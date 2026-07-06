-- Speed up GET /api/history list queries.
CREATE INDEX IF NOT EXISTS "AnalysisJob_userId_status_completedAt_idx"
ON "AnalysisJob"("userId", "status", "completedAt");
