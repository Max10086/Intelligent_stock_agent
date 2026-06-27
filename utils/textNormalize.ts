const NON_BREAKING_HYPHEN = '\u2011';

const formatDateParts = (year: string, month: string, day: string): string =>
  `${year}${NON_BREAKING_HYPHEN}${month.padStart(2, '0')}${NON_BREAKING_HYPHEN}${day.padStart(2, '0')}`;

export const cleanupBrokenNumericFormatting = (text: string): string => {
  if (!text) return '';

  return text
    // 2026 \n 06 \n 17 -> 2026-06-17 (month/day may be 1 or 2 digits)
    .replace(/(\d{4})\s*\n\s*(\d{1,2})\s*\n\s*(\d{1,2})/g, (_, year, month, day) =>
      formatDateParts(year, month, day)
    )
    // 2026-06-17 / 2026/06/17
    .replace(/(\d{4})\s*[-/]\s*(\d{1,2})\s*[-/]\s*(\d{1,2})/g, (_, year, month, day) =>
      formatDateParts(year, month, day)
    )
    // 2026 06 17 (spaces from model output or newline collapse) -> 2026-06-17
    .replace(/(\d{4})\s+(\d{1,2})\s+(\d{1,2})(?=[^\d\s]|$)/g, (_, year, month, day) =>
      formatDateParts(year, month, day)
    )
    // 5 \n 10亿元 -> 5-10亿元
    .replace(
      /(\d{1,4})\s*\n\s*(\d{1,4})(?=\s*(亿元|万亿|万美元|港元|元|%|片|万片|亿元\/月))/g,
      `$1${NON_BREAKING_HYPHEN}$2`
    )
    .replace(
      /(\d{1,4})\s*-\s*(\d{1,4})(?=\s*(亿元|万亿|万美元|港元|元|%|片|万片|亿元\/月))/g,
      `$1${NON_BREAKING_HYPHEN}$2`
    )
    // Single line breaks inside one sentence -> space
    .replace(/([^\n])\n(?!\n)([^\n])/g, '$1 $2')
    .trim();
};

export const mergeBrokenEvidenceFragments = (items: string[]): string[] => {
  const merged: string[] = [];

  for (let i = 0; i < items.length; i++) {
    let current = items[i];
    const next = items[i + 1];
    const nextNext = items[i + 2];

    const wholeYear = current.match(/^(20\d{2})$/);
    const trailingYear = current.match(/(20\d{2})$/);
    const month = next?.match(/^(\d{1,2})$/);
    const dayWithRest = nextNext?.match(/^(\d{1,2})(.*)$/);
    const combinedMonthDay = next?.match(/^(\d{1,2})\s*\n\s*(\d{1,2})(.*)$/);

    if ((wholeYear || trailingYear) && month && dayWithRest) {
      const year = (wholeYear || trailingYear)![1];
      const replacement = formatDateParts(year, month[1], dayWithRest[1]) + (dayWithRest[2] || '');
      current = wholeYear ? replacement : current.replace(/20\d{2}$/, replacement);
      i += 2;
    } else if ((wholeYear || trailingYear) && combinedMonthDay) {
      const year = (wholeYear || trailingYear)![1];
      const replacement =
        formatDateParts(year, combinedMonthDay[1], combinedMonthDay[2]) + (combinedMonthDay[3] || '');
      current = wholeYear ? replacement : current.replace(/20\d{2}$/, replacement);
      i += 1;
    }

    const amountRange = items[i + 1]?.match(/^(\d{1,4})(\s*(亿元|万亿|万美元|港元|元|%|片|万片|亿元\/月).*)$/);
    if (amountRange && /\d{1,4}$/.test(current)) {
      current = `${current}${NON_BREAKING_HYPHEN}${amountRange[1]}${amountRange[2]}`;
      i += 1;
    }

    const cleaned = cleanupBrokenNumericFormatting(current);
    if (cleaned) merged.push(cleaned);
  }

  return merged;
};

export const normalizeDisplayText = cleanupBrokenNumericFormatting;
