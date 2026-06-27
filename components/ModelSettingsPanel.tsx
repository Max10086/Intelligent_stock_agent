import React, { useEffect, useState } from 'react';
import { Language, RuntimeModelConfig, SearchProvider } from '../types.ts';
import {
  pushRuntimeModelConfigToBackend,
  saveStoredRuntimeModelConfig,
} from '../utils/runtimeModelConfigStorage.ts';

const API_BASE_URL = typeof window !== 'undefined' ? '' : 'http://localhost:3001';

interface ModelSettingsPanelProps {
  language: Language;
  runtimeModelConfig: RuntimeModelConfig;
  onConfigReload: () => Promise<RuntimeModelConfig | null>;
}

export const ModelSettingsPanel: React.FC<ModelSettingsPanelProps> = ({
  language,
  runtimeModelConfig,
  onConfigReload,
}) => {
  const [analysisProvider, setAnalysisProvider] = useState<'vertex' | 'deepseek'>(runtimeModelConfig.analysis.provider);
  const [analysisModel, setAnalysisModel] = useState(runtimeModelConfig.analysis.model);
  const [searchProvider, setSearchProvider] = useState<SearchProvider>(runtimeModelConfig.search.provider);
  const [searchModel, setSearchModel] = useState(runtimeModelConfig.search.model);
  const [focusQuestions, setFocusQuestions] = useState(runtimeModelConfig.questions.focus);
  const [candidateQuestions, setCandidateQuestions] = useState(runtimeModelConfig.questions.candidate);
  const [qnaThinkingEnabled, setQnaThinkingEnabled] = useState(runtimeModelConfig.qna.thinkingEnabled);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageType, setMessageType] = useState<'success' | 'error' | 'info'>('info');
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    setAnalysisProvider(runtimeModelConfig.analysis.provider);
    setAnalysisModel(runtimeModelConfig.analysis.model);
    setSearchProvider(runtimeModelConfig.search.provider);
    setSearchModel(runtimeModelConfig.search.model);
    setFocusQuestions(runtimeModelConfig.questions.focus);
    setCandidateQuestions(runtimeModelConfig.questions.candidate);
    setQnaThinkingEnabled(runtimeModelConfig.qna.thinkingEnabled);
  }, [runtimeModelConfig]);

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    setMessageType('info');
    const payload: RuntimeModelConfig = {
      analysis: {
        provider: analysisProvider,
        model: analysisModel.trim(),
      },
      search: {
        provider: searchProvider,
        model: searchModel.trim(),
      },
      questions: {
        focus: Math.max(5, Math.floor(focusQuestions || 15)),
        candidate: Math.max(3, Math.floor(candidateQuestions || 15)),
      },
      qna: {
        thinkingEnabled: qnaThinkingEnabled,
      },
    };

    try {
      await pushRuntimeModelConfigToBackend(payload, API_BASE_URL);
      saveStoredRuntimeModelConfig(payload);
      await onConfigReload();
      setMessage(
        language === 'cn'
          ? `已生效：分析 ${payload.analysis.provider}:${payload.analysis.model}；搜索 ${payload.search.provider}:${payload.search.model}；Q&A Thinking ${payload.qna.thinkingEnabled ? '开' : '关'}`
          : `Applied: analysis ${payload.analysis.provider}:${payload.analysis.model}; search ${payload.search.provider}:${payload.search.model}; Q&A thinking ${payload.qna.thinkingEnabled ? 'ON' : 'OFF'}`
      );
      setMessageType('success');
    } catch (error: any) {
      setMessage(error?.message || (language === 'cn' ? '保存失败' : 'Failed to save'));
      setMessageType('error');
    } finally {
      setSaving(false);
    }
  };

  const searchProviderLabel = searchProvider === 'doubao' ? 'Doubao' : 'Vertex';

  return (
    <div className="max-w-6xl mx-auto mb-4 rounded-lg border border-gray-700 bg-gray-800/70">
      <button
        type="button"
        onClick={() => setIsOpen(v => !v)}
        className="w-full px-4 py-3 text-left text-sm text-gray-200 hover:bg-gray-700/50 flex items-center justify-between"
      >
        <span>{language === 'cn' ? '高级模型设置' : 'Advanced Model Settings'}</span>
        <span className="text-xs text-gray-400">
          A {runtimeModelConfig.analysis.provider}:{runtimeModelConfig.analysis.model} | S {runtimeModelConfig.search.provider}:{runtimeModelConfig.search.model} | Q {runtimeModelConfig.questions.focus}/{runtimeModelConfig.questions.candidate} | Think {runtimeModelConfig.qna.thinkingEnabled ? 'ON' : 'OFF'}
        </span>
      </button>

      {isOpen && (
        <div className="border-t border-gray-700 p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-3">
          <label className="text-xs text-gray-300 flex flex-col gap-1">
            {language === 'cn' ? '分析 Provider' : 'Analysis Provider'}
            <select
              value={analysisProvider}
              onChange={e => setAnalysisProvider(e.target.value as 'vertex' | 'deepseek')}
              className="bg-gray-900 border border-gray-600 rounded px-2 py-2 text-sm text-white"
            >
              <option value="deepseek">deepseek</option>
              <option value="vertex">vertex</option>
            </select>
          </label>

          <label className="text-xs text-gray-300 flex flex-col gap-1">
            {language === 'cn' ? '分析模型' : 'Analysis Model'}
            <input
              value={analysisModel}
              onChange={e => setAnalysisModel(e.target.value)}
              className="bg-gray-900 border border-gray-600 rounded px-2 py-2 text-sm text-white"
              placeholder="deepseek-v4-pro"
            />
          </label>

          <label className="text-xs text-gray-300 flex flex-col gap-1">
            {language === 'cn' ? '搜索 Provider' : 'Search Provider'}
            <select
              value={searchProvider}
              onChange={e => setSearchProvider(e.target.value as SearchProvider)}
              className="bg-gray-900 border border-gray-600 rounded px-2 py-2 text-sm text-white"
            >
              <option value="vertex">vertex (Google Search)</option>
              <option value="doubao">doubao</option>
            </select>
          </label>

          <label className="text-xs text-gray-300 flex flex-col gap-1">
            {language === 'cn' ? `搜索模型(${searchProviderLabel})` : `Search Model (${searchProviderLabel})`}
            <input
              value={searchModel}
              onChange={e => setSearchModel(e.target.value)}
              className="bg-gray-900 border border-gray-600 rounded px-2 py-2 text-sm text-white"
              placeholder={searchProvider === 'doubao' ? 'deepseek-v4-pro' : 'gemini-3-flash-preview'}
            />
          </label>

          <label className="text-xs text-gray-300 flex flex-col gap-1">
            {language === 'cn' ? '目标公司问题数' : 'Focus Questions'}
            <input
              type="number"
              min={5}
              value={focusQuestions}
              onChange={e => setFocusQuestions(Number.parseInt(e.target.value || '15', 10))}
              className="bg-gray-900 border border-gray-600 rounded px-2 py-2 text-sm text-white"
            />
          </label>

          <label className="text-xs text-gray-300 flex flex-col gap-1">
            {language === 'cn' ? '候选公司问题数' : 'Candidate Questions'}
            <input
              type="number"
              min={3}
              value={candidateQuestions}
              onChange={e => setCandidateQuestions(Number.parseInt(e.target.value || '15', 10))}
              className="bg-gray-900 border border-gray-600 rounded px-2 py-2 text-sm text-white"
            />
          </label>

          <label className="text-xs text-gray-300 flex flex-col gap-1 md:col-span-2 lg:col-span-3">
            {language === 'cn' ? '详细问答 Thinking 模式' : 'Detailed Q&A Thinking Mode'}
            <select
              value={qnaThinkingEnabled ? 'on' : 'off'}
              onChange={e => setQnaThinkingEnabled(e.target.value === 'on')}
              className="bg-gray-900 border border-gray-600 rounded px-2 py-2 text-sm text-white"
            >
              <option value="off">{language === 'cn' ? '关闭（更快，用于速度对比）' : 'Off (faster — for speed benchmarks)'}</option>
              <option value="on">{language === 'cn' ? '开启（DeepSeek 思考链，更慢）' : 'On (DeepSeek thinking — slower)'}</option>
            </select>
            <span className="text-[11px] text-gray-500 leading-snug">
              {language === 'cn'
                ? '仅控制「搜索 + 合成答案」中 DeepSeek 合成阶段的 thinking，不影响投资论点/最终结论。'
                : 'Controls DeepSeek thinking during answer synthesis only; thesis/final conclusion steps unchanged.'}
            </span>
          </label>

          <div className="md:col-span-2 lg:col-span-6 flex items-center justify-between mt-1">
            <p className="text-xs text-gray-400">
              {language === 'cn'
                ? `搜索问答当前走 ${searchProviderLabel}；保存后写入浏览器并同步后端。`
                : `Search Q&A uses ${searchProviderLabel}; save persists locally and syncs backend.`}
            </p>
            <div className="flex items-center gap-3">
              {message && (
                <span
                  className={`text-xs ${
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
                onClick={handleSave}
                disabled={saving}
                className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-sm text-white"
              >
                {saving ? (language === 'cn' ? '保存中...' : 'Saving...') : language === 'cn' ? '保存配置' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
