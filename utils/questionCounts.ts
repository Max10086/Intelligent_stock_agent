/** Fixed expectation-gap questions (LLM-generated). */
export const EXPECTATION_GAP_QUESTION_COUNT = 3;

/** Fixed strategic-events questions (deterministic templates). */
export const STRATEGIC_EVENTS_QUESTION_COUNT = 2;

export const getReservedQuestionCount = (): number =>
  EXPECTATION_GAP_QUESTION_COUNT + STRATEGIC_EVENTS_QUESTION_COUNT;

export const getCoreQuestionCount = (totalQuestionCount: number): number =>
  Math.max(1, totalQuestionCount - getReservedQuestionCount());

/** Follow-up runs reserve only the fixed strategic-event slots (no expectation-gap batch). */
export const getFollowUpCoreQuestionCount = (totalQuestionCount: number): number =>
  Math.max(1, totalQuestionCount - STRATEGIC_EVENTS_QUESTION_COUNT);
