# Worker Logic Refactor - Progress Tracking

## Overview

Refactored the worker logic to provide cleaner progress tracking with a helper function and improved callback structure.

## Changes Made

### 1. Created Helper Function (`server/actions/process.ts`)

Added `updateJobProgress()` helper function:

```typescript
async function updateJobProgress(jobId: string, percent: number, message: string): Promise<void> {
  const logMessage = `[Job ${jobId}] ${percent}% - ${message}`;
  console.log(logMessage); // Server Console Log
  
  try {
    await updateJobStatus(jobId, {
      progress: percent,
      currentStep: message,
      logs: [logMessage],
    });
  } catch (error) {
    // Don't fail the analysis if progress update fails
    console.error(`Error updating job progress for ${jobId}:`, error);
  }
}
```

**Benefits:**
- Centralized progress update logic
- Consistent logging format
- Error handling doesn't break analysis flow

### 2. Updated `processNextJob()` Function

**Before:**
```typescript
await updateJobStatus(jobId, {
  status: 'PROCESSING',
  startedAt: new Date(),
});

const result = await runDeepResearch(...);
```

**After:**
```typescript
await updateJobStatus(jobId, {
  status: 'PROCESSING',
  startedAt: new Date(),
});

// Initialize progress tracking
await updateJobProgress(jobId, 0, 'Initializing AI Agents...');

// Create progress callback
const onProgress = async (message: string) => {
  console.log(`[Job ${jobId}] ${message}`);
};

const result = await runDeepResearch(..., jobId, onProgress);
```

**Key Changes:**
- Explicit initialization message: "Initializing AI Agents..."
- Progress callback passed to `runDeepResearch`
- Cleaner separation of concerns

### 3. Refactored `runDeepResearch()` Function

**Signature Change:**
```typescript
export async function runDeepResearch(
  ticker: string,
  query: string,
  language: string = 'en',
  jobId?: string,
  onProgress?: (message: string) => void | Promise<void>  // NEW: Simple callback
): Promise<AnalysisState>
```

**Implementation:**
- Accepts optional `onProgress` callback with simple `(message: string)` signature
- Maps detailed progress (percent, step, log) to simple message callback
- Uses `updateJobProgress()` helper internally for database updates

### 4. Enhanced `answerQuestion()` Method

**Added Progress Callbacks:**

```typescript
async answerQuestion(
  question: string,
  companyName: string,
  lang: Language,
  onProgress?: (message: string) => void | Promise<void>  // NEW
): Promise<QnAResult>
```

**Progress Updates:**
- Before Google Search: `"Searching Google for: [question]..."`
- After search completes: `"Found X sources, synthesizing answer..."`

### 5. Updated `runAnalysisForCompany()` Method

**Key Changes:**
- Before generating questions: `"Deconstructing narrative..."`
- Inside Google Search loop: `"Searching Google for question ${i+1}..."`
- Before synthesis: `"Synthesizing final report..."`

**Progress Flow:**
```typescript
await log(5, 'Deconstructing narrative...', `Analyzing ${company.name} investment thesis`);
// ... generate questions ...

for (let i = 0; i < questions.length; i++) {
  const questionProgressCallback = onProgress ? async (message: string) => {
    await log(questionProgress, `Question ${i + 1}/${questions.length}`, message);
  } : undefined;
  
  const result = await this.answerQuestion(question, company.name, lang, questionProgressCallback);
  // ... process result ...
}

await log(75, 'Synthesizing final report...', 'Analyzing Q&A results and generating investment thesis');
```

## Progress Message Flow

### Example Progress Messages:

1. **Initialization:**
   ```
   [Job abc123] 0% - Initializing AI Agents...
   ```

2. **Question Generation:**
   ```
   [Job abc123] 5% - Deconstructing narrative...
   [Job abc123] 10% - Questions Generated: Created 10 research questions
   ```

3. **Google Search Loop:**
   ```
   [Job abc123] 15% - Answering Question 1/10: What is Apple's market position...
   [Job abc123] 15% - Searching Google for: What is Apple's market position...
   [Job abc123] 20% - Found 5 sources, synthesizing answer...
   [Job abc123] 21% - Question 1 Answered: Found 5 sources
   ```

4. **Synthesis:**
   ```
   [Job abc123] 75% - Synthesizing final report...
   [Job abc123] 85% - Conclusion Synthesized: Investment thesis generated
   ```

## Benefits

1. **Cleaner Code:**
   - Helper function reduces duplication
   - Consistent progress update pattern
   - Better separation of concerns

2. **Better Visibility:**
   - Explicit initialization message
   - Detailed Google Search progress
   - Clear synthesis steps

3. **Improved Debugging:**
   - Consistent log format: `[Job ID] % - Message`
   - All progress updates logged to console
   - Database updates don't break analysis flow

4. **Flexible Callbacks:**
   - Simple callback signature: `(message: string) => void`
   - Can be used for logging, notifications, etc.
   - Optional - doesn't break existing code

## Testing

To test the refactored progress tracking:

1. Submit a batch job with multiple tickers
2. Watch console logs for progress messages
3. Check database for `progress`, `currentStep`, and `logs` fields
4. Verify frontend receives real-time updates

## Migration Notes

- No database migration needed (fields already exist)
- Backward compatible - `onProgress` is optional
- Existing code continues to work without changes
