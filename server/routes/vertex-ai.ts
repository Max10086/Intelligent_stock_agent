import express from 'express';
import { GoogleGenAI } from '@google/genai';
import { Type } from '@google/genai';

const router = express.Router();

// Initialize Vertex AI client with Application Default Credentials
let aiClient: GoogleGenAI | null = null;

// 修改后的 getAIClient 函数
function getAIClient(): GoogleGenAI {
    if (!aiClient) {
      try {
        // 1. 获取项目 ID 和 地区
        // 如果环境变量没读到，请暂时在这里硬编码你的 Project ID 试一下
        const projectId = process.env.GOOGLE_CLOUD_PROJECT || 'smartstockagent'; 
        const location = process.env.GOOGLE_CLOUD_LOCATION || 'us-central1';
  
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

    if (!model || !contents) {
      return res.status(400).json({
        error: 'Missing required fields: model and contents are required'
      });
    }

    const client = getAIClient();
    const response = await client.models.generateContent({
      model: model || 'gemini-2.5-flash',
      contents,
      config: config || {},
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
