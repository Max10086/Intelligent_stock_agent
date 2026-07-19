import { prisma, withPrismaRetry } from '../db.js';
import {
  classifyConclusion,
  type ConclusionCategory,
} from '../../utils/conclusionCategory.js';

export interface AnalysisCatalogItem {
  id: string;
  ticker: string;
  companyName: string | null;
  overallConclusion: string | null;
  currentPrice: string | null;
  currency: string | null;
  exchange: string | null;
  completedAt: string | null;
  category: ConclusionCategory;
}

type CatalogRawRow = {
  id: string;
  ticker: string;
  completedAt: Date | null;
  overall_conclusion: string | null;
  company_name: string | null;
  current_price: string | null;
  currency: string | null;
  exchange: string | null;
};

const CATALOG_WHERE_SQL = `
  "userId" = $1
  AND status = 'COMPLETED'
  AND "listSummary" IS NOT NULL
  AND COALESCE(
    NULLIF(TRIM("listSummary"::jsonb #>> '{focusCompany,finalConclusion,overall_conclusion}'), ''),
    ''
  ) <> ''
`;

const CATALOG_SELECT_SQL = `
  SELECT
    id,
    ticker,
    "completedAt" AS "completedAt",
    NULLIF(TRIM("listSummary"::jsonb #>> '{focusCompany,finalConclusion,overall_conclusion}'), '') AS overall_conclusion,
    NULLIF(TRIM("listSummary"::jsonb #>> '{focusCompany,profile,name}'), '') AS company_name,
    NULLIF(TRIM("listSummary"::jsonb #>> '{focusCompany,profile,currentPrice}'), '') AS current_price,
    NULLIF(TRIM("listSummary"::jsonb #>> '{focusCompany,profile,currency}'), '') AS currency,
    NULLIF(TRIM("listSummary"::jsonb #>> '{focusCompany,profile,exchange}'), '') AS exchange
  FROM "AnalysisJob"
  WHERE ${CATALOG_WHERE_SQL}
  ORDER BY "completedAt" DESC NULLS LAST
`;

function mapRow(row: CatalogRawRow): AnalysisCatalogItem {
  return {
    id: row.id,
    ticker: row.ticker,
    companyName: row.company_name,
    overallConclusion: row.overall_conclusion,
    currentPrice: row.current_price,
    currency: row.currency,
    exchange: row.exchange,
    completedAt: row.completedAt?.toISOString() ?? null,
    category: classifyConclusion(row.overall_conclusion),
  };
}

export async function listAnalysisCatalog(
  userId: string,
  options?: { limit?: number; offset?: number; includeTotal?: boolean }
): Promise<{
  items: AnalysisCatalogItem[];
  total?: number;
  hasMore: boolean;
  limit: number;
  offset: number;
}> {
  const limit = Math.min(Math.max(options?.limit ?? 60, 1), 100);
  const offset = Math.max(options?.offset ?? 0, 0);
  const includeTotal = options?.includeTotal ?? false;
  const take = includeTotal ? limit : limit + 1;

  const rows = await withPrismaRetry(
    () =>
      prisma.$queryRawUnsafe<CatalogRawRow[]>(
        `${CATALOG_SELECT_SQL} LIMIT $2 OFFSET $3`,
        userId,
        take,
        offset
      ),
    'catalog.list',
    3
  );

  const hasMoreWithoutCount = !includeTotal && rows.length > limit;
  const pageRows = hasMoreWithoutCount ? rows.slice(0, limit) : rows;
  const items = pageRows.map(mapRow);

  let total: number | undefined;
  let hasMore: boolean;

  if (includeTotal) {
    const countRows = await withPrismaRetry(
      () =>
        prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
          `SELECT COUNT(*)::bigint AS count FROM "AnalysisJob" WHERE ${CATALOG_WHERE_SQL}`,
          userId
        ),
      'catalog.count',
      2
    );
    total = Number(countRows[0]?.count ?? 0);
    hasMore = offset + pageRows.length < total;
  } else {
    hasMore = hasMoreWithoutCount;
  }

  return {
    items,
    total,
    hasMore,
    limit,
    offset,
  };
}
