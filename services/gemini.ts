
// Backend API client for Vertex AI
// This client calls the backend proxy server which uses Application Default Credentials

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
}

// Create a proxy object that mimics GoogleGenAI interface
class VertexAIClient {
  models = {
    generateContent: async (params: {
      model: string;
      contents: any;
      config?: any;
    }): Promise<GenerateContentResponse> => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/vertex-ai/generate-content`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: params.model,
            contents: params.contents,
            config: params.config,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(
            errorData.error || 
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
        };
      } catch (error) {
        console.error('Error calling Vertex AI backend:', error);
        if (error instanceof Error) {
          // Check if it's a network error
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
