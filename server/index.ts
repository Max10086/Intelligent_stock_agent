import express from 'express';
import cors from 'cors';
import { vertexAIRouter } from './routes/vertex-ai.js';

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

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Backend server running on http://localhost:${PORT}`);
  console.log(`📡 Vertex AI proxy endpoint: http://localhost:${PORT}/api/vertex-ai`);
});
