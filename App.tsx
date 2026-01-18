
import React, { useState, useCallback } from 'react';
import { SearchComponent } from './components/SearchComponent.tsx';
import { AnalysisComponent } from './components/AnalysisComponent.tsx';
import { useStockAgent } from './hooks/useStockAgent.ts';
import { Language } from './types.ts';
import { Header } from './components/Header.tsx';
import { HistorySidebar } from './components/HistorySidebar.tsx';

const App: React.FC = () => {
  const [language, setLanguage] = useState<Language>('en');
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const { analysisState, history, startAnalysis, resetAnalysis, loadFromHistory, deleteFromHistory, clearHistory } = useStockAgent();

  const handleSearch = useCallback((query: string) => {
    if (query.trim()) {
      startAnalysis(query, language);
    }
  }, [language, startAnalysis]);

  const handleReset = useCallback(() => {
    resetAnalysis();
  }, [resetAnalysis]);

  const handleLoadFromHistory = useCallback((id: string) => {
    loadFromHistory(id);
    setIsHistoryOpen(false);
  }, [loadFromHistory]);

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 font-sans">
      <HistorySidebar
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        history={history}
        onLoad={handleLoadFromHistory}
        onDelete={deleteFromHistory}
        onClearAll={clearHistory}
        currentLanguage={analysisState.language}
      />
      <Header onReset={handleReset} onToggleHistory={() => setIsHistoryOpen(true)} />
      <main className="container mx-auto px-4 py-8">
        {analysisState.status === 'idle' ? (
          <SearchComponent
            onSearch={handleSearch}
            language={language}
            setLanguage={setLanguage}
          />
        ) : (
          <AnalysisComponent analysisState={analysisState} language={analysisState.language} />
        )}
      </main>
      <footer className="text-center py-4 text-gray-500 text-sm">
        <p>Intelligent Stock Agent. For informational purposes only. Not financial advice.</p>
      </footer>
    </div>
  );
};

export default App;
