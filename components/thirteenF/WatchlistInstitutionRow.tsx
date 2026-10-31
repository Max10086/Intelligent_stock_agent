import React from 'react';
import { resolveInstitutionCik } from '../../utils/thirteenFInstitutionSearch.ts';

export const WatchlistInstitutionRow: React.FC<{
  name: string;
  selected: boolean;
  starred: boolean;
  starLabel: string;
  unstarLabel: string;
  removeLabel: string;
  onSelect: () => void;
  onToggleStar: () => void;
  onRemove: () => void;
}> = ({
  name,
  selected,
  starred,
  starLabel,
  unstarLabel,
  removeLabel,
  onSelect,
  onToggleStar,
  onRemove,
}) => (
  <div
    className={`flex items-center gap-1 rounded-md px-1 py-1.5 ${
      selected ? 'bg-blue-600/20' : 'hover:bg-gray-800'
    }`}
  >
    <button
      type="button"
      onClick={onToggleStar}
      className={`shrink-0 rounded p-1 text-base leading-none transition-colors ${
        starred
          ? 'text-amber-400 hover:text-amber-300'
          : 'text-gray-600 hover:text-amber-400/80'
      }`}
      aria-label={starred ? unstarLabel : starLabel}
      title={starred ? unstarLabel : starLabel}
    >
      {starred ? '★' : '☆'}
    </button>
    <button
      type="button"
      onClick={onSelect}
      className="min-w-0 flex-1 truncate text-left text-sm text-gray-200"
    >
      {name}
    </button>
    <button
      type="button"
      onClick={onRemove}
      className="shrink-0 px-1 text-xs text-gray-500 hover:text-red-300"
      aria-label={removeLabel}
    >
      ×
    </button>
  </div>
);

export const isWatchlistItemSelected = (
  selectedCik: string,
  itemCik: string
): boolean => resolveInstitutionCik(selectedCik) === resolveInstitutionCik(itemCik);
