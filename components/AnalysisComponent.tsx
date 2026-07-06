
import React, { useMemo, useState } from 'react';
import { AnalysisState, Language } from '../types.ts';
import { LoadingComponent } from './LoadingComponent.tsx';
import { CompanyReport } from './CompanyReport.tsx';
import { FollowUpSummaryBanner } from './FollowUpSummaryBanner.tsx';
import { CompanyTimelineStrip } from './CompanyTimelineStrip.tsx';
import { getUIText } from '../constants.ts';
import { findIncompleteCompanies, isCandidateAwaitingUser } from '../utils/analysisComplete.ts';
import { getFollowUpEligibleCompanies } from '../utils/followUpHelpers.ts';
import {
  canShowComparisonToggle,
  ComparisonBaselineMode,
  getComparisonBaseline,
  getTickerTimelineForReport,
} from '../utils/analysisTimeline.ts';

interface AnalysisComponentProps {
  analysisState: AnalysisState;
  language: Language;
  history: AnalysisState[];
  onRetry?: () => void;
  onFollowUpCompany?: (companyId: string) => void;
  onStartCandidateAnalysis?: (companyId: string) => void;
  onViewParentReport?: () => void;
  onViewInitialReport?: () => void;
  onLoadReport?: (reportId: string) => void;
  parentReportAvailable?: boolean;
  initialReportAvailable?: boolean;
  isLoadingReportDetails?: boolean;
}

export const AnalysisComponent: React.FC<AnalysisComponentProps> = ({
  analysisState,
  language,
  history,
  onRetry,
  onFollowUpCompany,
  onStartCandidateAnalysis,
  onViewParentReport,
  onViewInitialReport,
  onLoadReport,
  parentReportAvailable = false,
  initialReportAvailable = false,
  isLoadingReportDetails = false,
}) => {
  const [activeTab, setActiveTab] = useState<string | null>(analysisState.focusCompany?.id ?? null);
  const [comparisonMode, setComparisonMode] = useState<ComparisonBaselineMode>('previous');
  const uiText = getUIText(language);

  React.useEffect(() => {
    if (analysisState.focusCompany) {
      setActiveTab(prev => prev ?? analysisState.focusCompany!.id);
    }
  }, [analysisState.focusCompany?.id]);

  React.useEffect(() => {
    setComparisonMode('previous');
  }, [analysisState.id]);

  const activeCompany =
    [analysisState.focusCompany, ...analysisState.candidateCompanies].find(
      company => company?.id === activeTab
    ) || analysisState.focusCompany;

  const activeTicker = activeCompany?.profile.ticker || '';

  const timelineEntries = useMemo(() => {
    if (!activeTicker) return [];
    return getTickerTimelineForReport(history, analysisState.id, activeTicker, language);
  }, [history, analysisState.id, activeTicker, language]);

  const showComparisonToggle = useMemo(() => {
    if (!activeTicker || analysisState.analysisType !== 'follow_up') return false;
    return canShowComparisonToggle(analysisState, activeTicker, history);
  }, [analysisState, activeTicker, history]);

  const baselinesByCompanyId = useMemo(() => {
    const map: Record<string, ReturnType<typeof getComparisonBaseline>> = {};
    for (const company of [analysisState.focusCompany, ...analysisState.candidateCompanies]) {
      if (!company) continue;
      map[company.id] = getComparisonBaseline(
        analysisState,
        company.profile.ticker,
        comparisonMode,
        history
      );
    }
    return map;
  }, [analysisState, comparisonMode, history]);

  if (analysisState.status === 'error' && !analysisState.focusCompany) {
    return (
      <div className="text-center p-8 bg-red-900/20 border border-red-500 rounded-lg">
        <h3 className="text-2xl font-bold text-red-400">{uiText.errorTitle}</h3>
        <p className="mt-2 text-red-300">{analysisState.error}</p>
        {onRetry && (
          <button
            onClick={onRetry}
            className="mt-4 px-4 py-2 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium"
          >
            {language === 'cn' ? '从中断点继续' : 'Resume From Interruption'}
          </button>
        )}
      </div>
    );
  }

  if (analysisState.status === 'finding_companies' || !analysisState.focusCompany) {
    return <LoadingComponent stage={analysisState.currentStage} progress={analysisState.currentProgress} />;
  }

  const allCompanies = [analysisState.focusCompany, ...analysisState.candidateCompanies];
  const incompleteCompanies = findIncompleteCompanies(allCompanies);
  const showGlobalProgress =
    analysisState.status === 'analyzing' && incompleteCompanies.length > 0;
  const reportTimestamp = analysisState.timestamp
    ? new Date(analysisState.timestamp).toLocaleString()
    : null;
  const isCompleteReport = analysisState.status === 'complete' || analysisState.status === 'partial';
  const followUpSourceState = isCompleteReport ? analysisState : null;
  const isSessionAnalyzing = analysisState.status === 'analyzing';

  return (
    <div className="fade-in">
      {analysisState.status === 'partial' && (
        <div className="mb-4 p-4 bg-green-900/20 border border-green-600/40 rounded-lg">
          <p className="text-sm text-green-200">
            {language === 'cn'
              ? '核心公司已分析完成并已保存。候选公司仅在您点击「开始分析」后才会消耗 Token。'
              : 'Focus company is complete and saved. Candidates run only when you click Start Analysis.'}
          </p>
        </div>
      )}
      {analysisState.status === 'complete' && incompleteCompanies.length > 0 && (
        <div className="mb-4 p-4 bg-yellow-900/20 border border-yellow-600/50 rounded-lg">
          <h3 className="text-lg font-bold text-yellow-300">
            {language === 'cn' ? '部分公司报告不完整' : 'Some company reports are incomplete'}
          </h3>
          <p className="mt-1 text-yellow-200/90 text-sm">
            {language === 'cn'
              ? `以下公司缺少投资论点或最终结论：${incompleteCompanies.map(c => c.profile.name).join('、')}。可点击继续补全。`
              : `Missing thesis or final conclusion for: ${incompleteCompanies.map(c => c.profile.name).join(', ')}. Click below to resume.`}
          </p>
          {onRetry && (
            <button
              onClick={onRetry}
              className="mt-3 px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium"
            >
              {language === 'cn' ? '补全未完成部分' : 'Complete Missing Sections'}
            </button>
          )}
        </div>
      )}
      {analysisState.status === 'error' && analysisState.error && (
        <div className="mb-4 p-4 bg-red-900/20 border border-red-500 rounded-lg">
          <h3 className="text-lg font-bold text-red-400">{uiText.errorTitle}</h3>
          <p className="mt-1 text-red-300 text-sm">{analysisState.error}</p>
          <p className="mt-1 text-xs text-gray-400">
            {language === 'cn'
              ? '已保留当前已生成内容，可继续查看并从此状态重试。'
              : 'Generated content is preserved. You can review it and retry from here.'}
          </p>
          {onRetry && (
            <button
              onClick={onRetry}
              className="mt-3 px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium"
            >
              {language === 'cn' ? '从中断点继续' : 'Resume From Interruption'}
            </button>
          )}
        </div>
      )}
      {showGlobalProgress && (
        <LoadingComponent stage={analysisState.currentStage} progress={analysisState.currentProgress} />
      )}

      {onLoadReport && timelineEntries.length > 1 && (
        <CompanyTimelineStrip
          entries={timelineEntries}
          currentReportId={analysisState.id}
          language={language}
          onSelectReport={onLoadReport}
        />
      )}

      {analysisState.analysisType === 'follow_up' && (
        <FollowUpSummaryBanner
          analysisState={analysisState}
          language={language}
          comparisonMode={comparisonMode}
          onComparisonModeChange={setComparisonMode}
          showInitialOption={showComparisonToggle}
          baselinesByCompanyId={baselinesByCompanyId}
          onViewParent={
            comparisonMode === 'previous' && parentReportAvailable ? onViewParentReport : undefined
          }
          onViewInitial={
            comparisonMode === 'initial' && initialReportAvailable ? onViewInitialReport : undefined
          }
        />
      )}

      {reportTimestamp && (
        <div className="mt-3 text-right text-xs text-gray-400">
          {uiText.reportGeneratedAt}: {reportTimestamp}
        </div>
      )}

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
          {allCompanies.map(company => (
            <div key={company.id} className={activeTab === company.id ? 'block' : 'hidden'}>
              <CompanyReport
                companyAnalysis={company}
                language={language}
                reportId={analysisState.id}
                analysisTimestamp={analysisState.timestamp}
                canFollowUp={
                  Boolean(followUpSourceState) &&
                  getFollowUpEligibleCompanies(followUpSourceState!).some(item => item.id === company.id)
                }
                onFollowUp={
                  onFollowUpCompany ? () => onFollowUpCompany(company.id) : undefined
                }
                onStartAnalysis={
                  onStartCandidateAnalysis && isCandidateAwaitingUser(company)
                    ? () => onStartCandidateAnalysis(company.id)
                    : undefined
                }
                isCandidateRunning={
                  isSessionAnalyzing &&
                  company.status !== 'complete' &&
                  company.status !== 'awaiting_user' &&
                  company.status !== 'error' &&
                  company.id !== analysisState.focusCompany?.id
                }
                comparisonBaseline={
                  analysisState.analysisType === 'follow_up'
                    ? baselinesByCompanyId[company.id] ?? null
                    : null
                }
                comparisonMode={comparisonMode}
                isLoadingDetails={isLoadingReportDetails}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
