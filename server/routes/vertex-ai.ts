import express from 'express';
import { GoogleGenAI } from '@google/genai';
import { getRuntimeModelConfig, setRuntimeModelConfig } from '../aiModelConfig.js';
import { ModelClient, type ModelCallStep } from '../services/modelClient.js';
import { requireAuth, requireAuthLite } from '../middleware/auth.js';
import { createGoogleGenAIClient } from '../lib/googleGenAIClient.js';

const router = express.Router();

// Initialize Vertex AI client with Application Default Credentials
let aiClient: GoogleGenAI | null = null;
let modelClient: ModelClient | null = null;

// 修改后的 getAIClient 函数
function getAIClient(): GoogleGenAI {
    if (!aiClient) {
      try {
        const projectId = process.env.GOOGLE_CLOUD_PROJECT || 'smartstockagent';
        const location = process.env.GOOGLE_CLOUD_LOCATION || 'global';

        console.log(`🔌 Initializing Vertex AI with Project: ${projectId}, Location: ${location}`);

        aiClient = createGoogleGenAIClient();

        console.log('✅ Vertex AI client initialized with Application Default Credentials');
      } catch (error) {
        console.error('❌ Failed to initialize Vertex AI client:', error);
        throw new Error(
          'Failed to initialize Vertex AI. ' +
          'Please ensure Application Default Credentials are configured: ' +
          'gcloud auth application-default login'
        );
      }
    }
    return aiClient;
  }

function getModelClient(): ModelClient {
  if (!modelClient) {
    modelClient = new ModelClient(getAIClient());
  }
  return modelClient;
}

// POST /api/vertex-ai/generate-content
// Proxy for Vertex AI generateContent requests
router.post('/generate-content', requireAuth, async (req, res) => {
  try {
    const { model, provider, contents, config, step, requireGoogleSearch, searchQueries } = req.body;

    if (!contents) {
      return res.status(400).json({
        error: 'Missing required field: contents is required'
      });
    }

    const normalizedSearchQueries = Array.isArray(searchQueries)
      ? searchQueries.filter((q: unknown) => typeof q === 'string' && q.trim()).map((q: string) => q.trim())
      : undefined;

    const response = await getModelClient().generateContent({
      step: ((typeof step === 'string' && step) || 'custom') as ModelCallStep,
      provider,
      model,
      contents,
      config: config || {},
      requireGoogleSearch: Boolean(requireGoogleSearch),
      searchQueries: normalizedSearchQueries?.length ? normalizedSearchQueries : undefined,
    });

    // Return the response in a format compatible with the frontend
    // Ensure candidates array structure matches what frontend expects
    const candidates = response.candidates || [];
    const firstCandidate = candidates[0];
    
    res.json({
      text: response.text,
      candidates: candidates.map((candidate: any) => ({
        ...candidate,
        groundingMetadata: candidate.groundingMetadata || firstCandidate?.groundingMetadata,
      })),
      // Also include groundingMetadata at top level for compatibility
      groundingMetadata: firstCandidate?.groundingMetadata,
      usage: response.usage,
      provider: response.provider,
      model: response.model,
    });
  } catch (error: any) {
    console.error('Error calling LLM provider:', error);
    
    // Provide helpful error messages
    let errorMessage = 'Failed to generate content';
    let statusCode = 500;

    if (error.message?.includes('authentication') || error.message?.includes('credentials')) {
      errorMessage = 'Authentication failed. Please ensure Application Default Credentials are configured.';
      statusCode = 401;
    } else if (error.message?.includes('permission')) {
      errorMessage = 'Permission denied. Please check IAM permissions for Vertex AI.';
      statusCode = 403;
    } else if (error.message) {
      errorMessage = error.message;
    }

    res.status(statusCode).json({
      error: errorMessage,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

router.get('/model-config', requireAuthLite, (req, res) => {
  res.status(200).json(getRuntimeModelConfig());
});

router.post('/model-config', requireAuthLite, (req, res) => {
  try {
    const { analysis, search, questions, qna, searchMode } = req.body || {};
    const updated = setRuntimeModelConfig({
      analysis: {
        provider: analysis?.provider,
        model: analysis?.model,
      },
      search: {
        provider: search?.provider,
        model: search?.model,
      },
      searchMode: searchMode === 'advanced' || searchMode === 'standard' ? searchMode : undefined,
      questions: {
        focus: typeof questions?.focus === 'number' ? questions.focus : undefined,
        candidate: typeof questions?.candidate === 'number' ? questions.candidate : undefined,
      },
      qna: {
        thinkingEnabled:
          typeof qna?.thinkingEnabled === 'boolean' ? qna.thinkingEnabled : undefined,
      },
    });
    res.status(200).json(updated);
  } catch (error: any) {
    res.status(400).json({ error: error?.message || 'Failed to update model config' });
  }
});

export { router as vertexAIRouter };
