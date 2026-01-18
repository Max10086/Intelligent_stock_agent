
import { useState, useCallback, useEffect } from 'react';
import { ai } from '../services/gemini.ts';
import { getFinancialData, searchTicker } from '../services/finance.ts';
import { Type } from '@google/genai';
import { AnalysisState, CompanyAnalysis, CompanyProfile, Language, QnAResult, GroundingSource, InvestmentConclusion, FinalConclusion } from '../types.ts';
import { getUIText } from '../constants.ts';

const ACTIVE_ANALYSIS_KEY = 'intelligentStockAgentActiveState';
const HISTORY_KEY = 'intelligentStockAgentHistory';

const createInitialState = (): AnalysisState => ({
  id: ``,
  timestamp: ``,
  status: 'idle',
  language: 'en',
  query: '',
  focusCompany: null,
  candidateCompanies: [],
  error: null,
  currentStage: '',
  currentProgress: 0,
});

const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

export const useStockAgent = () => {
  const [analysisState, setAnalysisState] = useState<AnalysisState>(() => {
    const initialState = createInitialState();
    try {
      const savedStateJSON = localStorage.getItem(ACTIVE_ANALYSIS_KEY);
      if (savedStateJSON) {
        const savedState: Partial<AnalysisState> = JSON.parse(savedStateJSON);
        const mergedState: AnalysisState = { ...initialState, ...savedState };

        if (mergedState.status === 'finding_companies' || mergedState.status === 'analyzing') {
          mergedState.status = 'error';
          mergedState.error = getUIText(mergedState.language).interruptedMessage; 
          mergedState.currentStage = getUIText(mergedState.language).interrupted;
        }
        return mergedState;
      }
    } catch (error) {
      console.error('Could not load active state from local storage', error);
      localStorage.removeItem(ACTIVE_ANALYSIS_KEY);
    }
    return initialState;
  });

  const [history, setHistory] = useState<AnalysisState[]>(() => {
    try {
      const savedHistoryJSON = localStorage.getItem(HISTORY_KEY);
      if (savedHistoryJSON) {
        const parsed = JSON.parse(savedHistoryJSON);
        // Deduplicate on load - keep only unique entries by id
        const uniqueHistory = Array.from(
          new Map(parsed.map((item: AnalysisState) => [item.id, item])).values()
        );
        return uniqueHistory;
      }
      return [];
    } catch (error) {
      console.error('Could not load history from local storage', error);
      return [];
    }
  });

  useEffect(() => {
    try {
      if (analysisState.status !== 'idle') {
        localStorage.setItem(ACTIVE_ANALYSIS_KEY, JSON.stringify(analysisState));
      } else {
        localStorage.removeItem(ACTIVE_ANALYSIS_KEY);
      }
    } catch (error) {
      console.error('Could not save active state to local storage', error);
    }
  }, [analysisState]);

  useEffect(() => {
    try {
      // Deduplicate history before saving to localStorage
      // Use a Map to ensure unique entries by id (keeps the first occurrence)
      const uniqueHistory = Array.from(
        new Map(history.map(item => [item.id, item])).values()
      );
      
      // Save deduplicated version to localStorage
      localStorage.setItem(HISTORY_KEY, JSON.stringify(uniqueHistory));
      
      // If duplicates were found, log a warning but don't update state here
      // to avoid infinite loop. The deduplication will happen on next load.
      if (uniqueHistory.length !== history.length) {
        console.warn(`Found ${history.length - uniqueHistory.length} duplicate history entries. They will be removed on next page load.`);
      }
    } catch (error) {
      console.error('Could not save history to local storage', error);
    }
  }, [history]);

  const updateState = (update: Partial<AnalysisState>) => {
    setAnalysisState(prev => ({ ...prev, ...update }));
  };

  const updateCompanyState = (ticker: string, update: Partial<CompanyAnalysis>) => {
    setAnalysisState(prev => {
      const newFocus = prev.focusCompany?.profile.ticker === ticker ? { ...prev.focusCompany, ...update } : prev.focusCompany;
      const newCandidates = prev.candidateCompanies.map(c => c.profile.ticker === ticker ? { ...c, ...update } : c);
      return { ...prev, focusCompany: newFocus as CompanyAnalysis, candidateCompanies: newCandidates };
    });
  };

  const findCompetitors = async (focusCompany: Pick<CompanyProfile, 'name' | 'ticker'>, lang: Language): Promise<Pick<CompanyProfile, 'name' | 'ticker' | 'exchange'>[]> => {
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

    const response = await ai.models.generateContent({
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
  };

  const findCompaniesByConcept = async (query: string, lang: Language): Promise<Pick<CompanyProfile, 'name' | 'ticker' | 'exchange'>[]> => {
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
      
      const response = await ai.models.generateContent({
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
  };

  const generateQuestions = async (companyName: string, lang: Language): Promise<string[]> => {
    const outputLanguage = lang === 'cn' ? 'Simplified Chinese' : 'English';
    const prompt = `Generate exactly 10 critical investment research questions in ${outputLanguage} about "${companyName}". Cover: supply chain, market position, business model, financials, growth drivers, competitive advantages, risks, management, recent news, and valuation. Respond ONLY with a valid JSON object: {"questions": ["...", ...]}`;
    
    const response = await ai.models.generateContent({
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
  };

  const answerQuestion = async (question: string, companyName: string, lang: Language): Promise<QnAResult> => {
    const outputLanguage = lang === 'cn' ? 'Simplified Chinese' : 'English';
    const prompt = `As a financial analyst, answer this question about "${companyName}" in ${outputLanguage}: "${question}". Provide a detailed, data-driven answer using the most recent information. Cite sources.`;
    
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: { role: 'user', parts: [{ text: prompt }] },
      config: {
        tools: [{ googleSearch: {} }],
      },
    });

    const sources: GroundingSource[] = response.candidates?.[0]?.groundingMetadata?.groundingChunks
      ?.map((chunk: any) => chunk.web)
      .filter(Boolean) ?? [];

    return { question, answer: response.text, sources };
  };

  const synthesizeConclusion = async (companyName: string, qna: QnAResult[], lang: Language): Promise<InvestmentConclusion> => {
    const outputLanguage = lang === 'cn' ? 'Simplified Chinese' : 'English';
    const conclusionSectionSchema = {
        type: Type.OBJECT,
        properties: {
            summary: { type: Type.STRING },
            evidence: { type: Type.ARRAY, items: { type: Type.STRING } }
        },
        required: ['summary', 'evidence']
    };

    const prompt = `Based on this Q&A for "${companyName}", synthesize an investment thesis in ${outputLanguage}. Structure the response into: "UpstreamSupplyChain", "MarketPosition", "BusinessModel", "Financials", "OutlookRisks". For each, provide a summary and list key evidence from the Q&A. Respond ONLY with a valid JSON object. Q&A: ${JSON.stringify(qna.map(item => ({q: item.question, a: item.answer})))}`;
    
    const response = await ai.models.generateContent({
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
  };

  const generateFinalConclusion = async (companyName: string, qna: QnAResult[], lang: Language): Promise<FinalConclusion> => {
    const outputLanguage = lang === 'cn' ? 'Simplified Chinese' : 'English';
    
    const finalConclusionSchema = {
        type: Type.OBJECT,
        properties: {
            overall_conclusion: { 
                type: Type.STRING,
                description: `A concise, overall investment conclusion for ${companyName} (e.g., 'Strong Buy', 'Hold', 'Sell with caution').`
            },
            bullet_points: {
                type: Type.ARRAY,
                items: {
                    type: Type.OBJECT,
                    properties: {
                        argument: { 
                            type: Type.STRING,
                            description: 'A single, key investment argument (pro or con).'
                        },
                        evidence: {
                            type: Type.ARRAY,
                            items: { type: Type.STRING },
                            description: 'A list of specific data points or facts from the Q&A that support the argument.'
                        }
                    },
                    required: ['argument', 'evidence']
                }
            }
        },
        required: ['overall_conclusion', 'bullet_points']
    };

    const prompt = `You are a senior investment analyst. Based on the following comprehensive Q&A for "${companyName}", provide a final, decisive investment conclusion in ${outputLanguage}. 
    
    Your task is to:
    1.  Formulate a clear, one-sentence overall conclusion (e.g., 'Strong Buy', 'Hold', 'Speculative Buy', 'Sell').
    2.  Provide 3-5 bullet points that summarize the most critical arguments supporting your conclusion.
    3.  For each argument, cite specific, quantitative evidence directly from the provided Q&A.
    
    Respond ONLY with a valid JSON object matching the required schema.
    
    Q&A Context: ${JSON.stringify(qna.map(item => ({ question: item.question, answer: item.answer })))}`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: { role: 'user', parts: [{ text: prompt }] },
      config: {
        responseMimeType: 'application/json',
        responseSchema: finalConclusionSchema,
      },
    });

    return JSON.parse(response.text);
  };

  const runAnalysisForCompany = async (company: CompanyProfile, lang: Language) => {
    const uiText = getUIText(lang);
    try {
      updateState({ currentStage: uiText.generatingQuestions, currentProgress: 20 });
      updateCompanyState(company.ticker, { status: 'generating_questions' });
      const questions = await generateQuestions(company.name, lang);
      updateCompanyState(company.ticker, { questions });
      await delay(1000);

      updateCompanyState(company.ticker, { status: 'answering_questions' });
      const qnaResults: QnAResult[] = [];
      for (const [i, q] of questions.entries()) {
        const result = await answerQuestion(q, company.name, lang);
        qnaResults.push(result);
        updateCompanyState(company.ticker, { qna: [...qnaResults] });
        updateState({ currentStage: uiText.answeringQuestions.replace('{current}', String(i + 1)).replace('{total}', '10'), currentProgress: 20 + (i + 1) * 5 });
        await delay(1000);
      }

      updateState({ currentStage: uiText.synthesizingReport, currentProgress: 75 });
      updateCompanyState(company.ticker, { status: 'synthesizing' });
      const conclusion = await synthesizeConclusion(company.name, qnaResults, lang);
      updateCompanyState(company.ticker, { conclusion });
      await delay(500);

      updateState({ currentStage: uiText.generatingFinalConclusion, currentProgress: 90 });
      const finalConclusion = await generateFinalConclusion(company.name, qnaResults, lang);
      updateCompanyState(company.ticker, { finalConclusion, status: 'complete' });
      
      updateState({ currentProgress: 100 });

    } catch (e) {
      console.error(`Error analyzing ${company.name}:`, e);
      const errorMessage = e instanceof Error ? e.message : 'An unknown error occurred.';
      updateCompanyState(company.ticker, { status: 'error', error: errorMessage });
      throw e;
    }
  };

  const startAnalysis = useCallback(async (query: string, lang: Language) => {
    const id = Date.now().toString();
    setAnalysisState({ ...createInitialState(), id, timestamp: new Date().toISOString(), status: 'finding_companies', query, language: lang, currentStage: getUIText(lang).findingCompanies, currentProgress: 5 });
    
    try {
        let companyProfiles: Pick<CompanyProfile, 'name' | 'ticker' | 'exchange'>[] = [];

        const exactMatch = await searchTicker(query);

        if (exactMatch) {
            updateState({ currentStage: `Found ${exactMatch.ticker}. Finding competitors...`, currentProgress: 7 });
            const competitors = await findCompetitors(exactMatch, lang);
            companyProfiles = [exactMatch, ...competitors];
        } else {
            updateState({ currentStage: `No exact ticker found. Searching for concept: "${query}"...`, currentProgress: 7 });
            companyProfiles = await findCompaniesByConcept(query, lang);
        }

        if (companyProfiles.length === 0) {
            throw new Error("Could not identify any companies for the given query.");
        }
      
        updateState({ currentStage: 'Fetching financial data...', currentProgress: 15 });

        const enrichedProfiles = await Promise.all(
            companyProfiles.map(p => getFinancialData(p))
        );

        const focusProfile = enrichedProfiles[0];
        const candidateProfiles = enrichedProfiles.slice(1);

        const focusAnalysis: CompanyAnalysis = { id: focusProfile.ticker, profile: focusProfile, status: 'pending', questions: [], qna: [], conclusion: null, finalConclusion: null, followUpQuestions: [] };
        const candidateAnalyses: CompanyAnalysis[] = candidateProfiles.map(p => ({ id: p.ticker, profile: p, status: 'pending', questions: [], qna: [], conclusion: null, finalConclusion: null, followUpQuestions: [] }));

        updateState({
            status: 'analyzing',
            focusCompany: focusAnalysis,
            candidateCompanies: candidateAnalyses,
            currentStage: getUIText(lang).analyzingCompany.replace('{companyName}', focusProfile.name),
        });

        await runAnalysisForCompany(focusProfile, lang);
        await delay(2000);

        for (const company of candidateAnalyses) {
            updateState({ currentStage: getUIText(lang).analyzingCompany.replace('{companyName}', company.profile.name) });
            await runAnalysisForCompany(company.profile, lang);
            await delay(2000);
        }

        // Update analysis state to complete and add to history
        setAnalysisState(prevState => {
            const finalState: AnalysisState = {
                ...prevState,
                status: 'complete',
                currentStage: getUIText(lang).analysisComplete,
                currentProgress: 100
            };
            
            // Add to history only if not already present (prevent duplicates)
            setHistory(prevHistory => {
                // Check if this analysis already exists in history by id
                const exists = prevHistory.some(item => item.id === finalState.id);
                if (exists) {
                    // If exists, update it instead of adding duplicate
                    return prevHistory.map(item => 
                        item.id === finalState.id ? finalState : item
                    );
                }
                // Add new entry to history
                return [finalState, ...prevHistory];
            });
            
            return finalState;
        });

    } catch (e) {
        console.error("Analysis failed:", e);
        const errorMessage = e instanceof Error ? e.message : 'Failed to complete analysis.';
        updateState({ status: 'error', error: errorMessage, currentStage: getUIText(lang).errorTitle });
    }
  }, []);

  const resetAnalysis = useCallback(() => {
    setAnalysisState(createInitialState());
  }, []);

  const loadFromHistory = useCallback((id: string) => {
    const historyItem = history.find(item => item.id === id);
    if (historyItem) {
      setAnalysisState(historyItem);
    }
  }, [history]);

  const deleteFromHistory = useCallback((id: string) => {
    setHistory(prev => {
      // Filter out all items with matching id (in case of duplicates)
      const filtered = prev.filter(item => item.id !== id);
      // Also clear active state if it matches the deleted item
      setAnalysisState(current => {
        if (current.id === id && current.status === 'complete') {
          return createInitialState();
        }
        return current;
      });
      return filtered;
    });
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
  }, []);

  return { analysisState, history, startAnalysis, resetAnalysis, loadFromHistory, deleteFromHistory, clearHistory };
};
