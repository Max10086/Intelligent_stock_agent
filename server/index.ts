import express from 'express';
import cors from 'cors';
import { vertexAIRouter } from './routes/vertex-ai.js';
import { jobsRouter } from './routes/jobs.js';
import { historyRouter } from './routes/history.js';
import { startQueueWorker } from './worker.js';

const app = express();
// Cloud Run 会传入 PORT=8080，必须解析为数字
const PORT = parseInt(process.env.PORT || '3001', 10);
// 关键：必须显式绑定到 0.0.0.0，不能是 localhost
const HOST = '0.0.0.0';

// Middleware
app.use(cors());
app.use(express.json());

// Health check endpoint (Cloud Run 用这个来检查服务是否存活)
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', message: 'Backend server is running' });
});

// API routes
app.use('/api/vertex-ai', vertexAIRouter);
app.use('/api/jobs', jobsRouter);
app.use('/api/history', historyRouter);

// Start server
const server = app.listen(PORT, HOST, () => {
  console.log(`🚀 Backend server running on http://${HOST}:${PORT}`);
  console.log(`📡 Vertex AI proxy endpoint: http://${HOST}:${PORT}/api/vertex-ai`);
  console.log(`📋 Jobs API endpoint: http://${HOST}:${PORT}/api/jobs`);
  console.log(`📚 History API endpoint: http://${HOST}:${PORT}/api/history`);
  
  // Start the queue worker
  // 建议：加一个 try-catch，防止 Worker 启动失败导致整个 Server 挂掉
  try {
    startQueueWorker().catch(err => {
      console.error('❌ Failed to start queue worker asynchronously:', err);
    });
    console.log(`⚙️  Queue worker initialization triggered`);
  } catch (error) {
    console.error('❌ Synchronous error starting queue worker:', error);
  }
});

// 优雅关闭处理 (防止 Docker 强制杀进程导致数据丢失)
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
  });
});