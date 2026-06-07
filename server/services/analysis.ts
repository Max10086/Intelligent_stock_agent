import { GoogleGenAI } from '@google/genai';
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
import { ANALYSIS_MODEL } from '../aiModelConfig.js';
// FIX: 删除了重复引用，保留这一行正确的
import { searchTicker, getFinancialData } from '../../services/finance.js';

// This service contains the analysis logic ported from useStockAgent.ts
// It can be used by both the worker and API routes

export type ProgressCallback = (progress: number, step: string, log?: string) => void | Promise<void>;

const getLatestDisclosedQuarter = (date: Date): { year: number; quarter: number } => {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  // Conservative disclosure assumptions:
  // Q1 by May, Q2 by Aug, Q3 by Nov, Q4/annual by next spring.
  if (month <= 4) return { year: year - 1, quarter: 3 };
  if (month <= 7) return { year, quarter: 1 };
  if (month <= 10) return { year, quarter: 2 };
  return { year, quarter: 3 };
};

const buildRecencyGuidance = (date: Date) => {
  const today = date.toISOString().slice(0, 10);
  const { year: quarterYear, quarter } = getLatestDisclosedQuarter(date);
  const latestAnnualYear = date.getFullYear() - 1;
  const compareYear1 = latestAnnualYear - 1;
  const compareYear2 = latestAnnualYear - 2;

  return `Today is ${today}.
Prioritize the most recent information in this strict order:
1) The latest 2-3 months of updates (news, announcements, policy changes, major events)
2) ${quarterYear} Q${quarter} data and filings (latest disclosed quarter)
3) ${latestAnnualYear} annual report / FY${latestAnnualYear} official disclosures (latest complete annual report)
4) ${compareYear1} and ${compareYear2} only for historical comparison and trend context
When newer authoritative data exists, do NOT anchor conclusions on older numbers.
If newer data cannot be found, explicitly state the latest available date and why older data is used.
Always include concrete dates or periods (YYYY-MM or YYYY-Qx) in key claims.`;
};

export class AnalysisService {
  constructor(private ai: GoogleGenAI) {}

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
        exchange: { type: Type.STRING, description: "Stock exchange (e.g., NASDAQ, NYSE, HKEX, SSE)" },
      },
      required: ['name', 'ticker', 'exchange'],
    };

    const prompt = `The user's focus company is "${focusCompany.name} (${focusCompany.ticker})". Please identify two of its main publicly traded competitors. The competitors must be from US, Hong Kong, or A-share markets.
    
    Respond ONLY with a valid JSON object containing an array of two companies. The language for the company names should be ${outputLanguage}.`;

    const response = await this.ai.models.generateContent({
      model: ANALYSIS_MODEL,
      contents: { role: 'user', parts: [{ text: prompt }] },
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            competitors: { type: Type.ARRAY, items: companySchema },
          },
          required: ['competitors'],
        },
      },
    });

    // FIX: 增加空值保底
    const parsed = JSON.parse(response.text || '{}');
    const competitors = parsed.competitors || [];
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
        exchange: { type: Type.STRING, description: "Stock exchange (e.g., NASDAQ, NYSE, HKEX, SSE)" },
      },
      required: ['name', 'ticker', 'exchange'],
    };

    const prompt = `The user searched for the concept: "${query}". A direct stock ticker match was not found. 
    
    Your task is:
    1.  Identify the single most prominent publicly traded company related to this concept. This will be the focus company.
    2.  Identify two other relevant publicly traded competitors.

    All companies must be from US, Hong Kong, or A-share markets.
    Respond ONLY with a valid JSON object. The language for the company names should be ${outputLanguage}.`;

    const response = await this.ai.models.generateContent({
      model: ANALYSIS_MODEL,
      contents: { role: 'user', parts: [{ text: prompt }] },
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            focusCompany: companySchema,
            candidateCompanies: { type: Type.ARRAY, items: companySchema },
          },
          required: ['focusCompany', 'candidateCompanies'],
        },
      },
    });

    // FIX: 增加空值保底
    const parsed = JSON.parse(response.text || '{}');
    const { focusCompany, candidateCompanies } = parsed;
    
    // 增加安全性检查，防止 AI 返回空导致崩溃
    if (!focusCompany) {
      throw new Error('Failed to identify companies from concept.');
    }
    
    return [focusCompany, ...(candidateCompanies || []).slice(0, 2)];
  }

  async generateQuestions(companyName: string, lang: Language): Promise<string[]> {
    const outputLanguage = lang === 'cn' ? 'Simplified Chinese' : 'English';
    const now = new Date();
    const prompt = `Generate exactly 10 critical investment research questions in ${outputLanguage} about "${companyName}". Cover: supply chain, market position, business model, financials, growth drivers, competitive advantages, risks, management, recent news, and valuation.
${buildRecencyGuidance(now)}
Ensure several questions explicitly require the latest quarter, latest annual report, and very recent 2-3 month developments.
Respond ONLY with a valid JSON object: {"questions": ["...", ...]}`;

    const response = await this.ai.models.generateContent({
      model: ANALYSIS_MODEL,
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

    // FIX: 增加空值保底
    const parsed = JSON.parse(response.text || '{}');
    return parsed.questions || [];
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
      await onProgress(`Searching Google for: ${question.substring(0, 60)}...`);
    }
    
    const prompt = `As a financial analyst, answer this question about "${companyName}" in ${outputLanguage}: "${question}".
${buildRecencyGuidance(now)}
Answer requirements:
- Use freshest available data first; older data is secondary context only.
- If the latest filing/period is unavailable, clearly disclose that limitation.
- For key facts, include period labels (e.g. YYYY-Qx, YYYY annual report, YYYY-MM).
- Cite sources.`;

    const response = await this.ai.models.generateContent({
      model: ANALYSIS_MODEL,
      contents: { role: 'user', parts: [{ text: prompt }] },
      config: {
        tools: [{ googleSearch: {} }],
      },
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
    return { question, answer: response.text || '', sources };
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

    const prompt = `Based on this Q&A for "${companyName}", synthesize an investment thesis in ${outputLanguage}. Structure the response into: "UpstreamSupplyChain", "MarketPosition", "BusinessModel", "Financials", "OutlookRisks". For each, provide a summary and list key evidence from the Q&A.
${buildRecencyGuidance(now)}
When evidence conflicts across years, prioritize the latest period and explain differences briefly.
Respond ONLY with a valid JSON object. Q&A: ${JSON.stringify(qna.map(item => ({ q: item.question, a: item.answer })))}`;

    const response = await this.ai.models.generateContent({
      model: ANALYSIS_MODEL,
      contents: { role: 'user', parts: [{ text: prompt }] },
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            UpstreamSupplyChain: conclusionSectionSchema,
            MarketPosition: conclusionSectionSchema,
            BusinessModel: conclusionSectionSchema,
            Financials: conclusionSectionSchema,
            OutlookRisks: conclusionSectionSchema,
          },
        },
      },
    });

    // FIX: 增加空值保底
    return JSON.parse(response.text || '{}');
  }

  async generateFinalConclusion(
    companyName: string,
    qna: QnAResult[],
    lang: Language
  ): Promise<FinalConclusion> {
    const outputLanguage = lang === 'cn' ? 'Simplified Chinese' : 'English';
    const now = new Date();

    const finalConclusionSchema = {
      type: Type.OBJECT,
      properties: {
        overall_conclusion: {
          type: Type.STRING,
          description: `A concise, overall investment conclusion for ${companyName} (e.g., 'Strong Buy', 'Hold', 'Sell with caution').`,
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
                description: 'A list of specific data points or facts from the Q&A that support the argument.',
              },
            },
            required: ['argument', 'evidence'],
          },
        },
      },
      required: ['overall_conclusion', 'bullet_points'],
    };

    const prompt = `You are a senior investment analyst. Based on the following comprehensive Q&A for "${companyName}", provide a final, decisive investment conclusion in ${outputLanguage}. 
    
    Your task is to:
    1.  Formulate a clear, one-sentence overall conclusion (e.g., 'Strong Buy', 'Hold', 'Speculative Buy', 'Sell').
    2.  Provide 3-5 bullet points that summarize the most critical arguments supporting your conclusion.
    3.  For each argument, cite specific, quantitative evidence directly from the provided Q&A.
    ${buildRecencyGuidance(now)}
    
    Respond ONLY with a valid JSON object matching the required schema.
    
    Q&A Context: ${JSON.stringify(qna.map(item => ({ question: item.question, answer: item.answer })))}`;

    const response = await this.ai.models.generateContent({
      model: ANALYSIS_MODEL,
      contents: { role: 'user', parts: [{ text: prompt }] },
      config: {
        responseMimeType: 'application/json',
        responseSchema: finalConclusionSchema,
      },
    });

    // FIX: 增加空值保底
    return JSON.parse(response.text || '{}');
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

    const response = await this.ai.models.generateContent({
      model: ANALYSIS_MODEL,
      contents: { role: 'user', parts: [{ text: prompt }] },
    });

    return (response.text || '').replace(/\s+/g, ' ').trim();
  }

  async runAnalysisForCompany(
    company: CompanyProfile,
    lang: Language,
    onProgress?: ProgressCallback
  ): Promise<{ questions: string[]; qna: QnAResult[]; conclusion: InvestmentConclusion; finalConclusion: FinalConclusion }> {
    const log = async (progress: number, step: string, message?: string) => {
      const logMessage = message || step;
      if (onProgress) {
        await onProgress(progress, step, logMessage);
      }
    };

    // Before generating questions: "Deconstructing narrative..."
    await log(5, 'Deconstructing narrative...', `Analyzing ${company.name} investment thesis`);
    const questions = await this.generateQuestions(company.name, lang);
    await log(10, 'Questions Generated', `Created ${questions.length} research questions`);

    const qnaResults: QnAResult[] = [];
    for (let i = 0; i < questions.length; i++) {
      const question = questions[i];
      const questionProgress = 10 + (i / questions.length) * 60;
      
      // Create a progress callback for answerQuestion that maps to overall progress
      const questionProgressCallback = onProgress ? async (message: string) => {
        // Update progress with the question-specific message
        await log(questionProgress, `Question ${i + 1}/${questions.length}`, message);
      } : undefined;
      
      await log(questionProgress, `Answering Question ${i + 1}/${questions.length}`, question.substring(0, 60) + '...');
      const result = await this.answerQuestion(question, company.name, lang, questionProgressCallback);
      qnaResults.push(result);
      await log(questionProgress + (60 / questions.length), `Question ${i + 1} Answered`, `Found ${result.sources.length} sources`);
    }

    // Before synthesis: "Synthesizing final report..."
    await log(75, 'Synthesizing final report...', 'Analyzing Q&A results and generating investment thesis');
    const conclusion = await this.synthesizeConclusion(company.name, qnaResults, lang);
    await log(85, 'Conclusion Synthesized', 'Investment thesis generated');

    await log(90, 'Generating Final Conclusion', 'Creating executive summary');
    const finalConclusion = await this.generateFinalConclusion(company.name, qnaResults, lang);
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
      const competitors = await this.findCompetitors(exactMatch, lang);
      companyProfiles = [exactMatch, ...competitors];
      await log(20, 'Competitors Found', `Found ${competitors.length} competitors`);
    } else {
      await log(15, 'Searching by Concept', `No exact match found, searching by concept`);
      companyProfiles = await this.findCompaniesByConcept(query, lang);
      await log(20, 'Companies Found', `Found ${companyProfiles.length} companies`);
    }

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