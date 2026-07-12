import React from 'react';
import type { Language } from '../types.ts';
import { getUIText } from '../constants.ts';

interface ReportFeedbackBarProps {
  language: Language;
  onPositive: () => void;
  onNegative: () => void;
}

export const ReportFeedbackBar: React.FC<ReportFeedbackBarProps> = ({
  language,
  onPositive,
  onNegative,
}) => {
  const ui = getUIText(language);

  return (
    <div className="mt-6 rounded-lg border border-gray-700 bg-gray-900/50 px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <p className="text-sm text-gray-300">{ui.feedbackReportHelpful}</p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onPositive}
          className="rounded-md bg-emerald-700/40 px-3 py-1.5 text-sm text-emerald-200 hover:bg-emerald-700/60"
        >
          {ui.feedbackReportYes}
        </button>
        <button
          type="button"
          onClick={onNegative}
          className="rounded-md bg-gray-700 px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-600"
        >
          {ui.feedbackReportNo}
        </button>
      </div>
    </div>
  );
};
