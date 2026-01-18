import { prisma } from '../db.js';
import { JobStatus } from '@prisma/client';
import { GoogleGenAI } from '@google/genai';
import { AnalysisState } from '../../types.js';
import { AnalysisService } from '../services/analysis.js';
import { updateJobStatus } from './queue.js';

// --- Configuration ---
// 最大并发任务数：限制同时运行的分析任务数量，防止 API 超限或内存崩溃
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

/**
 * 核心修复：重置僵尸任务
 * 在服务器启动时调用，防止上次崩溃导致任务卡在 PROCESSING
 */
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
      logs: [logMessage], // The updateJobStatus implementation should append this
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
  
  // Progress adapter
  const progressCallback = async (progress: number, step: string, log?: string) => {
    const message = log || step;
    if (jobId) await updateJobProgress(jobId, progress, message);
    if (onProgress) await onProgress(message);
  };

  return await analysisService.runFullAnalysis(query, language as 'en' | 'cn', progressCallback);
}

/**
 * 核心修复：Process Next Job (无锁设计 + 并发控制)
 * 依靠数据库状态来保证并发安全
 */
export async function processNextJob(): Promise<void> {
  try {
    // 1. Check Concurrency Limit (新增逻辑)
    const activeCount = await prisma.analysisJob.count({
      where: { status: 'PROCESSING' }
    });

    if (activeCount >= MAX_CONCURRENT_JOBS) {
      // 如果当前正在跑的任务达到上限，暂停领取新任务
      // console.log(`⚠️ Max concurrency reached (${activeCount}/${MAX_CONCURRENT_JOBS}). Waiting for slots.`);
      return;
    }

    // 2. Debug: Check pending count
    const pendingCount = await prisma.analysisJob.count({ where: { status: 'PENDING' } });
    
    if (pendingCount === 0) {
      // console.log('📭 Queue empty, stopping worker loop.');
      return;
    }

    console.log(`[Debug] Queue check. Pending: ${pendingCount}, Active: ${activeCount}/${MAX_CONCURRENT_JOBS}`);

    // 3. Find First Pending (FIFO)
    const nextJob = await prisma.analysisJob.findFirst({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
    });

    if (!nextJob) return; // Double check

    // 4. ATOMIC LOCK: Try to update status to PROCESSING
    // This prevents other workers (if any) from grabbing the same job
    const jobId = nextJob.id;
    
    // Optimistic locking attempt
    try {
        await updateJobStatus(jobId, {
            status: 'PROCESSING',
            startedAt: new Date(),
        });
    } catch (e) {
        console.log(`[Concurrency] Job ${jobId} might have been picked by another process, skipping.`);
        // Immediately try again to pick another job if this one failed
        return processNextJob(); 
    }

    console.log(`▶️ Processing job ${jobId} (${nextJob.ticker})`);
    
    try {
      // Execute Logic
      await updateJobProgress(jobId, 5, 'Initializing Analysis...');
      
      const result = await runDeepResearch(
        nextJob.ticker,
        nextJob.query,
        nextJob.language,
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
      // 5. Recursive Loop: Process next job IMMEDIATELY
      // 当一个任务结束（无论成功失败），释放了一个槽位，立即尝试启动下一个
      setTimeout(() => processNextJob(), 100); 
    }

  } catch (error) {
    console.error('🔥 Critical Error in processNextJob:', error);
    // Retry after delay to avoid tight loop on db error
    setTimeout(() => processNextJob(), 5000);
  }
}

/**
 * Entry Point
 */
export function startQueueProcessing(): Promise<void> {
  // Fire and forget
  console.log('🚀 Triggering Queue Processing Check...');
  
  // Start the chain. We don't await this because we want to return the HTTP response immediately.
  setTimeout(() => {
    processNextJob();
  }, 0);

  return Promise.resolve();
}

// 兼容旧接口（如果其他文件还在引用）
export function isQueueProcessing() { return false; }
export function setQueueProcessing() {}