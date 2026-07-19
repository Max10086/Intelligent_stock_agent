import { Type } from '@google/genai';
import {
  AnalysisState,
  CompanyAnalysis,
  CompanyProfile,
  Language,
  QnAResult,
  GroundingSource,
  InvestmentConclusion,
  FinalConclusion,
} from '../../types.js';
import { getRuntimeModelConfig } from '../aiModelConfig.js';
import { ModelClient } from './modelClient.js';
import { cleanupBrokenNumericFormatting, mergeBrokenEvidenceFragments } from '../../utils/textNormalize.js';
import { buildFinalConclusionPrompt, buildFinalConclusionStrictRetrySuffix, buildFollowUpFinalConclusionStrictRetrySuffix, FINAL_CONCLUSION_RESPONSE_SCHEMA } from '../../utils/finalConclusionPrompt.js';
import { getFinalConclusionQualityIssues, hasUsableFinalConclusion } from '../../utils/analysisComplete.js';
import { normalizeInvestmentConclusion } from '../../utils/investmentConclusionNormalize.js';
import { normalizeFinalConclusion } from '../../utils/finalConclusionNormalize.js';
import { parseModelJsonResponse } from '../../utils/modelJson.js';
import {
  hasUsableInvestmentConclusion,
  THESIS_SECTION_KEYS,
} from '../../utils/synthesizeConclusionPrompt.js';
import { synthesizeInvestmentConclusionBySections } from '../../utils/synthesizeConclusionOrchestrator.js';
import type { ThesisSectionKey } from '../../utils/synthesizeConclusionPrompt.js';
import { QNA_CONCURRENCY, runParallelIndexedTasks } from '../../utils/parallelTasks.js';
import { indexAnsweredQuestions, orderQnaByQuestions, countAnsweredQuestions } from '../../utils/qnaHelpers.js';
import { buildGenerateQuestionsPrompt } from '../../utils/questionGenerationPrompt.js';
import { generateQuestionsInBatches } from '../../utils/questionGenerationBatches.js';
import { buildRecencyGuidance } from '../../utils/recencyGuidance.js';
import { buildAnswerQuestionPrompt, buildVerifiedMarketContext } from '../../utils/marketSnapshot.js';
import {
  applyStrategicEventAnswerRetries,
  buildAnswerPromptForQuestion,
  resolveStrategicEventSearchQueries,
} from '../../utils/strategicEventsAnswer.js';
import {
  buildQuickTakeIdentityRule,
  buildWrongCompanyRetryAppendix,
  detectWrongCompanyMix,
} from '../../utils/companyIdentity.js';
import { buildMarketCapPromptRule, formatMarketCapForPrompt } from '../../utils/priceFormat.js';
import { resolveMarketCurrency } from '../../utils/marketCurrency.js';
import { sanitizeQuickTakeMarketCap } from '../../utils/marketCapTextSanitize.js';
import { pickLanguageValidQuestions } from '../../utils/questionLanguage.js';
import {
  buildExpectationGapQuestionsPrompt,
  EXPECTATION_GAP_QUESTION_COUNT,
  getCoreQuestionCount,
} from '../../utils/expectationGapPrompt.js';
import { mergeAllResearchQuestions } from '../../utils/mergeQuestionSets.js';
import { buildStrategicEventsQuestions } from '../../utils/strategicEventsPrompt.js';
import {
  buildMaterialEventsDigestForFinalConclusion,
  extractMaterialEventsFromQna,
  type MaterialEvent,
} from '../../utils/materialEventsExtract.js';
import { isUnusableSearchAnswer } from '../../utils/qnaAnswerQuality.js';
// FIX: 删除了重复引用，保留这一行正确的
import { searchTicker, getFinancialData } from '../../services/finance.js';
import {
  alignConceptDiscoveryByMarket,
  buildFindCompaniesByConceptPrompt,
  buildFindCompetitorsPrompt,
  parseConceptDiscoveryResponse,
  prioritizeCompetitorsByMarket,
  runCompetitorDiscovery,
} from '../../utils/companyDiscovery.js';

// This service contains the analysis logic ported from useStockAgent.ts
// It can be used by both the worker and API routes

export type ProgressCallback = (progress: number, step: string, log?: string) => void | Promise<void>;

const getFirstString = (obj: any, keys: string[]): string => {
  for (const key of keys) {
    const value = obj?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
};

const normalizeEvidenceItem = (value: any): string => {
  if (typeof value === 'string') return cleanupBrokenNumericFormatting(value);
  if (typeof value === 'number' || typeof value === 'boolean') return cleanupBrokenNumericFormatting(String(value));
  if (value && typeof value === 'object') {
    const fromKnownKeys = getFirstString(value, [
      'evidence',
      'text',
      'detail',
      'fact',
      'data',
      'value',
      'source',
      'content',
    ]);
    if (fromKnownKeys) return cleanupBrokenNumericFormatting(fromKnownKeys);
    try {
      return cleanupBrokenNumericFormatting(JSON.stringify(value));
    } catch {
      return '';
    }
  }
  return '';
};

const normalizeEvidenceList = (value: any): string[] => {
  if (Array.isArray(value)) {
    const items = value
      .map(normalizeEvidenceItem)
      .map(v => v.trim())
      .filter(Boolean);
    return mergeBrokenEvidenceFragments(items);
  }
  if (typeof value === 'string' && value.trim()) {
    // Preserve evidence as complete prose. Splitting on single newlines can break dates like 2026-06-17.
    return [cleanupBrokenNumericFormatting(value)].filter(Boolean);
  }
  if (value && typeof value === 'object') {
    const single = normalizeEvidenceItem(value);
    return single ? [single] : [];
  }
  return [];
};

export class AnalysisService {
  constructor(private modelClient: ModelClient) {}

  private isValidCompanyProfile(item: any): item is Pick<CompanyProfile, 'name' | 'ticker' | 'exchange'> {
    return Boolean(
      item &&
        typeof item.name === 'string' &&
        item.name.trim() &&
        typeof item.ticker === 'string' &&
        item.ticker.trim() &&
        typeof item.exchange === 'string' &&
        item.exchange.trim()
    );
  }

  async findCompetitors(
    focusCompany: Pick<CompanyProfile, 'name' | 'ticker' | 'exchange'>,
    lang: Language
  ): Promise<Pick<CompanyProfile, 'name' | 'ticker' | 'exchange'>[]> {
    const outputLanguage = lang === 'cn' ? 'Simplified Chinese' : 'English';
    const companySchema = {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING, description: "Company's official name" },
        ticker: { type: Type.STRING, description: "Company's primary stock ticker" },
        exchange: { type: Type.STRING, description: 'NASDAQ, NYSE, AMEX, HKEX, SSE, or SZSE' },
      },
      required: ['name', 'ticker', 'exchange'],
    };
    const responseSchema = {
      type: Type.OBJECT,
      properties: {
        competitors: { type: Type.ARRAY, items: companySchema },
      },
      required: ['competitors'],
    };

    const competitors = await runCompetitorDiscovery(focusCompany, async ({ strictRetry, allowCrossMarket }) => {
      const response = await this.modelClient.generateContent({
        step: 'company_discovery',
        contents: {
          role: 'user',
          parts: [{
            text: buildFindCompetitorsPrompt(focusCompany, outputLanguage, { strictRetry, allowCrossMarket }),
          }],
        },
        config: {
          responseMimeType: 'application/json',
          responseSchema,
        },
      });
      return response.text || '';
    });

    if (competitors.length === 0) {
      console.warn(
        `[company_discovery] no competitors for ${focusCompany.name} (${focusCompany.ticker})`
      );
    }
    return competitors;
  }

  async findCompaniesByConcept(
    query: string,
    lang: Language
  ): Promise<Pick<CompanyProfile, 'name' | 'ticker' | 'exchange'>[]> {
    const outputLanguage = lang === 'cn' ? 'Simplified Chinese' : 'English';
    const companySchema = {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING, description: "Company's official name" },
        ticker: { type: Type.STRING, description: "Company's primary stock ticker" },
        exchange: { type: Type.STRING, description: 'NASDAQ, NYSE, AMEX, HKEX, SSE, or SZSE' },
      },
      required: ['name', 'ticker', 'exchange'],
    };
    const responseSchema = {
      type: Type.OBJECT,
      properties: {
        focusCompany: companySchema,
        candidateCompanies: { type: Type.ARRAY, items: companySchema },
      },
      required: ['focusCompany', 'candidateCompanies'],
    };

    const callDiscovery = async (strict: boolean) => {
      const response = await this.modelClient.generateContent({
        step: 'company_discovery',
        contents: {
          role: 'user',
          parts: [{ text: buildFindCompaniesByConceptPrompt(query, outputLanguage, strict) }],
        },
        config: {
          responseMimeType: 'application/json',
          responseSchema,
        },
      });
      return response.text || '';
    };

    let companies = parseConceptDiscoveryResponse(await callDiscovery(false));
    if (companies.length === 0) {
      companies = parseConceptDiscoveryResponse(await callDiscovery(true));
    }
    if (companies.length === 0) {
      throw new Error('Failed to identify companies from concept.');
    }
    return alignConceptDiscoveryByMarket(companies);
  }

  async generateExpectationGapQuestions(
    company: Pick<CompanyProfile, 'name' | 'ticker' | 'exchange'>,
    lang: Language
  ): Promise<string[]> {
    const outputLanguage = lang === 'cn' ? 'Simplified Chinese' : 'English';
    const recencyGuidance = buildRecencyGuidance(new Date(), lang);

    const callOnce = async (strictLanguageRetry: boolean) => {
      const prompt = buildExpectationGapQuestionsPrompt(
        company,
        outputLanguage,
        recencyGuidance,
        strictLanguageRetry
      );
      const response = await this.modelClient.generateContent({
        step: 'question_generation',
        contents: { role: 'user', parts: [{ text: prompt }] },
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              questions: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: ['questions'],
          },
        },
      });
      const parsed = parseModelJsonResponse(response.text || '{}') as { questions?: string[] };
      const questions = Array.isArray(parsed.questions) ? parsed.questions : [];
      return questions.slice(0, EXPECTATION_GAP_QUESTION_COUNT);
    };

    const raw = await callOnce(false);
    return pickLanguageValidQuestions(raw, lang, () => callOnce(true), EXPECTATION_GAP_QUESTION_COUNT);
  }

  async generateQuestions(
    company: Pick<CompanyProfile, 'name' | 'ticker' | 'exchange'>,
    lang: Language,
    questionCount: number
  ): Promise<string[]> {
    const outputLanguage = lang === 'cn' ? 'Simplified Chinese' : 'English';
    const now = new Date();
    const recencyGuidance = buildRecencyGuidance(now, lang);
    const coreCount = getCoreQuestionCount(questionCount);

    const callBatch = async (
      batchSize: number,
      batchIndex: number,
      batchTotal: number,
      priorQuestionCount: number,
      strictLanguageRetry: boolean
    ) => {
      const prompt = buildGenerateQuestionsPrompt(
        company,
        outputLanguage,
        batchSize,
        recencyGuidance,
        { batchIndex, batchTotal, priorQuestionCount },
        strictLanguageRetry
      );
      const response = await this.modelClient.generateContent({
        step: 'question_generation',
        contents: { role: 'user', parts: [{ text: prompt }] },
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              questions: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: ['questions'],
          },
        },
      });
      const parsed = parseModelJsonResponse(response.text || '{}') as { questions?: string[] };
      const questions = Array.isArray(parsed.questions) ? parsed.questions : [];
      return questions.slice(0, batchSize);
    };

    const standardQuestions = await generateQuestionsInBatches(coreCount, async (batchSize, batchIndex, batchTotal, priorQuestionCount) => {
      const raw = await callBatch(batchSize, batchIndex, batchTotal, priorQuestionCount, false);
      return pickLanguageValidQuestions(raw, lang, () =>
        callBatch(batchSize, batchIndex, batchTotal, priorQuestionCount, true),
        batchSize
      );
    });

    const gapQuestions = await this.generateExpectationGapQuestions(company, lang);
    const strategicQuestions = buildStrategicEventsQuestions(company, lang);
    return mergeAllResearchQuestions(standardQuestions, strategicQuestions, gapQuestions, questionCount);
  }

  private async extractMaterialEvents(
    company: CompanyProfile,
    qna: QnAResult[],
    lang: Language,
    step: 'extract_material_events' | 'follow_up_extract_material_events' = 'extract_material_events'
  ): Promise<MaterialEvent[]> {
    return extractMaterialEventsFromQna({
      companyName: company.name,
      lang,
      qna: qna.map(item => ({
        question: item.question,
        answer: item.answer,
        sources: item.sources,
      })),
      callModel: async prompt => {
        const response = await this.modelClient.generateContent({
          step,
          contents: { role: 'user', parts: [{ text: prompt }] },
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                events: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      date: { type: Type.STRING },
                      headline: { type: Type.STRING },
                      partners: { type: Type.ARRAY, items: { type: Type.STRING } },
                      category: { type: Type.STRING },
                      status: { type: Type.STRING },
                      investment_relevance: { type: Type.STRING },
                    },
                    required: ['headline', 'category', 'status', 'investment_relevance'],
                  },
                },
              },
              required: ['events'],
            },
          },
        });
        return response.text || '{}';
      },
    });
  }

  async answerQuestion(
    question: string,
    company: CompanyProfile,
    lang: Language,
    onProgress?: (message: string) => void | Promise<void>
  ): Promise<QnAResult> {
    const outputLanguage = lang === 'cn' ? 'Simplified Chinese' : 'English';
    const now = new Date();
    
    // Notify before starting Google Search
    if (onProgress) {
      await onProgress(`Searching web for: ${question.substring(0, 60)}...`);
    }
    
    const basePrompt = buildAnswerPromptForQuestion({
      question,
      profile: company,
      outputLanguage,
      recencyGuidance: buildRecencyGuidance(now, lang),
      lang,
    });
    const searchQueries = resolveStrategicEventSearchQueries(question, company, lang);

    const callSearch = async (prompt: string) => {
      const response = await this.modelClient.generateContent({
        step: 'answer_question',
        contents: { role: 'user', parts: [{ text: prompt }] },
        config: {
          tools: [{ googleSearch: {} }],
        },
        requireGoogleSearch: true,
        searchQueries,
      });
      const sources: GroundingSource[] =
        response.candidates?.[0]?.groundingMetadata?.groundingChunks
          ?.map((chunk: any) => chunk.web)
          .filter(Boolean) ?? [];
      return { answer: response.text || '', sources };
    };

    let { answer, sources } = await callSearch(basePrompt);

    if (onProgress) {
      await onProgress(`Found ${sources.length} sources, synthesizing answer...`);
    }

    if (isUnusableSearchAnswer(answer)) {
      throw new Error(`Search returned no usable evidence for question: ${question.substring(0, 80)}`);
    }

    ({ answer, sources } = await applyStrategicEventAnswerRetries({
      question,
      company,
      lang,
      basePrompt,
      initial: { answer, sources },
      callSearch,
    }));

    const mixCheck = detectWrongCompanyMix(answer, company);
    if (mixCheck.mixed) {
      console.warn(
        `[answerQuestion] Possible wrong-company mix for ${company.ticker}: ${mixCheck.reasons.join('; ')}`
      );
      const retry = await callSearch(
        `${basePrompt}${buildWrongCompanyRetryAppendix(company, lang, mixCheck.reasons)}`
      );
      if (!isUnusableSearchAnswer(retry.answer)) {
        answer = retry.answer;
        sources = retry.sources;
      }
    }

    return { question, answer, sources };
  }

  async synthesizeConclusion(
    company: CompanyProfile,
    qna: QnAResult[],
    lang: Language,
    materialEvents?: MaterialEvent[]
  ): Promise<InvestmentConclusion> {
    const outputLanguage = lang === 'cn' ? 'Simplified Chinese' : 'English';
    const now = new Date();
    const marketContext = buildVerifiedMarketContext(company, lang);
    const buildSectionSchema = (sectionKey: ThesisSectionKey) => {
      if (sectionKey === 'ExpectationGap') {
        return {
          type: Type.OBJECT,
          properties: {
            gap_assessment: { type: Type.STRING },
            summary: { type: Type.STRING },
            evidence: { type: Type.ARRAY, items: { type: Type.STRING } },
          },
          required: ['gap_assessment', 'summary', 'evidence'],
        };
      }
      return {
        type: Type.OBJECT,
        properties: {
          summary: { type: Type.STRING },
          evidence: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ['summary', 'evidence'],
      };
    };

    const qnaPayload = qna.map(item => ({
      question: item.question,
      answer: item.answer,
      sources: item.sources,
    }));

    const events =
      materialEvents ?? (await this.extractMaterialEvents(company, qna, lang, 'extract_material_events'));

    return synthesizeInvestmentConclusionBySections({
      companyName: company.name,
      outputLanguage,
      recencyGuidance: buildRecencyGuidance(now, lang),
      qna: qnaPayload,
      marketContext,
      materialEvents: events,
      lang,
      callSection: async (sectionKey: ThesisSectionKey, prompt: string) => {
        const response = await this.modelClient.generateContent({
          step: 'synthesize_conclusion_section',
          contents: { role: 'user', parts: [{ text: prompt }] },
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                [sectionKey]: buildSectionSchema(sectionKey),
              },
              required: [sectionKey],
            },
          },
        });
        const normalized = normalizeInvestmentConclusion(parseModelJsonResponse(response.text || '{}'));
        return { sectionKey, section: normalized[sectionKey] };
      },
    });
  }

  async generateFinalConclusion(
    company: CompanyProfile,
    qna: QnAResult[],
    conclusion: InvestmentConclusion,
    lang: Language,
    materialEvents?: MaterialEvent[]
  ): Promise<FinalConclusion> {
    const outputLanguage = lang === 'cn' ? 'Simplified Chinese' : 'English';
    const now = new Date();
    const marketContext = buildVerifiedMarketContext(company, lang);
    const events =
      materialEvents ?? (await this.extractMaterialEvents(company, qna, lang, 'extract_material_events'));
    const materialEventsDigest = buildMaterialEventsDigestForFinalConclusion(events, lang);

    const finalConclusionSchema = {
      ...FINAL_CONCLUSION_RESPONSE_SCHEMA,
      properties: {
        ...FINAL_CONCLUSION_RESPONSE_SCHEMA.properties,
        overall_conclusion: {
          type: Type.STRING,
          description: `Clean sell-side executive summary prose for ${company.name}. No section headers.`,
        },
      },
    };

    const qualityOptions = {
      gapAssessment: conclusion.ExpectationGap?.gap_assessment ?? null,
    };

    const buildPrompt = (strict: boolean, qualityIssues: string[] = []) => {
      const base = buildFinalConclusionPrompt(
        company.name,
        outputLanguage,
        buildRecencyGuidance(now, lang),
        conclusion,
        qna.map(item => ({ question: item.question, answer: item.answer, sources: item.sources })),
        marketContext,
        materialEventsDigest
      );
      if (!strict) return base;
      return `${base}\n\n${buildFinalConclusionStrictRetrySuffix(qualityIssues)}`;
    };

    const callModel = async (strict: boolean, qualityIssues: string[] = []) => {
      const response = await this.modelClient.generateContent({
        step: 'final_conclusion',
        contents: { role: 'user', parts: [{ text: buildPrompt(strict, qualityIssues) }] },
        config: {
          responseMimeType: 'application/json',
          responseSchema: finalConclusionSchema,
        },
      });
      return normalizeFinalConclusion(parseModelJsonResponse(response.text || '{}'));
    };

    let finalConclusion = await callModel(false);
    let qualityIssues = getFinalConclusionQualityIssues(finalConclusion, qualityOptions);
    if (qualityIssues.length > 0) {
      console.warn(
        `[finalConclusion] Quality gate failed for ${company.ticker} (attempt 1):`,
        qualityIssues.join('; ')
      );
      finalConclusion = await callModel(true, qualityIssues);
      qualityIssues = getFinalConclusionQualityIssues(finalConclusion, qualityOptions);
    }
    if (qualityIssues.length > 0) {
      console.warn(
        `[finalConclusion] Quality gate failed for ${company.ticker} (attempt 2):`,
        qualityIssues.join('; ')
      );
      finalConclusion = await callModel(true, qualityIssues);
      qualityIssues = getFinalConclusionQualityIssues(finalConclusion, qualityOptions);
    }
    if (!hasUsableFinalConclusion(finalConclusion, qualityOptions)) {
      console.error(
        `[finalConclusion] Giving up for ${company.ticker} after 3 attempts:`,
        qualityIssues.join('; ')
      );
      throw new Error(`Failed to generate a usable final investment conclusion for ${company.name}.`);
    }
    return finalConclusion;
  }

  async generateCompanyQuickTake(
    company: CompanyProfile,
    lang: Language
  ): Promise<string> {
    const outputLanguage = lang === 'cn' ? 'Simplified Chinese' : 'English';
    const resolvedCurrency = resolveMarketCurrency(company.exchange, company.currency);
    const marketCapLabel = formatMarketCapForPrompt(
      company.marketCap,
      lang,
      company.exchange,
      resolvedCurrency
    );
    const floatMarketCapLabel = formatMarketCapForPrompt(
      company.floatMarketCap,
      lang,
      company.exchange,
      resolvedCurrency
    );
    const marketCapRule = buildMarketCapPromptRule(
      marketCapLabel,
      company.exchange,
      resolvedCurrency,
      lang
    );
    const prompt = `You are writing a sharp "at-a-glance" company brief in ${outputLanguage}.

Target company:
- Name: ${company.name}
- Ticker/Exchange: ${company.ticker} (${company.exchange})
- Market cap (verified): ${marketCapLabel}
- Float market cap (verified): ${floatMarketCapLabel}

Reference writing style (must emulate this level of concreteness and directness):
"Rocket Lab (RKLB) is the second-largest commercial space company in the U.S. after SpaceX, and a key player in high-frequency small-satellite launches. Its core model is an end-to-end space stack: it not only earns launch revenue, but also manufactures satellites and mission-critical components, offering integrated build+launch services to monetize across the full value chain."

Hard requirements:
1) Output EXACTLY 2 sentences.
2) Sentence 1: state company identity + relative position/role in its market + scale signal. If mentioning market cap, copy the verified market cap text exactly: 「${marketCapLabel}」.
3) Sentence 2: explain the monetization model concretely (how it makes money, key products/services, value-chain position).
4) Use concrete industry wording; no generic filler.
5) Forbidden vague phrases (or their equivalents): "core product and service model", "certain differentiation", "comprehensive conclusion", "etc.".
6) No markdown, no bullet points, no disclaimer.
${marketCapRule}
${buildQuickTakeIdentityRule(company, lang)}`;

    const response = await this.modelClient.generateContent({
      step: 'quick_take',
      contents: { role: 'user', parts: [{ text: prompt }] },
    });

    const raw = (response.text || '').replace(/\s+/g, ' ').trim();
    return sanitizeQuickTakeMarketCap(raw, company, lang);
  }

  async runAnalysisForCompany(
    company: CompanyProfile,
    lang: Language,
    questionCount: number,
    onProgress?: ProgressCallback,
    existing?: Pick<CompanyAnalysis, 'questions' | 'qna' | 'conclusion' | 'finalConclusion'> | null,
    onCheckpoint?: (partial: Pick<CompanyAnalysis, 'questions' | 'qna' | 'conclusion' | 'finalConclusion'>) => void | Promise<void>
  ): Promise<{ questions: string[]; qna: QnAResult[]; conclusion: InvestmentConclusion; finalConclusion: FinalConclusion }> {
    const log = async (progress: number, step: string, message?: string) => {
      const logMessage = message || step;
      if (onProgress) {
        await onProgress(progress, step, logMessage);
      }
    };

    const existingQuestions = Array.isArray(existing?.questions) ? existing!.questions : [];
    const existingQna = Array.isArray(existing?.qna) ? existing!.qna : [];
    const existingConclusion = hasUsableInvestmentConclusion(existing?.conclusion) ? existing!.conclusion! : null;
    const existingFinalConclusion = hasUsableFinalConclusion(existing?.finalConclusion)
      ? existing!.finalConclusion!
      : null;

    let questions = existingQuestions;
    if (!questions.length) {
      await log(5, 'Deconstructing narrative...', `Analyzing ${company.name} investment thesis`);
      questions = await this.generateQuestions(company, lang, questionCount);
      await log(10, 'Questions Generated', `Created ${questions.length} research questions`);
    }

    const totalQuestions = questions.length || questionCount;
    const { qnaByQuestion, pendingIndices } = indexAnsweredQuestions(questions, existingQna);
    let completedCount = countAnsweredQuestions(questions, qnaByQuestion);

    const reportQnaProgress = async (completed: number) => {
      const safeCompleted = Math.min(completed, totalQuestions);
      const questionProgress = 10 + (safeCompleted / totalQuestions) * 60;
      await log(
        questionProgress,
        `Completed ${safeCompleted}/${totalQuestions} questions`,
        `${safeCompleted} of ${totalQuestions} questions answered`
      );
    };

    await reportQnaProgress(completedCount);

    if (pendingIndices.length > 0) {
      const pendingTasks = pendingIndices.map(index => ({
        index,
        item: questions[index],
      }));

      await runParallelIndexedTasks<string, QnAResult>(
        pendingTasks,
        async task => this.answerQuestion(task.item, company, lang),
        {
          concurrency: QNA_CONCURRENCY,
          onTaskComplete: async (result, task) => {
            const questionKey = questions[task.index];
            qnaByQuestion.set(questionKey, { ...result, question: questionKey });
            completedCount = countAnsweredQuestions(questions, qnaByQuestion);
            await reportQnaProgress(completedCount);
            const questionProgress = 10 + (Math.min(completedCount, totalQuestions) / totalQuestions) * 60;
            await log(
              questionProgress,
              `Completed ${Math.min(completedCount, totalQuestions)}/${totalQuestions} questions`,
              `Answered: ${task.item.substring(0, 60)}... (${result.sources.length} sources)`
            );
          },
        }
      );
    }

    const qnaResults = orderQnaByQuestions(questions, qnaByQuestion);
    if (qnaResults.length < questions.length) {
      throw new Error(
        `Only ${qnaResults.length}/${questions.length} questions answered for ${company.name}. Retry to continue remaining items.`
      );
    }

    let conclusion = existingConclusion;
    let finalConclusion = existingFinalConclusion;
    let materialEvents: MaterialEvent[] | undefined;

    if (!conclusion) {
      if (onCheckpoint) {
        await onCheckpoint({
          questions,
          qna: qnaResults,
          conclusion: null,
          finalConclusion: null,
        });
      }
      await log(75, 'Synthesizing final report...', 'Analyzing Q&A results and generating investment thesis');
      materialEvents = await this.extractMaterialEvents(company, qnaResults, lang);
      await log(78, 'Material events extracted', `${materialEvents.length} events for thesis synthesis`);
      conclusion = await this.synthesizeConclusion(company, qnaResults, lang, materialEvents);
      await log(85, 'Conclusion Synthesized', 'Investment thesis generated');
    }

    if (!finalConclusion) {
      if (onCheckpoint && conclusion) {
        await onCheckpoint({
          questions,
          qna: qnaResults,
          conclusion,
          finalConclusion: null,
        });
      }
      await log(90, 'Generating Final Conclusion', 'Creating executive summary');
      materialEvents =
        materialEvents ?? (await this.extractMaterialEvents(company, qnaResults, lang));
      finalConclusion = await this.generateFinalConclusion(
        company,
        qnaResults,
        conclusion!,
        lang,
        materialEvents
      );
    }
    await log(100, 'Analysis Complete', `${company.name} analysis finished`);

    return {
      questions,
      qna: qnaResults,
      conclusion: conclusion!,
      finalConclusion: finalConclusion!,
    };
  }

  async runFullAnalysis(
    query: string,
    lang: Language,
    onProgress?: ProgressCallback,
    options?: {
      analyzeCandidates?: boolean;
      resumeFrom?: AnalysisState | null;
      onCheckpoint?: (state: AnalysisState) => void | Promise<void>;
    }
  ): Promise<AnalysisState> {
    const analyzeCandidates = options?.analyzeCandidates ?? false;
    const resume = options?.resumeFrom ?? null;
    const runtimeConfig = getRuntimeModelConfig();
    const id = resume?.id ?? Date.now().toString();
    const timestamp = resume?.timestamp ?? new Date().toISOString();

    const saveCheckpoint = async (
      partial: Pick<
        AnalysisState,
        'currentProgress' | 'currentStage' | 'focusCompany' | 'candidateCompanies' | 'status'
      >
    ) => {
      if (!options?.onCheckpoint) return;
      await options.onCheckpoint({
        id,
        timestamp,
        language: lang,
        query,
        status: partial.status ?? 'partial',
        error: null,
        currentStage: partial.currentStage,
        currentProgress: partial.currentProgress,
        focusCompany: partial.focusCompany ?? null,
        candidateCompanies: partial.candidateCompanies ?? [],
        stepLogs: resume?.stepLogs ?? [],
      });
    };

    const log = async (progress: number, step: string, message?: string) => {
      const logMessage = message || step;
      console.log(`[${progress}%] ${step}${message ? `: ${message}` : ''}`);
      if (onProgress) {
        await onProgress(progress, step, logMessage);
      }
    };

    const resumedFocus = resume?.focusCompany;
    const canResumeFromProfile = Boolean(resumedFocus?.profile?.ticker);

    if (canResumeFromProfile) {
      await log(5, 'Resuming Analysis', `Continuing from checkpoint for ${resumedFocus!.profile.name}`);
    } else {
      await log(5, 'Starting Analysis', `Query: ${query}`);
    }

    let focusProfile: CompanyProfile;
    let candidateProfiles: CompanyProfile[];
    let quickTakes: (string | null)[];

    if (canResumeFromProfile) {
      focusProfile = resumedFocus!.profile;
      candidateProfiles = (resume?.candidateCompanies || [])
        .map(c => c.profile)
        .filter(Boolean) as CompanyProfile[];
      quickTakes = [
        resumedFocus!.quickTake ?? null,
        ...(resume?.candidateCompanies || []).map(c => c.quickTake ?? null),
      ];
      await log(55, 'Resuming Focus Company', `${focusProfile.name} (${focusProfile.ticker})`);
    } else {
      // Find companies
      let companyProfiles: Pick<CompanyProfile, 'name' | 'ticker' | 'exchange'>[] = [];

      await log(10, 'Searching for Companies', `Looking up ticker: ${query}`);
      const exactMatch = await searchTicker(query);

      if (exactMatch) {
        await log(15, 'Finding Competitors', `Found exact match: ${exactMatch.name} (${exactMatch.ticker})`);
        let competitors = await this.findCompetitors(exactMatch, lang);
        if (competitors.length === 0) {
          try {
            const conceptCandidates = await this.findCompaniesByConcept(exactMatch.name, lang);
            competitors = prioritizeCompetitorsByMarket(
              exactMatch,
              conceptCandidates.filter(c => c.ticker.toUpperCase() !== exactMatch.ticker.toUpperCase()),
              2
            );
          } catch {
            // keep empty competitors if fallback discovery also fails
          }
        }
        companyProfiles = [exactMatch, ...competitors];
        await log(20, 'Competitors Found', `Found ${competitors.length} competitors`);
      } else {
        await log(15, 'Searching by Concept', `No exact match found, searching by concept`);
        try {
          companyProfiles = await this.findCompaniesByConcept(query, lang);
        } catch (conceptError) {
          const fallbackMatch = await searchTicker(query);
          if (fallbackMatch) {
            const competitors = await this.findCompetitors(fallbackMatch, lang);
            companyProfiles = [fallbackMatch, ...competitors];
          } else {
            throw conceptError;
          }
        }
        await log(20, 'Companies Found', `Found ${companyProfiles.length} companies`);
      }

      companyProfiles = companyProfiles.filter(c => this.isValidCompanyProfile(c));

      if (companyProfiles.length === 0) {
        throw new Error("Could not identify any companies for the given query.");
      }

      await log(25, 'Fetching Financial Data', `Enriching ${companyProfiles.length} company profiles`);
      const enrichedProfiles = await Promise.all(
        companyProfiles.map(async (p, index) => {
          await log(25 + (index + 1) * 5, 'Fetching Financial Data', `${p.name} (${p.ticker})`);
          return getFinancialData(p);
        })
      );
      await log(50, 'Financial Data Loaded', 'All company profiles enriched');

      focusProfile = enrichedProfiles[0];
      candidateProfiles = enrichedProfiles.slice(1);
      await log(52, 'Generating Company Snapshots', 'Creating quick company overviews');
      quickTakes = await Promise.all(
        enrichedProfiles.map(async profile => this.generateCompanyQuickTake(profile, lang))
      );
    }

    const buildCandidateAnalyses = (): CompanyAnalysis[] =>
      candidateProfiles.map((profile, i) => {
        const resumed = resume?.candidateCompanies?.find(c => c.id === profile.ticker);
        if (resumed) return resumed;
        return {
          id: profile.ticker,
          profile,
          quickTake: quickTakes[i + 1] || null,
          status: 'awaiting_user' as const,
          questions: [],
          qna: [],
          conclusion: null,
          finalConclusion: null,
          followUpQuestions: [],
        };
      });

    const focusCheckpointWrapper = async (
      partial: Pick<CompanyAnalysis, 'questions' | 'qna' | 'conclusion' | 'finalConclusion'>
    ) => {
      await saveCheckpoint({
        status: 'partial',
        currentProgress: 72,
        currentStage: 'Generating Final Conclusion',
        focusCompany: {
          id: focusProfile.ticker,
          profile: focusProfile,
          quickTake: quickTakes[0] || null,
          status: partial.finalConclusion
            ? 'complete'
            : partial.conclusion
              ? 'synthesizing'
              : partial.qna?.length
                ? 'answering_questions'
                : 'generating_questions',
          questions: partial.questions,
          qna: partial.qna,
          conclusion: partial.conclusion,
          finalConclusion: partial.finalConclusion,
          followUpQuestions: [],
        },
        candidateCompanies: buildCandidateAnalyses(),
      });
    };

    // Analyze focus company
    if (!canResumeFromProfile) {
      await log(55, 'Analyzing Focus Company', `${focusProfile.name} (${focusProfile.ticker})`);
    }
    const focusAnalysis = await this.runAnalysisForCompany(
      focusProfile,
      lang,
      runtimeConfig.questions.focus,
      async (progress, step, message) => {
        const overallProgress = 55 + Math.floor(progress * 0.2);
        await log(overallProgress, `Focus Company: ${step}`, message);
      },
      canResumeFromProfile ? resumedFocus : null,
      focusCheckpointWrapper
    );
    
    const focusCompanyAnalysis: CompanyAnalysis = {
      id: focusProfile.ticker,
      profile: focusProfile,
      quickTake: quickTakes[0] || null,
      status: 'complete',
      questions: focusAnalysis.questions,
      qna: focusAnalysis.qna,
      conclusion: focusAnalysis.conclusion,
      finalConclusion: focusAnalysis.finalConclusion,
      followUpQuestions: [],
    };
    await log(75, 'Focus Company Analysis Complete', `${focusProfile.name}`);

    const candidateAnalyses: CompanyAnalysis[] = [];

    if (analyzeCandidates) {
      // Optional full run: analyze every candidate (not used by batch queue — saves tokens)
      for (let i = 0; i < candidateProfiles.length; i++) {
        const profile = candidateProfiles[i];
        await log(75 + i * 5, 'Analyzing Candidate Company', `${profile.name} (${profile.ticker})`);
        try {
          const analysis = await this.runAnalysisForCompany(
            profile,
            lang,
            runtimeConfig.questions.candidate,
            async (progress, step, message) => {
              const baseProgress = 75 + i * 5;
              const overallProgress = baseProgress + Math.floor(progress * 0.05);
              await log(overallProgress, `Candidate ${i + 1}: ${step}`, message);
            }
          );
          candidateAnalyses.push({
            id: profile.ticker,
            profile,
            quickTake: quickTakes[i + 1] || null,
            status: 'complete',
            questions: analysis.questions,
            qna: analysis.qna,
            conclusion: analysis.conclusion,
            finalConclusion: analysis.finalConclusion,
            followUpQuestions: [],
          });
        } catch (candidateError) {
          const message =
            candidateError instanceof Error ? candidateError.message : String(candidateError);
          console.error(`Candidate analysis failed for ${profile.name}:`, message);
          await log(75 + i * 5, 'Candidate Analysis Failed', `${profile.name}: ${message}`);
          candidateAnalyses.push({
            id: profile.ticker,
            profile,
            quickTake: quickTakes[i + 1] || null,
            status: 'error',
            questions: [],
            qna: [],
            conclusion: null,
            finalConclusion: null,
            followUpQuestions: [],
            error: message,
          });
        }
      }
      await log(
        95,
        'All Companies Analyzed',
        `Completed analysis for ${1 + candidateProfiles.length} companies`
      );
    } else {
      for (let i = 0; i < candidateProfiles.length; i++) {
        const profile = candidateProfiles[i];
        const resumed = resume?.candidateCompanies?.find(c => c.id === profile.ticker);
        candidateAnalyses.push(
          resumed ?? {
            id: profile.ticker,
            profile,
            quickTake: quickTakes[i + 1] || null,
            status: 'awaiting_user',
            questions: [],
            qna: [],
            conclusion: null,
            finalConclusion: null,
            followUpQuestions: [],
          }
        );
      }
      await log(
        85,
        'Candidates Ready',
        candidateProfiles.length > 0
          ? `${candidateProfiles.length} competitor(s) await manual analysis`
          : 'No competitors identified'
      );
    }

    const focusComplete = Boolean(focusCompanyAnalysis.finalConclusion);
    const hasCandidateErrors = candidateAnalyses.some(c => c.status === 'error');
    const allCandidatesComplete =
      candidateAnalyses.length === 0 ||
      candidateAnalyses.every(c => c.status === 'complete');
    const analysisState: AnalysisState = {
      id,
      timestamp,
      status:
        focusComplete && allCandidatesComplete && !hasCandidateErrors
          ? 'complete'
          : focusComplete
            ? 'partial'
            : 'error',
      language: lang,
      query,
      focusCompany: focusCompanyAnalysis,
      candidateCompanies: candidateAnalyses,
      error: null,
      currentStage: analyzeCandidates ? 'Analysis Complete' : 'Focus Analysis Complete',
      currentProgress: 100,
    };

    await log(
      100,
      analyzeCandidates ? 'Analysis Complete' : 'Focus Analysis Complete',
      analyzeCandidates ? 'Finalizing report' : 'Focus company report ready'
    );
    return analysisState;
  }
}