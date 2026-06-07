
import { useState, useCallback, useEffect, useRef } from 'react';
import { ai } from '../services/gemini.ts';
import { getFinancialData, searchTicker } from '../services/finance.ts';
import { Type } from '@google/genai';
import { AnalysisState, CompanyAnalysis, CompanyProfile, Language, QnAResult, GroundingSource, InvestmentConclusion, FinalConclusion } from '../types.ts';
import { getUIText } from '../constants.ts';

const ACTIVE_ANALYSIS_KEY = 'intelligentStockAgentActiveState';
const HISTORY_KEY = 'intelligentStockAgentHistory';

const API_BASE_URL = typeof window !== 'undefined' ? '' : 'http://localhost:3001';

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

  const [history, setHistory] = useState<AnalysisState[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const [saveMessage, setSaveMessage] = useState('');
  const analysisStateRef = useRef<AnalysisState>(analysisState);

  // Fetch history from server on mount (100% server-based)
  useEffect(() => {
    const fetchServerHistory = async () => {
      setIsLoadingHistory(true);
      try {
        const response = await fetch(`${API_BASE_URL}/api/history`);
        if (!response.ok) {
          throw new Error('Failed to fetch server history');
        }
        const data = await response.json();
        const serverHistory: AnalysisState[] = data.history || [];

        // Sort by timestamp (most recent first)
        const sortedHistory = serverHistory.sort((a, b) => {
          const timeA = new Date(a.timestamp).getTime();
          const timeB = new Date(b.timestamp).getTime();
          return timeB - timeA;
        });

        setHistory(sortedHistory);
      } catch (error) {
        console.error('Could not fetch server history:', error);
        // Set empty array on error
        setHistory([]);
      } finally {
        setIsLoadingHistory(false);
      }
    };

    fetchServerHistory();
  }, []); // Only run on mount

  useEffect(() => {
    analysisStateRef.current = analysisState;
  }, [analysisState]);

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

  // Refresh history from server (called after save/delete operations)
  const refreshHistory = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/history`);
      if (!response.ok) {
        throw new Error('Failed to fetch server history');
      }
      const data = await response.json();
      const serverHistory: AnalysisState[] = data.history || [];

      // Sort by timestamp (most recent first)
      const sortedHistory = serverHistory.sort((a, b) => {
        const timeA = new Date(a.timestamp).getTime();
        const timeB = new Date(b.timestamp).getTime();
        return timeB - timeA;
      });

      setHistory(sortedHistory);
    } catch (error) {
      console.error('Could not refresh history:', error);
    }
  }, []);

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
    const now = new Date();
    const prompt = `Generate exactly 10 critical investment research questions in ${outputLanguage} about "${companyName}". Cover: supply chain, market position, business model, financials, growth drivers, competitive advantages, risks, management, recent news, and valuation.
${buildRecencyGuidance(now)}
Ensure several questions explicitly require the latest quarter, latest annual report, and very recent 2-3 month developments.
Respond ONLY with a valid JSON object: {"questions": ["...", ...]}`;
    
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
    const now = new Date();
    const prompt = `As a financial analyst, answer this question about "${companyName}" in ${outputLanguage}: "${question}".
${buildRecencyGuidance(now)}
Answer requirements:
- Use freshest available data first; older data is secondary context only.
- If the latest filing/period is unavailable, clearly disclose that limitation.
- For key facts, include period labels (e.g. YYYY-Qx, YYYY annual report, YYYY-MM).
- Cite sources.`;
    
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

    const now = new Date();
    const prompt = `Based on this Q&A for "${companyName}", synthesize an investment thesis in ${outputLanguage}. Structure the response into: "UpstreamSupplyChain", "MarketPosition", "BusinessModel", "Financials", "OutlookRisks". For each, provide a summary and list key evidence from the Q&A.
${buildRecencyGuidance(now)}
When evidence conflicts across years, prioritize the latest period and explain differences briefly.
Respond ONLY with a valid JSON object. Q&A: ${JSON.stringify(qna.map(item => ({q: item.question, a: item.answer})))}`;
    
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

    const now = new Date();
    const prompt = `You are a senior investment analyst. Based on the following comprehensive Q&A for "${companyName}", provide a final, decisive investment conclusion in ${outputLanguage}. 
    
    Your task is to:
    1.  Formulate a clear, one-sentence overall conclusion (e.g., 'Strong Buy', 'Hold', 'Speculative Buy', 'Sell').
    2.  Provide 3-5 bullet points that summarize the most critical arguments supporting your conclusion.
    3.  For each argument, cite specific, quantitative evidence directly from the provided Q&A.
    ${buildRecencyGuidance(now)}
    
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
    setSaveStatus('idle');
    setSaveMessage('');
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

        const completedState: AnalysisState = {
          ...analysisStateRef.current,
          status: 'complete',
          currentStage: getUIText(lang).analysisComplete,
          currentProgress: 100,
        };
        analysisStateRef.current = completedState;
        setAnalysisState(completedState);

        // Save to server database immediately after reaching 100%
        setSaveStatus('saving');
        setSaveMessage(getUIText(lang).savingReport);
        try {
          const response = await fetch(`${API_BASE_URL}/api/history`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              result: completedState,
              query: completedState.query,
              language: completedState.language,
            }),
          });

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `Failed to save report (${response.status})`);
          }

          await refreshHistory();
          setSaveStatus('success');
          setSaveMessage(getUIText(lang).saveSuccess);
        } catch (error) {
          console.error('Error saving report to server:', error);
          const message = error instanceof Error ? error.message : 'Failed to save report';
          setSaveStatus('error');
          setSaveMessage(`${getUIText(lang).saveFailed}: ${message}`);
        }

    } catch (e) {
        console.error("Analysis failed:", e);
        const errorMessage = e instanceof Error ? e.message : 'Failed to complete analysis.';
        updateState({ status: 'error', error: errorMessage, currentStage: getUIText(lang).errorTitle });
    }
  }, [refreshHistory]);

  const resetAnalysis = useCallback(() => {
    setAnalysisState(createInitialState());
  }, []);

  const loadFromHistory = useCallback((id: string) => {
    const historyItem = history.find(item => item.id === id);
    if (historyItem) {
      setAnalysisState(historyItem);
    }
  }, [history]);

  const deleteFromHistory = useCallback(async (id: string) => {
    // Delete from server
    try {
      const response = await fetch(`${API_BASE_URL}/api/history/${id}`, {
        method: 'DELETE',
      });
      if (!response.ok && response.status !== 404) {
        // 404 is okay (item might not exist on server)
        throw new Error(`Failed to delete report from server: ${response.statusText}`);
      }

      // Refresh history from server after deletion
      await refreshHistory();
    } catch (error) {
      console.error('Error deleting report from server:', error);
      // Still update local state to provide immediate feedback
      setHistory(prev => prev.filter(item => item.id !== id));
    }

    // Clear active state if it matches the deleted item
    setAnalysisState(current => {
      if (current.id === id && current.status === 'complete') {
        return createInitialState();
      }
      return current;
    });
  }, [refreshHistory]);

  const clearHistory = useCallback(async () => {
    // Clear from server
    try {
      const response = await fetch(`${API_BASE_URL}/api/history`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        throw new Error(`Failed to clear history from server: ${response.statusText}`);
      }

      // Refresh history from server (should be empty now)
      await refreshHistory();
    } catch (error) {
      console.error('Error clearing history from server:', error);
      // Still clear local state to provide immediate feedback
      setHistory([]);
    }
  }, [refreshHistory]);

  const dismissSaveNotice = useCallback(() => {
    setSaveStatus('idle');
    setSaveMessage('');
  }, []);

  return { 
    analysisState, 
    history, 
    isLoadingHistory,
    saveStatus,
    saveMessage,
    startAnalysis, 
    resetAnalysis, 
    loadFromHistory, 
    deleteFromHistory, 
    clearHistory,
    refreshHistory,
    dismissSaveNotice,
  };
};
