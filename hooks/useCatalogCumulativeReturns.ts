import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AnalysisCatalogItem } from './useAnalysisCatalog.ts';
import type { CatalogReturnBatchResponse, CatalogReturnDisplay } from '../types/catalogReturn.ts';
import { parsePriceNumber } from '../utils/priceFormat.ts';
import { apiFetch, readApiError } from '../utils/authenticatedFetch.ts';

const CHUNK_SIZE = 6;
const CHUNK_GAP_MS = 120;

export interface CumulativeReturnTrackItem {
  id: string;
  ticker: string;
  companyName?: string | null;
  currentPrice?: string | null;
  exchange?: string | null;
}

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

export const resolveCumulativeReturnExchange = (item: CumulativeReturnTrackItem): string => {
  if (item.exchange?.trim()) return item.exchange.trim();

  const ticker = (item.ticker || '').trim();
  if (/^\d{6}$/.test(ticker)) {
    return ticker.startsWith('6') || ticker.startsWith('9') ? 'SSE' : 'SZSE';
  }
  if (/^\d{1,5}$/.test(ticker)) return 'HKEX';

  const upper = ticker.toUpperCase();
  if (upper.startsWith('HK.') || upper.startsWith('HK')) return 'HKEX';
  if (upper.startsWith('SH')) return 'SSE';
  if (upper.startsWith('SZ')) return 'SZSE';
  return 'NASDAQ';
};

const isEligible = (item: CumulativeReturnTrackItem): boolean =>
  Boolean(item.currentPrice && parsePriceNumber(item.currentPrice));

export const useCatalogCumulativeReturns = (
  items: CumulativeReturnTrackItem[] | AnalysisCatalogItem[]
) => {
  const [returnsById, setReturnsById] = useState<Record<string, CatalogReturnDisplay>>({});
  const fetchedIdsRef = useRef(new Set<string>());
  const runIdRef = useRef(0);

  const itemIdsKey = useMemo(() => items.map(item => item.id).join(','), [items]);

  const reload = useCallback(() => {
    runIdRef.current += 1;
    fetchedIdsRef.current.clear();
    setReturnsById({});
  }, []);

  useEffect(() => {
    const eligible = items.filter(isEligible);
    const toFetch = eligible.filter(item => !fetchedIdsRef.current.has(item.id));
    if (toFetch.length === 0) {
      setReturnsById(prev => {
        const next = { ...prev };
        for (const item of items) {
          if (!isEligible(item)) {
            next[item.id] = { status: 'idle', returnPct: null, currentPrice: null };
          }
        }
        return next;
      });
      return;
    }

    const runId = ++runIdRef.current;

    setReturnsById(prev => {
      const next = { ...prev };
      for (const item of items) {
        if (!isEligible(item)) {
          next[item.id] = { status: 'idle', returnPct: null, currentPrice: null };
        }
      }
      return next;
    });

    const loadReturns = async () => {
      for (let offset = 0; offset < toFetch.length; offset += CHUNK_SIZE) {
        if (runIdRef.current !== runId) return;

        const chunk = toFetch.slice(offset, offset + CHUNK_SIZE);
        setReturnsById(prev => {
          const next = { ...prev };
          for (const item of chunk) {
            next[item.id] = { status: 'loading', returnPct: null, currentPrice: null };
          }
          return next;
        });

        try {
          const response = await apiFetch('/api/jobs/catalog/returns', {
            method: 'POST',
            body: JSON.stringify({
              items: chunk.map(item => ({
                id: item.id,
                ticker: item.ticker,
                exchange: resolveCumulativeReturnExchange(item),
                anchorPrice: item.currentPrice,
                companyName: item.companyName,
              })),
            }),
          });
          if (!response.ok) throw new Error(await readApiError(response));
          const payload = (await response.json()) as CatalogReturnBatchResponse;
          if (runIdRef.current !== runId) return;

          setReturnsById(prev => {
            const next = { ...prev };
            for (const row of payload.results ?? []) {
              next[row.id] = {
                status: 'done',
                returnPct: row.returnPct,
                currentPrice: row.currentPrice,
              };
              fetchedIdsRef.current.add(row.id);
            }
            return next;
          });
        } catch {
          if (runIdRef.current !== runId) return;
          setReturnsById(prev => {
            const next = { ...prev };
            for (const item of chunk) {
              next[item.id] = { status: 'error', returnPct: null, currentPrice: null };
              fetchedIdsRef.current.add(item.id);
            }
            return next;
          });
        }

        if (offset + CHUNK_SIZE < toFetch.length) {
          await sleep(CHUNK_GAP_MS);
        }
      }
    };

    void loadReturns();
  }, [itemIdsKey, items]);

  return { returnsById, reload };
};
