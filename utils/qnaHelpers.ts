import { QnAResult } from '../types.ts';
import { isUnusableSearchAnswer } from './qnaAnswerQuality.ts';

const normalizeQuestionKey = (question: string): string => question?.trim() || '';

export const countAnsweredQuestions = (
  questions: string[],
  qnaByQuestion: Map<string, QnAResult>
): number =>
  questions.filter(question => {
    const key = normalizeQuestionKey(question);
    const item = qnaByQuestion.get(key);
    return Boolean(key && item?.answer?.trim() && !isUnusableSearchAnswer(item.answer));
  }).length;

export const indexAnsweredQuestions = (questions: string[], existingQna: QnAResult[]) => {
  const qnaByQuestion = new Map<string, QnAResult>();
  const allowedQuestions = new Set(questions.map(normalizeQuestionKey).filter(Boolean));

  for (const item of existingQna) {
    const key = normalizeQuestionKey(item.question);
    if (!key || !allowedQuestions.has(key)) continue;
    if (item.answer?.trim() && !isUnusableSearchAnswer(item.answer)) {
      qnaByQuestion.set(key, { ...item, question: key });
    }
  }

  const pendingIndices = questions
    .map((question, index) => (!qnaByQuestion.has(normalizeQuestionKey(question)) ? index : -1))
    .filter(index => index >= 0);

  return { qnaByQuestion, pendingIndices };
};

export const orderQnaByQuestions = (questions: string[], qnaByQuestion: Map<string, QnAResult>): QnAResult[] =>
  questions
    .map(question => qnaByQuestion.get(normalizeQuestionKey(question)))
    .filter((item): item is QnAResult => Boolean(item?.answer?.trim()));
