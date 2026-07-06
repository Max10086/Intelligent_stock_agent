import type { AnalysisState, CompanyAnalysis, FinalConclusion } from '../types.ts';
import { indexAnsweredQuestions } from './qnaHelpers.ts';
import { hasUsableInvestmentConclusion } from './synthesizeConclusionPrompt.ts';

export const hasUsableFinalConclusion = (
  finalConclusion: FinalConclusion | null | undefined
): boolean => {
  if (!finalConclusion) return false;
  const overall = (finalConclusion.overall_conclusion || '').trim();
  const bullets = Array.isArray(finalConclusion.bullet_points) ? finalConclusion.bullet_points : [];
  if (!overall) return false;
  if (bullets.length >= 3) return true;
  return bullets.length > 0 && overall.length >= 40;
};

export const isCompanyAnalysisComplete = (
  company: CompanyAnalysis | null | undefined
): boolean => {
  if (!company) return false;

  const questions = Array.isArray(company.questions) ? company.questions : [];
  const qna = Array.isArray(company.qna) ? company.qna : [];
  if (questions.length === 0) return false;

  const { pendingIndices } = indexAnsweredQuestions(questions, qna);
  if (pendingIndices.length > 0) return false;

  return (
    hasUsableInvestmentConclusion(company.conclusion) &&
    hasUsableFinalConclusion(company.finalConclusion)
  );
};

/** Companies that started Q&A but are missing thesis or final conclusion. */
export const isCandidateAwaitingUser = (
  company: CompanyAnalysis | null | undefined
): boolean => company?.status === 'awaiting_user';

export const findIncompleteCompanies = (
  companies: Array<CompanyAnalysis | null | undefined>
): CompanyAnalysis[] => {
  return companies.filter((company): company is CompanyAnalysis => {
    if (!company) return false;
    if (isCandidateAwaitingUser(company)) return false;
    const qna = Array.isArray(company.qna) ? company.qna : [];
    if (qna.length === 0) return false;
    return !isCompanyAnalysisComplete(company);
  });
};

/** Reconcile session/company status after loading from DB (JSON may lag UI ref on save). */
export const normalizeReportOnLoad = (state: AnalysisState): AnalysisState => {
  const normalizeCompany = (company: CompanyAnalysis | null | undefined): CompanyAnalysis | null => {
    if (!company) return null;
    if (isCandidateAwaitingUser(company)) return company;
    if (isCompanyAnalysisComplete(company)) {
      return { ...company, status: 'complete', error: undefined };
    }
    return company;
  };

  const focusCompany = normalizeCompany(state.focusCompany);
  const candidateCompanies = (state.candidateCompanies || [])
    .map(company => normalizeCompany(company))
    .filter(Boolean) as CompanyAnalysis[];

  const allCompanies = [focusCompany, ...candidateCompanies].filter(Boolean) as CompanyAnalysis[];
  const incomplete = findIncompleteCompanies(allCompanies);
  const hasAwaitingCandidates = candidateCompanies.some(isCandidateAwaitingUser);

  let status = state.status;
  if (state.status !== 'error' && state.status !== 'analyzing' && state.status !== 'finding_companies') {
    if (incomplete.length > 0 || hasAwaitingCandidates) {
      status = 'partial';
    } else if (allCompanies.every(c => isCompanyAnalysisComplete(c))) {
      status = 'complete';
    }
  }

  return {
    ...state,
    focusCompany,
    candidateCompanies,
    status,
  };
};
