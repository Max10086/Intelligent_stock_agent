import { DEEPSEEK_API_KEY, getRuntimeModelConfig } from '../aiModelConfig.js';
import { createGoogleGenAIClient } from '../lib/googleGenAIClient.js';
import {
  buildSectorLookupPrompt,
  parseSectorLookupResponse,
  type SectorLookupRequest,
  type SectorLookupResult,
} from '../../utils/thirteenFSectorLlm.js';
import { ModelClient } from './modelClient.js';
import { saveTickerSectorsToDb } from './tickerSectorCacheService.js';

const BATCH_SIZE = 25;
const BATCH_DELAY_MS = 400;

let modelClient: ModelClient | null = null;

const getModelClient = (): ModelClient => {
  if (!modelClient) {
    modelClient = new ModelClient(createGoogleGenAIClient());
  }
  return modelClient;
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const isSectorLlmEnabled = (): boolean =>
  process.env.THIRTEEN_F_SECTOR_LLM !== 'false' && Boolean(DEEPSEEK_API_KEY?.trim());

export const lookupSectorsViaLlm = async (
  items: SectorLookupRequest[]
): Promise<SectorLookupResult[]> => {
  if (!isSectorLlmEnabled() || items.length === 0) return [];

  const runtime = getRuntimeModelConfig();
  const client = getModelClient();
  const results: SectorLookupResult[] = [];

  for (let offset = 0; offset < items.length; offset += BATCH_SIZE) {
    const batch = items.slice(offset, offset + BATCH_SIZE);
    const prompt = buildSectorLookupPrompt(batch);

    try {
      const response = await client.generateContent({
        step: 'sector_lookup',
        provider: 'deepseek',
        model: runtime.analysis.model,
        contents: { role: 'user', parts: [{ text: prompt }] },
        config: { responseMimeType: 'application/json' },
      });

      const parsed = parseSectorLookupResponse(
        response.text || '',
        batch.map(row => row.ticker)
      );
      results.push(...parsed);

      if (parsed.length > 0) {
        await saveTickerSectorsToDb(
          parsed.map(row => ({
            ticker: row.ticker,
            sector: row.sector,
            industry: row.industry,
            companyName: batch.find(item => item.ticker.toUpperCase() === row.ticker)?.name,
            source: 'llm' as const,
          }))
        );
      }
    } catch (error) {
      console.warn(
        '[13f-sector] LLM lookup failed:',
        error instanceof Error ? error.message : error
      );
    }

    if (offset + BATCH_SIZE < items.length) {
      await sleep(BATCH_DELAY_MS);
    }
  }

  return results;
};
