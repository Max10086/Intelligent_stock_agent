import type { AnalysisState } from '../types.ts';

/** Strip heavy Q&A payloads for history list; full report via GET /api/history/:id. */
export function slimHistoryItem(state: AnalysisState): AnalysisState {
  const slimCompany = (company: AnalysisState['focusCompany']) => {
    if (!company) return null;
    return {
      ...company,
      qna: [],
    };
  };

  return {
    ...state,
    focusCompany: slimCompany(state.focusCompany),
    candidateCompanies: (state.candidateCompanies || []).map(company => ({
      ...company,
      qna: [],
    })),
    llmTelemetry: undefined,
  };
}

export function buildHistoryListSummary(state: AnalysisState): string {
  return JSON.stringify(slimHistoryItem(state));
}
