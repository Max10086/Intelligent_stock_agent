import 'dotenv/config';

// Single source of truth for model selection.
// Change this default (or set ANALYSIS_MODEL env) to switch globally.
export const DEFAULT_ANALYSIS_MODEL = 'gemini-2.5-flash';

const requestedModel =
  (process.env.ANALYSIS_MODEL && process.env.ANALYSIS_MODEL.trim()) ||
  DEFAULT_ANALYSIS_MODEL;

// Use the requested model directly by default.
export const ANALYSIS_MODEL = requestedModel;

