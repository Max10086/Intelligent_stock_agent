
import React from 'react';
import { Language } from '../types.ts';
import { getUIText } from '../constants.ts';
import type { ComparisonBaselineMode } from '../utils/analysisTimeline.ts';

interface ComparisonModeToggleProps {
  mode: ComparisonBaselineMode;
  onChange: (mode: ComparisonBaselineMode) => void;
  language: Language;
  showInitialOption: boolean;
}

export const ComparisonModeToggle: React.FC<ComparisonModeToggleProps> = ({
  mode,
  onChange,
  language,
  showInitialOption,
}) => {
  const uiText = getUIText(language);

  return (
    <div className="inline-flex items-center gap-2 text-xs">
      <span className="text-gray-500">{uiText.comparisonModeLabel}</span>
      <div className="inline-flex rounded-md bg-gray-900/80 p-0.5 border border-gray-700">
        <button
          type="button"
          onClick={() => onChange('previous')}
          className={`px-2.5 py-1 rounded font-medium transition-colors ${
            mode === 'previous'
              ? 'bg-blue-600 text-white'
              : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          {uiText.compareVsPrevious}
        </button>
        {showInitialOption && (
          <button
            type="button"
            onClick={() => onChange('initial')}
            className={`px-2.5 py-1 rounded font-medium transition-colors ${
              mode === 'initial'
                ? 'bg-blue-600 text-white'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            {uiText.compareVsInitial}
          </button>
        )}
      </div>
    </div>
  );
};
