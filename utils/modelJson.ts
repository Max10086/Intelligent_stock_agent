export const extractJsonObjectText = (raw: string): string | null => {
  const text = (raw || '').trim();
  if (!text) return null;

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]?.trim()) return extractBalancedJsonObject(fenced[1].trim()) || fenced[1].trim();

  return extractBalancedJsonObject(text) || extractByFirstLastBrace(text);
};

/** Balanced-brace extraction avoids grabbing broken spans when extra `{`/`}` appear in prose. */
export const extractBalancedJsonObject = (raw: string): string | null => {
  const text = (raw || '').trim();
  const start = text.indexOf('{');
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inString) {
      if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
};

const extractByFirstLastBrace = (text: string): string | null => {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  return null;
};

export const repairJsonText = (json: string): string =>
  json
    .replace(/^\uFEFF/, '')
    .replace(/[\u201C\u201D\u201E\u2033]/g, '"')
    .replace(/[\u2018\u2019\u201A\u2032]/g, "'")
    .replace(/,\s*([}\]])/g, '$1');

const parseJsonCandidates = (raw: string): unknown => {
  const trimmed = (raw || '').trim();
  if (!trimmed) return {};

  const candidates = [
    trimmed,
    extractBalancedJsonObject(trimmed),
    extractByFirstLastBrace(trimmed),
  ].filter((value, index, array): value is string => Boolean(value) && array.indexOf(value) === index);

  for (const candidate of candidates) {
    for (const variant of [candidate, repairJsonText(candidate)]) {
      try {
        return JSON.parse(variant);
      } catch {
        // try next variant
      }
    }
  }

  throw new Error('Model response is not valid JSON.');
};

export const tryParseModelJson = (raw: string): unknown | null => {
  try {
    return parseJsonCandidates(raw);
  } catch {
    return null;
  }
};

export const parseModelJsonResponse = (raw: string): unknown => parseJsonCandidates(raw);
