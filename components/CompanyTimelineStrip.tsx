
import React from 'react';
import { AnalysisState, Language } from '../types.ts';
import { getUIText } from '../constants.ts';
import { formatFollowUpDate } from '../utils/followUpHelpers.ts';
import {
  TickerTimelineEntry,
  truncateConclusion,
} from '../utils/analysisTimeline.ts';

interface CompanyTimelineStripProps {
  entries: TickerTimelineEntry[];
  currentReportId: string;
  language: Language;
  onSelectReport: (reportId: string) => void;
}

export const CompanyTimelineStrip: React.FC<CompanyTimelineStripProps> = ({
  entries,
  currentReportId,
  language,
  onSelectReport,
}) => {
  const uiText = getUIText(language);
  if (entries.length <= 1) return null;

  return (
    <section className="mb-6 rounded-lg border border-gray-700 bg-gray-800/60 p-4">
      <h3 className="text-sm font-semibold text-gray-200 mb-3">{uiText.companyTimeline}</h3>
      <div className="overflow-x-auto pb-1">
        <ol className="flex min-w-max items-stretch gap-0">
          {entries.map((entry, index) => {
            const isCurrent = entry.reportId === currentReportId;
            const conclusion = truncateConclusion(
              entry.company.finalConclusion?.overall_conclusion,
              36
            );

            return (
              <li key={entry.reportId} className="flex items-stretch">
                {index > 0 && (
                  <div className="flex items-center px-1">
                    <div className="h-px w-6 bg-gray-600" />
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => onSelectReport(entry.reportId)}
                  className={`min-w-[132px] max-w-[168px] rounded-lg border px-3 py-2 text-left transition-colors ${
                    isCurrent
                      ? 'border-blue-500 bg-blue-950/40'
                      : 'border-gray-700 bg-gray-900/40 hover:border-gray-500 hover:bg-gray-900/70'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span
                      className={`text-[11px] font-bold ${
                        entry.isFollowUp ? 'text-amber-400' : 'text-emerald-400'
                      }`}
                    >
                      {entry.sequenceLabel}
                    </span>
                    {isCurrent && (
                      <span className="text-[10px] text-blue-300">{uiText.currentReportMarker}</span>
                    )}
                  </div>
                  <p className="mt-1 text-[10px] text-gray-500">
                    {formatFollowUpDate(entry.report.timestamp, language)}
                  </p>
                  {conclusion && (
                    <p className="mt-1 text-[10px] text-gray-400 line-clamp-2">{conclusion}</p>
                  )}
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
};
