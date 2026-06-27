export const QNA_CONCURRENCY = 2;

/** Full answer_question round-trip: Doubao search + DeepSeek synthesis (no thinking). */
export const ANSWER_QUESTION_TIMEOUT_MS = 270_000;

const RETRYABLE_RATE_LIMIT_PATTERN =
  /\b429\b|700429|rate.?limit|frequency exceeded|too many requests|quota exceeded|resource exhausted|Doubao search returned 0 results/i;

export const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export async function withRetry429<T>(fn: () => Promise<T>, maxRetries = 5): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const retryable = RETRYABLE_RATE_LIMIT_PATTERN.test(message);
      if (!retryable || attempt >= maxRetries) throw error;
      const backoffMs = Math.min(60_000, 1_000 * 2 ** attempt + Math.random() * 500);
      await sleep(backoffMs);
      attempt += 1;
    }
  }
}

export interface IndexedTask<TItem> {
  index: number;
  item: TItem;
}

export interface RunParallelIndexedTasksOptions<TItem, TResult> {
  concurrency?: number;
  onTaskComplete?: (
    result: TResult,
    task: IndexedTask<TItem>,
    completedInBatch: number,
    batchTotal: number
  ) => void | Promise<void>;
  onTaskError?: (error: unknown, task: IndexedTask<TItem>) => void | Promise<void>;
}

export async function runParallelIndexedTasks<TItem, TResult>(
  tasks: IndexedTask<TItem>[],
  worker: (task: IndexedTask<TItem>) => Promise<TResult>,
  options: RunParallelIndexedTasksOptions<TItem, TResult> = {}
): Promise<Map<number, TResult>> {
  if (tasks.length === 0) return new Map();

  const concurrency = Math.max(1, options.concurrency ?? QNA_CONCURRENCY);
  const results = new Map<number, TResult>();
  let nextTaskIdx = 0;
  let completedInBatch = 0;
  let failedError: unknown = null;
  let stopScheduling = false;

  const runWorker = async () => {
    while (!stopScheduling && nextTaskIdx < tasks.length) {
      const task = tasks[nextTaskIdx++];
      try {
        const result = await withRetry429(() => worker(task));
        if (stopScheduling) return;
        results.set(task.index, result);
        completedInBatch += 1;
        await options.onTaskComplete?.(result, task, completedInBatch, tasks.length);
      } catch (error) {
        failedError = failedError || error;
        stopScheduling = true;
        await options.onTaskError?.(error, task);
        return;
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, tasks.length) }, () => runWorker())
  );

  if (failedError) throw failedError;
  return results;
}
