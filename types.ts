
export type Language = 'en' | 'cn';
export type ModelProvider = 'vertex' | 'deepseek';
export type SearchProvider = 'vertex' | 'doubao';

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
  investment_narrative?: string;
  cross_dimensional_insights?: string[];
  UpstreamSupplyChain: ConclusionSectionData;
  MarketPosition: ConclusionSectionData;
  BusinessModel: ConclusionSectionData;
  Financials: ConclusionSectionData;
  OutlookRisks: ConclusionSectionData;
  MarketSentiment: ConclusionSectionData;
  IndustryCycle: ConclusionSectionData;
}

export interface FinalConclusionPoint {
  argument: string;
  evidence: string[];
}

export type RatingChange = 'upgrade' | 'maintain' | 'downgrade' | 'unknown';

export interface FinalConclusionVsPrior {
  prior_overall_conclusion?: string;
  rating_change?: RatingChange;
  change_summary?: string;
}

export interface FinalConclusion {
  overall_conclusion: string;
  bullet_points: FinalConclusionPoint[];
  vs_prior?: FinalConclusionVsPrior;
}

export interface FollowUpBaseline {
  analysisDate: string;
  ticker: string;
  name: string;
  price: string;
  peTtm?: string;
  marketCap?: string;
  overallConclusion?: string;
  thesisBullets?: string[];
}

export type AnalysisType = 'initial' | 'follow_up';

export interface FollowUpMeta {
  parentAnalysisId: string;
  parentTimestamp: string;
  parentQuery: string;
  baselines: Record<string, FollowUpBaseline>;
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
  priorBaseline?: FollowUpBaseline;
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
  llmTelemetry?: LlmTelemetryEntry[];
  analysisType?: AnalysisType;
  followUpMeta?: FollowUpMeta;
  /** Client-side session id (AnalysisState.id before DB job id overwrite); used to dedupe duplicate saves. */
  clientSessionId?: string;
}

export interface LlmTelemetryEntry {
  step: string;
  provider: 'vertex' | 'deepseek' | 'doubao';
  model: string;
  startedAt: string;
  durationMs: number;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    reasoningTokens?: number;
    totalTokens?: number;
    estimatedCostUsd?: number;
  };
}

export interface RuntimeModelConfig {
  analysis: { provider: ModelProvider; model: string };
  search: { provider: SearchProvider; model: string };
  questions: { focus: number; candidate: number };
  /** DeepSeek thinking for answer_question_synthesis (detailed Q&A prose). */
  qna: { thinkingEnabled: boolean };
}
