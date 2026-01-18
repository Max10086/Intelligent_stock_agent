
import React from 'react';
import { AnalysisState, Language } from '../types.ts';
import { getUIText } from '../constants.ts';
import { TrashIcon } from './icons.tsx';

interface HistorySidebarProps {
  isOpen: boolean;
  onClose: () => void;
  history: AnalysisState[];
  isLoading?: boolean;
  onLoad: (id: string) => void;
  onDelete: (id: string) => void;
  onClearAll: () => void;
  currentLanguage: Language;
}

export const HistorySidebar: React.FC<HistorySidebarProps> = ({
  isOpen,
  onClose,
  history,
  isLoading = false,
  onLoad,
  onDelete,
  onClearAll,
  currentLanguage,
}) => {
  const uiText = getUIText(currentLanguage);

  const handleClearAll = () => {
    if (window.confirm('Are you sure you want to delete all history? This cannot be undone.')) {
      onClearAll();
    }
  };

  return (
    <>
      <div
        className={`fixed inset-0 bg-black/60 z-30 transition-opacity ${
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      ></div>
      <aside
        className={`fixed top-0 left-0 h-full w-80 bg-gray-800 shadow-2xl z-40 transform transition-transform ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex flex-col h-full">
          <div className="p-4 border-b border-gray-700 flex justify-between items-center">
            <h2 className="text-lg font-semibold text-white">{uiText.history}</h2>
            <button
              onClick={onClose}
              className="p-1 rounded-full text-gray-400 hover:bg-gray-700 hover:text-white"
            >
              &times;
            </button>
          </div>

          {isLoading ? (
            <div className="flex-grow flex items-center justify-center">
              <div className="text-center">
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-400 mb-2"></div>
                <p className="text-gray-400 text-sm">
                  {currentLanguage === 'cn' ? '加载历史中...' : 'Loading history...'}
                </p>
              </div>
            </div>
          ) : history.length > 0 ? (
            <>
              <div className="flex-grow overflow-y-auto">
                {history.map((item) => (
                  <div
                    key={item.id}
                    className="p-3 border-b border-gray-700/50 hover:bg-gray-700/50 group"
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="font-semibold text-blue-400 text-sm truncate max-w-[180px]">{item.query}</p>
                        <p className="text-xs text-gray-400">
                          {new Date(item.timestamp).toLocaleString()}
                        </p>
                      </div>
                      <button
                        onClick={() => onDelete(item.id)}
                        className="p-1 rounded-full text-gray-500 hover:bg-red-500/20 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                        aria-label={uiText.deleteReport}
                      >
                        <TrashIcon className="w-4 h-4" />
                      </button>
                    </div>
                    <button
                      onClick={() => onLoad(item.id)}
                      className="mt-2 w-full text-center text-xs font-bold py-1.5 bg-blue-600/80 text-white rounded-md hover:bg-blue-600"
                    >
                      {uiText.loadReport}
                    </button>
                  </div>
                ))}
              </div>
              <div className="p-4 border-t border-gray-700">
                <button
                  onClick={handleClearAll}
                  className="w-full py-2 text-sm font-medium text-red-400 bg-red-900/50 rounded-md hover:bg-red-900"
                >
                  {uiText.clearHistory}
                </button>
              </div>
            </>
          ) : (
            <div className="flex-grow flex items-center justify-center text-center p-4">
              <p className="text-gray-500">{uiText.emptyHistory}</p>
            </div>
          )}
        </div>
      </aside>
    </>
  );
};
