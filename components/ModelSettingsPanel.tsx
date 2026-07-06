import React, { useEffect, useState } from 'react';
import { Language, RuntimeModelConfig, SearchMode } from '../types.ts';
import {
  configForSearchMode,
  pushRuntimeModelConfigToBackend,
  saveStoredRuntimeModelConfig,
} from '../utils/runtimeModelConfigStorage.ts';

const API_BASE_URL = typeof window !== 'undefined' ? '' : 'http://localhost:3001';

interface ModelSettingsPanelProps {
  language: Language;
  runtimeModelConfig: RuntimeModelConfig;
  onConfigApplied: (config: RuntimeModelConfig) => void;
}

const modeCardClass = (selected: boolean) =>
  `rounded-lg border p-4 text-left transition-colors ${
    selected
      ? 'border-blue-500 bg-blue-950/30 ring-1 ring-blue-500/40'
      : 'border-gray-700 bg-gray-900/40 hover:border-gray-600'
  }`;

export const ModelSettingsPanel: React.FC<ModelSettingsPanelProps> = ({
  language,
  runtimeModelConfig,
  onConfigApplied,
}) => {
  const [searchMode, setSearchMode] = useState<SearchMode>(runtimeModelConfig.searchMode || 'standard');
  const [qnaThinkingEnabled, setQnaThinkingEnabled] = useState(runtimeModelConfig.qna.thinkingEnabled);
  const [focusQuestions, setFocusQuestions] = useState(runtimeModelConfig.questions.focus);
  const [candidateQuestions, setCandidateQuestions] = useState(runtimeModelConfig.questions.candidate);
  const [showExpert, setShowExpert] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageType, setMessageType] = useState<'success' | 'error' | 'info'>('info');
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    setSearchMode(runtimeModelConfig.searchMode || 'standard');
    setQnaThinkingEnabled(runtimeModelConfig.qna.thinkingEnabled);
    setFocusQuestions(runtimeModelConfig.questions.focus);
    setCandidateQuestions(runtimeModelConfig.questions.candidate);
  }, [runtimeModelConfig]);

  const buildPayload = (): RuntimeModelConfig => {
    const base = configForSearchMode(searchMode);
    return {
      ...base,
      questions: {
        focus: Math.max(5, Math.floor(focusQuestions || base.questions.focus)),
        candidate: Math.max(3, Math.floor(candidateQuestions || base.questions.candidate)),
      },
      qna: { thinkingEnabled: qnaThinkingEnabled },
    };
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    setMessageType('info');
    const payload = buildPayload();

    try {
      const saved = await pushRuntimeModelConfigToBackend(payload, API_BASE_URL);
      saveStoredRuntimeModelConfig(saved);
      onConfigApplied(saved);
      setMessage(
        language === 'cn'
          ? searchMode === 'advanced'
            ? '已切换为高级模式：豆包 + Google 双源搜索（冲突时优先 Google）'
            : '已切换为标准模式：豆包搜索 + DeepSeek 分析'
          : searchMode === 'advanced'
            ? 'Advanced mode enabled: Doubao + Google dual search (Google wins conflicts).'
            : 'Standard mode enabled: Doubao search + DeepSeek analysis.'
      );
      setMessageType('success');
    } catch (error: any) {
      setMessage(error?.message || (language === 'cn' ? '保存失败' : 'Failed to save'));
      setMessageType('error');
    } finally {
      setSaving(false);
    }
  };

  const modeSummary =
    searchMode === 'advanced'
      ? language === 'cn'
        ? '高级 · 双源搜索'
        : 'Advanced · dual search'
      : language === 'cn'
        ? '标准 · 推荐'
        : 'Standard · recommended';

  return (
    <div className="max-w-6xl mx-auto mb-4 rounded-lg border border-gray-700 bg-gray-800/70">
      <button
        type="button"
        onClick={() => setIsOpen(v => !v)}
        className="w-full px-4 py-3 text-left text-sm text-gray-200 hover:bg-gray-700/50 flex items-center justify-between gap-3"
      >
        <span>{language === 'cn' ? '分析模式' : 'Analysis Mode'}</span>
        <span className="text-xs text-gray-400 shrink-0">
          {modeSummary} · DeepSeek · {runtimeModelConfig.questions.focus}/{runtimeModelConfig.questions.candidate}{' '}
          {language === 'cn' ? '题' : 'Q'}
        </span>
      </button>

      {isOpen && (
        <div className="border-t border-gray-700 p-4 space-y-4">
          <p className="text-sm text-gray-400">
            {language === 'cn'
              ? '一键选择分析模式。标准模式为系统默认，速度与质量均衡；高级模式在问答搜索时额外启用 Google 搜索，并与豆包结果合并（事实冲突时以 Google 为准）。'
              : 'Pick a one-click analysis mode. Standard is the default balance of speed and quality. Advanced adds Google Search alongside Doubao for Q&A and merges both (Google wins factual conflicts).'}
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <button
              type="button"
              className={modeCardClass(searchMode === 'standard')}
              onClick={() => setSearchMode('standard')}
            >
              <div className="font-medium text-gray-100">
                {language === 'cn' ? '标准模式（默认）' : 'Standard (default)'}
              </div>
              <ul className="mt-2 text-xs text-gray-400 space-y-1 list-disc list-inside">
                <li>{language === 'cn' ? '分析：DeepSeek deepseek-v4-pro' : 'Analysis: DeepSeek deepseek-v4-pro'}</li>
                <li>{language === 'cn' ? '搜索：豆包 Web 搜索' : 'Search: Doubao web search'}</li>
                <li>{language === 'cn' ? '每家公司 18 道研究问题' : '18 research questions per company'}</li>
                <li>{language === 'cn' ? '问答 Thinking：关闭（更快）' : 'Q&A thinking: off (faster)'}</li>
              </ul>
            </button>

            <button
              type="button"
              className={modeCardClass(searchMode === 'advanced')}
              onClick={() => setSearchMode('advanced')}
            >
              <div className="font-medium text-gray-100">
                {language === 'cn' ? '高级模式' : 'Advanced mode'}
              </div>
              <ul className="mt-2 text-xs text-gray-400 space-y-1 list-disc list-inside">
                <li>{language === 'cn' ? '继承标准模式的全部分析配置' : 'Same analysis stack as Standard'}</li>
                <li>
                  {language === 'cn'
                    ? '搜索：豆包 + Google 双源，合并后再合成答案'
                    : 'Search: Doubao + Google merged before synthesis'}
                </li>
                <li>
                  {language === 'cn'
                    ? '两者冲突时优先采用 Google 搜索结果'
                    : 'Google results win on factual conflicts'}
                </li>
                <li>{language === 'cn' ? '耗时更长，适合高要求深度研究' : 'Slower; best for high-stakes research'}</li>
              </ul>
            </button>
          </div>

          <div>
            <button
              type="button"
              onClick={() => setShowExpert(v => !v)}
              className="text-xs text-gray-400 hover:text-gray-200 underline"
            >
              {showExpert
                ? language === 'cn'
                  ? '收起专家选项'
                  : 'Hide expert options'
                : language === 'cn'
                  ? '展开专家选项（问题数 / Thinking）'
                  : 'Show expert options (question counts / thinking)'}
            </button>
          </div>

          {showExpert && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 rounded-lg border border-gray-700/80 bg-gray-900/30 p-3">
              <label className="text-xs text-gray-300 flex flex-col gap-1">
                {language === 'cn' ? '目标公司问题数' : 'Focus questions'}
                <input
                  type="number"
                  min={5}
                  value={focusQuestions}
                  onChange={e => setFocusQuestions(Number.parseInt(e.target.value || '18', 10))}
                  className="bg-gray-900 border border-gray-600 rounded px-2 py-2 text-sm text-white"
                />
              </label>
              <label className="text-xs text-gray-300 flex flex-col gap-1">
                {language === 'cn' ? '候选公司问题数' : 'Candidate questions'}
                <input
                  type="number"
                  min={3}
                  value={candidateQuestions}
                  onChange={e => setCandidateQuestions(Number.parseInt(e.target.value || '18', 10))}
                  className="bg-gray-900 border border-gray-600 rounded px-2 py-2 text-sm text-white"
                />
              </label>
              <label className="text-xs text-gray-300 flex flex-col gap-1">
                {language === 'cn' ? '详细问答 Thinking' : 'Q&A thinking'}
                <select
                  value={qnaThinkingEnabled ? 'on' : 'off'}
                  onChange={e => setQnaThinkingEnabled(e.target.value === 'on')}
                  className="bg-gray-900 border border-gray-600 rounded px-2 py-2 text-sm text-white"
                >
                  <option value="off">{language === 'cn' ? '关闭（推荐）' : 'Off (recommended)'}</option>
                  <option value="on">{language === 'cn' ? '开启（更慢）' : 'On (slower)'}</option>
                </select>
              </label>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <p className="text-xs text-gray-500">
              {language === 'cn'
                ? `当前选择：${searchMode === 'advanced' ? '高级' : '标准'} · 保存后同步至浏览器与后端`
                : `Selected: ${searchMode} · Save syncs browser + backend`}
            </p>
            <div className="flex items-center gap-3">
              {message && (
                <span
                  className={`text-xs max-w-md ${
                    messageType === 'success'
                      ? 'text-green-300'
                      : messageType === 'error'
                        ? 'text-red-300'
                        : 'text-gray-300'
                  }`}
                >
                  {message}
                </span>
              )}
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={saving}
                className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-sm text-white font-medium"
              >
                {saving
                  ? language === 'cn'
                    ? '保存中…'
                    : 'Saving…'
                  : language === 'cn'
                    ? '应用模式'
                    : 'Apply mode'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
