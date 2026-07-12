import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { vertexAIRouter } from './routes/vertex-ai.js';
import { jobsRouter } from './routes/jobs.js';
import { historyRouter } from './routes/history.js';
import { compareRouter } from './routes/compare.js';
import { returnTrackingRouter } from './routes/returnTracking.js';
import { authRouter } from './routes/auth.js';
import { billingRouter, handlePayPalWebhook } from './routes/billing.js';
import { usageRouter } from './routes/usage.js';
import { analyticsRouter } from './routes/analytics.js';
import { adminRouter } from './routes/admin.js';
import { feedbackRouter } from './routes/feedback.js';
import { requireAuth } from './middleware/auth.js';
import { startQueueWorker, stopQueueWorker } from './worker.js';
import { resetStalledJobs } from './actions/process.js';
import { checkDatabaseHealth, disconnectDatabase } from './db.js';
import { getRuntimeModelConfig } from './aiModelConfig.js';
import { getPublicSupabaseConfig, getSupabaseEnvStatus } from './lib/publicEnv.js';
import { getPayPalPublicConfig } from './services/paypalService.js';

// --- ESM 路径兼容处理 ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);
const HOST = '0.0.0.0';

// Middleware
app.use(
  cors({
    origin: true,
    credentials: true,
  })
);
// PayPal webhooks need the raw body (must register before express.json)
app.post(
  '/api/billing/paypal/webhook',
  express.raw({ type: 'application/json' }),
  (req, res) => {
    void handlePayPalWebhook(req, res);
  }
);

// Full analysis reports (multi-company Q&A) can exceed Express's default 100kb limit
app.use(express.json({ limit: '10mb' }));

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', message: 'Backend server is running' });
});

app.get('/health/db', async (_req, res) => {
  const result = await checkDatabaseHealth();
  res.status(result.ok ? 200 : 503).json({
    status: result.ok ? 'ok' : 'error',
    latencyMs: result.latencyMs,
    poolMode: result.poolMode,
    ...(result.error ? { error: result.error } : {}),
  });
});

/** Public runtime config for the browser (Cloud Run env vars — not baked into Vite build). */
app.get('/api/public-config', (_req, res) => {
  const { supabaseUrl, supabaseAnonKey } = getPublicSupabaseConfig();
  res.set('Cache-Control', 'no-store');
  res.status(200).json({
    supabaseUrl,
    supabaseAnonKey,
    authConfigured: Boolean(supabaseUrl && supabaseAnonKey),
    paypal: getPayPalPublicConfig(),
  });
});

app.get('/health/auth', (_req, res) => {
  const publicConfig = getPublicSupabaseConfig();
  const envStatus = getSupabaseEnvStatus();
  let urlHost: string | null = null;
  try {
    urlHost = publicConfig.supabaseUrl ? new URL(publicConfig.supabaseUrl).host : null;
  } catch {
    urlHost = null;
  }
  res.status(200).json({
    publicAuthConfigured: Boolean(publicConfig.supabaseUrl && publicConfig.supabaseAnonKey),
    serverAuthConfigured: envStatus.serverAuthReady,
    env: {
      hasSupabaseUrl: envStatus.hasUrl,
      hasPublishableKey: envStatus.hasAnonKey,
      hasServiceRoleKey: envStatus.hasServiceRoleKey,
      usingServiceRoleForApiAuth: envStatus.hasServiceRoleKey,
      usingPublishableKeyFallback: !envStatus.hasServiceRoleKey && envStatus.hasAnonKey,
    },
    supabaseHost: urlHost,
  });
});

// Runtime model info (for frontend visibility/debugging)
app.get('/api/model', requireAuth, (req, res) => {
  const cfg = getRuntimeModelConfig();
  res.status(200).json({
    model: `${cfg.analysis.provider}:${cfg.analysis.model}`,
    analysis: cfg.analysis,
    search: cfg.search,
    searchMode: cfg.searchMode,
    questions: cfg.questions,
    qna: cfg.qna,
  });
});

app.get('/api/search-ticker', requireAuth, async (req, res) => {
  try {
    const query = typeof req.query.query === 'string' ? req.query.query.trim() : '';
    if (!query) {
      return res.status(400).json({ error: 'query is required' });
    }
    const match = await searchTicker(query);
    res.status(200).json({ match: match || null });
  } catch (error: any) {
    res.status(500).json({
      error: 'Failed to search ticker',
      details: process.env.NODE_ENV === 'development' ? error?.message : undefined,
    });
  }
});

// --- 1. API 路由 ---
app.use('/api/auth', authRouter);
app.use('/api/billing', billingRouter);
app.use('/api/usage', usageRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/admin', adminRouter);
app.use('/api/feedback', feedbackRouter);
app.use('/api/vertex-ai', vertexAIRouter);
app.use('/api/jobs', requireAuth, jobsRouter);
app.use('/api/history', historyRouter);
app.use('/api/compare', compareRouter);
app.use('/api/return-tracking', returnTrackingRouter);

// --- 2. 托管前端静态文件 ---
const distPath = path.join(__dirname, '../dist');

// 静态资源托管 (js, css, images)
app.use(express.static(distPath));

// --- 3. 【关键新增】SPA 回退路由 (Catch-All) ---
// 任何不匹配 API 的请求，都返回 index.html，交给 React Router 处理
app.get('*', (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

// Start server
const server = app.listen(PORT, HOST, async () => {
  console.log(`🚀 Backend server running on http://${HOST}:${PORT}`);
  console.log(`📂 Serving static files from: ${distPath}`);
  const envStatus = getSupabaseEnvStatus();
  console.log(
    `🔐 Supabase public auth: ${envStatus.hasUrl && envStatus.hasAnonKey ? 'configured' : 'NOT configured'} (browser via /api/public-config)`
  );
  console.log(
    `🔐 Supabase server auth: ${envStatus.serverAuthReady ? 'configured' : 'NOT configured'} ` +
      `(url=${envStatus.hasUrl}, serviceRole=${envStatus.hasServiceRoleKey}, publishable=${envStatus.hasAnonKey})`
  );
  if (envStatus.serverAuthReady && !envStatus.hasServiceRoleKey) {
    console.warn('⚠️  SUPABASE_SERVICE_ROLE_KEY not set — using publishable/anon key for API JWT verification.');
  }

  // Always recover zombie PROCESSING rows after restart (dev hot-reload, crash, etc.)
  await resetStalledJobs();

  const enableQueueWorker =
    process.env.DISABLE_QUEUE_WORKER !== 'true' &&
    (process.env.NODE_ENV === 'production' || process.env.ENABLE_QUEUE_WORKER === 'true');

  if (enableQueueWorker) {
    try {
      startQueueWorker().catch(err => {
        console.error('❌ Failed to start queue worker asynchronously:', err);
      });
      console.log(`⚙️  Queue worker initialization triggered`);
    } catch (error) {
      console.error('❌ Synchronous error starting queue worker:', error);
    }
  } else {
    console.log('⏸️  Queue worker disabled (set ENABLE_QUEUE_WORKER=true to enable in dev)');
  }
});

async function shutdown(signal: string) {
  console.log(`${signal} received: shutting down...`);
  stopQueueWorker();
  server.close(() => {
    console.log('HTTP server closed');
  });
  await disconnectDatabase();
  process.exit(0);
}

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});
process.on('SIGINT', () => {
  void shutdown('SIGINT');
});