
export type Language = 'en' | 'cn';

export interface CompanyProfile {
  name: string;
  ticker: string;
  exchange: string;
  currentPrice: string;
  weekChange: string;
  monthChange: string;
  quoteTime?: string;
  prevClose?: string;
  openPrice?: string;
  dayHigh?: string;
  dayLow?: string;
  dayChange?: string;
  dayChangePct?: string;
  volume?: string;
  amount?: string;
  turnoverRate?: string;
  amplitude?: string;
  peTtm?: string;
  pb?: string;
  marketCap?: string;
  floatMarketCap?: string;
  high52w?: string;
  low52w?: string;
  currency?: string;
  dataSource?: string;
}

export interface QnAResult {
  question: string;
  answer: string;
  sources: GroundingSource[];
}

export interface GroundingSource {
  title: string;
  uri: string;
}

export interface ConclusionSectionData {
  summary: string;
  evidence: string[];
}

export interface InvestmentConclusion {
  UpstreamSupplyChain: ConclusionSectionData;
  MarketPosition: ConclusionSectionData;
  BusinessModel: ConclusionSectionData;
  Financials: ConclusionSectionData;
  OutlookRisks: ConclusionSectionData;
}

export interface FinalConclusionPoint {
  argument: string;
  evidence: string[];
}

export interface FinalConclusion {
  overall_conclusion: string;
  bullet_points: FinalConclusionPoint[];
}

export interface CompanyAnalysis {
  id: string;
  profile: CompanyProfile;
  quickTake?: string | null;
  status: 'pending' | 'generating_questions' | 'answering_questions' | 'synthesizing' | 'complete' | 'error';
  questions: string[];
  qna: QnAResult[];
  conclusion: InvestmentConclusion | null;
  finalConclusion: FinalConclusion | null;
  followUpQuestions: string[];
  error?: string | null;
}

export interface AnalysisState {
  id: string;
  timestamp: string;
  status: 'idle' | 'finding_companies' | 'analyzing' | 'complete' | 'error';
  language: Language;
  query: string;
  focusCompany: CompanyAnalysis | null;
  candidateCompanies: CompanyAnalysis[];
  error: string | null;
  currentStage: string;
  currentProgress: number;
}
