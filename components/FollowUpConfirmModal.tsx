
import React, { useEffect, useState } from 'react';
import { AnalysisState, CompanyAnalysis, CompanyProfile, Language } from '../types.ts';
import { getUIText } from '../constants.ts';
import { getFinancialData } from '../services/finance.ts';
import {
  computeDaysSince,
  formatFollowUpDate,
  formatPriceChangePct,
  getFollowUpEligibleCompanies,
} from '../utils/followUpHelpers.ts';

interface FollowUpConfirmModalProps {
  isOpen: boolean;
  parentState: AnalysisState | null;
  targetCompanies: CompanyAnalysis[];
  language: Language;
  onClose: () => void;
  onConfirm: () => void;
}

export const FollowUpConfirmModal: React.FC<FollowUpConfirmModalProps> = ({
  isOpen,
  parentState,
  targetCompanies,
  language,
  onClose,
  onConfirm,
}) => {
  const uiText = getUIText(language);
  const [currentProfiles, setCurrentProfiles] = useState<Record<string, CompanyProfile>>({});
  const [isLoadingPrices, setIsLoadingPrices] = useState(false);

  useEffect(() => {
    if (!isOpen || targetCompanies.length === 0) return;

    let cancelled = false;
    setIsLoadingPrices(true);

    void (async () => {
      try {
        const entries = await Promise.all(
          targetCompanies.map(async company => {
            const profile = await getFinancialData(company.profile);
            return [company.id, profile] as const;
          })
        );
        if (!cancelled) {
          setCurrentProfiles(Object.fromEntries(entries));
        }
      } catch (error) {
        console.warn('Failed to refresh prices for follow-up modal', error);
      } finally {
        if (!cancelled) setIsLoadingPrices(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isOpen, targetCompanies]);

  if (!isOpen || !parentState) return null;

  const daysSince = computeDaysSince(parentState.timestamp);
  const parentDateLabel = formatFollowUpDate(parentState.timestamp, language);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-gray-800 border border-gray-700 rounded-xl shadow-2xl p-6">
        <h2 className="text-xl font-bold text-white">{uiText.followUpConfirmTitle}</h2>
        <p className="mt-2 text-sm text-gray-300">{uiText.followUpConfirmDesc}</p>

        <div className="mt-4 rounded-lg bg-gray-900/60 p-4 text-sm space-y-2">
          <p className="text-gray-400">
            {uiText.followUpPriorReport}:{' '}
            <span className="text-gray-200">{parentDateLabel}</span>
            <span className="text-gray-500 ml-2">
              ({daysSince} {language === 'cn' ? '天前' : 'days ago'})
            </span>
          </p>
          <p className="text-gray-400">
            {uiText.followUpTargetCompanies}:{' '}
            <span className="text-gray-200">
              {targetCompanies.map(company => company.profile.name).join(', ')}
            </span>
          </p>
        </div>

        <div className="mt-4 max-h-56 overflow-y-auto space-y-3">
          {targetCompanies.map(company => {
            const baselinePrice = company.profile.currentPrice;
            const refreshed = currentProfiles[company.id];
            const currentPrice = refreshed?.currentPrice || baselinePrice;
            const priceChange = formatPriceChangePct(baselinePrice, currentPrice);
            const priorConclusion = company.finalConclusion?.overall_conclusion || '';

            return (
              <div key={company.id} className="rounded-md border border-gray-700 p-3 text-sm">
                <p className="font-semibold text-white">{company.profile.name}</p>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <p className="text-gray-500">{uiText.followUpPriorPrice}</p>
                    <p className="text-gray-200">{baselinePrice}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">{uiText.followUpCurrentPrice}</p>
                    <p className="text-gray-200">
                      {isLoadingPrices ? '...' : currentPrice}
                      {priceChange && (
                        <span
                          className={`ml-2 ${
                            priceChange.startsWith('+')
                              ? 'text-green-400'
                              : priceChange.startsWith('-')
                                ? 'text-red-400'
                                : 'text-gray-400'
                          }`}
                        >
                          ({priceChange})
                        </span>
                      )}
                    </p>
                  </div>
                </div>
                {priorConclusion && (
                  <p className="mt-2 text-xs text-gray-400 line-clamp-2">
                    {uiText.followUpPriorConclusion}: {priorConclusion}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-6 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2 rounded-md bg-gray-700 hover:bg-gray-600 text-white text-sm font-medium"
          >
            {uiText.followUpCancel}
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 py-2 rounded-md bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold"
          >
            {uiText.followUpStart}
          </button>
        </div>
      </div>
    </div>
  );
};
