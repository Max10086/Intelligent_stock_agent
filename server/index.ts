import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { vertexAIRouter } from './routes/vertex-ai.js';
import { jobsRouter } from './routes/jobs.js';
import { historyRouter } from './routes/history.js';
import { startQueueWorker } from './worker.js';

// --- ESM 路径兼容处理 ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);
const HOST = '0.0.0.0';

// Middleware
app.use(cors());
// Full analysis reports (multi-company Q&A) can exceed Express's default 100kb limit
app.use(express.json({ limit: '10mb' }));

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', message: 'Backend server is running' });
});

// --- 1. API 路由 (保持不变) ---
app.use('/api/vertex-ai', vertexAIRouter);
app.use('/api/jobs', jobsRouter);
app.use('/api/history', historyRouter);

// --- 2. 【关键新增】托管前端静态文件 ---
// 指向构建好的 dist 目录 (假设 server 和 dist 都在项目根目录下)
// 在 Docker 中结构是 /app/server 和 /app/dist，所以从 server 目录往上跳一级找 dist
const distPath = path.join(__dirname, '../dist');

// 静态资源托管 (js, css, images)
app.use(express.static(distPath));

// --- 3. 【关键新增】SPA 回退路由 (Catch-All) ---
// 任何不匹配 API 的请求，都返回 index.html，交给 React Router 处理
app.get('*', (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

// Start server
const server = app.listen(PORT, HOST, () => {
  console.log(`🚀 Backend server running on http://${HOST}:${PORT}`);
  console.log(`📂 Serving static files from: ${distPath}`);
  
  // Start queue worker
  try {
    startQueueWorker().catch(err => {
      console.error('❌ Failed to start queue worker asynchronously:', err);
    });
    console.log(`⚙️  Queue worker initialization triggered`);
  } catch (error) {
    console.error('❌ Synchronous error starting queue worker:', error);
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
  });
});