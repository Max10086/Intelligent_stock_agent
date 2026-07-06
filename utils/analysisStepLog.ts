import type { AnalysisStepLog, Language } from '../types.ts';

export type AnalysisStepKey =
  | 'find_companies'
  | 'fetch_financials'
  | 'quick_take'
  | 'generate_questions'
  | 'answer_questions'
  | 'synthesize_conclusion'
  | 'final_conclusion';

const STEP_LABELS: Record<AnalysisStepKey, { en: string; cn: string }> = {
  find_companies: { en: 'Discover companies', cn: '发现公司与竞品' },
  fetch_financials: { en: 'Fetch financial data', cn: '获取财务数据' },
  quick_take: { en: 'Generate quick take', cn: '生成公司简介' },
  generate_questions: { en: 'Generate research questions', cn: '生成研究问题' },
  answer_questions: { en: 'Answer detailed Q&A', cn: '详细问答分析' },
  synthesize_conclusion: { en: 'Synthesize investment thesis', cn: '合成投资论点' },
  final_conclusion: { en: 'Generate final conclusion', cn: '生成最终结论' },
};

export const getStepLabel = (step: AnalysisStepKey, lang: Language): string =>
  STEP_LABELS[step]?.[lang] ?? step;

export const formatStepDuration = (durationMs: number, lang: Language): string => {
  if (durationMs < 1000) {
    return lang === 'cn' ? `${durationMs} 毫秒` : `${durationMs} ms`;
  }
  const seconds = durationMs / 1000;
  if (seconds < 60) {
    return lang === 'cn' ? `${seconds.toFixed(1)} 秒` : `${seconds.toFixed(1)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const rem = Math.round(seconds % 60);
  return lang === 'cn' ? `${minutes} 分 ${rem} 秒` : `${minutes}m ${rem}s`;
};

export const createStepLogEntry = (params: {
  companyId: string;
  companyName: string;
  step: AnalysisStepKey;
  lang: Language;
  startedAt: number;
  endedAt?: number;
}): AnalysisStepLog => {
  const endedAt = params.endedAt ?? Date.now();
  return {
    id: `${params.companyId}-${params.step}-${endedAt}`,
    companyId: params.companyId,
    companyName: params.companyName,
    step: params.step,
    label: getStepLabel(params.step, params.lang),
    startedAt: new Date(params.startedAt).toISOString(),
    endedAt: new Date(endedAt).toISOString(),
    durationMs: Math.max(0, endedAt - params.startedAt),
  };
};

export const groupStepLogsByCompany = (
  logs: AnalysisStepLog[]
): Array<{ companyId: string; companyName: string; logs: AnalysisStepLog[] }> => {
  const map = new Map<string, { companyId: string; companyName: string; logs: AnalysisStepLog[] }>();
  for (const log of logs) {
    const existing = map.get(log.companyId);
    if (existing) {
      existing.logs.push(log);
    } else {
      map.set(log.companyId, { companyId: log.companyId, companyName: log.companyName, logs: [log] });
    }
  }
  return Array.from(map.values());
};

export const sumStepDuration = (logs: AnalysisStepLog[]): number =>
  logs.reduce((sum, log) => sum + (log.durationMs || 0), 0);
