
import React from 'react';
import { BrainCircuitIcon, HistoryIcon } from './icons.tsx';

interface HeaderProps {
  onReset: () => void;
  onToggleHistory: () => void;
  currentView?: 'single' | 'batch';
  onViewChange?: (view: 'single' | 'batch') => void;
}

export const Header: React.FC<HeaderProps> = ({ 
  onReset, 
  onToggleHistory,
  currentView = 'single',
  onViewChange,
}) => {
  return (
    <header className="bg-gray-900/80 backdrop-blur-sm sticky top-0 z-20 border-b border-gray-700">
      <div className="container mx-auto px-4 py-3 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <button onClick={onToggleHistory} className="p-2 rounded-full hover:bg-gray-700 transition-colors" aria-label="View history">
            <HistoryIcon className="w-6 h-6 text-gray-300" />
          </button>
          <h1 className="text-xl font-bold text-gray-100 tracking-tight hidden sm:block">
            Intelligent Stock Agent
          </h1>
        </div>
        <div className="flex items-center gap-3">
          {onViewChange && (
            <div className="flex bg-gray-700 rounded-md p-1">
              <button
                onClick={() => onViewChange('single')}
                className={`px-3 py-1 text-sm font-medium rounded transition-colors ${
                  currentView === 'single'
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-300 hover:text-white'
                }`}
              >
                Single
              </button>
              <button
                onClick={() => onViewChange('batch')}
                className={`px-3 py-1 text-sm font-medium rounded transition-colors ${
                  currentView === 'batch'
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-300 hover:text-white'
                }`}
              >
                Batch Queue
              </button>
            </div>
          )}
          <button
            onClick={onReset}
            className="px-4 py-2 text-sm font-medium text-gray-300 bg-gray-700 rounded-md hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-blue-500 transition-colors"
          >
            New Analysis
          </button>
        </div>
      </div>
    </header>
  );
};
