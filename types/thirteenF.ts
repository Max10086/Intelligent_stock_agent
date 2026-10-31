export type ThirteenFQuarterId = `${number}-Q${1 | 2 | 3 | 4}`;

export type ThirteenFPositionChangeCategory = 'NEW' | 'ADD' | 'REDUCE' | 'CLEAR';

export type ThirteenFConsensusDirection = 'BUY' | 'SELL';

export type ThirteenFPerformanceSortMode = 'by_position_delta' | 'by_return_pct';

export type ThirteenFHoldingSortField = 'marketValue' | 'portfolioWeight';

export type ThirteenFSortDirection = 'asc' | 'desc';

export type ThirteenFTrackerPanel = 'institution' | 'aggregate' | 'performance' | 'important';

export interface ThirteenFInstitution {
  cik: string;
  name: string;
  shortName?: string;
  description?: string;
  /** SEC-registered former legal names (most recent first). */
  formerNames?: string[];
  aumUsd?: number;
  latestQuarter?: ThirteenFQuarterId;
}

export interface ThirteenFWatchlistItem {
  cik: string;
  name: string;
  addedAt: string;
  sortOrder: number;
}

export interface ThirteenFWatchlistResponse {
  items: ThirteenFWatchlistItem[];
  presets: ThirteenFInstitution[];
}

/** Synced 13F tracker UI state (watchlist, stars, Important Tracking selection). */
export interface ThirteenFUserTrackerState {
  watchlist: ThirteenFWatchlistItem[];
  starredCiks: string[];
  stakeCiks: string[];
  stakeLookbackDays: ThirteenFStakeLookbackDays;
}

export interface ThirteenFQuarterOption {
  quarter: ThirteenFQuarterId;
  filingDate: string;
  reportDate: string;
  isLatest: boolean;
  /** Quarter filed as 13F-NT only — holdings resolved via related manager. */
  noticeOnly?: boolean;
}

export interface ThirteenFHoldingsSource {
  type: '13F-NT-redirect';
  sourceCik: string;
  sourceInstitutionName: string;
  noticeFilingDate: string;
  additionalInformation?: string | null;
}

export interface ThirteenFHolding {
  id: string;
  cik: string;
  quarter: ThirteenFQuarterId;
  ticker: string;
  cusip?: string;
  name: string;
  sector: string;
  industry?: string;
  shares: number;
  marketValueUsd: number;
  portfolioWeightPct: number;
  rank: number;
  filingDate: string;
  reportDate: string;
  sharesDelta?: number | null;
  weightDeltaPct?: number | null;
  marketValueDeltaUsd?: number | null;
  referencePriceUsd?: number | null;
}

export interface ThirteenFHoldingSummary {
  cik: string;
  institutionName: string;
  description?: string;
  /** SEC-registered former legal names (most recent first). */
  formerNames?: string[];
  quarter: ThirteenFQuarterId;
  filingDate: string;
  reportDate: string;
  totalMarketValueUsd: number;
  holdingCount: number;
  topSector?: string;
  /** Present when holdings are merged from a related filer's 13F-HR after a 13F-NT notice. */
  holdingsSource?: ThirteenFHoldingsSource;
}

export interface ThirteenFDistributionSlice {
  key: string;
  label: string;
  marketValueUsd: number;
  weightPct: number;
}

export type ThirteenFSectorEnrichmentPhase = 'idle' | 'running' | 'complete';

export interface ThirteenFSectorEnrichmentStatus {
  status: ThirteenFSectorEnrichmentPhase;
  pendingCount: number;
  totalCount: number;
  resolvedCount: number;
}

export interface ThirteenFHoldingsResponse {
  summary: ThirteenFHoldingSummary;
  holdings: ThirteenFHolding[];
  distribution: {
    byStock: ThirteenFDistributionSlice[];
    bySector: ThirteenFDistributionSlice[];
  };
  availableQuarters: ThirteenFQuarterOption[];
  sectorEnrichment?: ThirteenFSectorEnrichmentStatus;
  /** ISO timestamp when this quarter snapshot was last fetched from SEC. */
  cacheFetchedAt?: string;
}

export interface ThirteenFPositionChange {
  id: string;
  cik: string;
  quarter: ThirteenFQuarterId;
  priorQuarter: ThirteenFQuarterId;
  ticker: string;
  name: string;
  sector: string;
  category: ThirteenFPositionChangeCategory;
  priorShares: number | null;
  currentShares: number | null;
  sharesDelta: number;
  priorMarketValueUsd: number | null;
  currentMarketValueUsd: number | null;
  marketValueDeltaUsd: number;
  priorWeightPct: number | null;
  currentWeightPct: number | null;
  weightDeltaPct: number | null;
}

export interface ThirteenFPositionChangesResponse {
  cik: string;
  institutionName: string;
  quarter: ThirteenFQuarterId;
  priorQuarter: ThirteenFQuarterId;
  filingDate: string;
  reportDate?: string;
  changes: ThirteenFPositionChange[];
  /** Tab badges — items shown in the list (top N per category). */
  counts: Record<ThirteenFPositionChangeCategory, number>;
  /** SEC-reported totals for the quarter (may exceed listed items). */
  totalCounts?: Record<ThirteenFPositionChangeCategory, number>;
  /** @deprecated alias of counts */
  displayedCounts?: Record<ThirteenFPositionChangeCategory, number>;
  changesLimitPerCategory?: number;
  availableQuarters: ThirteenFQuarterOption[];
}

export interface ThirteenFConsensusStock {
  ticker: string;
  name: string;
  sector: string;
  direction: ThirteenFConsensusDirection;
  institutionCount: number;
  institutions: Array<{
    cik: string;
    name: string;
    category: ThirteenFPositionChangeCategory;
    marketValueDeltaUsd: number;
  }>;
  netMarketValueDeltaUsd: number;
}

export interface ThirteenFConsensusSector {
  sector: string;
  direction: ThirteenFConsensusDirection;
  institutionCount: number;
  netMarketValueDeltaUsd: number;
  tickerCount: number;
  topTickers: string[];
}

export interface ThirteenFAggregateDashboardRequest {
  ciks: string[];
  quarter?: ThirteenFQuarterId;
  minInstitutionCount?: number;
}

export interface ThirteenFAggregateDashboardResponse {
  quarter: ThirteenFQuarterId;
  priorQuarter: ThirteenFQuarterId;
  institutions: ThirteenFInstitution[];
  stockConsensus: ThirteenFConsensusStock[];
  sectorConsensus: ThirteenFConsensusSector[];
}

export interface ThirteenFPerformanceEntry {
  ticker: string;
  name: string;
  sector: string;
  category: 'NEW' | 'ADD';
  institutions: Array<{
    cik: string;
    name: string;
    sharesDelta: number;
    marketValueDeltaUsd: number;
  }>;
  totalMarketValueDeltaUsd: number;
  totalSharesDelta: number;
  anchorDate: string;
  anchorPriceUsd: number | null;
  reportDate: string;
  reportPriceUsd: number | null;
  currentPriceUsd: number | null;
  currentDate: string;
  returnPct: number | null;
  reportReturnPct: number | null;
  quoteStatus: 'ok' | 'missing_anchor' | 'missing_current' | 'error' | 'estimated';
  /** Quarter-end implied price from 13F holdings; used for quote enrichment fallback. */
  impliedReferencePriceUsd?: number | null;
}

export interface ThirteenFPerformanceEnrichRequestEntry {
  ticker: string;
  anchorDate: string;
  reportDate: string;
  impliedReferencePriceUsd?: number | null;
}

export interface ThirteenFPerformanceQuoteEnrichment {
  ticker: string;
  anchorPriceUsd: number | null;
  reportPriceUsd: number | null;
  currentPriceUsd: number | null;
  returnPct: number | null;
  reportReturnPct: number | null;
  quoteStatus: ThirteenFPerformanceEntry['quoteStatus'];
}

export interface ThirteenFPerformanceEnrichResponse {
  quotes: ThirteenFPerformanceQuoteEnrichment[];
}

export interface ThirteenFPerformanceTrackingResponse {
  quarter: ThirteenFQuarterId;
  institutions: ThirteenFInstitution[];
  entries: ThirteenFPerformanceEntry[];
  asOfDate: string;
  sortMode: ThirteenFPerformanceSortMode;
  scope?: {
    /** NEW + ADD positions included in backtest. */
    buySideTickers: number;
    newCount: number;
    addCount: number;
  };
  excludedInstitutions?: Array<{
    cik: string;
    name: string;
    availableQuarter: ThirteenFQuarterId;
  }>;
}

export interface ThirteenFInstitutionSearchResponse {
  items: ThirteenFInstitution[];
}

export type ThirteenFStakeFormType = 'SC 13D' | 'SC 13D/A' | 'SC 13G' | 'SC 13G/A';

export type ThirteenFStakeLookbackDays = 90 | 180 | 365 | 730 | 0;

export type ThirteenFStakeMajorEvent = 'NEW_5PCT_STAKE' | 'POSITION_CHANGE' | 'OTHER';

export type ThirteenFStakeChangeType =
  | 'NEW_STAKE'
  | 'STAKE_INCREASED'
  | 'STAKE_DECREASED'
  | 'FELL_BELOW_5'
  | 'UNCHANGED'
  | 'NO_PRIOR_DATA'
  | 'PRIOR_PENDING'
  | 'UNKNOWN';

export type ThirteenFStakeParseStatus = 'pending' | 'ok' | 'partial' | 'failed';

export type ThirteenFStakeItem4Status = 'pending' | 'loading' | 'ready' | 'failed' | 'skipped';

export interface ThirteenFStakeEnrichment {
  accessionNumber: string;
  ownershipPct?: number | null;
  priorOwnershipPct?: number | null;
  ownershipDeltaPct?: number | null;
  sharesOwned?: number | null;
  stakeChangeType?: ThirteenFStakeChangeType;
  item4Summary?: string | null;
  item4SummaryStatus?: ThirteenFStakeItem4Status;
  parseStatus?: ThirteenFStakeParseStatus;
}

export interface ThirteenFStakeFiling {
  id: string;
  filerCik: string;
  filerName: string;
  formType: ThirteenFStakeFormType | string;
  filingDate: string;
  accessionNumber: string;
  fileNumber?: string | null;
  targetCompanyName?: string | null;
  targetCompanyCik?: string | null;
  targetCompanyTicker?: string | null;
  documentUrl: string;
  isMajorEvent: ThirteenFStakeMajorEvent;
  ownershipPct?: number | null;
  priorOwnershipPct?: number | null;
  ownershipDeltaPct?: number | null;
  sharesOwned?: number | null;
  stakeChangeType?: ThirteenFStakeChangeType;
  item4Summary?: string | null;
  item4SummaryStatus?: ThirteenFStakeItem4Status;
  parseStatus?: ThirteenFStakeParseStatus;
  mergedAccessionNumbers?: string[];
  mergedFormTypes?: string[];
}

export interface ThirteenFStakeFeedResponse {
  filings: ThirteenFStakeFiling[];
  totalCount: number;
  institutionCount: number;
  fetchedAt: string;
  dataSource?: string;
  sinceDate?: string | null;
  lookbackDays?: number | null;
}

export interface ThirteenFStakeFeedRequest {
  ciks: string[];
  limit?: number;
  limitPerInstitution?: number;
  sinceDate?: string | null;
  lookbackDays?: number | null;
  refresh?: boolean;
}

export interface ThirteenFStakeParseRequest {
  filings: Array<{
    accessionNumber: string;
    documentUrl: string;
    formType: string;
    filingDate: string;
    filerCik: string;
    filerName: string;
    fileNumber?: string | null;
    targetCompanyName?: string | null;
    targetCompanyCik?: string | null;
  }>;
}

export interface ThirteenFStakeParseResponse {
  enrichments: ThirteenFStakeEnrichment[];
}

export interface ThirteenFStakeItem4Request {
  accessionNumber: string;
  documentUrl: string;
  formType: string;
  filerName: string;
  targetCompanyName?: string | null;
  filingDate?: string;
}

export interface ThirteenFStakeBackfillRequest {
  filings: Array<{
    accessionNumber: string;
    documentUrl: string;
    formType: string;
    filingDate: string;
    filerCik: string;
    filerName: string;
    targetCompanyName?: string | null;
    targetCompanyCik?: string | null;
    ownershipPct?: number | null;
    mergedAccessionNumbers?: string[];
  }>;
}

export interface ThirteenFStakeBackfillResponse {
  enrichments: ThirteenFStakeEnrichment[];
}

export interface ThirteenFStakeItem4Response {
  accessionNumber: string;
  item4Summary: string | null;
  item4SummaryStatus: ThirteenFStakeItem4Status;
}
