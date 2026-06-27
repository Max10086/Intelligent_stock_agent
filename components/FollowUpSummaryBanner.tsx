
import React from 'react';
import { AnalysisState, CompanyAnalysis, FollowUpBaseline, Language } from '../types.ts';
import { getUIText } from '../constants.ts';
import {
  formatFollowUpDate,
  formatPriceChangePct,
} from '../utils/followUpHelpers.ts';
import type { ComparisonBaselineMode } from '../utils/analysisTimeline.ts';
import { ComparisonModeToggle } from './ComparisonModeToggle.tsx';

interface FollowUpSummaryBannerProps {
  analysisState: AnalysisState;
  language: Language;
  comparisonMode: ComparisonBaselineMode;
  onComparisonModeChange: (mode: ComparisonBaselineMode) => void;
  showInitialOption: boolean;
  baselinesByCompanyId: Record<string, FollowUpBaseline | null>;
  onViewParent?: () => void;
  onViewInitial?: () => void;
}

const getRatingChangeLabel = (
  change: string | undefined,
  language: Language
): { label: string; className: string } => {
  const uiText = getUIText(language);
  switch (change) {
    case 'upgrade':
      return { label: uiText.followUpRatingUpgrade, className: 'text-green-400' };
    case 'downgrade':
      return { label: uiText.followUpRatingDowngrade, className: 'text-red-400' };
    case 'maintain':
      return { label: uiText.followUpRatingMaintain, className: 'text-gray-300' };
    default:
      return { label: '', className: 'text-gray-400' };
  }
};

const CompanyFollowUpRow: React.FC<{
  company: CompanyAnalysis;
  language: Language;
  comparisonMode: ComparisonBaselineMode;
  baseline: FollowUpBaseline | null;
}> = ({ company, language, comparisonMode, baseline }) => {
  const uiText = getUIText(language);
  if (!baseline) return null;

  const priceChange = formatPriceChangePct(baseline.price, company.profile.currentPrice);
  const ratingMeta =
    comparisonMode === 'previous'
      ? getRatingChangeLabel(company.finalConclusion?.vs_prior?.rating_change, language)
      : { label: '', className: '' };

  return (
    <div className="rounded-md bg-gray-900/50 p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="font-semibold text-white">{company.profile.name}</p>
        {ratingMeta.label && (
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full bg-gray-800 ${ratingMeta.className}`}>
            {ratingMeta.label}
          </span>
        )}
      </div>
      <p className="mt-1 text-[11px] text-gray-500">
        {uiText.compareBaselineDate}: {formatFollowUpDate(baseline.analysisDate, language)}
        <span className="ml-2 text-gray-600">
          ({comparisonMode === 'previous' ? uiText.compareVsPrevious : uiText.compareVsInitial})
        </span>
      </p>
      <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
        <div>
          <p className="text-gray-500">{uiText.followUpPriorPrice}</p>
          <p className="text-gray-200">{baseline.price}</p>
        </div>
        <div>
          <p className="text-gray-500">{uiText.followUpCurrentPrice}</p>
          <p className="text-gray-200">{company.profile.currentPrice}</p>
        </div>
        <div>
          <p className="text-gray-500">{uiText.followUpPriceChange}</p>
          <p
            className={
              priceChange?.startsWith('+')
                ? 'text-green-400'
                : priceChange?.startsWith('-')
                  ? 'text-red-400'
                  : 'text-gray-300'
            }
          >
            {priceChange || '—'}
          </p>
        </div>
      </div>
      {comparisonMode === 'previous' && company.finalConclusion?.vs_prior?.change_summary && (
        <p className="mt-2 text-xs text-gray-300">
          {company.finalConclusion.vs_prior.change_summary}
        </p>
      )}
      {comparisonMode === 'initial' && baseline.overallConclusion && (
        <p className="mt-2 text-xs text-gray-400 line-clamp-2">
          {uiText.followUpPriorConclusion}: {baseline.overallConclusion}
        </p>
      )}
    </div>
  );
};

export const FollowUpSummaryBanner: React.FC<FollowUpSummaryBannerProps> = ({
  analysisState,
  language,
  comparisonMode,
  onComparisonModeChange,
  showInitialOption,
  baselinesByCompanyId,
  onViewParent,
  onViewInitial,
}) => {
  if (analysisState.analysisType !== 'follow_up' || !analysisState.followUpMeta) return null;

  const uiText = getUIText(language);
  const companies = [
    analysisState.focusCompany,
    ...(analysisState.candidateCompanies || []),
  ].filter(Boolean) as CompanyAnalysis[];

  return (
    <section className="mb-6 rounded-lg border border-blue-700/50 bg-blue-950/20 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold text-blue-300">{uiText.followUpBannerTitle}</h3>
          <div className="mt-2">
            <ComparisonModeToggle
              mode={comparisonMode}
              onChange={onComparisonModeChange}
              language={language}
              showInitialOption={showInitialOption}
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {comparisonMode === 'previous' && onViewParent && (
            <button
              onClick={onViewParent}
              className="text-xs font-medium px-3 py-1.5 rounded-md bg-gray-800 hover:bg-gray-700 text-blue-300"
            >
              {uiText.followUpViewPriorReport}
            </button>
          )}
          {comparisonMode === 'initial' && onViewInitial && (
            <button
              onClick={onViewInitial}
              className="text-xs font-medium px-3 py-1.5 rounded-md bg-gray-800 hover:bg-gray-700 text-emerald-300"
            >
              {uiText.viewInitialReport}
            </button>
          )}
        </div>
      </div>
      <div className="mt-4 space-y-3">
        {companies.map(company => (
          <CompanyFollowUpRow
            key={company.id}
            company={company}
            language={language}
            comparisonMode={comparisonMode}
            baseline={baselinesByCompanyId[company.id] ?? null}
          />
        ))}
      </div>
    </section>
  );
};
