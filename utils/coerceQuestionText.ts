/** Normalize LLM question output to a plain string (models sometimes return objects). */
export function coerceQuestionText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    for (const key of ['question', 'text', 'q', 'content', 'title']) {
      const candidate = obj[key];
      if (typeof candidate === 'string') return candidate;
    }
  }
  return '';
}

export function normalizeQuestionList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(coerceQuestionText).filter(q => q.trim().length > 0);
}
