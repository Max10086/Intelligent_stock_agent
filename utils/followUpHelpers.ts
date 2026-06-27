import type {
  AnalysisState,
  CompanyAnalysis,
  FollowUpBaseline,
  Language,
} from '../types.ts';
import {
  hasUsableFinalConclusion,
  isCompanyAnalysisComplete,
} from './analysisComplete.ts';
import { hasUsableInvestmentConclusion } from './synthesizeConclusionPrompt.ts';

export const DEFAULT_FOLLOW_UP_QUESTION_COUNT = 8;

export const extractFollowUpBaseline = (
  company: CompanyAnalysis,
  parentTimestamp: string
): FollowUpBaseline => ({
  analysisDate: parentTimestamp,
  ticker: company.profile.ticker,
  name: company.profile.name,
  price: company.profile.currentPrice,
  peTtm: company.profile.peTtm,
  marketCap: company.profile.marketCap,
  overallConclusion: company.finalConclusion?.overall_conclusion || '',
  thesisBullets:
    company.finalConclusion?.bullet_points
      ?.map(point => point.argument)
      .filter(Boolean) || [],
});

export const getFollowUpEligibleCompanies = (
  state: AnalysisState
): CompanyAnalysis[] => {
  const companies = [
    state.focusCompany,
    ...(state.candidateCompanies || []),
  ].filter(Boolean) as CompanyAnalysis[];
  return companies.filter(isFollowUpEligibleCompany);
};

/** Supports slim history rows where Q&A was stripped for list performance. */
export const isFollowUpEligibleCompany = (
  company: CompanyAnalysis
): boolean => {
  if (isCompanyAnalysisComplete(company)) return true;

  const qna = Array.isArray(company.qna) ? company.qna : [];
  if (qna.length > 0) return false;

  const questions = Array.isArray(company.questions) ? company.questions : [];
  return (
    questions.length > 0 &&
    hasUsableInvestmentConclusion(company.conclusion) &&
    hasUsableFinalConclusion(company.finalConclusion)
  );
};

export const computeDaysSince = (isoDate: string): number => {
  const then = new Date(isoDate).getTime();
  if (Number.isNaN(then)) return 0;
  return Math.max(0, Math.floor((Date.now() - then) / (1000 * 60 * 60 * 24)));
};

export const formatPriceChangePct = (
  baselinePrice: string,
  currentPrice: string
): string | null => {
  const base = Number((baselinePrice || '').replace(/[^0-9.-]/g, ''));
  const curr = Number((currentPrice || '').replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(base) || !Number.isFinite(curr) || base === 0) return null;
  const pct = ((curr - base) / base) * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
};

export const formatFollowUpDate = (isoDate: string, lang: Language): string => {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return isoDate;
  return date.toLocaleDateString(lang === 'cn' ? 'zh-CN' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
};

export const buildFollowUpQueryLabel = (
  parentQuery: string,
  companies: CompanyAnalysis[],
  lang: Language
): string => {
  if (companies.length === 1) {
    const name = companies[0].profile.name;
    return lang === 'cn'
      ? `跟进分析 · ${name}`
      : `Follow-up · ${name}`;
  }
  return lang === 'cn'
    ? `跟进分析 · ${parentQuery}`
    : `Follow-up · ${parentQuery}`;
};

export const getFollowUpTargetsFromParent = (
  parentState: AnalysisState,
  companyIds?: string[]
): CompanyAnalysis[] => {
  const eligible = getFollowUpEligibleCompanies(parentState);
  if (!companyIds?.length) return eligible;
  return eligible.filter(company => companyIds.includes(company.id));
};
