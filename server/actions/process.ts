import { prisma } from '../db.js';
import { JobStatus } from '@prisma/client';
import { GoogleGenAI } from '@google/genai';
import { AnalysisState } from '../../types.js';
import { AnalysisService } from '../services/analysis.js';
import { updateJobStatus } from './queue.js';

// --- Configuration ---
const MAX_CONCURRENT_JOBS = 2; 

// Initialize Vertex AI client (singleton)
let aiClient: GoogleGenAI | null = null;

function getAIClient(): GoogleGenAI {
  if (!aiClient) {
    try {
      const projectId = process.env.GOOGLE_CLOUD_PROJECT || 'smartstockagent';
      const location = process.env.GOOGLE_CLOUD_LOCATION || 'us-central1';
      
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
 * 核心修复：Process Next Job (事务级并发控制)
 */
export async function processNextJob(): Promise<void> {
  try {
    // --- 事务开始：原子化检查与锁定 ---
    const jobToProcess = await prisma.$transaction(async (tx) => {
      // 1. 在事务内部检查当前运行数量
      // 这里的 tx 是事务客户端，在这个事务提交前，它看到的状态是一致的
      const activeCount = await tx.analysisJob.count({
        where: { status: 'PROCESSING' }
      });

      if (activeCount >= MAX_CONCURRENT_JOBS) {
        return null; // 超过限制，直接在事务内放弃
      }

      // 2. 查找下一个任务
      const nextJob = await tx.analysisJob.findFirst({
        where: { status: 'PENDING' },
        orderBy: { createdAt: 'asc' },
      });

      if (!nextJob) return null;

      // 3. 立即锁定 (更新状态)
      // 使用 tx.analysisJob.update 确保在同一个事务里完成更新
      const lockedJob = await tx.analysisJob.update({
        where: { id: nextJob.id },
        data: { 
          status: 'PROCESSING',
          startedAt: new Date() 
        }
      });

      return lockedJob;
    });
    // --- 事务结束 ---

    // 如果没抢到任务（队列空或满），直接退出
    if (!jobToProcess) {
        // console.log('📭 Queue check: No job picked (Queue empty or Max concurrency reached)');
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
    console.error('🔥 Critical Error in processNextJob:', error);
    setTimeout(() => processNextJob(), 5000);
  }
}

/**
 * Entry Point
 */
export function startQueueProcessing(): Promise<void> {
  console.log('🚀 Triggering Queue Processing Check...');
  setTimeout(() => {
    processNextJob();
  }, 0);
  return Promise.resolve();
}

export function isQueueProcessing() { return false; }
export function setQueueProcessing() {}