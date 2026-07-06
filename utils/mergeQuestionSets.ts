import { dedupeQuestions } from './questionGenerationBatches.ts';
import { EXPECTATION_GAP_QUESTION_COUNT, getCoreQuestionCount } from './expectationGapPrompt.ts';

/** Merge standard research questions with fixed expectation-gap questions (total ≈ questionCount). */
export const mergeCoreAndExpectationGapQuestions = (
  coreQuestions: string[],
  expectationGapQuestions: string[],
  totalQuestionCount: number
): string[] => {
  const coreTarget = getCoreQuestionCount(totalQuestionCount);
  const gap = expectationGapQuestions.slice(0, EXPECTATION_GAP_QUESTION_COUNT);
  const core = coreQuestions.slice(0, coreTarget);
  return dedupeQuestions([...core, ...gap]).slice(0, totalQuestionCount);
};
