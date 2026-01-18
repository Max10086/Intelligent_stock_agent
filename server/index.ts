import express from 'express';
import cors from 'cors';
import { vertexAIRouter } from './routes/vertex-ai.js';
import { jobsRouter } from './routes/jobs.js';
import { historyRouter } from './routes/history.js';
import { startQueueWorker } from './worker.js';

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Backend server is running' });
});

// API routes
app.use('/api/vertex-ai', vertexAIRouter);
app.use('/api/jobs', jobsRouter);
app.use('/api/history', historyRouter);

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Backend server running on http://localhost:${PORT}`);
  console.log(`📡 Vertex AI proxy endpoint: http://localhost:${PORT}/api/vertex-ai`);
  console.log(`📋 Jobs API endpoint: http://localhost:${PORT}/api/jobs`);
  console.log(`📚 History API endpoint: http://localhost:${PORT}/api/history`);
  
  // Start the queue worker
  startQueueWorker();
  console.log(`⚙️  Queue worker started`);
});
