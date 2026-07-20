/** Merge CNINFO / EDGAR (or other) official filing prompt blocks — at most one is non-empty per company. */
export const mergeOfficialFilingEvidenceBlocks = (
  ...blocks: Array<string | undefined | null>
): string =>
  blocks
    .map(block => block?.trim())
    .filter((block): block is string => Boolean(block))
    .join('\n\n');
