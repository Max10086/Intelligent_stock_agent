/**
 * Queue Worker
 * 
 * Orchestrates the background processing of analysis jobs.
 * Now includes recovery mechanisms for server restarts.
 */

// 引入新增加的 resetStalledJobs
import { startQueueProcessing, resetStalledJobs } from './actions/process.js';

let workerInterval: NodeJS.Timeout | null = null;

/**
 * Start the queue worker
 * 1. Resets any stalled jobs from previous crashes
 * 2. Starts the processing loop
 * 3. Sets up a watchdog interval to ensure processing stays alive
 */
export async function startQueueWorker(): Promise<void> {
  if (workerInterval) {
    console.log('⚠️  Worker already running');
    return;
  }

  console.log('🚀 Booting up Queue Worker...');
  
  try {
    // 1. 核心修复：复活僵尸任务
    // 如果上次服务器崩溃时有任务正在 PROCESSING，现在把它们重置为 PENDING
    await resetStalledJobs();
    
    // 2. 立即触发一次处理循环
    startQueueProcessing();
    
    // 3. 设置“看门狗”定时器 (Watchdog)
    // 每 10 秒检查一次。如果递归循环意外终止，这里会重新点火。
    // 由于 processNextJob 内部有数据库锁机制，这里重复触发是安全的。
    workerInterval = setInterval(() => {
      startQueueProcessing();
    }, 10000);

  } catch (error) {
    console.error('❌ Failed to start queue worker:', error);
  }
}

/**
 * Stop queue worker
 */
export function stopQueueWorker(): void {
  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
    console.log('⏹️  Queue worker stopped');
  }
}

// Re-export functions for API routes
export { startQueueProcessing, processNextJob } from './actions/process.js';