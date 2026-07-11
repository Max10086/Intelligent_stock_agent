import React, { useState } from 'react';
import { Language, RuntimeModelConfig } from '../types.ts';
import { getUIText } from '../constants.ts';
import { BrandMark } from './BrandMark.tsx';
import { SearchIcon } from './icons.tsx';
import { AnalysisModeSplitButton } from './AnalysisModeSplitButton.tsx';

interface SearchComponentProps {
  onSearch: (query: string) => void | Promise<void>;
  language: Language;
  runtimeModelConfig: RuntimeModelConfig;
  onConfigApplied: (config: RuntimeModelConfig) => void;
  isAdmin?: boolean;
}

export const SearchComponent: React.FC<SearchComponentProps> = ({
  onSearch,
  language,
  runtimeModelConfig,
  onConfigApplied,
  isAdmin = false,
}) => {
  const [query, setQuery] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const uiText = getUIText(language);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed || isSubmitting) return;
    setIsSubmitting(true);
    void Promise.resolve(onSearch(trimmed)).finally(() => setIsSubmitting(false));
  };

  return (
    <section className="w-full max-w-6xl mx-auto px-2 sm:px-4 fade-in">
      <BrandMark language={language} variant="hero" />

      <form onSubmit={handleSubmit} className="mt-10 sm:mt-12">
        <div className="flex flex-col sm:flex-row sm:items-stretch gap-3 sm:gap-2 sm:rounded-2xl sm:border sm:border-gray-600/80 sm:bg-gray-800/60 sm:p-2 sm:shadow-[0_8px_32px_rgba(0,0,0,0.35)]">
          <div className="relative flex-1 min-w-0">
            <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
              <SearchIcon className="h-5 w-5 text-gray-400" />
            </div>
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              className="w-full pl-11 pr-4 py-4 text-lg bg-gray-800 border border-gray-600 rounded-xl sm:rounded-lg sm:border-0 sm:bg-gray-900/50 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 sm:focus:ring-1"
              placeholder={uiText.searchPlaceholder}
              aria-label={uiText.searchPlaceholder}
            />
          </div>

          <AnalysisModeSplitButton
            language={language}
            runtimeModelConfig={runtimeModelConfig}
            onConfigApplied={onConfigApplied}
            isAdmin={isAdmin}
            submitLabel={uiText.searchButton}
            submittingLabel={uiText.startingSearch}
            isSubmitting={isSubmitting}
            canSubmit={Boolean(query.trim())}
          />
        </div>
      </form>
    </section>
  );
};
