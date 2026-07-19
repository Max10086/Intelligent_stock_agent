import { dedupeQuestions } from './questionGenerationBatches.ts';
import {
  EXPECTATION_GAP_QUESTION_COUNT,
  getCoreQuestionCount,
  getFollowUpCoreQuestionCount,
  STRATEGIC_EVENTS_QUESTION_COUNT,
} from './questionCounts.ts';

export {
  getCoreQuestionCount,
  getFollowUpCoreQuestionCount,
  EXPECTATION_GAP_QUESTION_COUNT,
  STRATEGIC_EVENTS_QUESTION_COUNT,
};

/** Merge core LLM questions + fixed strategic-event questions + expectation-gap questions. */
export const mergeAllResearchQuestions = (
  coreQuestions: string[],
  strategicEventQuestions: string[],
  expectationGapQuestions: string[],
  totalQuestionCount: number
): string[] => {
  const coreTarget = getCoreQuestionCount(totalQuestionCount);
  const core = coreQuestions.slice(0, coreTarget);
  const strategic = strategicEventQuestions.slice(0, STRATEGIC_EVENTS_QUESTION_COUNT);
  const gap = expectationGapQuestions.slice(0, EXPECTATION_GAP_QUESTION_COUNT);
  return dedupeQuestions([...core, ...strategic, ...gap]).slice(0, totalQuestionCount);
};

/** Merge follow-up LLM questions + fixed strategic-event questions. */
export const mergeFollowUpResearchQuestions = (
  coreQuestions: string[],
  strategicEventQuestions: string[],
  totalQuestionCount: number
): string[] => {
  const coreTarget = getFollowUpCoreQuestionCount(totalQuestionCount);
  const core = coreQuestions.slice(0, coreTarget);
  const strategic = strategicEventQuestions.slice(0, STRATEGIC_EVENTS_QUESTION_COUNT);
  return dedupeQuestions([...core, ...strategic]).slice(0, totalQuestionCount);
};

/** @deprecated Use mergeAllResearchQuestions */
export const mergeCoreAndExpectationGapQuestions = (
  coreQuestions: string[],
  expectationGapQuestions: string[],
  totalQuestionCount: number
): string[] =>
  mergeAllResearchQuestions(coreQuestions, [], expectationGapQuestions, totalQuestionCount);
