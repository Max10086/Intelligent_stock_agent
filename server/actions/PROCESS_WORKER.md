# Background Worker Implementation

## Overview

This document describes the "Fire-and-Forget" background worker implementation that processes analysis jobs recursively.

## Architecture

### Core Components

1. **`process.ts`** - Core processing logic
   - `runDeepResearch()` - Runs the analysis for a ticker
   - `processNextJob()` - Recursive function that processes jobs one by one
   - `startQueueProcessing()` - Fire-and-Forget trigger

2. **`worker.ts`** - Worker orchestration
   - Provides both polling and recursive modes
   - Manages worker lifecycle

## How It Works

### Recursive Processing Flow

```
processNextJob()
  ↓
Find first PENDING job
  ↓
If none → Return (Queue empty)
  ↓
Mark as PROCESSING
  ↓
Run runDeepResearch()
  ↓
On Success:
  - Mark COMPLETED
  - Save result
  - Recursively call processNextJob()
  ↓
On Error:
  - Mark FAILED
  - Save error
  - Recursively call processNextJob()
```

### Fire-and-Forget Pattern

When a batch job is created:

1. Jobs are added to the queue with `PENDING` status
2. `startQueueProcessing()` is called
3. HTTP response returns immediately
4. Background processing continues recursively

```typescript
// In route handler
const { jobIds } = await addToQueue(tickers);
startQueueProcessing(); // Fire-and-Forget
res.json({ jobIds, message: 'Processing started' }); // Returns immediately
```

## Key Features

### 1. Recursive Processing

- Processes jobs one by one in FIFO order
- Automatically continues to next job after completion/failure
- Uses `setImmediate()` to avoid stack overflow

### 2. Error Handling

- Individual job failures don't stop the queue
- Errors are logged and saved to database
- Processing continues with next job

### 3. Concurrency Control

- `isProcessing` flag prevents concurrent processing
- Only one job processed at a time
- Prevents race conditions

### 4. Non-Blocking

- Uses `setImmediate()` for recursive calls
- Allows event loop to process other events
- Doesn't block HTTP responses

## API Endpoints

### POST /api/jobs/batch

Creates batch job and automatically starts processing.

**Request:**
```json
{
  "tickers": "AAPL MSFT TSLA",
  "language": "en"
}
```

**Response:**
```json
{
  "batchJobId": "uuid",
  "jobCount": 3,
  "jobs": [...],
  "message": "Batch job created. Background processing started."
}
```

### POST /api/jobs/process

Manually trigger queue processing.

**Response:**
```json
{
  "message": "Queue processing started in background",
  "status": "processing"
}
```

## Usage Examples

### Starting Processing

```typescript
import { startQueueProcessing } from './actions/process.js';

// Fire-and-Forget: Returns immediately
startQueueProcessing();
console.log('Processing started in background');
```

### Processing Next Job

```typescript
import { processNextJob } from './actions/process.js';

// Process a single job (will recursively continue)
await processNextJob();
```

### Running Deep Research

```typescript
import { runDeepResearch } from './actions/process.js';

const result = await runDeepResearch('AAPL', 'AAPL', 'en');
console.log('Analysis complete:', result);
```

## Implementation Details

### Stack Overflow Prevention

Recursive calls use `setImmediate()` instead of direct recursion:

```typescript
// ✅ Good: Uses event loop
setImmediate(() => {
  processNextJob().catch(handleError);
});

// ❌ Bad: Direct recursion (can cause stack overflow)
await processNextJob();
```

### Concurrency Prevention

```typescript
if (isProcessing) {
  return; // Skip if already processing
}
isProcessing = true;
// ... process job ...
isProcessing = false;
```

### Error Recovery

```typescript
try {
  // Process job
} catch (error) {
  // Mark as failed
  // Continue with next job
  setImmediate(() => processNextJob());
}
```

## Benefits

1. **Immediate Response**: HTTP requests return immediately
2. **Automatic Processing**: Jobs processed as soon as added
3. **Resilient**: Individual failures don't stop the queue
4. **Efficient**: Processes jobs sequentially without polling overhead
5. **Scalable**: Can handle large queues without blocking

## Monitoring

### Logs

- `🔄 Processing job {id} for ticker: {ticker}` - Job started
- `✅ Completed job {id}` - Job succeeded
- `❌ Failed job {id}` - Job failed
- `📭 Queue empty` - No more jobs

### Database Status

Check job status:
```typescript
const status = await getQueueStatus();
console.log('Pending:', status.stats.pending);
console.log('Processing:', status.stats.processing);
console.log('Completed:', status.stats.completed);
```

## Troubleshooting

### Jobs Not Processing

1. Check if worker is running: `isQueueProcessing()`
2. Check for PENDING jobs in database
3. Check server logs for errors
4. Manually trigger: `POST /api/jobs/process`

### Stack Overflow

- Should not occur due to `setImmediate()` usage
- If it does, check for infinite loops in error handling

### Concurrent Processing

- Prevented by `isProcessing` flag
- Only one job processed at a time

## Future Improvements

1. **Parallel Processing**: Process multiple jobs concurrently
2. **Priority Queue**: Process high-priority jobs first
3. **Retry Logic**: Automatic retry for failed jobs
4. **Rate Limiting**: Control processing rate
5. **Metrics**: Track processing time, success rate, etc.
