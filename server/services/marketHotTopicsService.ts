import type { EquityMarket, MarketHotTopicsSnapshot } from '../../types/compare.js';
import type { Language } from '../../types.js';
import { getRuntimeModelConfig } from '../aiModelConfig.js';
import { ModelClient } from './modelClient.js';
import {
  buildMarketHotTopicsSearchPrompt,
  buildMarketHotTopicsSearchQuery,
  emptyHotTopicsSnapshot,
  parseMarketHotTopicsResponse,
} from '../../utils/marketHotTopics.js';

const hotTopicsCache = new Map<
  string,
  { expiresAt: number; data: MarketHotTopicsSnapshot['markets'][EquityMarket] }
>();

const getCacheTtlMs = (): number => {
  const seconds = Number(process.env.COMPARE_HOT_TOPICS_CACHE_TTL || '86400');
  return Math.max(0, seconds) * 1000;
};

export async function fetchMarketHotTopicsForMarkets(
  modelClient: ModelClient,
  markets: EquityMarket[],
  language: Language
): Promise<MarketHotTopicsSnapshot> {
  const snapshot = emptyHotTopicsSnapshot();
  const ttl = getCacheTtlMs();

  await Promise.all(
    markets.map(async market => {
      const cacheKey = `${market}:${language}`;
      const cached = hotTopicsCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        snapshot.markets[market] = cached.data;
        return;
      }

      const searchQuery = buildMarketHotTopicsSearchPrompt(market, language);
      const runtime = getRuntimeModelConfig();

      let rawText = '';
      try {
        if (runtime.search.provider === 'doubao') {
          const response = await modelClient.generateContent({
            step: 'market_hot_topics',
            provider: 'doubao',
            model: runtime.search.model,
            contents: {
              role: 'user',
              parts: [{ text: searchQuery }],
            },
            config: { responseMimeType: 'application/json' },
          });
          rawText = response.text || '';
        } else {
          const response = await modelClient.generateContent({
            step: 'market_hot_topics',
            provider: 'vertex',
            model: runtime.search.model,
            contents: {
              role: 'user',
              parts: [{ text: searchQuery }],
            },
            config: { responseMimeType: 'application/json' },
            requireGoogleSearch: true,
          });
          rawText = response.text || '';
        }
      } catch (error) {
        console.warn(`[compare] hot topics search failed for ${market}:`, error);
        snapshot.markets[market] = {
          themes: [],
          searchQuery: buildMarketHotTopicsSearchQuery(market, language),
        };
        return;
      }

      const parsed = parseMarketHotTopicsResponse(
        rawText,
        market,
        buildMarketHotTopicsSearchQuery(market, language)
      );
      snapshot.markets[market] = parsed;

      if (ttl > 0) {
        hotTopicsCache.set(cacheKey, {
          expiresAt: Date.now() + ttl,
          data: parsed,
        });
      }
    })
  );

  return snapshot;
}
