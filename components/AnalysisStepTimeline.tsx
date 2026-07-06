import React from 'react';
import type { AnalysisStepLog, Language } from '../types.ts';
import {
  formatStepDuration,
  groupStepLogsByCompany,
  sumStepDuration,
} from '../utils/analysisStepLog.ts';

interface AnalysisStepTimelineProps {
  stepLogs: AnalysisStepLog[];
  language: Language;
}

export const AnalysisStepTimeline: React.FC<AnalysisStepTimelineProps> = ({
  stepLogs,
  language,
}) => {
  if (!stepLogs.length) {
    return (
      <p className="text-sm text-gray-500">
        {language === 'cn' ? '暂无步骤耗时记录。' : 'No step timing recorded yet.'}
      </p>
    );
  }

  const groups = groupStepLogsByCompany(stepLogs);
  const grandTotal = sumStepDuration(stepLogs);

  return (
    <div className="space-y-6">
      <p className="text-xs text-gray-400">
        {language === 'cn'
          ? `总耗时 ${formatStepDuration(grandTotal, language)} · ${stepLogs.length} 个步骤`
          : `Total ${formatStepDuration(grandTotal, language)} · ${stepLogs.length} steps`}
      </p>

      {groups.map(group => {
        const groupTotal = sumStepDuration(group.logs);
        return (
          <div key={group.companyId} className="rounded-lg border border-gray-700 bg-gray-900/40 p-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-semibold text-gray-100">{group.companyName}</h4>
              <span className="text-xs text-blue-300">
                {formatStepDuration(groupTotal, language)}
              </span>
            </div>

            <div className="flex flex-col gap-0">
              {group.logs.map((log, index) => (
                <div key={log.id} className="flex gap-3 min-h-[52px]">
                  <div className="flex flex-col items-center w-4 shrink-0">
                    <div className="w-2.5 h-2.5 rounded-full bg-blue-500 mt-1" />
                    {index < group.logs.length - 1 && (
                      <div className="w-px flex-1 bg-gray-600 my-1" />
                    )}
                  </div>
                  <div className="flex-1 pb-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-sm text-gray-200">{log.label}</span>
                      <span className="text-xs font-mono text-amber-300">
                        {formatStepDuration(log.durationMs, language)}
                      </span>
                    </div>
                    <p className="text-[11px] text-gray-500 mt-0.5">
                      {new Date(log.startedAt).toLocaleTimeString()} →{' '}
                      {new Date(log.endedAt).toLocaleTimeString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
};
