/** US / CN implemented; HK reserved for future Gemini-based fetch. */
export type GainerMarket = 'US' | 'CN' | 'HK';

export type GainerPeriod = 'DAILY' | 'WEEKLY' | 'THREE_DAY';

export type GainerBadge = 'none' | 'recurring' | 'hot' | 'trending';

export interface MarketGainerEntryDto {
  id: string;
  rank: number;
  displayRank: number;
  name: string;
  ticker: string;
  exchange: string | null;
  changePct: number;
  blurb: string;
  validated: boolean;
  appearanceScore: number;
  dailyAppearances14d: number;
  weeklyAppearances14d: number;
  badge: GainerBadge;
  autoAnalyzeEligible: boolean;
}

export interface MarketGainerSnapshotDto {
  id: string;
  market: GainerMarket;
  period: GainerPeriod;
  tradingDateEnd: string;
  tradingDateStart: string | null;
  modelProvider: string;
  modelName: string;
  status: string;
  fetchedAt: string;
  entries: MarketGainerEntryDto[];
}

export interface MarketGainerListResponse {
  snapshot: MarketGainerSnapshotDto | null;
  highAttention: MarketGainerEntryDto[];
  /** When viewing a specific tradingDateEnd; null means latest. */
  selectedTradingDateEnd: string | null;
}

export interface MarketGainerHistoryItemDto {
  id: string;
  tradingDateEnd: string;
  tradingDateStart: string | null;
  fetchedAt: string;
  entryCount: number;
  modelProvider: string;
  modelName: string;
}

export interface MarketGainerHistoryResponse {
  items: MarketGainerHistoryItemDto[];
}

export interface UserGainerPreferenceDto {
  autoAnalyzeEnabled: boolean;
  autoAnalyzeMarkets: GainerMarket[];
  minAppearanceScore: number;
  maxAutoTickersPerRun: number;
  language: 'en' | 'cn';
}

export interface ParsedGainerEntry {
  rank: number;
  name: string;
  ticker: string;
  exchange?: string;
  changePct: number;
  blurb: string;
}

export interface ParsedGainerPayload {
  asOfDate: string;
  periodStart?: string;
  entries: ParsedGainerEntry[];
}
