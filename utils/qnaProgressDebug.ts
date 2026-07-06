import type { QnAResult } from '../types.ts';
import { isUnusableSearchAnswer } from './qnaAnswerQuality.ts';

/** Troubleshooting logs for Q&A progress jumps. Enabled in Vite dev (`npm run dev`). */
export const QNA_PROGRESS_DEBUG =
  typeof import.meta !== 'undefined' && Boolean((import.meta as { env?: { DEV?: boolean } }).env?.DEV);

const LOG_PREFIX = '[QnaProgress]';

let runSeq = 0;

/** Active company runs — detects overlapping runAnalysisForCompany for the same companyId. */
const activeRunsByCompany = new Map<string, string>();

export const createQnaProgressRunId = (companyId: string, companyName: string): string => {
  runSeq += 1;
  return `${companyId}-${runSeq}-${Date.now().toString(36)}`;
};

export const registerQnaProgressRun = (companyId: string, runId: string, companyName: string): void => {
  if (!QNA_PROGRESS_DEBUG) return;
  const existing = activeRunsByCompany.get(companyId);
  if (existing && existing !== runId) {
    logQnaProgress('OVERLAP_RUN', {
      companyId,
      companyName,
      runId,
      otherRunId: existing,
      hint: 'Two runAnalysisForCompany instances are active for the same company — progress may regress.',
    });
  }
  activeRunsByCompany.set(companyId, runId);
};

export const unregisterQnaProgressRun = (companyId: string, runId: string): void => {
  if (!QNA_PROGRESS_DEBUG) return;
  if (activeRunsByCompany.get(companyId) === runId) {
    activeRunsByCompany.delete(companyId);
  }
};

export const logQnaProgress = (event: string, payload: Record<string, unknown>): void => {
  if (!QNA_PROGRESS_DEBUG) return;
  console.info(LOG_PREFIX, event, payload);
};

export const normalizeQuestionKeyDebug = (question: string): string => question?.trim() || '';

export interface QuestionCountRow {
  index: number;
  normalizedKeyPreview: string;
  rawDiffersFromNormalized: boolean;
  mapHitNormalized: boolean;
  mapHitRaw: boolean;
  hasAnswer: boolean;
  unusableAnswer: boolean;
  counted: boolean;
}

/** Per-question breakdown — use when completed count looks wrong vs map size. */
export const diagnoseQuestionCount = (
  questions: string[],
  qnaByQuestion: Map<string, QnAResult>
): { counted: number; rows: QuestionCountRow[] } => {
  const rows = questions.map((question, index) => {
    const normalizedKey = normalizeQuestionKeyDebug(question);
    const byNorm = qnaByQuestion.get(normalizedKey);
    const byRaw = question !== normalizedKey ? qnaByQuestion.get(question) : undefined;
    const item = byNorm ?? byRaw;
    const hasAnswer = Boolean(item?.answer?.trim());
    const unusableAnswer = hasAnswer ? isUnusableSearchAnswer(item!.answer) : false;
    const counted = Boolean(normalizedKey && hasAnswer && !unusableAnswer);
    return {
      index,
      normalizedKeyPreview: normalizedKey.slice(0, 100),
      rawDiffersFromNormalized: question !== normalizedKey,
      mapHitNormalized: qnaByQuestion.has(normalizedKey),
      mapHitRaw: question !== normalizedKey && qnaByQuestion.has(question),
      hasAnswer,
      unusableAnswer,
      counted,
    };
  });
  return { counted: rows.filter(r => r.counted).length, rows };
};

export const snapshotQnaMaps = (
  questions: string[],
  qnaByQuestion: Map<string, QnAResult>
): {
  mapRawKeyCount: number;
  mapNormalizedUniqueCount: number;
  orderedQnaLength: number;
  counted: number;
  keyMismatchSamples: Array<{ raw: string; normalized: string }>;
} => {
  const rawKeys = [...qnaByQuestion.keys()];
  const normalizedUnique = new Set(rawKeys.map(normalizeQuestionKeyDebug).filter(Boolean));
  const keyMismatchSamples = rawKeys
    .filter(k => k !== normalizeQuestionKeyDebug(k))
    .slice(0, 5)
    .map(raw => ({ raw: raw.slice(0, 80), normalized: normalizeQuestionKeyDebug(raw).slice(0, 80) }));

  const orderedQnaLength = questions.filter(q => {
    const item = qnaByQuestion.get(normalizeQuestionKeyDebug(q));
    return Boolean(item?.answer?.trim());
  }).length;

  const { counted } = diagnoseQuestionCount(questions, qnaByQuestion);

  return {
    mapRawKeyCount: rawKeys.length,
    mapNormalizedUniqueCount: normalizedUnique.size,
    orderedQnaLength,
    counted,
    keyMismatchSamples,
  };
};

export class QnaProgressReporter {
  private lastReportedCount = -1;
  private lastReportedAt = 0;

  constructor(
    private readonly runId: string,
    private readonly companyId: string,
    private readonly companyName: string,
    private readonly totalQuestions: number
  ) {}

  report(source: string, completed: number, extra?: Record<string, unknown>): void {
    if (!QNA_PROGRESS_DEBUG) return;

    const now = Date.now();
    const delta = this.lastReportedCount < 0 ? completed : completed - this.lastReportedCount;
    const regressed = this.lastReportedCount >= 0 && completed < this.lastReportedCount;

    logQnaProgress(regressed ? 'REGRESSION' : 'PROGRESS', {
      runId: this.runId,
      companyId: this.companyId,
      companyName: this.companyName,
      source,
      completed,
      total: this.totalQuestions,
      previousCompleted: this.lastReportedCount,
      delta,
      msSinceLastReport: this.lastReportedAt ? now - this.lastReportedAt : null,
      ...extra,
    });

    if (regressed) {
      console.warn(
        `${LOG_PREFIX} COUNT WENT DOWN ${this.lastReportedCount} → ${completed} (${source}). See REGRESSION log above.`
      );
    }

    this.lastReportedCount = completed;
    this.lastReportedAt = now;
  }
}
