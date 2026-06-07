import express from 'express';
import { GoogleGenAI } from '@google/genai';
import { Type } from '@google/genai';
import { ANALYSIS_MODEL } from '../aiModelConfig.js';

const router = express.Router();
const RETRYABLE_ERROR_PATTERN =
  /(fetch failed|sending request|socket hang up|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|503|429)/i;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Initialize Vertex AI client with Application Default Credentials
let aiClient: GoogleGenAI | null = null;

// 修改后的 getAIClient 函数
function getAIClient(): GoogleGenAI {
    if (!aiClient) {
      try {
        // 1. 获取项目 ID 和 地区
        // 如果环境变量没读到，请暂时在这里硬编码你的 Project ID 试一下
        const projectId = process.env.GOOGLE_CLOUD_PROJECT || 'smartstockagent'; 
        const location = process.env.GOOGLE_CLOUD_LOCATION || 'global';
  
        console.log(`🔌 Initializing Vertex AI with Project: ${projectId}, Location: ${location}`);
  
        // 2. 显式传入配置
        aiClient = new GoogleGenAI({ 
          vertexai: true,
          project: projectId,   // <--- 关键修复：必须指定项目 ID
          location: location    // <--- 关键修复：建议指定地区
        });
        
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

// POST /api/vertex-ai/generate-content
// Proxy for Vertex AI generateContent requests
router.post('/generate-content', async (req, res) => {
  try {
    const { model, contents, config } = req.body;

    if (!contents) {
      return res.status(400).json({
        error: 'Missing required field: contents is required'
      });
    }

    const selectedModel = model || ANALYSIS_MODEL;
    const client = getAIClient();

    let response: any;
    let lastError: unknown = null;
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        response = await client.models.generateContent({
          model: selectedModel,
          contents,
          config: config || {},
        });
        lastError = null;
        break;
      } catch (error: any) {
        lastError = error;
        const message = error?.message || String(error);
        const retryable = RETRYABLE_ERROR_PATTERN.test(message);
        if (!retryable || attempt === maxAttempts) {
          throw error;
        }
        const backoffMs = 300 * attempt;
        console.warn(
          `Vertex generateContent transient failure (attempt ${attempt}/${maxAttempts}) for model ${selectedModel}: ${message}`
        );
        await sleep(backoffMs);
      }
    }

    if (!response && lastError) {
      throw lastError;
    }

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
    });
  } catch (error: any) {
    console.error('Error calling Vertex AI:', error);
    
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

export { router as vertexAIRouter };
