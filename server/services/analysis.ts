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
import { searchTicker, getFinancialData } from '../../services/finance.js';

import { getFinancialData } from '../../services/finance.js';
console.log("Analysis service importing getFinancialData:", getFinancialData);

// This service contains the analysis logic ported from useStockAgent.ts
// It can be used by both the worker and API routes

export type ProgressCallback = (progress: number, step: string, log?: string) => void | Promise<void>;

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
      model: 'gemini-2.5-flash',
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

    const { competitors } = JSON.parse(response.text);
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
      model: 'gemini-2.5-flash',
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

    const { focusCompany, candidateCompanies } = JSON.parse(response.text);
    return [focusCompany, ...candidateCompanies.slice(0, 2)];
  }

  async generateQuestions(companyName: string, lang: Language): Promise<string[]> {
    const outputLanguage = lang === 'cn' ? 'Simplified Chinese' : 'English';
    const prompt = `Generate exactly 10 critical investment research questions in ${outputLanguage} about "${companyName}". Cover: supply chain, market position, business model, financials, growth drivers, competitive advantages, risks, management, recent news, and valuation. Respond ONLY with a valid JSON object: {"questions": ["...", ...]}`;

    const response = await this.ai.models.generateContent({
      model: 'gemini-2.5-flash',
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

    return JSON.parse(response.text).questions;
  }

  async answerQuestion(
    question: string,
    companyName: string,
    lang: Language,
    onProgress?: (message: string) => void | Promise<void>
  ): Promise<QnAResult> {
    const outputLanguage = lang === 'cn' ? 'Simplified Chinese' : 'English';
    
    // Notify before starting Google Search
    if (onProgress) {
      await onProgress(`Searching Google for: ${question.substring(0, 60)}...`);
    }
    
    const prompt = `As a financial analyst, answer this question about "${companyName}" in ${outputLanguage}: "${question}". Provide a detailed, data-driven answer using the most recent information. Cite sources.`;

    const response = await this.ai.models.generateContent({
      model: 'gemini-2.5-flash',
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

    return { question, answer: response.text, sources };
  }

  async synthesizeConclusion(
    companyName: string,
    qna: QnAResult[],
    lang: Language
  ): Promise<InvestmentConclusion> {
    const outputLanguage = lang === 'cn' ? 'Simplified Chinese' : 'English';
    const conclusionSectionSchema = {
      type: Type.OBJECT,
      properties: {
        summary: { type: Type.STRING },
        evidence: { type: Type.ARRAY, items: { type: Type.STRING } },
      },
      required: ['summary', 'evidence'],
    };

    const prompt = `Based on this Q&A for "${companyName}", synthesize an investment thesis in ${outputLanguage}. Structure the response into: "UpstreamSupplyChain", "MarketPosition", "BusinessModel", "Financials", "OutlookRisks". For each, provide a summary and list key evidence from the Q&A. Respond ONLY with a valid JSON object. Q&A: ${JSON.stringify(qna.map(item => ({ q: item.question, a: item.answer })))}`;

    const response = await this.ai.models.generateContent({
      model: 'gemini-2.5-flash',
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

    return JSON.parse(response.text);
  }

  async generateFinalConclusion(
    companyName: string,
    qna: QnAResult[],
    lang: Language
  ): Promise<FinalConclusion> {
    const outputLanguage = lang === 'cn' ? 'Simplified Chinese' : 'English';

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
    
    Respond ONLY with a valid JSON object matching the required schema.
    
    Q&A Context: ${JSON.stringify(qna.map(item => ({ question: item.question, answer: item.answer })))}`;

    const response = await this.ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: { role: 'user', parts: [{ text: prompt }] },
      config: {
        responseMimeType: 'application/json',
        responseSchema: finalConclusionSchema,
      },
    });

    return JSON.parse(response.text);
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
