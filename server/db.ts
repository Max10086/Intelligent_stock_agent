import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function isTransactionPoolUrl(url: URL): boolean {
  return url.port === '6543' || process.env.SUPABASE_POOL_MODE === 'transaction';
}

function resolveRawDatabaseUrl(): string | undefined {
  const forceTransaction = process.env.SUPABASE_POOL_MODE === 'transaction';
  const forceSession = process.env.SUPABASE_POOL_MODE === 'session';

  if (forceTransaction) return process.env.DATABASE_URL;
  if (forceSession) return process.env.DIRECT_URL || process.env.DATABASE_URL;

  // Local long-running dev server: Session pooler (5432) handles concurrent Prisma queries.
  // Cloud Run / serverless: set SUPABASE_POOL_MODE=transaction and use port 6543 in DATABASE_URL.
  if (process.env.NODE_ENV !== 'production') {
    return process.env.DIRECT_URL || process.env.DATABASE_URL;
  }

  return process.env.DATABASE_URL;
}

function buildDatabaseUrl(rawUrl: string | undefined): string | undefined {
  if (!rawUrl) return rawUrl;
  try {
    const parsed = new URL(rawUrl);
    if (isTransactionPoolUrl(parsed)) {
      parsed.searchParams.set('pgbouncer', 'true');
      parsed.searchParams.set('connection_limit', process.env.PRISMA_CONNECTION_LIMIT || '1');
      parsed.searchParams.set('pool_timeout', process.env.PRISMA_POOL_TIMEOUT || '20');
      parsed.searchParams.set('statement_cache_size', '0');
    } else {
      parsed.searchParams.set('connect_timeout', process.env.PRISMA_CONNECT_TIMEOUT || '30');
      // Keep dev pool small to avoid exhausting Supabase session limits after HMR restarts.
      const defaultLimit = process.env.NODE_ENV !== 'production' ? '1' : '5';
      if (!parsed.searchParams.has('connection_limit')) {
        parsed.searchParams.set('connection_limit', process.env.PRISMA_CONNECTION_LIMIT || defaultLimit);
      }
      if (!parsed.searchParams.has('pool_timeout')) {
        parsed.searchParams.set('pool_timeout', process.env.PRISMA_POOL_TIMEOUT || (process.env.NODE_ENV !== 'production' ? '10' : '20'));
      }
    }
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

const databaseUrl = buildDatabaseUrl(resolveRawDatabaseUrl());

type PrismaGlobal = typeof globalForPrisma & { prismaUrl?: string };
const prismaGlobal = globalForPrisma as PrismaGlobal;

function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    ...(databaseUrl
      ? {
          datasources: {
            db: { url: databaseUrl },
          },
        }
      : {}),
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });
}

export function getPrisma(): PrismaClient {
  if (prismaGlobal.prismaUrl && prismaGlobal.prismaUrl !== databaseUrl && prismaGlobal.prisma) {
    void prismaGlobal.prisma.$disconnect();
    prismaGlobal.prisma = undefined;
  }

  if (!prismaGlobal.prisma) {
    prismaGlobal.prisma = createPrismaClient();
    prismaGlobal.prismaUrl = databaseUrl;
  }

  return prismaGlobal.prisma;
}

export async function resetPrismaConnection(): Promise<void> {
  if (prismaGlobal.prisma) {
    try {
      await prismaGlobal.prisma.$disconnect();
    } catch {
      // best effort
    }
    prismaGlobal.prisma = undefined;
  }
}

/** Proxy so callers always use the current client after pool reset. */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = getPrisma();
    const value = Reflect.get(client, prop, client);
    if (typeof value === 'function') {
      return (value as (...args: unknown[]) => unknown).bind(client);
    }
    return value;
  },
});

const POOL_RESET_PATTERN = /connection pool|P2024|ECHECKOUTTIMEOUT|too many clients/i;

const RETRYABLE_DB_PATTERN =
  /ECHECKOUTTIMEOUT|P1017|P1001|P1008|P2024|connection|pool|closed|timeout/i;

export async function withPrismaRetry<T>(
  operation: () => Promise<T>,
  label = 'db',
  maxAttempts = 3
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      const retryable = RETRYABLE_DB_PATTERN.test(message);
      if (!retryable || attempt === maxAttempts) {
        throw error;
      }
      console.warn(`[Prisma] ${label} failed (attempt ${attempt}/${maxAttempts}): ${message}`);
      if (POOL_RESET_PATTERN.test(message)) {
        await resetPrismaConnection();
      }
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }
  }
  throw lastError;
}

export async function checkDatabaseHealth(): Promise<{
  ok: boolean;
  latencyMs: number;
  poolMode: 'session' | 'transaction' | 'unknown';
  error?: string;
}> {
  const startedAt = Date.now();
  const poolMode = databaseUrl?.includes(':6543')
    ? 'transaction'
    : databaseUrl?.includes(':5432')
      ? 'session'
      : 'unknown';
  try {
    await withPrismaRetry(() => prisma.$queryRaw`SELECT 1`, 'health-check', 2);
    return { ok: true, latencyMs: Date.now() - startedAt, poolMode };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      poolMode,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function disconnectDatabase(): Promise<void> {
  await resetPrismaConnection();
}
