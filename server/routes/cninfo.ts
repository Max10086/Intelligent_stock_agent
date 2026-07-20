import { Router } from 'express';
import type { Language } from '../../types.js';
import { requireAuth } from '../middleware/auth.js';
import { prefetchCninfoFilingsForCompany } from '../services/cninfoService.js';
import {
  buildCninfoEvidencePromptBlock,
  isAShareProfile,
} from '../../utils/cninfoFilingContext.js';

export const cninfoRouter = Router();

cninfoRouter.post('/filings', requireAuth, async (req, res) => {
  try {
    const { ticker, exchange, name, language } = req.body as {
      ticker?: string;
      exchange?: string;
      name?: string;
      language?: Language;
    };

    if (!ticker?.trim() || !exchange?.trim()) {
      res.status(400).json({ error: 'ticker and exchange are required' });
      return;
    }

    const profile = {
      ticker: ticker.trim(),
      exchange: exchange.trim(),
      name: (name || ticker).trim(),
    };

    if (!isAShareProfile(profile)) {
      res.status(200).json({ enabled: false, reason: 'not_a_share', evidenceBlock: '' });
      return;
    }

    const lang: Language = language === 'cn' ? 'cn' : 'en';
    const bundle = await prefetchCninfoFilingsForCompany(profile, lang);

    if (!bundle) {
      res.status(200).json({
        enabled: true,
        loaded: false,
        evidenceBlock: '',
        reports: [],
        errors: [],
      });
      return;
    }

    res.status(200).json({
      enabled: true,
      loaded: true,
      secCode: bundle.secCode,
      plate: bundle.plate,
      reports: bundle.reports.map(item => ({
        year: item.year,
        kind: item.kind,
        title: item.title,
        annDate: item.annDate,
        tsCode: item.tsCode,
        textChars: item.textChars,
        extractedPages: item.extractedPages,
        cacheHit: item.cacheHit,
      })),
      errors: bundle.errors,
      evidenceBlock: buildCninfoEvidencePromptBlock(bundle.evidenceText, lang),
    });
  } catch (error) {
    console.error('[cninfo] /filings error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to fetch cninfo filings',
    });
  }
});
