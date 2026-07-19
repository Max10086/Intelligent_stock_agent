
// Backend API client for Vertex AI
// This client calls the backend proxy server which uses Application Default Credentials

import { QUESTION_GENERATION_BATCH_TIMEOUT_MS } from '../utils/questionGenerationBatches.ts';
import { ANSWER_QUESTION_TIMEOUT_MS } from '../utils/parallelTasks.ts';
import { apiFetch } from '../utils/authenticatedFetch.ts';

// In development, Vite proxy handles /api requests
// In production, use VITE_API_BASE_URL environment variable or default to relative path
const API_BASE_URL = 
  typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE_URL
    ? import.meta.env.VITE_API_BASE_URL
    : typeof window !== 'undefined'
    ? '' // Use relative path - Vite proxy will handle /api in dev, or use same origin in production
    : 'http://localhost:3001';

// Response interface matching Vertex AI response structure
interface GenerateContentResponse {
  text: string;
  candidates?: Array<{
    groundingMetadata?: {
      groundingChunks?: Array<{
        web?: {
          uri?: string;
          title?: string;
        };
      }>;
    };
  }>;
  groundingMetadata?: {
    groundingChunks?: Array<{
      web?: {
        uri?: string;
        title?: string;
      };
    }>;
  };
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    reasoningTokens?: number;
    totalTokens?: number;
    estimatedCostUsd?: number;
  };
  provider?: 'vertex' | 'deepseek' | 'doubao';
  model?: string;
}

// Create a proxy object that mimics GoogleGenAI interface
class VertexAIClient {
  models = {
    generateContent: async (params: {
      model?: string;
      provider?: 'vertex' | 'deepseek' | 'doubao';
      step?: string;
      requireGoogleSearch?: boolean;
      searchQueries?: string[];
      contents: any;
      config?: any;
    }): Promise<GenerateContentResponse> => {
      const timeoutMs =
        params.step === 'question_generation' || params.step === 'follow_up_question_generation'
          ? QUESTION_GENERATION_BATCH_TIMEOUT_MS
          : params.step === 'answer_question' || params.step === 'follow_up_answer_question'
            ? ANSWER_QUESTION_TIMEOUT_MS
            : params.step === 'synthesize_conclusion_section' ||
                params.step === 'follow_up_synthesize_conclusion_section' ||
                params.step === 'final_conclusion' ||
                params.step === 'follow_up_final_conclusion'
              ? 240_000
              : 180_000;

      try {
        const requestBody = JSON.stringify({
          ...(params.model ? { model: params.model } : {}),
          ...(params.provider ? { provider: params.provider } : {}),
          ...(params.step ? { step: params.step } : {}),
          ...(params.requireGoogleSearch ? { requireGoogleSearch: true } : {}),
          ...(params.searchQueries?.length ? { searchQueries: params.searchQueries } : {}),
          contents: params.contents,
          config: params.config,
        });

        const callBackend = async () => {
          const controller = new AbortController();
          const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
          try {
            return await apiFetch(`/api/vertex-ai/generate-content`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: requestBody,
              signal: controller.signal,
            });
          } finally {
            window.clearTimeout(timeoutId);
          }
        };

        let response: Response;
        try {
          response = await callBackend();
        } catch (firstError) {
          const isAbort =
            firstError instanceof Error &&
            (firstError.name === 'AbortError' || firstError.message.includes('aborted'));
          if (isAbort) {
            throw firstError;
          }
          // Retry once for transient proxy/startup race.
          await new Promise(resolve => setTimeout(resolve, 300));
          response = await callBackend();
        }

        if (!response.ok) {
          const bodyText = await response.text().catch(() => '');
          const errorData = (() => {
            try {
              return bodyText ? JSON.parse(bodyText) : {};
            } catch {
              return {};
            }
          })();
          throw new Error(
            errorData.error || 
            (bodyText && bodyText.slice(0, 200)) ||
            `HTTP error! status: ${response.status}`
          );
        }

        const data = await response.json();
        
        // Return response in format compatible with @google/genai
        return {
          text: data.text || '',
          candidates: data.candidates || [{
            groundingMetadata: data.groundingMetadata,
          }],
          groundingMetadata: data.groundingMetadata,
          usage: data.usage,
          provider: data.provider,
          model: data.model,
        };
      } catch (error) {
        console.error('Error calling Vertex AI backend:', error);
        if (error instanceof Error) {
          // Check if it's a network error
          if (error.name === 'AbortError' || error.message.includes('aborted')) {
            throw new Error(
              `LLM request timed out after ${Math.round(timeoutMs / 1000)}s (${params.step || 'unknown step'}). Retry or switch model.`
            );
          }
          if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
            throw new Error(
              'Failed to connect to backend server. ' +
              'Please ensure the backend server is running on ' + API_BASE_URL
            );
          }
          throw error;
        }
        throw new Error('Unknown error occurred while calling Vertex AI');
      }
    },
  };
}

// Export a singleton instance
let aiInstance: VertexAIClient | null = null;

function getAIInstance(): VertexAIClient {
  if (!aiInstance) {
    aiInstance = new VertexAIClient();
  }
  return aiInstance;
}

// Export the AI client with the same interface as GoogleGenAI
export const ai = getAIInstance();
