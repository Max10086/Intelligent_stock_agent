import type { Language } from '../types.ts';
import type { ThesisSectionKey } from '../utils/synthesizeConclusionPrompt.ts';

export type CompanyRole = 'focus' | 'candidate';
export type EquityMarket = 'US' | 'HK' | 'CN';
export type ThemeRelevance = 'high' | 'medium' | 'low';

export interface ComparisonItemInput {
  reportId: string;
  companyId: string;
}

export interface ComparisonItem extends ComparisonItemInput {
  companyRole: CompanyRole;
  ticker: string;
  name: string;
  exchange: string;
  snapshotAt: string;
  reportLanguage: Language;
}

export interface MarketTheme {
  name: string;
  keywords: string[];
  brief: string;
  sources?: Array<{ title: string; uri: string }>;
}

export interface MarketHotTopicsSnapshot {
  fetchedAt: string;
  markets: Partial<
    Record<
      EquityMarket,
      {
        themes: MarketTheme[];
        searchQuery: string;
      }
    >
  >;
}

export interface CompareDimensionScores {
  conviction: number;
  upside: number;
  downsideProtection: number;
  marketThemeFit: number;
}

export interface CompareMatchedTheme {
  theme: string;
  relevance: ThemeRelevance;
  reason: string;
}

export interface CompareCompanyScore {
  itemId: string;
  rank: number;
  dimensions: CompareDimensionScores;
  matchedThemes: CompareMatchedTheme[];
  compositeScore: number;
  rationale: string;
  keyStrengths: string[];
  keyRisks: string[];
}

export interface CompanyCompareDigest {
  itemId: string;
  ticker: string;
  name: string;
  exchange: string;
  snapshotAt: string;
  companyRole: CompanyRole;
  profileSnapshot: {
    price: string;
    peTtm?: string;
    marketCap?: string;
    weekChange?: string;
    monthChange?: string;
  };
  finalConclusion: {
    overall: string;
    bullets: Array<{ argument: string; evidence: string[] }>;
  };
  thesis: Partial<
    Record<
      ThesisSectionKey,
      {
        summary: string;
        topEvidence: string[];
      }
    >
  >;
  qnaHighlights: Array<{
    question: string;
    answerExcerpt: string;
  }>;
}

export interface CompareRunResult {
  runId: string;
  sessionId: string;
  parentRunId?: string;
  createdAt: string;
  items: ComparisonItem[];
  marketHotTopics: MarketHotTopicsSnapshot;
  rankings: CompareCompanyScore[];
  portfolioSummary: string;
  methodologyNote: string;
  changeSummary?: string;
  warnings?: string[];
  digests?: CompanyCompareDigest[];
}

export interface ComparisonSessionSummary {
  id: string;
  label: string | null;
  language: Language;
  createdAt: string;
  updatedAt: string;
  runCount: number;
  latestRun?: {
    runId: string;
    createdAt: string;
    itemCount: number;
    topTicker?: string;
    topName?: string;
    topCompanies?: Array<{ rank: number; ticker: string; name: string }>;
  };
}

export interface ComparisonSessionDetail extends ComparisonSessionSummary {
  runs: Array<{
    id: string;
    parentRunId: string | null;
    createdAt: string;
    itemCount: number;
    topRank?: CompareCompanyScore;
    changeSummary?: string | null;
    status?: CompareRunStatus;
    progress?: number;
  }>;
}

export interface CreateCompareRequest {
  items: ComparisonItemInput[];
  language: Language;
  label?: string;
}

export interface FollowUpCompareRequest {
  sessionId: string;
  parentRunId: string;
  refreshReports?: boolean;
}

export type CompareRunStatus = 'PROCESSING' | 'COMPLETED' | 'FAILED';

export type CompareRunStep =
  | 'loading_reports'
  | 'building_digests'
  | 'fetching_topics'
  | 'ai_ranking'
  | 'saving';

export interface CompareRunProgress {
  runId: string;
  sessionId: string;
  status: CompareRunStatus;
  progress: number;
  currentStep?: CompareRunStep;
  error?: string;
  items?: ComparisonItem[];
}

export interface CompareRunStatusResponse extends CompareRunProgress {
  run?: CompareRunResult;
}

export interface CompareStartResponse {
  runId: string;
  sessionId: string;
  status: CompareRunStatus;
}
