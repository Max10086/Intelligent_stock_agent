export type StakeItem4Display = {
  label: string;
  detail: string;
};

const ITEM4_SUMMARY_PREFIX = '{"label":';

export const truncatePurposeLabel = (text: string, maxChars = 8): string => {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';

  let result = '';
  for (const char of cleaned) {
    if (result.length >= maxChars) break;
    if (char !== ' ') {
      result += char;
    }
  }
  return result || cleaned.slice(0, maxChars);
};

export const encodeStakeItem4Summary = (payload: StakeItem4Display): string =>
  JSON.stringify({ label: payload.label, detail: payload.detail });

export const decodeStakeItem4Summary = (
  raw: string | null | undefined
): StakeItem4Display | null => {
  const text = raw?.trim();
  if (!text) return null;

  if (text.startsWith(ITEM4_SUMMARY_PREFIX)) {
    try {
      const parsed = JSON.parse(text) as { label?: unknown; detail?: unknown };
      const label = String(parsed.label ?? '').trim();
      const detail = String(parsed.detail ?? '').trim();
      if (label && detail) {
        return { label: truncatePurposeLabel(label, 8), detail };
      }
    } catch {
      // fall through to legacy plain-text handling
    }
  }

  return {
    label: truncatePurposeLabel(text, 8),
    detail: text,
  };
};
