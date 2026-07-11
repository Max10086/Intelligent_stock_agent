import React, { useEffect, useRef, useState } from 'react';
import type { AnalysisPreset, Language, RuntimeModelConfig } from '../types.ts';
import {
  configForPreset,
  presetFromConfig,
  pushRuntimeModelConfigToBackend,
  saveStoredRuntimeModelConfig,
} from '../utils/runtimeModelConfigStorage.ts';
import { ChevronDownIcon } from './icons.tsx';

const API_BASE_URL = typeof window !== 'undefined' ? '' : 'http://localhost:3001';

const PRESETS: AnalysisPreset[] = ['quick', 'standard', 'advanced'];

export const presetModeLabel = (preset: AnalysisPreset, language: Language): string => {
  if (language === 'cn') {
    if (preset === 'quick') return '快速模式';
    if (preset === 'advanced') return '高级模式';
    return '标准模式';
  }
  if (preset === 'quick') return 'Quick mode';
  if (preset === 'advanced') return 'Advanced mode';
  return 'Standard mode';
};

const presetHint = (preset: AnalysisPreset, language: Language): string => {
  if (language === 'cn') {
    if (preset === 'quick') return '分析更快速，适合初筛';
    if (preset === 'advanced') return '多信息源混合搜索';
    return '深度与速度均衡';
  }
  if (preset === 'quick') return 'Faster analysis for screening';
  if (preset === 'advanced') return 'Multi-source blended search';
  return 'Balanced depth and speed';
};

interface AnalysisModeSplitButtonProps {
  language: Language;
  runtimeModelConfig: RuntimeModelConfig;
  onConfigApplied: (config: RuntimeModelConfig) => void;
  isAdmin?: boolean;
  submitLabel: string;
  submittingLabel: string;
  isSubmitting: boolean;
  canSubmit: boolean;
}

export const AnalysisModeSplitButton: React.FC<AnalysisModeSplitButtonProps> = ({
  language,
  runtimeModelConfig,
  onConfigApplied,
  isAdmin = false,
  submitLabel,
  submittingLabel,
  isSubmitting,
  canSubmit,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const activePreset = presetFromConfig(runtimeModelConfig);

  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [isOpen]);

  const buildPayload = (preset: AnalysisPreset): RuntimeModelConfig => {
    const base = configForPreset(preset);
    if (!isAdmin) return base;
    return {
      ...base,
      questions: runtimeModelConfig.questions,
      qna: runtimeModelConfig.qna,
    };
  };

  const handleSelect = async (preset: AnalysisPreset) => {
    if (preset === activePreset || saving) {
      setIsOpen(false);
      return;
    }

    setSaving(true);
    try {
      const saved = await pushRuntimeModelConfigToBackend(buildPayload(preset), API_BASE_URL);
      saveStoredRuntimeModelConfig(saved);
      onConfigApplied(saved);
      setIsOpen(false);
    } catch (error) {
      console.error('[analysis-mode] apply failed:', error);
    } finally {
      setSaving(false);
    }
  };

  const disabled = !canSubmit || isSubmitting || saving;

  return (
    <div ref={rootRef} className="relative flex shrink-0 w-full sm:w-auto">
      <div className="flex w-full sm:w-auto rounded-xl sm:rounded-lg overflow-hidden shadow-sm">
        <button
          type="submit"
          disabled={disabled}
          className="flex-1 sm:flex-none px-6 sm:px-8 py-4 sm:py-0 sm:min-h-[3.25rem] text-lg font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-blue-500 transition-colors"
        >
          {isSubmitting ? submittingLabel : submitLabel}
        </button>
        <button
          type="button"
          onClick={() => setIsOpen(v => !v)}
          disabled={isSubmitting || saving}
          className="inline-flex items-center gap-1 border-l border-blue-500/40 bg-blue-600 px-3 sm:px-3.5 py-4 sm:py-0 sm:min-h-[3.25rem] text-sm font-medium text-blue-50 hover:bg-blue-500 disabled:bg-gray-600 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-blue-500 transition-colors"
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          aria-label={language === 'cn' ? '选择分析模式' : 'Select analysis mode'}
        >
          <span className="hidden sm:inline max-w-[6.5rem] truncate">
            {presetModeLabel(activePreset, language)}
          </span>
          <span className="sm:hidden">{language === 'cn' ? '模式' : 'Mode'}</span>
          <ChevronDownIcon
            className={`h-4 w-4 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          />
        </button>
      </div>

      {isOpen && (
        <ul
          role="listbox"
          aria-label={language === 'cn' ? '选择分析模式' : 'Select analysis mode'}
          className="absolute right-0 top-full z-40 mt-2 w-56 rounded-xl border border-gray-600 bg-gray-900 py-1.5 shadow-2xl"
        >
          {PRESETS.map(preset => {
            const selected = preset === activePreset;
            return (
              <li key={preset} role="option" aria-selected={selected}>
                <button
                  type="button"
                  onClick={() => void handleSelect(preset)}
                  disabled={saving}
                  className={`w-full px-3 py-2.5 text-left transition-colors ${
                    selected
                      ? 'bg-blue-600/20 text-blue-100'
                      : 'text-gray-200 hover:bg-gray-800'
                  }`}
                >
                  <span className="block text-sm font-medium">
                    {presetModeLabel(preset, language)}
                    {preset === 'quick' && (
                      <span className="ml-1.5 text-[10px] font-normal text-gray-400">
                        {language === 'cn' ? '默认' : 'default'}
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-xs text-gray-400">{presetHint(preset, language)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
