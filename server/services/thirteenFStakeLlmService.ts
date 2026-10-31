import { DEEPSEEK_API_KEY, getRuntimeModelConfig } from '../aiModelConfig.js';
import { createGoogleGenAIClient } from '../lib/googleGenAIClient.js';
import {
  buildStakeItem4Prompt,
  parseStakeItem4Response,
  type StakeItem4SummaryRequest,
  type StakeItem4SummaryResult,
} from '../../utils/thirteenFStakeLlm.js';
import { ModelClient } from './modelClient.js';

let modelClient: ModelClient | null = null;

const getModelClient = (): ModelClient => {
  if (!modelClient) {
    modelClient = new ModelClient(createGoogleGenAIClient());
  }
  return modelClient;
};

export const isStakeItem4LlmEnabled = (): boolean =>
  process.env.THIRTEEN_F_STAKE_LLM !== 'false' && Boolean(DEEPSEEK_API_KEY?.trim());

export const summarizeStakeItem4ViaLlm = async (
  input: StakeItem4SummaryRequest
): Promise<StakeItem4SummaryResult | null> => {
  if (!isStakeItem4LlmEnabled() || !input.item4Text.trim()) return null;

  const runtime = getRuntimeModelConfig();
  const client = getModelClient();
  const prompt = buildStakeItem4Prompt(input);

  try {
    const response = await client.generateContent({
      step: 'stake_item4_summary',
      provider: 'deepseek',
      model: runtime.analysis.model,
      contents: { role: 'user', parts: [{ text: prompt }] },
      config: { responseMimeType: 'application/json' },
    });
    return parseStakeItem4Response(response.text || '', input.accessionNumber);
  } catch (error) {
    console.warn(
      '[13f-stake] Item 4 LLM failed:',
      error instanceof Error ? error.message : error
    );
    return null;
  }
};
