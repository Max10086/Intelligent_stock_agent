# Server-Based History Refactor

## Overview

Refactored the application to use 100% server-based history management, replacing localStorage-based history with database-backed storage.

## Changes Made

### 1. Server-Side History API (`server/routes/history.ts`)

#### Added `POST /api/history`
- Saves completed single-run analysis reports to database
- Creates an `AnalysisJob` record with `COMPLETED` status
- Stores the full `AnalysisState` as JSON in `result` field

**Request:**
```json
{
  "result": AnalysisState,
  "query": "AAPL",
  "language": "en"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Report saved successfully",
  "jobId": "uuid"
}
```

#### Existing Endpoints
- `GET /api/history` - Fetch all completed reports
- `DELETE /api/history/:id` - Delete a specific report
- `DELETE /api/history` - Clear all history

### 2. Refactored `useStockAgent` Hook

#### Removed localStorage History Logic
- **Before**: History loaded from localStorage, merged with server
- **After**: History loaded 100% from server on mount

#### New State Management
```typescript
const [history, setHistory] = useState<AnalysisState[]>([]);
const [isLoadingHistory, setIsLoadingHistory] = useState(true);
```

#### Server History Fetching
- `useEffect` hook fetches history on component mount
- Sets `isLoadingHistory` state during fetch
- Sorts by timestamp (most recent first)

#### Save Single-Run Analysis
- When analysis completes, saves to server via `POST /api/history`
- Refreshes history from server after save
- Continues even if save fails (user can still see report)

#### Delete History
- Calls `DELETE /api/history/:id` on server
- Refreshes history from server after deletion
- Falls back to local update if server fails

#### Clear History
- Calls `DELETE /api/history` on server
- Refreshes history from server after clearing
- Falls back to local clear if server fails

#### New Function: `refreshHistory()`
- Fetches latest history from server
- Called after save/delete/clear operations
- Ensures UI stays in sync with database

### 3. Updated Components

#### `App.tsx`
- Added `isLoadingHistory` to destructured hook values
- Passes `isLoading` prop to `HistorySidebar`

#### `HistorySidebar.tsx`
- Added `isLoading` prop
- Shows loading spinner while fetching history
- Displays "Loading history..." message

## Data Flow

### History Loading (On Mount)

```
Component Mount
  ↓
Set isLoadingHistory = true
  ↓
GET /api/history
  ↓
Parse response (AnalysisState[])
  ↓
Sort by timestamp (desc)
  ↓
Set history state
  ↓
Set isLoadingHistory = false
```

### Single-Run Analysis Completion

```
Analysis Complete
  ↓
Create finalState (AnalysisState)
  ↓
POST /api/history { result: finalState, query, language }
  ↓
Server creates AnalysisJob record
  ↓
refreshHistory() - GET /api/history
  ↓
Update history state
```

### Delete Report

```
User clicks delete
  ↓
DELETE /api/history/:id
  ↓
Server deletes AnalysisJob
  ↓
refreshHistory() - GET /api/history
  ↓
Update history state
```

## Benefits

1. **Unified Storage**: All reports (single-run and batch) stored in same database
2. **Persistent**: History persists across browser sessions
3. **Real-time Sync**: History updates automatically after operations
4. **No Duplicates**: Server is single source of truth
5. **Better Performance**: No localStorage size limits
6. **Cross-Device**: History accessible from any device (future: with auth)

## Migration Notes

### For Existing Users

- **Old localStorage history**: Will not be automatically migrated
- **New reports**: Will be saved to server automatically
- **Recommendation**: Users can manually re-run analyses if needed

### For New Users

- History starts empty (as expected)
- All reports saved to server automatically
- History persists across sessions

## Testing

### Test Single-Run Analysis

1. Run a single analysis (e.g., "AAPL")
2. Wait for completion
3. Open history sidebar
4. Verify report appears in list
5. Refresh page
6. Verify report still appears

### Test Batch Analysis

1. Submit batch job (e.g., "AAPL MSFT TSLA")
2. Wait for all jobs to complete
3. Open history sidebar
4. Verify all batch reports appear
5. Refresh page
6. Verify reports still appear

### Test Delete

1. Delete a report from history
2. Verify it disappears immediately
3. Refresh page
4. Verify it stays deleted

### Test Clear All

1. Clear all history
2. Verify all reports disappear
3. Refresh page
4. Verify history stays empty

## API Endpoints Summary

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/history` | Fetch all completed reports |
| POST | `/api/history` | Save a completed report |
| DELETE | `/api/history/:id` | Delete a specific report |
| DELETE | `/api/history` | Clear all history |

## Future Enhancements

1. **User Authentication**: Add user-specific history
2. **Pagination**: Paginate large history lists
3. **Filtering**: Filter by date, ticker, etc.
4. **Search**: Search history by query/ticker
5. **Export**: Export history to CSV/JSON
6. **Migration Tool**: Migrate localStorage history to server
