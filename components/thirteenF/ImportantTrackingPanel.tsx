import React, { useMemo } from 'react';
import type { Language } from '../../types.ts';
import type {
  ThirteenFStakeFiling,
  ThirteenFStakeLookbackDays,
  ThirteenFStakeMajorEvent,
} from '../../types/thirteenF.ts';
import type { ThirteenFTrackerState } from '../../hooks/useThirteenFTracker.ts';
import { getUIText } from '../../constants.ts';
import { resolveInstitutionCik } from '../../utils/thirteenFInstitutionSearch.ts';
import { STAKE_LOOKBACK_OPTIONS } from '../../utils/thirteenFStakeLookback.ts';
import { ArrowPathIcon } from '../icons.tsx';

interface ImportantTrackingPanelProps {
  language: Language;
  tracker: ThirteenFTrackerState;
}

const lookbackLabel = (
  days: ThirteenFStakeLookbackDays,
  ui: ReturnType<typeof getUIText>
): string => {
  switch (days) {
    case 90:
      return ui.thirteenFStakeLookback90;
    case 180:
      return ui.thirteenFStakeLookback180;
    case 365:
      return ui.thirteenFStakeLookback365;
    case 730:
      return ui.thirteenFStakeLookback730;
    default:
      return ui.thirteenFStakeLookbackAll;
  }
};

const majorEventLabel = (
  event: ThirteenFStakeMajorEvent,
  ui: ReturnType<typeof getUIText>
): string => {
  switch (event) {
    case 'NEW_5PCT_STAKE':
      return ui.thirteenFStakeEventNew;
    case 'POSITION_CHANGE':
      return ui.thirteenFStakeEventAmendment;
    default:
      return ui.thirteenFStakeEventOther;
  }
};

const majorEventClass = (event: ThirteenFStakeMajorEvent): string => {
  switch (event) {
    case 'NEW_5PCT_STAKE':
      return 'border-emerald-500/40 bg-emerald-950/40 text-emerald-200';
    case 'POSITION_CHANGE':
      return 'border-amber-500/40 bg-amber-950/40 text-amber-200';
    default:
      return 'border-gray-600 bg-gray-900/60 text-gray-300';
  }
};

const formTypeClass = (formType: string): string => {
  if (formType.includes('13D')) {
    return 'border-blue-500/40 bg-blue-950/40 text-blue-200';
  }
  return 'border-violet-500/40 bg-violet-950/40 text-violet-200';
};

const formatFilingDate = (value: string, language: Language): string => {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(language === 'cn' ? 'zh-CN' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
};

const formatOwnershipPct = (value: number | null | undefined): string => {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${value.toFixed(2)}%`;
};

const formatOwnershipDelta = (value: number | null | undefined): string => {
  if (value == null || !Number.isFinite(value)) return '';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
};

const isInitialStakeForm = (formType: string): boolean => {
  const primary = formType.split(' · ')[0] ?? formType;
  return primary === 'SC 13D' || primary === 'SC 13G';
};

const needsManualStakeCompare = (filing: ThirteenFStakeFiling): boolean => {
  if (filing.ownershipPct == null) return false;
  if (isInitialStakeForm(filing.formType)) return false;
  return filing.priorOwnershipPct == null || filing.stakeChangeType === 'PRIOR_PENDING';
};

const truncateText = (value: string, maxLength: number): string => {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength - 1)}…`;
};

const targetDisplayTitle = (filing: ThirteenFStakeFiling): string | undefined => {
  const parts = [
    filing.targetCompanyTicker?.trim(),
    filing.targetCompanyName?.trim(),
    filing.targetCompanyCik ? `CIK ${filing.targetCompanyCik}` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : undefined;
};

const TargetCell: React.FC<{
  filing: ThirteenFStakeFiling;
  ui: ReturnType<typeof getUIText>;
}> = ({ filing, ui }) => {
  const ticker = filing.targetCompanyTicker?.trim().toUpperCase() ?? '';
  const name = filing.targetCompanyName?.trim() ?? '';

  if (!ticker && !name) {
    return <span className="text-gray-500">{ui.thirteenFStakeTargetUnknown}</span>;
  }

  return (
    <span className="inline-flex max-w-full min-w-0 items-center gap-1.5" title={targetDisplayTitle(filing)}>
      {ticker ? (
        <span className="shrink-0 font-semibold tracking-wide text-sky-300">{ticker}</span>
      ) : null}
      {name ? <span className="truncate text-gray-200">{name}</span> : null}
    </span>
  );
};

const OwnershipCell: React.FC<{
  filing: ThirteenFStakeFiling;
  ui: ReturnType<typeof getUIText>;
  compareLoading: boolean;
  onCompareHistory?: () => void;
}> = ({ filing, ui, compareLoading, onCompareHistory }) => (
  <span className="inline-flex max-w-full items-center gap-2">
    <span className="min-w-0 whitespace-nowrap">
      <span>{formatOwnershipPct(filing.ownershipPct)}</span>
      {filing.priorOwnershipPct != null ? (
        <span className="ml-1 text-xs text-gray-500">
          ({ui.thirteenFStakePriorOwnership.replace('{pct}', formatOwnershipPct(filing.priorOwnershipPct))})
        </span>
      ) : null}
      {filing.ownershipDeltaPct != null ? (
        <span
          className={`ml-1 text-xs ${
            filing.ownershipDeltaPct > 0
              ? 'text-emerald-400'
              : filing.ownershipDeltaPct < 0
                ? 'text-red-400'
                : 'text-gray-500'
          }`}
        >
          {formatOwnershipDelta(filing.ownershipDeltaPct)}
        </span>
      ) : null}
    </span>
    {needsManualStakeCompare(filing) && onCompareHistory ? (
      <button
        type="button"
        onClick={onCompareHistory}
        disabled={compareLoading}
        className="shrink-0 rounded border border-gray-700 px-1.5 py-0.5 text-xs text-gray-300 hover:border-gray-500 hover:text-white disabled:opacity-50"
      >
        {compareLoading ? ui.thirteenFStakeCompareLoading : ui.thirteenFStakeCompareHistory}
      </button>
    ) : null}
  </span>
);

const StakeRow: React.FC<{
  filing: ThirteenFStakeFiling;
  language: Language;
  ui: ReturnType<typeof getUIText>;
  compareLoading: boolean;
  onCompareHistory?: () => void;
}> = ({ filing, language, ui, compareLoading, onCompareHistory }) => (
  <tr className="border-b border-gray-800/80 hover:bg-gray-800/30">
    <td className="px-2 py-2.5 text-sm text-gray-200 whitespace-nowrap">
      {formatFilingDate(filing.filingDate, language)}
    </td>
    <td
      className="px-2 py-2.5 text-sm text-gray-200 whitespace-nowrap"
      title={`${filing.filerName} (${filing.filerCik})`}
    >
      <span className="block truncate">{truncateText(filing.filerName, 18)}</span>
    </td>
    <td className="px-2 py-2.5 text-sm whitespace-nowrap">
      <span
        className={`inline-flex rounded-md border px-1.5 py-0.5 text-xs font-medium ${formTypeClass(filing.formType)}`}
        title={filing.formType}
      >
        {truncateText(filing.formType.replace(/^SC /, ''), 12)}
      </span>
    </td>
    <td className="px-2 py-2.5 text-sm whitespace-nowrap">
      <span
        className={`inline-flex rounded-md border px-1.5 py-0.5 text-xs font-medium ${majorEventClass(filing.isMajorEvent)}`}
      >
        {majorEventLabel(filing.isMajorEvent, ui)}
      </span>
    </td>
    <td className="px-2 py-2.5 text-sm text-gray-200">
      <OwnershipCell
        filing={filing}
        ui={ui}
        compareLoading={compareLoading}
        onCompareHistory={onCompareHistory}
      />
    </td>
    <td className="px-2 py-2.5 text-sm whitespace-nowrap">
      <TargetCell filing={filing} ui={ui} />
    </td>
    <td className="px-2 py-2.5 text-sm whitespace-nowrap">
      <a
        href={filing.documentUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="text-blue-400 hover:text-blue-300"
      >
        {ui.thirteenFStakeViewFiling}
      </a>
    </td>
  </tr>
);

export const ImportantTrackingPanel: React.FC<ImportantTrackingPanelProps> = ({
  language,
  tracker,
}) => {
  const ui = getUIText(language);
  const {
    watchlist,
    institutionOptions,
    stakeCiks,
    stakeLookbackDays,
    toggleStakeCik,
    selectAllStakeCiks,
    clearStakeCiks,
    setStakeLookbackDays,
    stakeFeed,
    stakeFeedLoading,
    stakeFeedError,
    stakeFilingsEnriched,
    stakeOwnershipLoading,
    stakeChangeLoadingIds,
    runStakeChangeForFiling,
    runStakeFeed,
    refreshStakeFeed,
  } = tracker;

  const filings = stakeFilingsEnriched;
  const selectedCount = stakeCiks.size;

  const lookbackSummary = useMemo(
    () => lookbackLabel(stakeLookbackDays, ui),
    [stakeLookbackDays, ui]
  );

  if (watchlist.length === 0) {
    return (
      <p className="py-12 text-center text-base text-gray-500">{ui.thirteenFStakeEmptyWatchlist}</p>
    );
  }

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-gray-800 bg-gray-900/60 p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-gray-100">{ui.thirteenFStakeTitle}</h2>
            <p className="mt-2 max-w-3xl text-sm text-gray-400">{ui.thirteenFStakeSubtitle}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void runStakeFeed()}
              disabled={selectedCount === 0 || stakeFeedLoading}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm hover:bg-blue-500 disabled:opacity-50"
            >
              {stakeFeedLoading && !stakeFeed ? ui.thirteenFStakeLoading : ui.thirteenFStakeRun}
            </button>
            {stakeFeed ? (
              <button
                type="button"
                onClick={() => void refreshStakeFeed()}
                disabled={selectedCount === 0 || stakeFeedLoading}
                className="inline-flex items-center gap-1.5 rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 hover:bg-gray-700 disabled:opacity-50"
              >
                <ArrowPathIcon className={`h-4 w-4 ${stakeFeedLoading ? 'animate-spin' : ''}`} />
                {ui.thirteenFStakeRefresh}
              </button>
            ) : null}
          </div>
        </div>

        <div className="mt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-gray-200">{ui.thirteenFStakeSelectInstitutions}</p>
            <div className="flex items-center gap-2 text-xs">
              <button
                type="button"
                onClick={selectAllStakeCiks}
                className="text-blue-400 hover:text-blue-300"
              >
                {ui.thirteenFStakeSelectAll}
              </button>
              <span className="text-gray-600">·</span>
              <button
                type="button"
                onClick={clearStakeCiks}
                className="text-gray-400 hover:text-gray-200"
              >
                {ui.thirteenFStakeClearSelection}
              </button>
            </div>
          </div>
          <p className="mt-1 text-xs text-gray-500">{ui.thirteenFStakeSelectHint}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {institutionOptions.map(inst => {
              const selected = stakeCiks.has(resolveInstitutionCik(inst.cik));
              return (
                <button
                  key={inst.cik}
                  type="button"
                  onClick={() => toggleStakeCik(inst.cik)}
                  className={`rounded-full border px-3 py-1.5 text-sm ${
                    selected
                      ? 'border-blue-500 bg-blue-600/20 text-blue-100'
                      : 'border-gray-700 bg-gray-800 text-gray-300 hover:text-white'
                  }`}
                >
                  {inst.shortName ?? inst.name}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-4 rounded-md border border-gray-800 bg-gray-950/40 px-3 py-3">
          <label htmlFor="stake-lookback" className="text-sm font-medium text-gray-200">
            {ui.thirteenFStakeLookback}
          </label>
          <p className="mt-0.5 text-xs text-gray-500">{ui.thirteenFStakeLookbackHint}</p>
          <select
            id="stake-lookback"
            value={stakeLookbackDays}
            onChange={event =>
              setStakeLookbackDays(Number(event.target.value) as ThirteenFStakeLookbackDays)
            }
            className="mt-2 rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-200"
          >
            {STAKE_LOOKBACK_OPTIONS.map(option => (
              <option key={option} value={option}>
                {lookbackLabel(option, ui)}
              </option>
            ))}
          </select>
        </div>

        {stakeFeed ? (
          <p className="mt-3 text-xs text-gray-500">
            {ui.thirteenFStakeMeta
              .replace('{shown}', String(filings.length))
              .replace('{total}', String(stakeFeed.totalCount))
              .replace('{institutions}', String(stakeFeed.institutionCount))}
            {` · ${ui.thirteenFStakeLookback}: ${lookbackSummary}`}
            {stakeOwnershipLoading ? ` · ${ui.thirteenFStakeOwnershipLoading}` : ''}
            {stakeFeed.fetchedAt
              ? ` · ${ui.thirteenFStakeFetchedAt} ${new Date(stakeFeed.fetchedAt).toLocaleString(language === 'cn' ? 'zh-CN' : 'en-US')}`
              : ''}
          </p>
        ) : null}
      </section>

      {selectedCount === 0 ? (
        <p className="py-10 text-center text-sm text-gray-500">{ui.thirteenFStakeEmptySelection}</p>
      ) : stakeFeedLoading && !stakeFeed ? (
        <p className="py-10 text-center text-sm text-gray-400">{ui.thirteenFStakeLoading}</p>
      ) : filings.length === 0 ? (
        <div className="py-12 text-center">
          {stakeFeedError ? (
            <p className="text-base text-red-400">{stakeFeedError}</p>
          ) : stakeFeed ? (
            <>
              <p className="text-base text-gray-500">{ui.thirteenFStakeEmpty}</p>
              <p className="mt-2 text-sm text-gray-600">{ui.thirteenFStakeEmptyHint}</p>
            </>
          ) : (
            <p className="text-sm text-gray-500">{ui.thirteenFStakeSelectHint}</p>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-800">
          <table className="w-full min-w-[860px] table-fixed">
            <colgroup>
              <col className="w-[92px]" />
              <col className="w-[128px]" />
              <col className="w-[88px]" />
              <col className="w-[88px]" />
              <col className="w-[168px]" />
              <col className="w-[260px]" />
              <col className="w-[72px]" />
            </colgroup>
            <thead>
              <tr className="border-b border-gray-800 bg-gray-900/80 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-2 py-2.5 font-medium">{ui.thirteenFStakeColDate}</th>
                <th className="px-2 py-2.5 font-medium">{ui.thirteenFStakeColInstitution}</th>
                <th className="px-2 py-2.5 font-medium">{ui.thirteenFStakeColForm}</th>
                <th className="px-2 py-2.5 font-medium">{ui.thirteenFStakeColEvent}</th>
                <th className="px-2 py-2.5 font-medium">{ui.thirteenFStakeColOwnership}</th>
                <th className="px-2 py-2.5 font-medium">{ui.thirteenFStakeColTarget}</th>
                <th className="px-2 py-2.5 font-medium">{ui.thirteenFStakeColLink}</th>
              </tr>
            </thead>
            <tbody>
              {filings.map(filing => (
                <StakeRow
                  key={filing.id}
                  filing={filing}
                  language={language}
                  ui={ui}
                  compareLoading={stakeChangeLoadingIds.has(filing.id)}
                  onCompareHistory={() => void runStakeChangeForFiling(filing)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
