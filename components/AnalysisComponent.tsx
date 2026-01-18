
import React, { useState } from 'react';
import { AnalysisState, Language } from '../types.ts';
import { LoadingComponent } from './LoadingComponent.tsx';
import { CompanyReport } from './CompanyReport.tsx';
import { getUIText } from '../constants.ts';

interface AnalysisComponentProps {
  analysisState: AnalysisState;
  language: Language;
}

export const AnalysisComponent: React.FC<AnalysisComponentProps> = ({ analysisState, language }) => {
  const [activeTab, setActiveTab] = useState<string | null>(analysisState.focusCompany?.id ?? null);
  const uiText = getUIText(language);

  React.useEffect(() => {
    if (analysisState.focusCompany && !activeTab) {
      setActiveTab(analysisState.focusCompany.id);
    }
  }, [analysisState.focusCompany, activeTab]);

  if (analysisState.status === 'error') {
    return (
      <div className="text-center p-8 bg-red-900/20 border border-red-500 rounded-lg">
        <h3 className="text-2xl font-bold text-red-400">{uiText.errorTitle}</h3>
        <p className="mt-2 text-red-300">{analysisState.error}</p>
      </div>
    );
  }

  if (analysisState.status === 'finding_companies' || !analysisState.focusCompany) {
    return <LoadingComponent stage={analysisState.currentStage} progress={analysisState.currentProgress} />;
  }

  const allCompanies = [analysisState.focusCompany, ...analysisState.candidateCompanies];

  return (
    <div className="fade-in">
      <LoadingComponent stage={analysisState.currentStage} progress={analysisState.currentProgress} />
      
      <div className="mt-8">
        <div className="border-b border-gray-700">
          <nav className="-mb-px flex space-x-6" aria-label="Tabs">
            {allCompanies.map((company, index) => (
              <button
                key={company.id}
                onClick={() => setActiveTab(company.id)}
                className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                  activeTab === company.id
                    ? 'border-blue-500 text-blue-400'
                    : 'border-transparent text-gray-400 hover:text-gray-200 hover:border-gray-500'
                }`}
              >
                {index === 0 ? uiText.focusCompany : `${uiText.candidateCompany} ${index}`}
                <span className="block text-xs text-gray-500">{company.profile.name}</span>
              </button>
            ))}
          </nav>
        </div>

        <div className="mt-6">
          {allCompanies.map((company) => (
            <div key={company.id} className={activeTab === company.id ? 'block' : 'hidden'}>
              <CompanyReport companyAnalysis={company} language={language} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
