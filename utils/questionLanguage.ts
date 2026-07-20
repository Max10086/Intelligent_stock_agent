import type { Language } from '../types.ts';
import { coerceQuestionText } from './coerceQuestionText.ts';

/** Heuristic: question is mostly English prose when user expects Chinese. */
export const questionLooksEnglish = (question: string): boolean => {
  const trimmed = (question || '').trim();
  if (!trimmed) return false;

  const cjk = (trimmed.match(/[\u4e00-\u9fff]/g) || []).length;
  const latinLetters = (trimmed.match(/[a-zA-Z]/g) || []).length;
  const latinWords = (trimmed.match(/\b[a-zA-Z]{4,}\b/g) || []).length;

  if (cjk >= 10) return false;
  if (latinWords >= 4 && cjk < 6) return true;
  return latinLetters >= 24 && cjk < 4;
};

export const filterQuestionsForLanguage = (
  questions: string[],
  lang: Language
): { accepted: string[]; rejected: string[] } => {
  if (lang !== 'cn') {
    return {
      accepted: questions.map(coerceQuestionText).filter(q => q.trim()),
      rejected: [],
    };
  }

  const accepted: string[] = [];
  const rejected: string[] = [];
  for (const question of questions) {
    const trimmed = coerceQuestionText(question).trim();
    if (!trimmed) continue;
    if (questionLooksEnglish(trimmed)) {
      rejected.push(trimmed);
    } else {
      accepted.push(trimmed);
    }
  }
  return { accepted, rejected };
};

export const pickLanguageValidQuestions = async (
  questions: string[],
  lang: Language,
  regenerateStrict: () => Promise<string[]>,
  expectedCount?: number
): Promise<string[]> => {
  const target =
    expectedCount ?? questions.map(coerceQuestionText).filter(q => q.trim()).length;

  const dedupeMerge = (base: string[], extra: string[]): string[] => {
    const seen = new Set(base.map(q => q.replace(/\s+/g, ' ').toLowerCase()));
    const out = [...base];
    for (const q of extra) {
      const trimmed = coerceQuestionText(q).trim();
      if (!trimmed) continue;
      const key = trimmed.replace(/\s+/g, ' ').toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(trimmed);
    }
    return out;
  };

  let { accepted, rejected } = filterQuestionsForLanguage(questions, lang);

  if (lang === 'cn' && rejected.length > 0) {
    const retry = filterQuestionsForLanguage(await regenerateStrict(), lang);
    const retryBetter =
      retry.rejected.length < rejected.length ||
      retry.accepted.length > accepted.length;
    accepted = retryBetter
      ? dedupeMerge([], retry.accepted)
      : dedupeMerge(accepted, retry.accepted);
  }

  let attempts = 0;
  while (lang === 'cn' && accepted.length < target && attempts < 2) {
    const retry = filterQuestionsForLanguage(await regenerateStrict(), lang);
    accepted = dedupeMerge(accepted, retry.accepted);
    attempts += 1;
  }

  return target > 0 ? accepted.slice(0, target) : accepted;
};

export const CHINESE_QUESTIONS_STRICT_SUFFIX =
  '\n\n【语言硬性要求】所有问题必须全部使用简体中文撰写。禁止输出英文问句（允许保留公司名、股票代码、YYYY-Qx、FYxxxx 等格式）。若上一批有误，本次必须全部改为中文。';

export const ENGLISH_QUESTIONS_STRICT_SUFFIX =
  '\n\nLANGUAGE REQUIREMENT: Every question must be written entirely in English.';
