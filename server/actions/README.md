# Queue Management Actions

This directory contains server-side actions for queue management, following a pattern similar to Next.js Server Actions but adapted for Express backend.

## Overview

The queue actions provide a clean, reusable interface for queue operations that can be used by:
- API routes (`server/routes/jobs.ts`)
- Background workers (`server/worker.ts`)
- Other services

## Functions

### `addToQueue(tickers: string[], language?: string, batchJobId?: string)`

Adds tickers to the analysis queue.

**Parameters:**
- `tickers`: Array of ticker symbols or queries
- `language`: Language for analysis ('en' or 'cn'), defaults to 'en'
- `batchJobId`: Optional batch job ID to associate these jobs with

**Returns:**
```typescript
{
  jobIds: string[];
  jobs: QueueJob[];
}
```

**Example:**
```typescript
const { jobIds, jobs } = await addToQueue(['AAPL', 'MSFT', 'TSLA'], 'en');
console.log(`Created ${jobIds.length} jobs`);
```

### `getQueueStatus(options?)`

Fetches queue status with jobs ordered by createdAt desc.

**Parameters:**
```typescript
{
  status?: JobStatus;      // Filter by status
  limit?: number;          // Pagination limit (default: 50)
  offset?: number;         // Pagination offset (default: 0)
  batchJobId?: string;     // Filter by batch job ID
}
```

**Returns:**
```typescript
{
  jobs: QueueJob[];
  total: number;
  stats: {
    pending: number;
    processing: number;
    completed: number;
    failed: number;
  };
}
```

**Example:**
```typescript
// Get all pending jobs
const status = await getQueueStatus({ status: 'PENDING' });

// Get jobs for a specific batch
const batchStatus = await getQueueStatus({ batchJobId: 'batch-id' });

// Get first 10 completed jobs
const completed = await getQueueStatus({ 
  status: 'COMPLETED', 
  limit: 10 
});
```

### `getJobById(jobId: string)`

Gets a single job by ID.

**Parameters:**
- `jobId`: Job ID

**Returns:**
- `QueueJob | null`

**Example:**
```typescript
const job = await getJobById('job-id');
if (job) {
  console.log(`Job ${job.id} status: ${job.status}`);
}
```

### `updateJobStatus(jobId: string, updates: {...})`

Updates job status and related fields.

**Parameters:**
```typescript
{
  status?: JobStatus;
  error?: string | null;
  result?: any;
  startedAt?: Date | null;
  completedAt?: Date | null;
}
```

**Returns:**
- Updated `QueueJob`

**Example:**
```typescript
// Mark as processing
await updateJobStatus(jobId, {
  status: 'PROCESSING',
  startedAt: new Date(),
});

// Mark as completed with result
await updateJobStatus(jobId, {
  status: 'COMPLETED',
  completedAt: new Date(),
  result: analysisResult,
});

// Mark as failed with error
await updateJobStatus(jobId, {
  status: 'FAILED',
  completedAt: new Date(),
  error: 'Analysis failed',
});
```

## Types

### `QueueJob`

```typescript
interface QueueJob {
  id: string;
  ticker: string;
  query: string;
  status: JobStatus;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  error: string | null;
  result: any | null;
  reportId?: string | null;
  batchJobId?: string | null;
}
```

### `QueueStatus`

```typescript
interface QueueStatus {
  jobs: QueueJob[];
  total: number;
  stats: {
    pending: number;
    processing: number;
    completed: number;
    failed: number;
  };
}
```

## Usage in Routes

```typescript
import { addToQueue, getQueueStatus } from '../actions/queue.js';

// In route handler
router.post('/queue', async (req, res) => {
  const { tickers } = req.body;
  const { jobIds } = await addToQueue(tickers);
  res.json({ jobIds });
});
```

## Usage in Workers

```typescript
import { updateJobStatus, getJobById } from '../actions/queue.js';

// In worker
const job = await getJobById(jobId);
await updateJobStatus(jobId, { status: 'PROCESSING' });
// ... process job ...
await updateJobStatus(jobId, { status: 'COMPLETED', result });
```

## Benefits

1. **Separation of Concerns**: Business logic separated from HTTP handling
2. **Reusability**: Same functions can be used by routes, workers, and other services
3. **Testability**: Easy to unit test without HTTP context
4. **Type Safety**: Full TypeScript support with proper types
5. **Consistency**: Standardized interface for queue operations
