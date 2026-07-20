export type EdgarReportForm = '10-K' | '10-Q' | '20-F';

export interface EdgarFetchSpec {
  form: EdgarReportForm;
}

export interface EdgarReportPayload {
  form: EdgarReportForm;
  title: string;
  filingDate: string;
  accessionNumber: string;
  fiscalPeriod: string;
  textChars: number;
  cacheHit: boolean;
  body: string;
}

export interface EdgarFilingBundle {
  ticker: string;
  reports: EdgarReportPayload[];
  errors: Array<{ form: EdgarReportForm; message: string }>;
  evidenceText: string;
}
