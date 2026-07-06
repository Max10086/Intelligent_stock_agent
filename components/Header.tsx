
import React from 'react';
import { HistoryIcon } from './icons.tsx';
import { Language } from '../types.ts';
import { getUIText } from '../constants.ts';

interface HeaderProps {
  onReset: () => void;
  onToggleHistory: () => void;
  onOpenCompare?: () => void;
  language: Language;
  onLanguageChange: (lang: Language) => void;
  /** Hidden on the idle search home where the input form is the entry point. */
  showNewAnalysisButton?: boolean;
  currentView?: 'single' | 'batch' | 'compare';
  onViewChange?: (view: 'single' | 'batch') => void;
  showStepTimeline?: boolean;
  onToggleStepTimeline?: () => void;
  userEmail?: string | null;
  onSignOut?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  onReset,
  onToggleHistory,
  onOpenCompare,
  language,
  onLanguageChange,
  showNewAnalysisButton = true,
  currentView = 'single',
  onViewChange,
  showStepTimeline = false,
  onToggleStepTimeline,
  userEmail,
  onSignOut,
}) => {
  const uiText = getUIText(language);

  const toggleLanguage = () => {
    onLanguageChange(language === 'en' ? 'cn' : 'en');
  };

  return (
    <header className="bg-gray-900/80 backdrop-blur-sm sticky top-0 z-20 border-b border-gray-700">
      <div className="container mx-auto px-4 py-3 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <button
            onClick={onToggleHistory}
            className="p-2 rounded-full hover:bg-gray-700 transition-colors"
            aria-label={uiText.history}
            title={uiText.history}
          >
            <HistoryIcon className="w-6 h-6 text-gray-300" />
          </button>
          <h1 className="text-xl font-bold text-gray-100 tracking-tight hidden sm:block">
            {uiText.title}
          </h1>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          {onViewChange && (
            <div className="flex bg-gray-700 rounded-md p-1">
              <button
                onClick={() => onViewChange('single')}
                className={`px-2 sm:px-3 py-1 text-xs sm:text-sm font-medium rounded transition-colors ${
                  currentView === 'single'
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-300 hover:text-white'
                }`}
              >
                {uiText.viewSingle}
              </button>
              <button
                onClick={() => onViewChange('batch')}
                className={`px-2 sm:px-3 py-1 text-xs sm:text-sm font-medium rounded transition-colors ${
                  currentView === 'batch'
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-300 hover:text-white'
                }`}
              >
                {uiText.viewBatch}
              </button>
            </div>
          )}
          {onToggleStepTimeline && (
            <button
              type="button"
              onClick={onToggleStepTimeline}
              className={`px-3 py-2 text-sm font-medium rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-blue-500 transition-colors ${
                showStepTimeline
                  ? 'bg-blue-600 text-white hover:bg-blue-500'
                  : 'text-gray-200 bg-gray-700 hover:bg-gray-600'
              }`}
              aria-pressed={showStepTimeline}
            >
              {uiText.stepTimelineToggle}
            </button>
          )}
          {onOpenCompare && (
            <button
              type="button"
              onClick={onOpenCompare}
              className="px-3 py-2 text-sm font-medium text-gray-200 bg-gray-700 rounded-md hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-blue-500 transition-colors"
            >
              {uiText.viewCompare}
            </button>
          )}
          {userEmail && (
            <span className="hidden md:inline text-xs text-gray-400 max-w-[160px] truncate" title={userEmail}>
              {userEmail}
            </span>
          )}
          {onSignOut && (
            <button
              type="button"
              onClick={onSignOut}
              className="px-3 py-2 text-sm font-medium text-gray-300 bg-gray-700 rounded-md hover:bg-gray-600"
            >
              {uiText.signOut}
            </button>
          )}
          <button
            type="button"
            onClick={toggleLanguage}
            className="px-3 py-2 text-sm font-medium text-gray-200 bg-gray-700 rounded-md hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-blue-500 transition-colors"
            aria-label={uiText.languageToggle}
          >
            {uiText.languageToggle}
          </button>
          {showNewAnalysisButton && (
            <button
              onClick={onReset}
              className="px-3 sm:px-4 py-2 text-sm font-medium text-gray-300 bg-gray-700 rounded-md hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-blue-500 transition-colors"
            >
              {uiText.reset}
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
