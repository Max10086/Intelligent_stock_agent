import type {
  AnalysisState,
  CompanyAnalysis,
  CompanyProfile,
  ConclusionSectionData,
  FinalConclusion,
  InvestmentConclusion,
} from '../types.ts';
import { THESIS_SECTION_KEYS } from './synthesizeConclusionPrompt.ts';

const MIN_EVIDENCE_FOR_ELIGIBILITY = 3;

function slimProfile(profile: CompanyProfile): CompanyProfile {
  return {
    name: profile.name,
    ticker: profile.ticker,
    exchange: profile.exchange,
    currentPrice: profile.currentPrice,
    weekChange: profile.weekChange || '',
    monthChange: profile.monthChange || '',
    peTtm: profile.peTtm,
    marketCap: profile.marketCap,
    currency: profile.currency,
  };
}

function slimConclusion(conclusion: InvestmentConclusion | null): InvestmentConclusion | null {
  if (!conclusion) return null;

  const slim: Partial<InvestmentConclusion> = {};
  for (const key of THESIS_SECTION_KEYS) {
    const section = conclusion[key] as ConclusionSectionData | undefined;
    if (!section) continue;
    const evidence = Array.isArray(section.evidence) ? section.evidence.filter(Boolean) : [];
    slim[key] = {
      summary: section.summary || '',
      evidence: evidence.slice(0, MIN_EVIDENCE_FOR_ELIGIBILITY),
    };
  }
  return slim as InvestmentConclusion;
}

function slimFinalConclusion(finalConclusion: FinalConclusion | null): FinalConclusion | null {
  if (!finalConclusion) return null;

  return {
    overall_conclusion: finalConclusion.overall_conclusion || '',
    bullet_points: (finalConclusion.bullet_points || []).slice(0, 3).map(point => ({
      argument: point.argument,
      evidence: (point.evidence || []).slice(0, 2),
    })),
    ...(finalConclusion.decision ? { decision: finalConclusion.decision } : {}),
    ...(finalConclusion.vs_prior ? { vs_prior: finalConclusion.vs_prior } : {}),
  };
}

function slimCompany(company: CompanyAnalysis | null | undefined): CompanyAnalysis | null {
  if (!company) return null;

  return {
    id: company.id,
    profile: slimProfile(company.profile),
    status: company.status,
    questions: [],
    qna: [],
    conclusion: slimConclusion(company.conclusion),
    finalConclusion: slimFinalConclusion(company.finalConclusion),
    followUpQuestions: [],
    error: company.error,
  };
}

/** Strip heavy payloads for history list; full report via GET /api/history/:id. */
export function slimHistoryItem(state: AnalysisState): AnalysisState {
  return {
    id: state.id,
    clientSessionId: state.clientSessionId,
    timestamp: state.timestamp,
    status: state.status,
    language: state.language,
    query: state.query,
    focusCompany: slimCompany(state.focusCompany),
    candidateCompanies: (state.candidateCompanies || [])
      .map(company => slimCompany(company))
      .filter(Boolean) as CompanyAnalysis[],
    error: state.error,
    currentStage: '',
    currentProgress: state.status === 'complete' ? 100 : 0,
    analysisType: state.analysisType,
    followUpMeta: state.followUpMeta,
  };
}

export function buildHistoryListSummary(state: AnalysisState): string {
  return JSON.stringify(slimHistoryItem(state));
}
