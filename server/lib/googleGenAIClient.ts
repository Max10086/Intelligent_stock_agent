import { GoogleGenAI } from '@google/genai';
import { buildGoogleGenAIClientOptions } from './googleProxyBootstrap.js';

export function createGoogleGenAIClient(): GoogleGenAI {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT || 'smartstockagent';
  const location = process.env.GOOGLE_CLOUD_LOCATION || 'global';

  return new GoogleGenAI(
    buildGoogleGenAIClientOptions({
      vertexai: true,
      project: projectId,
      location,
    })
  );
}
