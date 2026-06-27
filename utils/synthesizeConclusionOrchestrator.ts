import { InvestmentConclusion } from '../types.ts';
import { QNA_CONCURRENCY, runParallelIndexedTasks } from './parallelTasks.ts';
import { normalizeInvestmentConclusion } from './investmentConclusionNormalize.ts';
import {
  buildSynthesizeSectionPrompt,
  hasUsableInvestmentSection,
  SynthesizeConclusionQnA,
  THESIS_SECTION_KEYS,
  ThesisSectionKey,
} from './synthesizeConclusionPrompt.ts';

export interface SynthesizeSectionResult {
  sectionKey: ThesisSectionKey;
  section: InvestmentConclusion[ThesisSectionKey];
}

export type SynthesizeSectionCaller = (
  sectionKey: ThesisSectionKey,
  prompt: string,
  strictRetry: boolean
) => Promise<SynthesizeSectionResult>;

export const synthesizeInvestmentConclusionBySections = async (options: {
  companyName: string;
  outputLanguage: string;
  recencyGuidance: string;
  qna: SynthesizeConclusionQnA[];
  callSection: SynthesizeSectionCaller;
  concurrency?: number;
}): Promise<InvestmentConclusion> => {
  const tasks = THESIS_SECTION_KEYS.map((sectionKey, index) => ({ index, item: sectionKey }));
  const sectionResults = new Map<ThesisSectionKey, InvestmentConclusion[ThesisSectionKey]>();

  await runParallelIndexedTasks<ThesisSectionKey, SynthesizeSectionResult>(
    tasks,
    async task => {
      const runOnce = (strict: boolean) =>
        options.callSection(
          task.item,
          buildSynthesizeSectionPrompt(
            options.companyName,
            options.outputLanguage,
            options.recencyGuidance,
            options.qna,
            task.item,
            strict
          ),
          strict
        );

      let result: SynthesizeSectionResult;
      try {
        result = await runOnce(false);
      } catch {
        result = await runOnce(true);
      }
      if (!hasUsableInvestmentSection(task.item, result.section)) {
        result = await runOnce(true);
      }
      if (!hasUsableInvestmentSection(task.item, result.section)) {
        throw new Error(`Failed to generate usable section "${task.item}" for ${options.companyName}.`);
      }
      return result;
    },
    {
      concurrency: options.concurrency ?? QNA_CONCURRENCY,
      onTaskComplete: async result => {
        sectionResults.set(result.sectionKey, result.section);
      },
    }
  );

  return normalizeInvestmentConclusion(
    Object.fromEntries(THESIS_SECTION_KEYS.map(key => [key, sectionResults.get(key)]))
  );
};
