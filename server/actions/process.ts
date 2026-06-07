import { prisma } from '../db.js';
import { JobStatus } from '@prisma/client';
import { GoogleGenAI } from '@google/genai';
import { AnalysisState } from '../../types.js';
import { AnalysisService } from '../services/analysis.js';
import { updateJobStatus } from './queue.js';

// --- Configuration ---
const MAX_CONCURRENT_JOBS = 2;
let consecutiveErrors = 0;

// Initialize Vertex AI client (singleton)
let aiClient: GoogleGenAI | null = null;

function getAIClient(): GoogleGenAI {
  if (!aiClient) {
    try {
      const projectId = process.env.GOOGLE_CLOUD_PROJECT || 'smartstockagent';
      const location = process.env.GOOGLE_CLOUD_LOCATION || 'global';
      
      aiClient = new GoogleGenAI({
        vertexai: true,
        project: projectId,
        location: location,
      });
      console.log('✅ Process: Vertex AI client initialized');
    } catch (error) {
      console.error('❌ Process: Failed to initialize Vertex AI client:', error);
      throw error;
    }
  }
  return aiClient;
}

export async function resetStalledJobs() {
  try {
    const { count } = await prisma.analysisJob.updateMany({
      where: { status: 'PROCESSING' },
      data: { status: 'PENDING', error: 'System restart: Job reset' }
    });
    if (count > 0) {
      console.log(`🔄 [Recovery] Reset ${count} stalled jobs to PENDING`);
    }
  } catch (error) {
    console.error('Failed to reset stalled jobs:', error);
  }
}

async function updateJobProgress(jobId: string, percent: number, message: string): Promise<void> {
  const logMessage = `[Job ${jobId}] ${percent}% - ${message}`;
  console.log(logMessage);
  try {
    await updateJobStatus(jobId, {
      progress: percent,
      currentStep: message,
      logs: [logMessage],
    });
  } catch (error) {
    console.error(`Error updating job progress for ${jobId}:`, error);
  }
}

export async function runDeepResearch(
  ticker: string,
  query: string,
  language: string = 'en',
  jobId?: string,
  onProgress?: (message: string) => void | Promise<void>
): Promise<AnalysisState> {
  const ai = getAIClient();
  const analysisService = new AnalysisService(ai);
  
  const progressCallback = async (progress: number, step: string, log?: string) => {
    const message = log || step;
    if (jobId) await updateJobProgress(jobId, progress, message);
    if (onProgress) await onProgress(message);
  };

  return await analysisService.runFullAnalysis(query, language as 'en' | 'cn', progressCallback);
}

/**
 * Claim next job without $transaction (Supabase pooler port 6543 rejects interactive transactions).
 */
async function claimNextJob() {
  const activeCount = await prisma.analysisJob.count({
    where: { status: 'PROCESSING' },
  });

  if (activeCount >= MAX_CONCURRENT_JOBS) {
    return null;
  }

  const nextJob = await prisma.analysisJob.findFirst({
    where: { status: 'PENDING' },
    orderBy: { createdAt: 'asc' },
  });

  if (!nextJob) {
    return null;
  }

  const claimed = await prisma.analysisJob.updateMany({
    where: { id: nextJob.id, status: 'PENDING' },
    data: {
      status: 'PROCESSING',
      startedAt: new Date(),
    },
  });

  return claimed.count > 0 ? nextJob : null;
}

export async function processNextJob(): Promise<void> {
  try {
    const jobToProcess = await claimNextJob();

    if (!jobToProcess) {
      consecutiveErrors = 0;
      return;
    }

    // 拿到任务了，开始执行 (Execution)
    // 注意：这里的代码已经在事务之外，因为 AI 分析耗时很长，不能卡在数据库事务里
    const jobId = jobToProcess.id;
    console.log(`▶️ Processing job ${jobId} (${jobToProcess.ticker})`);
    
    try {
      await updateJobProgress(jobId, 5, 'Initializing Analysis...');
      
      const result = await runDeepResearch(
        jobToProcess.ticker,
        jobToProcess.query,
        jobToProcess.language,
        jobId
      );

      await updateJobStatus(jobId, {
        status: 'COMPLETED',
        completedAt: new Date(),
        result: result,
        error: null,
        progress: 100,
        currentStep: 'Analysis Complete'
      });

      console.log(`✅ Job ${jobId} Completed.`);

    } catch (error: any) {
      const errorMessage = error?.message || String(error);
      console.error(`❌ Job ${jobId} Failed:`, errorMessage);
      
      await updateJobStatus(jobId, {
        status: 'FAILED',
        completedAt: new Date(),
        error: errorMessage,
        progress: 0,
        currentStep: 'Failed'
      });
    } finally {
      // 递归循环：任务结束后，立即尝试启动下一个
      setTimeout(() => processNextJob(), 100); 
    }

  } catch (error) {
    consecutiveErrors += 1;
    const retryMs = Math.min(60000, 5000 * consecutiveErrors);
    if (consecutiveErrors <= 3 || consecutiveErrors % 10 === 0) {
      console.error('🔥 Error in processNextJob (will retry):', error);
    }
    setTimeout(() => processNextJob(), retryMs);
  }
}

/**
 * Entry Point
 */
export function startQueueProcessing(): Promise<void> {
  setTimeout(() => {
    processNextJob();
  }, 0);
  return Promise.resolve();
}

export function isQueueProcessing() { return false; }
export function setQueueProcessing() {}