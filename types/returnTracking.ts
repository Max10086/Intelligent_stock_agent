export type ReturnTrackingSourceType = 'compare_run' | 'analysis_report';

export interface ReturnTrackingCompanyInput {
  companyKey: string;
  ticker: string;
  exchange: string;
  name?: string;
  anchorPrice: string;
  anchorDate: string;
}

export interface RecordReturnTrackingRequest {
  sourceType: ReturnTrackingSourceType;
  sourceId: string;
  observedDate: string;
  companies: ReturnTrackingCompanyInput[];
}

export interface ReturnTrackingSnapshotPoint {
  date: string;
  price: string;
  returnPct: number;
}

export interface ReturnTrackingCompanyResult {
  companyKey: string;
  ticker: string;
  exchange: string;
  name?: string;
  anchorPrice: string;
  anchorDate: string;
  currentPrice: string;
  returnPct: number | null;
  timeline: ReturnTrackingSnapshotPoint[];
}

export interface RecordReturnTrackingResponse {
  companies: ReturnTrackingCompanyResult[];
}
