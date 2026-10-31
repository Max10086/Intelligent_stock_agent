import React from 'react';
import type { Language } from '../../types.ts';
import type { ThirteenFQuarterId, ThirteenFQuarterOption } from '../../types/thirteenF.ts';
import { getUIText } from '../../constants.ts';

interface QuarterSelectorProps {
  language: Language;
  quarters: ThirteenFQuarterOption[];
  value: ThirteenFQuarterId | null;
  onChange: (quarter: ThirteenFQuarterId | null) => void;
}

export const QuarterSelector: React.FC<QuarterSelectorProps> = ({
  language,
  quarters,
  value,
  onChange,
}) => {
  const ui = getUIText(language);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <label className="text-sm text-gray-400" htmlFor="thirteen-f-quarter">
        {ui.thirteenFQuarter}
      </label>
      <select
        id="thirteen-f-quarter"
        value={value ?? ''}
        onChange={event => {
          const next = event.target.value;
          onChange(next ? (next as ThirteenFQuarterId) : null);
        }}
        className="rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100"
      >
        {quarters.map(item => (
          <option key={item.quarter} value={item.quarter}>
            {item.quarter}
            {item.isLatest ? ` (${ui.thirteenFLatest})` : ''}
            {item.noticeOnly ? ' · Notice' : ''}
            {` · filed ${item.filingDate}`}
          </option>
        ))}
      </select>
    </div>
  );
};
