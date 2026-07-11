import React, { useEffect, useState } from 'react';
import { AnalysisPreset, Language, RuntimeModelConfig } from '../types.ts';
import {
  configForPreset,
  presetFromConfig,
  pushRuntimeModelConfigToBackend,
  saveStoredRuntimeModelConfig,
} from '../utils/runtimeModelConfigStorage.ts';

const API_BASE_URL = typeof window !== 'undefined' ? '' : 'http://localhost:3001';

interface ModelSettingsPanelProps {
  language: Language;
  runtimeModelConfig: RuntimeModelConfig;
  onConfigApplied: (config: RuntimeModelConfig) => void;
  isAdmin?: boolean;
}

const modeCardClass = (selected: boolean) =>
  `rounded-lg border p-4 text-left transition-colors ${
    selected
      ? 'border-blue-500 bg-blue-950/30 ring-1 ring-blue-500/40'
      : 'border-gray-700 bg-gray-900/40 hover:border-gray-600'
  }`;

const presetLabel = (preset: AnalysisPreset, language: Language): string => {
  if (language === 'cn') {
    if (preset === 'quick') return '快速';
    if (preset === 'advanced') return '高级';
    return '标准';
  }
  if (preset === 'quick') return 'Quick';
  if (preset === 'advanced') return 'Advanced';
  return 'Standard';
};

export const ModelSettingsPanel: React.FC<ModelSettingsPanelProps> = ({
  language,
  runtimeModelConfig,
  onConfigApplied,
  isAdmin = false,
}) => {
  const [preset, setPreset] = useState<AnalysisPreset>(() => presetFromConfig(runtimeModelConfig));
  const [qnaThinkingEnabled, setQnaThinkingEnabled] = useState(runtimeModelConfig.qna.thinkingEnabled);
  const [focusQuestions, setFocusQuestions] = useState(runtimeModelConfig.questions.focus);
  const [candidateQuestions, setCandidateQuestions] = useState(runtimeModelConfig.questions.candidate);
  const [showExpert, setShowExpert] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageType, setMessageType] = useState<'success' | 'error' | 'info'>('info');
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    setPreset(presetFromConfig(runtimeModelConfig));
    setQnaThinkingEnabled(runtimeModelConfig.qna.thinkingEnabled);
    setFocusQuestions(runtimeModelConfig.questions.focus);
    setCandidateQuestions(runtimeModelConfig.questions.candidate);
  }, [runtimeModelConfig]);

  const buildPayload = (): RuntimeModelConfig => {
    const base = configForPreset(preset);
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
          ? preset === 'advanced'
            ? '已切换为高级模式'
            : preset === 'quick'
              ? '已切换为快速模式'
              : '已切换为标准模式'
          : preset === 'advanced'
            ? 'Advanced mode applied.'
            : preset === 'quick'
              ? 'Quick mode applied.'
              : 'Standard mode applied.'
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
    preset === 'advanced'
      ? language === 'cn'
        ? '高级 · 双源搜索'
        : 'Advanced · dual search'
      : preset === 'quick'
        ? language === 'cn'
          ? '快速 · 默认'
          : 'Quick · default'
        : language === 'cn'
          ? '标准'
          : 'Standard';

  return (
    <div className="max-w-6xl mx-auto mb-4 rounded-lg border border-gray-700 bg-gray-800/70">
      <button
        type="button"
        onClick={() => setIsOpen(v => !v)}
        className="w-full px-4 py-3 text-left text-sm text-gray-200 hover:bg-gray-700/50 flex items-center justify-between gap-3"
      >
        <span>{language === 'cn' ? '分析模式' : 'Analysis Mode'}</span>
        <span className="text-xs text-gray-400 shrink-0">
          {isAdmin
            ? `${modeSummary} · ${runtimeModelConfig.analysis.model} · ${runtimeModelConfig.questions.focus}/${runtimeModelConfig.questions.candidate} ${language === 'cn' ? '题' : 'Q'}`
            : modeSummary}
        </span>
      </button>

      {isOpen && (
        <div className="border-t border-gray-700 p-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <button
              type="button"
              className={modeCardClass(preset === 'standard')}
              onClick={() => setPreset('standard')}
            >
              <div className="font-medium text-gray-100">
                {language === 'cn' ? '标准模式' : 'Standard mode'}
              </div>
              <ul className="mt-2 text-xs text-gray-400 space-y-1 list-disc list-inside">
                <li>{language === 'cn' ? 'Powered by DeepSeek' : 'Powered by DeepSeek'}</li>
                <li>{language === 'cn' ? '智能生成研究问题' : 'AI-generated research questions'}</li>
                <li>
                  {language === 'cn'
                    ? '广泛的互联网搜索结果聚合'
                    : 'Broad web search aggregation'}
                </li>
                <li>{language === 'cn' ? '8 大研究方向' : 'Eight research dimensions'}</li>
                <li>{language === 'cn' ? '明确的投资结论' : 'Clear investment conclusion'}</li>
              </ul>
            </button>

            <button
              type="button"
              className={modeCardClass(preset === 'quick')}
              onClick={() => setPreset('quick')}
            >
              <div className="font-medium text-gray-100">
                {language === 'cn' ? '快速模式（默认）' : 'Quick (default)'}
              </div>
              <ul className="mt-2 text-xs text-gray-400 space-y-1 list-disc list-inside">
                <li>
                  {language === 'cn'
                    ? 'Powered by DeepSeek，分析更快速'
                    : 'Powered by DeepSeek for faster analysis'}
                </li>
                <li>{language === 'cn' ? '智能生成研究问题' : 'AI-generated research questions'}</li>
                <li>
                  {language === 'cn'
                    ? '广泛的互联网信息聚合'
                    : 'Broad web search aggregation'}
                </li>
                <li>{language === 'cn' ? '8 大研究方向' : 'Eight research dimensions'}</li>
                <li>{language === 'cn' ? '明确的投资结论' : 'Clear investment conclusion'}</li>
                <li>{language === 'cn' ? '适合快速浏览与初筛' : 'Ideal for quick screening'}</li>
              </ul>
            </button>

            <button
              type="button"
              className={modeCardClass(preset === 'advanced')}
              onClick={() => setPreset('advanced')}
            >
              <div className="font-medium text-gray-100">
                {language === 'cn' ? '高级模式' : 'Advanced mode'}
              </div>
              <ul className="mt-2 text-xs text-gray-400 space-y-1 list-disc list-inside">
                <li>
                  {language === 'cn'
                    ? 'Powered by DeepSeek 深度分析'
                    : 'Powered by DeepSeek for in-depth analysis'}
                </li>
                <li>
                  {language === 'cn'
                    ? '多信息源混合搜索'
                    : 'Multi-source blended search'}
                </li>
                <li>{language === 'cn' ? '智能生成研究问题' : 'AI-generated research questions'}</li>
                <li>{language === 'cn' ? '8 大研究方向' : 'Eight research dimensions'}</li>
                <li>{language === 'cn' ? '明确的投资结论' : 'Clear investment conclusion'}</li>
                <li>{language === 'cn' ? '适合高要求深度研究' : 'Best for demanding deep research'}</li>
              </ul>
            </button>
          </div>

          {isAdmin && (
            <>
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
                    {language === 'cn' ? '问答 Thinking' : 'Q&A thinking'}
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
            </>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <p className="text-xs text-gray-500">
              {language === 'cn'
                ? `当前选择：${presetLabel(preset, language)}`
                : `Selected: ${presetLabel(preset, language)}`}
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
