-- Slim list payload for fast GET /api/history (without loading multi-MB result blobs).
ALTER TABLE "AnalysisJob" ADD COLUMN IF NOT EXISTS "listSummary" TEXT;
