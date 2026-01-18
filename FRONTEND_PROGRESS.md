# Frontend Progress Tracking Update

## Overview

Updated the Batch Queue page to display real-time progress bars and current step information for processing jobs.

## Changes Made

### 1. Updated `QueueJob` Interface

Added progress tracking fields:

```typescript
interface QueueJob {
  // ... existing fields ...
  progress?: number;        // 0-100
  currentStep?: string | null;  // Current step description
  logs?: string[] | null;   // Log history
}
```

### 2. Updated Data Fetching

Modified `fetchQueueStatus()` to include progress fields from API:

```typescript
const transformedJobs: QueueJob[] = (data.jobs || []).map((job: any) => ({
  // ... existing fields ...
  progress: job.progress ?? 0,
  currentStep: job.currentStep || null,
  logs: job.logs || null,
}));
```

### 3. Enhanced Status Column

Replaced simple status badge with:

#### Status Badge + Progress Percentage
- Shows status badge (PENDING/PROCESSING/COMPLETED/FAILED)
- Displays progress percentage next to badge for PROCESSING jobs

#### Progress Bar (for PROCESSING jobs)
- Visual progress bar (0-100%)
- Gradient blue color (`from-blue-500 to-blue-400`)
- Smooth transition animation (`transition-all duration-500`)
- Progress percentage overlay (shown when progress > 10%)

#### Current Step Text
- Shows `job.currentStep` below progress bar
- Animated pulse dot indicator
- Truncated with tooltip for long messages
- Example: "Searching Google for: What is Apple's market position..."

### 4. Visual Design

**Progress Bar:**
- Height: `h-2.5` (10px)
- Background: `bg-gray-700` (dark gray)
- Fill: Gradient blue (`from-blue-500 to-blue-400`)
- Smooth animation: `transition-all duration-500 ease-out`

**Current Step:**
- Text color: `text-gray-300`
- Font size: `text-xs`
- Pulse indicator: Blue dot with `animate-pulse`
- Truncation: Long text truncated with `title` attribute for full text

**Completed Jobs:**
- Green progress bar at 100%
- No current step text

## UI Components

### Status Column Structure

```
┌─────────────────────────────────────┐
│ [Status Badge] 45%                  │
│ ████████████░░░░░░░░░░░░░░░░░░░░░░ │
│ • Searching Google for: What is... │
└─────────────────────────────────────┘
```

### Example Display

**Processing Job:**
```
[PROCESSING] 45%
████████████░░░░░░░░░░░░░░░░░░░░░░░░
• Searching Google for: What is Apple's market position...
```

**Completed Job:**
```
[COMPLETED]
████████████████████████████████████
```

**Pending Job:**
```
[PENDING]
(no progress bar)
```

## Polling Behavior

- **Interval**: 5 seconds (unchanged)
- **Auto-refresh**: Enabled on component mount
- **Cleanup**: Interval cleared on unmount
- **Progress Updates**: Fetched automatically with each poll

## Benefits

1. **Real-time Visibility**: Users see exactly what's happening
2. **Progress Tracking**: Visual progress bar shows completion percentage
3. **Step Details**: Current step text explains what AI is doing
4. **Better UX**: Smooth animations and clear visual feedback
5. **Responsive**: Progress bar adapts to different screen sizes

## Testing

To test the progress display:

1. Submit a batch job with multiple tickers
2. Navigate to Batch Queue view
3. Watch progress bars update every 5 seconds
4. Verify current step text changes as analysis progresses
5. Check that completed jobs show green progress bar

## Example Progress Flow

```
[PROCESSING] 0%
• Initializing AI Agents...

[PROCESSING] 5%
• Deconstructing narrative...

[PROCESSING] 15%
• Answering Question 1/10: What is Apple's market position...
• Searching Google for: What is Apple's market position...

[PROCESSING] 45%
• Answering Question 3/10: What are Apple's financial metrics...
• Searching Google for: What are Apple's financial metrics...

[PROCESSING] 75%
• Synthesizing final report...

[COMPLETED]
████████████████████████████████████
```

## Responsive Design

- Progress bar: Full width with min-width constraint
- Text truncation: Long step messages truncated with tooltip
- Mobile-friendly: Stacked layout works on small screens
- Table scroll: Horizontal scroll for small screens
