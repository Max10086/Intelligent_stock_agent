import type { CompanyAnalysis, FinalConclusion } from '../types.ts';
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
export const findIncompleteCompanies = (
  companies: Array<CompanyAnalysis | null | undefined>
): CompanyAnalysis[] => {
  return companies.filter((company): company is CompanyAnalysis => {
    if (!company) return false;
    const qna = Array.isArray(company.qna) ? company.qna : [];
    if (qna.length === 0) return false;
    return !isCompanyAnalysisComplete(company);
  });
};
