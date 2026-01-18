import express from 'express';
import { prisma } from '../db.js';
import { JobStatus } from '@prisma/client';
import { AnalysisState } from '../../types.js';

const router = express.Router();

/**
 * POST /api/history
 * Save a completed analysis report to the database
 * Used for single-run analyses (not batch jobs)
 */
router.post('/', async (req, res) => {
  try {
    const { result, query, language = 'en' } = req.body;

    if (!result || !query) {
      return res.status(400).json({
        error: 'result and query are required',
      });
    }

    // Extract ticker from result or use query
    const ticker = result.focusCompany?.profile?.ticker || query.split(' ')[0].toUpperCase();

    // Create an AnalysisJob record for this single-run analysis
    const job = await prisma.analysisJob.create({
      data: {
        ticker,
        query,
        language,
        status: 'COMPLETED',
        startedAt: new Date(),
        completedAt: new Date(),
        progress: 100,
        currentStep: 'Analysis Complete',
        result: JSON.stringify(result),
      },
    });

    res.json({
      success: true,
      message: 'Report saved successfully',
      jobId: job.id,
    });
  } catch (error: any) {
    console.error('Error saving report:', error);
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Failed to save report',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  }
});

/**
 * GET /api/history
 * Get user's report history from completed analysis jobs
 * Returns AnalysisState[] compatible with frontend
 */
router.get('/', async (req, res) => {
  try {
    // Fetch all completed analysis jobs with results
    const completedJobs = await prisma.analysisJob.findMany({
      where: {
        status: 'COMPLETED',
        result: {
          not: null,
        },
      },
      orderBy: {
        completedAt: 'desc', // Most recent first
      },
      select: {
        id: true,
        ticker: true,
        query: true,
        language: true,
        completedAt: true,
        result: true,
      },
    });

    // Transform database results to AnalysisState format
    const history: AnalysisState[] = completedJobs
      .map((job) => {
        try {
          // Parse the JSON result stored in the database
          const result: AnalysisState = JSON.parse(job.result!);
          
          // Ensure the result has required fields and is properly formatted
          return {
            ...result,
            id: job.id, // Use job ID as the history item ID
            timestamp: job.completedAt?.toISOString() || new Date().toISOString(),
            status: 'complete' as const, // Ensure status is 'complete'
            language: (job.language as 'en' | 'cn') || 'en',
            query: job.query || job.ticker,
          };
        } catch (error) {
          console.error(`Error parsing result for job ${job.id}:`, error);
          return null;
        }
      })
      .filter((item): item is AnalysisState => item !== null);

    res.json({
      history,
      total: history.length,
    });
  } catch (error: any) {
    console.error('Error fetching history:', error);
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Failed to fetch history',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  }
});

/**
 * DELETE /api/history/:id
 * Delete a report from history
 * Deletes the AnalysisJob record (which contains the result)
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Delete the analysis job (which contains the result)
    const deleted = await prisma.analysisJob.delete({
      where: { id },
    });

    res.json({
      success: true,
      message: 'Report deleted successfully',
      deletedId: deleted.id,
    });
  } catch (error: any) {
    console.error('Error deleting report:', error);
    if (!res.headersSent) {
      // Check if it's a not found error
      if (error.code === 'P2025') {
        res.status(404).json({
          error: 'Report not found',
        });
      } else {
        res.status(500).json({
          error: 'Failed to delete report',
          details: process.env.NODE_ENV === 'development' ? error.message : undefined,
        });
      }
    }
  }
});

/**
 * DELETE /api/history
 * Clear all history (delete all completed jobs)
 */
router.delete('/', async (req, res) => {
  try {
    const result = await prisma.analysisJob.deleteMany({
      where: {
        status: 'COMPLETED',
      },
    });

    res.json({
      success: true,
      message: 'All history cleared',
      deletedCount: result.count,
    });
  } catch (error: any) {
    console.error('Error clearing history:', error);
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Failed to clear history',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  }
});

export { router as historyRouter };
