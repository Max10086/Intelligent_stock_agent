export type CninfoReportKind = 'annual' | 'q1' | 'h1' | 'q3';

export interface CninfoFetchSpec {
  year: number;
  kind: CninfoReportKind;
}

export interface CninfoReportPayload {
  year: number;
  kind: CninfoReportKind;
  title: string;
  annDate: string;
  tsCode: string;
  textChars: number;
  extractedPages: number;
  cacheHit: boolean;
  body: string;
}

export interface CninfoFilingBundle {
  secCode: string;
  plate: 'sz' | 'sh' | 'bj';
  reports: CninfoReportPayload[];
  errors: Array<{ year: number; kind: CninfoReportKind; message: string }>;
  evidenceText: string;
}
