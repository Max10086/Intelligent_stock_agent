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
import { buildFinalConclusionPrompt, buildFinalConclusionStrictRetrySuffix } from '../../utils/finalConclusionPrompt.js';
import { normalizeInvestmentConclusion } from '../../utils/investmentConclusionNormalize.js';
import { parseModelJsonResponse } from '../../utils/modelJson.js';
import {
  hasUsableInvestmentConclusion,
  THESIS_SECTION_KEYS,
} from '../../utils/synthesizeConclusionPrompt.js';
import { synthesizeInvestmentConclusionBySections } from '../../utils/synthesizeConclusionOrchestrator.js';
import type { ThesisSectionKey } from '../../utils/synthesizeConclusionPrompt.js';
import { QNA_CONCURRENCY, runParallelIndexedTasks } from '../../utils/parallelTasks.js';
import { indexAnsweredQuestions, orderQnaByQuestions } from '../../utils/qnaHelpers.js';
import { buildGenerateQuestionsPrompt } from '../../utils/questionGenerationPrompt.js';
import { generateQuestionsInBatches } from '../../utils/questionGenerationBatches.js';
import { buildRecencyGuidance } from '../../utils/recencyGuidance.js';
import { pickLanguageValidQuestions } from '../../utils/questionLanguage.js';
import { isUnusableSearchAnswer } from '../../utils/qnaAnswerQuality.js';
// FIX: 删除了重复引用，保留这一行正确的
import { searchTicker, getFinancialData } from '../../services/finance.js';
import {
  buildFindCompaniesByConceptPrompt,
  buildFindCompetitorsPrompt,
  parseCompetitorsResponse,
  parseConceptDiscoveryResponse,
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

const normalizeFinalBulletPoint = (point: any) => {
  if (typeof point === 'string') {
    return { argument: point.trim(), evidence: [] as string[] };
  }
  return {
    argument: cleanupBrokenNumericFormatting(getFirstString(point, ['argument', 'claim', 'point', 'thesis', 'summary'])),
    evidence: normalizeEvidenceList(
      point?.evidence ??
        point?.supporting_evidence ??
        point?.supportingEvidence ??
        point?.data_points ??
        point?.dataPoints ??
        point?.facts ??
        point?.proof
    ),
  };
};

const normalizeFinalConclusion = (raw: any): FinalConclusion => {
  const bulletRaw =
    raw?.bullet_points ??
    raw?.bulletPoints ??
    raw?.key_points ??
    raw?.keyPoints ??
    raw?.points ??
    raw?.arguments ??
    [];
  const bulletPoints = Array.isArray(bulletRaw)
    ? bulletRaw.map(normalizeFinalBulletPoint)
    : normalizeEvidenceList(bulletRaw).map(text => ({ argument: text, evidence: [] as string[] }));

  return {
    overall_conclusion: cleanupBrokenNumericFormatting(getFirstString(raw, [
      'overall_conclusion',
      'overallConclusion',
      'conclusion',
      'recommendation',
      'verdict',
    ])),
    bullet_points: bulletPoints.filter(point => point.argument || point.evidence.length > 0),
  };
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
    focusCompany: Pick<CompanyProfile, 'name' | 'ticker'>,
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

    const callDiscovery = async (strict: boolean) => {
      const response = await this.modelClient.generateContent({
        step: 'company_discovery',
        contents: {
          role: 'user',
          parts: [{ text: buildFindCompetitorsPrompt(focusCompany, outputLanguage, strict) }],
        },
        config: {
          responseMimeType: 'application/json',
          responseSchema,
        },
      });
      return response.text || '';
    };

    let competitors = parseCompetitorsResponse(await callDiscovery(false)).filter(
      c => c.ticker.toUpperCase() !== focusCompany.ticker.toUpperCase()
    );
    if (competitors.length === 0) {
      competitors = parseCompetitorsResponse(await callDiscovery(true)).filter(
        c => c.ticker.toUpperCase() !== focusCompany.ticker.toUpperCase()
      );
    }
    if (competitors.length === 0) {
      console.warn(
        `[company_discovery] no competitors for ${focusCompany.name} (${focusCompany.ticker})`
      );
    }
    return competitors.slice(0, 2);
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
    return companies.slice(0, 3);
  }

  async generateQuestions(companyName: string, lang: Language, questionCount: number): Promise<string[]> {
    const outputLanguage = lang === 'cn' ? 'Simplified Chinese' : 'English';
    const now = new Date();
    const recencyGuidance = buildRecencyGuidance(now, lang);

    const callBatch = async (
      batchSize: number,
      batchIndex: number,
      batchTotal: number,
      priorQuestionCount: number,
      strictLanguageRetry: boolean
    ) => {
      const prompt = buildGenerateQuestionsPrompt(
        companyName,
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

    return generateQuestionsInBatches(questionCount, async (batchSize, batchIndex, batchTotal, priorQuestionCount) => {
      const raw = await callBatch(batchSize, batchIndex, batchTotal, priorQuestionCount, false);
      return pickLanguageValidQuestions(raw, lang, () =>
        callBatch(batchSize, batchIndex, batchTotal, priorQuestionCount, true),
        batchSize
      );
    });
  }

  async answerQuestion(
    question: string,
    companyName: string,
    lang: Language,
    onProgress?: (message: string) => void | Promise<void>
  ): Promise<QnAResult> {
    const outputLanguage = lang === 'cn' ? 'Simplified Chinese' : 'English';
    const now = new Date();
    
    // Notify before starting Google Search
    if (onProgress) {
      await onProgress(`Searching web for: ${question.substring(0, 60)}...`);
    }
    
    const prompt = `As a financial analyst, answer this question about "${companyName}" in ${outputLanguage}: "${question}".
${buildRecencyGuidance(now, lang)}
Answer requirements:
- Use freshest available data first; older data is secondary context only.
- If the latest filing/period is unavailable, clearly disclose that limitation.
- For key facts, include period labels (e.g. YYYY-Qx, YYYY annual report, YYYY-MM).
- Cite sources.`;

    const response = await this.modelClient.generateContent({
      step: 'answer_question',
      contents: { role: 'user', parts: [{ text: prompt }] },
      config: {
        tools: [{ googleSearch: {} }],
      },
      requireGoogleSearch: true,
    });

    const sources: GroundingSource[] =
      response.candidates?.[0]?.groundingMetadata?.groundingChunks
        ?.map((chunk: any) => chunk.web)
        .filter(Boolean) ?? [];

    // Notify after search completes
    if (onProgress) {
      await onProgress(`Found ${sources.length} sources, synthesizing answer...`);
    }

    // FIX: 增加空值保底
    const answer = response.text || '';
    if (isUnusableSearchAnswer(answer)) {
      throw new Error(`Search returned no usable evidence for question: ${question.substring(0, 80)}`);
    }
    return { question, answer, sources };
  }

  async synthesizeConclusion(
    companyName: string,
    qna: QnAResult[],
    lang: Language
  ): Promise<InvestmentConclusion> {
    const outputLanguage = lang === 'cn' ? 'Simplified Chinese' : 'English';
    const now = new Date();
    const conclusionSectionSchema = {
      type: Type.OBJECT,
      properties: {
        summary: { type: Type.STRING },
        evidence: { type: Type.ARRAY, items: { type: Type.STRING } },
      },
      required: ['summary', 'evidence'],
    };

    const qnaPayload = qna.map(item => ({
      question: item.question,
      answer: item.answer,
      sources: item.sources,
    }));

    return synthesizeInvestmentConclusionBySections({
      companyName,
      outputLanguage,
      recencyGuidance: buildRecencyGuidance(now, lang),
      qna: qnaPayload,
      callSection: async (sectionKey: ThesisSectionKey, prompt: string) => {
        const response = await this.modelClient.generateContent({
          step: 'synthesize_conclusion_section',
          contents: { role: 'user', parts: [{ text: prompt }] },
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                [sectionKey]: conclusionSectionSchema,
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

  private hasUsableFinalConclusion(finalConclusion: FinalConclusion | null | undefined): boolean {
    if (!finalConclusion) return false;
    return Boolean(finalConclusion.overall_conclusion) ||
      (Array.isArray(finalConclusion.bullet_points) && finalConclusion.bullet_points.length > 0);
  }

  async generateFinalConclusion(
    companyName: string,
    qna: QnAResult[],
    conclusion: InvestmentConclusion,
    lang: Language
  ): Promise<FinalConclusion> {
    const outputLanguage = lang === 'cn' ? 'Simplified Chinese' : 'English';
    const now = new Date();

    const finalConclusionSchema = {
      type: Type.OBJECT,
      properties: {
        overall_conclusion: {
          type: Type.STRING,
          description: `Rating plus 3-5 sentence executive summary for ${companyName}.`,
        },
        bullet_points: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              argument: {
                type: Type.STRING,
                description: 'A single, key investment argument (pro or con).',
              },
              evidence: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: '2-3 specific data points supporting the argument.',
              },
            },
            required: ['argument', 'evidence'],
          },
        },
      },
      required: ['overall_conclusion', 'bullet_points'],
    };

    const buildPrompt = (strict: boolean) => {
      const base = buildFinalConclusionPrompt(
        companyName,
        outputLanguage,
        buildRecencyGuidance(now, lang),
        conclusion,
        qna.map(item => ({ question: item.question, answer: item.answer, sources: item.sources }))
      );
      if (!strict) return base;
      return `${base}\n\n${buildFinalConclusionStrictRetrySuffix()}`;
    };

    const callModel = async (strict: boolean) => {
      const response = await this.modelClient.generateContent({
        step: 'final_conclusion',
        contents: { role: 'user', parts: [{ text: buildPrompt(strict) }] },
        config: {
          responseMimeType: 'application/json',
          responseSchema: finalConclusionSchema,
        },
      });
      return normalizeFinalConclusion(parseModelJsonResponse(response.text || '{}'));
    };

    let finalConclusion = await callModel(false);
    if (!this.hasUsableFinalConclusion(finalConclusion)) {
      finalConclusion = await callModel(true);
    }
    if (!this.hasUsableFinalConclusion(finalConclusion)) {
      throw new Error(`Failed to generate a usable final investment conclusion for ${companyName}.`);
    }
    return finalConclusion;
  }

  async generateCompanyQuickTake(
    company: CompanyProfile,
    lang: Language
  ): Promise<string> {
    const outputLanguage = lang === 'cn' ? 'Simplified Chinese' : 'English';
    const prompt = `You are writing a sharp "at-a-glance" company brief in ${outputLanguage}.

Target company:
- Name: ${company.name}
- Ticker/Exchange: ${company.ticker} (${company.exchange})
- Market cap: ${company.marketCap || 'N/A'}
- Float market cap: ${company.floatMarketCap || 'N/A'}

Reference writing style (must emulate this level of concreteness and directness):
"Rocket Lab (RKLB) is the second-largest commercial space company in the U.S. after SpaceX, and a key player in high-frequency small-satellite launches. Its core model is an end-to-end space stack: it not only earns launch revenue, but also manufactures satellites and mission-critical components, offering integrated build+launch services to monetize across the full value chain."

Hard requirements:
1) Output EXACTLY 2 sentences.
2) Sentence 1: state company identity + relative position/role in its market + scale signal.
3) Sentence 2: explain the monetization model concretely (how it makes money, key products/services, value-chain position).
4) Use concrete industry wording; no generic filler.
5) Forbidden vague phrases (or their equivalents): "core product and service model", "certain differentiation", "comprehensive conclusion", "etc.".
6) No markdown, no bullet points, no disclaimer.`;

    const response = await this.modelClient.generateContent({
      step: 'quick_take',
      contents: { role: 'user', parts: [{ text: prompt }] },
    });

    return (response.text || '').replace(/\s+/g, ' ').trim();
  }

  async runAnalysisForCompany(
    company: CompanyProfile,
    lang: Language,
    questionCount: number,
    onProgress?: ProgressCallback,
    existing?: Pick<CompanyAnalysis, 'questions' | 'qna' | 'conclusion' | 'finalConclusion'> | null
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
    const existingFinalConclusion = this.hasUsableFinalConclusion(existing?.finalConclusion)
      ? existing!.finalConclusion!
      : null;

    let questions = existingQuestions;
    if (!questions.length) {
      await log(5, 'Deconstructing narrative...', `Analyzing ${company.name} investment thesis`);
      questions = await this.generateQuestions(company.name, lang, questionCount);
      await log(10, 'Questions Generated', `Created ${questions.length} research questions`);
    }

    const totalQuestions = questions.length || questionCount;
    const { qnaByQuestion, pendingIndices } = indexAnsweredQuestions(questions, existingQna);
    let completedCount = qnaByQuestion.size;

    const reportQnaProgress = async (completed: number) => {
      const questionProgress = 10 + (completed / totalQuestions) * 60;
      await log(
        questionProgress,
        `Completed ${completed}/${totalQuestions} questions`,
        `${completed} of ${totalQuestions} questions answered`
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
        async task => this.answerQuestion(task.item, company.name, lang),
        {
          concurrency: QNA_CONCURRENCY,
          onTaskComplete: async (result, task) => {
            qnaByQuestion.set(result.question, result);
            completedCount = qnaByQuestion.size;
            await reportQnaProgress(completedCount);
            const questionProgress = 10 + (completedCount / totalQuestions) * 60;
            await log(
              questionProgress,
              `Completed ${completedCount}/${totalQuestions} questions`,
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
    if (!conclusion) {
      await log(75, 'Synthesizing final report...', 'Analyzing Q&A results and generating investment thesis');
      conclusion = await this.synthesizeConclusion(company.name, qnaResults, lang);
      await log(85, 'Conclusion Synthesized', 'Investment thesis generated');
    }

    let finalConclusion = existingFinalConclusion;
    if (!finalConclusion) {
      await log(90, 'Generating Final Conclusion', 'Creating executive summary');
      finalConclusion = await this.generateFinalConclusion(company.name, qnaResults, conclusion, lang);
    }
    await log(100, 'Analysis Complete', `${company.name} analysis finished`);

    return {
      questions,
      qna: qnaResults,
      conclusion,
      finalConclusion,
    };
  }

  async runFullAnalysis(
    query: string,
    lang: Language,
    onProgress?: ProgressCallback
  ): Promise<AnalysisState> {
    const runtimeConfig = getRuntimeModelConfig();
    const id = Date.now().toString();
    const timestamp = new Date().toISOString();

    const log = async (progress: number, step: string, message?: string) => {
      const logMessage = message || step;
      console.log(`[${progress}%] ${step}${message ? `: ${message}` : ''}`);
      if (onProgress) {
        await onProgress(progress, step, logMessage);
      }
    };

    await log(5, 'Starting Analysis', `Query: ${query}`);

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
          competitors = conceptCandidates
            .filter(c => c.ticker.toUpperCase() !== exactMatch.ticker.toUpperCase())
            .slice(0, 2);
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

    // Enrich with financial data
    await log(25, 'Fetching Financial Data', `Enriching ${companyProfiles.length} company profiles`);
    const enrichedProfiles = await Promise.all(
      companyProfiles.map(async (p, index) => {
        await log(25 + (index + 1) * 5, 'Fetching Financial Data', `${p.name} (${p.ticker})`);
        return getFinancialData(p);
      })
    );
    await log(50, 'Financial Data Loaded', 'All company profiles enriched');

    const focusProfile = enrichedProfiles[0];
    const candidateProfiles = enrichedProfiles.slice(1);
    await log(52, 'Generating Company Snapshots', 'Creating quick company overviews');
    const quickTakes = await Promise.all(
      enrichedProfiles.map(async (profile) => this.generateCompanyQuickTake(profile, lang))
    );

    // Analyze focus company
    await log(55, 'Analyzing Focus Company', `${focusProfile.name} (${focusProfile.ticker})`);
    const focusAnalysis = await this.runAnalysisForCompany(
      focusProfile,
      lang,
      runtimeConfig.questions.focus,
      async (progress, step, message) => {
        // Map company analysis progress (0-80%) to overall progress (55-75%)
        const overallProgress = 55 + Math.floor(progress * 0.2);
        await log(overallProgress, `Focus Company: ${step}`, message);
      }
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

    // Analyze candidate companies
    const candidateAnalyses: CompanyAnalysis[] = [];
    for (let i = 0; i < candidateProfiles.length; i++) {
      const profile = candidateProfiles[i];
      await log(75 + i * 5, 'Analyzing Candidate Company', `${profile.name} (${profile.ticker})`);
      const analysis = await this.runAnalysisForCompany(
        profile,
        lang,
        runtimeConfig.questions.candidate,
        async (progress, step, message) => {
          // Map company analysis progress to overall progress
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
    }
    await log(95, 'All Companies Analyzed', `Completed analysis for ${enrichedProfiles.length} companies`);

    const analysisState: AnalysisState = {
      id,
      timestamp,
      status: 'complete',
      language: lang,
      query,
      focusCompany: focusCompanyAnalysis,
      candidateCompanies: candidateAnalyses,
      error: null,
      currentStage: 'Analysis Complete',
      currentProgress: 100,
    };

    await log(100, 'Analysis Complete', 'Finalizing report');
    return analysisState;
  }
}