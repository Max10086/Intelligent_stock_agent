export interface CatalogReturnInputItem {
  id: string;
  ticker: string;
  exchange: string;
  anchorPrice: string;
  /** Used when ticker is a company name instead of a symbol. */
  companyName?: string | null;
}

export interface CatalogReturnResultItem {
  id: string;
  returnPct: number | null;
  currentPrice: string | null;
}

export interface CatalogReturnBatchResponse {
  results: CatalogReturnResultItem[];
}

export type CatalogReturnLoadStatus = 'idle' | 'loading' | 'done' | 'error';

export interface CatalogReturnDisplay {
  status: CatalogReturnLoadStatus;
  returnPct: number | null;
  currentPrice: string | null;
}
