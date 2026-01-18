
import React from 'react';
import { BrainCircuitIcon, HistoryIcon } from './icons.tsx';

interface HeaderProps {
  onReset: () => void;
  onToggleHistory: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onReset, onToggleHistory }) => {
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
        <button
          onClick={onReset}
          className="px-4 py-2 text-sm font-medium text-gray-300 bg-gray-700 rounded-md hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-blue-500 transition-colors"
        >
          New Analysis
        </button>
      </div>
    </header>
  );
};
