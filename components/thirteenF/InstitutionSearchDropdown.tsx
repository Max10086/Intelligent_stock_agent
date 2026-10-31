import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { ThirteenFInstitution } from '../../types/thirteenF.ts';
import {
  buildHighlightPattern,
  resolveInstitutionCik,
  splitByHighlightPattern,
} from '../../utils/thirteenFInstitutionSearch.ts';

interface InstitutionSearchDropdownProps {
  query: string;
  results: ThirteenFInstitution[];
  loading: boolean;
  watchlistCiks: Set<string>;
  labels: {
    loading: string;
    empty: string;
    inWatchlist: string;
    add: string;
    formerly?: string;
  };
  onSelect: (institution: ThirteenFInstitution) => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}

const HighlightedName: React.FC<{ name: string; query: string }> = ({ name, query }) => {
  const pattern = useMemo(() => buildHighlightPattern(query), [query]);
  const parts = useMemo(() => splitByHighlightPattern(name, pattern), [name, pattern]);

  return (
    <>
      {parts.map((part, index) =>
        part.highlight ? (
          <mark
            key={`${part.text}-${index}`}
            className="rounded bg-blue-500/30 text-blue-100 px-0.5"
          >
            {part.text}
          </mark>
        ) : (
          <span key={`${part.text}-${index}`}>{part.text}</span>
        )
      )}
    </>
  );
};

export const InstitutionSearchDropdown: React.FC<InstitutionSearchDropdownProps> = ({
  query,
  results,
  loading,
  watchlistCiks,
  labels,
  onSelect,
  inputRef,
}) => {
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, results]);

  useEffect(() => {
    const input = inputRef?.current;
    if (!input) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (results.length === 0) return;

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex(prev => Math.min(prev + 1, results.length - 1));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex(prev => Math.max(prev - 1, 0));
      } else if (event.key === 'Enter') {
        event.preventDefault();
        const selected = results[activeIndex];
        if (selected) onSelect(selected);
      }
    };

    input.addEventListener('keydown', handleKeyDown);
    return () => input.removeEventListener('keydown', handleKeyDown);
  }, [activeIndex, inputRef, onSelect, results]);

  useEffect(() => {
    const container = listRef.current;
    if (!container) return;
    const active = container.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    active?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  if (query.trim().length < 2) return null;

  return (
    <div
      ref={listRef}
      id="institution-search-results"
      className="mt-3 rounded-md border border-gray-700 bg-gray-950/50 max-h-56 overflow-y-auto"
      role="listbox"
      aria-label="Institution search results"
    >
      {loading ? (
        <p className="px-3 py-3 text-sm text-gray-400">{labels.loading}</p>
      ) : results.length === 0 ? (
        <p className="px-3 py-3 text-sm text-gray-500">{labels.empty}</p>
      ) : (
        results.map((inst, index) => {
          const inWatchlist = watchlistCiks.has(resolveInstitutionCik(inst.cik));
          const active = index === activeIndex;
          return (
            <button
              key={inst.cik}
              type="button"
              data-index={index}
              role="option"
              aria-selected={active}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => onSelect(inst)}
              className={`w-full border-b border-gray-800 px-3 py-2.5 text-left last:border-b-0 ${
                active ? 'bg-blue-950/40' : 'hover:bg-gray-800'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-100 leading-snug">
                    <HighlightedName name={inst.name} query={query} />
                  </p>
                  {inst.formerNames?.[0] && labels.formerly ? (
                    <p className="mt-0.5 text-xs text-gray-500">
                      {labels.formerly.replace('{name}', inst.formerNames[0])}
                    </p>
                  ) : null}
                  <p className="mt-0.5 text-xs text-gray-500 font-mono">CIK {inst.cik}</p>
                </div>
                <span className="shrink-0 text-xs text-blue-300 pt-0.5">
                  {inWatchlist ? labels.inWatchlist : labels.add}
                </span>
              </div>
            </button>
          );
        })
      )}
    </div>
  );
};
