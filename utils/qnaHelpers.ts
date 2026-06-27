import { QnAResult } from '../types.ts';
import { isUnusableSearchAnswer } from './qnaAnswerQuality.ts';

export const indexAnsweredQuestions = (questions: string[], existingQna: QnAResult[]) => {
  const qnaByQuestion = new Map<string, QnAResult>();
  for (const item of existingQna) {
    if (item.question?.trim() && item.answer?.trim() && !isUnusableSearchAnswer(item.answer)) {
      qnaByQuestion.set(item.question, item);
    }
  }
  const pendingIndices = questions
    .map((question, index) => (!qnaByQuestion.has(question) ? index : -1))
    .filter(index => index >= 0);
  return { qnaByQuestion, pendingIndices };
};

export const orderQnaByQuestions = (questions: string[], qnaByQuestion: Map<string, QnAResult>): QnAResult[] =>
  questions
    .map(question => qnaByQuestion.get(question))
    .filter((item): item is QnAResult => Boolean(item?.answer?.trim()));
