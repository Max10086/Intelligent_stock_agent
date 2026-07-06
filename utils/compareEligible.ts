import type { AnalysisState, CompanyAnalysis, Language } from '../types.ts';
import {
  hasUsableFinalConclusion,
  isCompanyAnalysisComplete,
} from './analysisComplete.ts';
import { hasUsableInvestmentConclusion } from './synthesizeConclusionPrompt.ts';
import type { CompanyRole } from '../types/compare.ts';

export interface EligibleCompareCompany {
  reportId: string;
  companyId: string;
  name: string;
  ticker: string;
  exchange: string;
  role: CompanyRole;
  snapshotAt: string;
  reportLanguage: Language;
  reportQuery: string;
}

/** Works with slim history list items (qna stripped) and full reports. */
export const isCompanyEligibleForCompare = (
  company: CompanyAnalysis | null | undefined
): boolean => {
  if (!company) return false;
  if (company.status === 'awaiting_user' || company.status === 'pending') return false;
  if (company.status === 'error') return false;

  const hasThesis =
    hasUsableInvestmentConclusion(company.conclusion) &&
    hasUsableFinalConclusion(company.finalConclusion);

  if (company.status === 'complete') {
    return hasThesis;
  }

  const qna = Array.isArray(company.qna) ? company.qna : [];
  if (qna.length === 0) {
    return hasThesis;
  }

  return isCompanyAnalysisComplete(company);
};

export const listEligibleCompareCompanies = (
  report: AnalysisState
): EligibleCompareCompany[] => {
  const results: EligibleCompareCompany[] = [];
  const push = (company: CompanyAnalysis | null | undefined, role: CompanyRole) => {
    if (!company || !isCompanyEligibleForCompare(company)) return;
    results.push({
      reportId: report.id,
      companyId: company.id,
      name: company.profile.name,
      ticker: company.profile.ticker,
      exchange: company.profile.exchange,
      role,
      snapshotAt: report.timestamp,
      reportLanguage: report.language,
      reportQuery: report.query,
    });
  };

  push(report.focusCompany, 'focus');
  for (const candidate of report.candidateCompanies || []) {
    push(candidate, 'candidate');
  }
  return results;
};

export const buildCompareBasketKey = (reportId: string, companyId: string): string =>
  `${reportId}::${companyId}`;
