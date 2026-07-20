import { Router } from 'express';
import type { Language } from '../../types.js';
import { requireAuth } from '../middleware/auth.js';
import { prefetchEdgarFilingsForCompany, getEdgarEvidencePromptBlock } from '../services/edgarService.js';
import { isUSProfile } from '../../utils/edgarFilingContext.js';

export const edgarRouter = Router();

edgarRouter.post('/filings', requireAuth, async (req, res) => {
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

    if (!isUSProfile(profile)) {
      res.status(200).json({ enabled: false, reason: 'not_us', evidenceBlock: '' });
      return;
    }

    const lang: Language = language === 'cn' ? 'cn' : 'en';
    const bundle = await prefetchEdgarFilingsForCompany(profile, lang);

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
      ticker: bundle.ticker,
      reports: bundle.reports.map(item => ({
        form: item.form,
        title: item.title,
        filingDate: item.filingDate,
        accessionNumber: item.accessionNumber,
        fiscalPeriod: item.fiscalPeriod,
        textChars: item.textChars,
        cacheHit: item.cacheHit,
      })),
      errors: bundle.errors,
      evidenceBlock: getEdgarEvidencePromptBlock(bundle, lang),
    });
  } catch (error) {
    console.error('[edgar] /filings error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to fetch EDGAR filings',
    });
  }
});
