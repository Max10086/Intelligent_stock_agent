import type {
  ThirteenFStakeLookbackDays,
  ThirteenFUserTrackerState,
  ThirteenFWatchlistItem,
} from '../../types/thirteenF.js';
import { resolveInstitutionCik } from '../../utils/thirteenFInstitutionSearch.js';
import { parseStakeLookbackDays } from '../../utils/thirteenFStakeLookback.js';
import { prisma, withPrismaRetry } from '../db.js';

const MAX_WATCHLIST_ITEMS = 80;

const parseJsonArray = (raw: string): unknown[] => {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const normalizeWatchlist = (raw: unknown[]): ThirteenFWatchlistItem[] => {
  const deduped = new Map<string, ThirteenFWatchlistItem>();
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as Partial<ThirteenFWatchlistItem>;
    const cik = resolveInstitutionCik(String(row.cik ?? ''));
    if (!cik || deduped.has(cik)) continue;
    const name = String(row.name ?? cik).trim() || cik;
    deduped.set(cik, {
      cik,
      name,
      addedAt: typeof row.addedAt === 'string' ? row.addedAt : new Date().toISOString(),
      sortOrder: Number.isFinite(Number(row.sortOrder)) ? Number(row.sortOrder) : deduped.size,
    });
    if (deduped.size >= MAX_WATCHLIST_ITEMS) break;
  }
  return [...deduped.values()].sort((a, b) => a.sortOrder - b.sortOrder);
};

const normalizeCikList = (raw: unknown[], watchlistCiks: Set<string>): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of raw) {
    const cik = resolveInstitutionCik(String(entry ?? ''));
    if (!cik || seen.has(cik)) continue;
    if (watchlistCiks.size > 0 && !watchlistCiks.has(cik)) continue;
    seen.add(cik);
    result.push(cik);
  }
  return result;
};

const emptyState = (): ThirteenFUserTrackerState => ({
  watchlist: [],
  starredCiks: [],
  stakeCiks: [],
  stakeLookbackDays: 180,
});

export const getUserThirteenFTrackerState = async (
  userId: string
): Promise<ThirteenFUserTrackerState> => {
  const row = await withPrismaRetry(
    () => prisma.userThirteenFTrackerState.findUnique({ where: { userId } }),
    '13f.userStateGet',
    2
  );

  if (!row) {
    return emptyState();
  }

  const watchlist = normalizeWatchlist(parseJsonArray(row.watchlistJson));
  const watchlistCiks = new Set(watchlist.map(item => item.cik));
  const starredCiks = normalizeCikList(parseJsonArray(row.starredCiksJson), watchlistCiks);
  const stakeCiks = normalizeCikList(parseJsonArray(row.stakeCiksJson), watchlistCiks);

  return {
    watchlist,
    starredCiks,
    stakeCiks,
    stakeLookbackDays: parseStakeLookbackDays(row.stakeLookbackDays),
  };
};

export const saveUserThirteenFTrackerState = async (
  userId: string,
  input: ThirteenFUserTrackerState
): Promise<ThirteenFUserTrackerState> => {
  const watchlist = normalizeWatchlist(input.watchlist);
  const watchlistCiks = new Set(watchlist.map(item => item.cik));
  const starredCiks = normalizeCikList(input.starredCiks, watchlistCiks);
  const stakeCiks = normalizeCikList(input.stakeCiks, watchlistCiks);
  const stakeLookbackDays = parseStakeLookbackDays(input.stakeLookbackDays) as ThirteenFStakeLookbackDays;

  const payload: ThirteenFUserTrackerState = {
    watchlist,
    starredCiks,
    stakeCiks,
    stakeLookbackDays,
  };

  await withPrismaRetry(
    () =>
      prisma.userThirteenFTrackerState.upsert({
        where: { userId },
        create: {
          userId,
          watchlistJson: JSON.stringify(watchlist),
          starredCiksJson: JSON.stringify(starredCiks),
          stakeCiksJson: JSON.stringify(stakeCiks),
          stakeLookbackDays,
        },
        update: {
          watchlistJson: JSON.stringify(watchlist),
          starredCiksJson: JSON.stringify(starredCiks),
          stakeCiksJson: JSON.stringify(stakeCiks),
          stakeLookbackDays,
        },
      }),
    '13f.userStateSave',
    2
  );

  return payload;
};
