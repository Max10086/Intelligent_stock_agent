import { InvestmentConclusion } from '../types.ts';
import { cleanupBrokenNumericFormatting, mergeBrokenEvidenceFragments } from './textNormalize.ts';

const getFirstString = (obj: any, keys: string[]): string => {
  for (const key of keys) {
    const value = obj?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
};

const normalizeEvidenceItem = (value: any): string => {
  if (typeof value === 'string') return cleanupBrokenNumericFormatting(value);
  if (typeof value === 'number' || typeof value === 'boolean') return cleanupBrokenNumericFormatting(String(value));
  if (value && typeof value === 'object') {
    const fromKnownKeys = getFirstString(value, [
      'evidence',
      'text',
      'detail',
      'fact',
      'data',
      'value',
      'source',
      'content',
      'point',
      'bullet',
    ]);
    if (fromKnownKeys) return cleanupBrokenNumericFormatting(fromKnownKeys);
    try {
      return cleanupBrokenNumericFormatting(JSON.stringify(value));
    } catch {
      return '';
    }
  }
  return '';
};

const normalizeEvidenceList = (value: any): string[] => {
  if (Array.isArray(value)) {
    const items = value
      .map(normalizeEvidenceItem)
      .map(v => v.trim())
      .filter(Boolean);
    return mergeBrokenEvidenceFragments(items);
  }
  if (typeof value === 'string' && value.trim()) {
    return [cleanupBrokenNumericFormatting(value)].filter(Boolean);
  }
  if (value && typeof value === 'object') {
    const single = normalizeEvidenceItem(value);
    return single ? [single] : [];
  }
  return [];
};

const pickEvidenceField = (raw: any) =>
  raw?.evidence ??
  raw?.key_evidence ??
  raw?.supporting_evidence ??
  raw?.supportingEvidence ??
  raw?.data_points ??
  raw?.dataPoints ??
  raw?.facts ??
  raw?.points ??
  raw?.bullets ??
  raw?.citations ??
  raw?.sources ??
  raw?.['证据'] ??
  raw?.['关键证据'] ??
  raw?.['论据'] ??
  raw?.['关键论据'];

const normalizeConclusionSection = (raw: any) => ({
  summary: cleanupBrokenNumericFormatting(
    getFirstString(raw, ['summary', 'thesis', 'analysis', 'conclusion', '概述', '摘要', '总结'])
  ),
  evidence: normalizeEvidenceList(pickEvidenceField(raw)),
});

const getConclusionSection = (raw: any, keys: string[]) => {
  for (const key of keys) {
    if (raw?.[key]) return raw[key];
  }
  return {};
};

export const normalizeInvestmentConclusion = (raw: any): InvestmentConclusion => {
  const sectionsRoot = raw?.sections || raw?.['章节'] || {};
  const crossRaw = raw?.cross_dimensional_insights ?? raw?.crossDimensionalInsights ?? raw?.insights;
  const crossDimensionalInsights = Array.isArray(crossRaw)
    ? crossRaw.map((item: unknown) => cleanupBrokenNumericFormatting(String(item || ''))).filter(Boolean)
    : undefined;

  return {
    investment_narrative: cleanupBrokenNumericFormatting(
      getFirstString(raw, ['investment_narrative', 'investmentNarrative', 'narrative', '投资叙事', '核心叙事'])
    ) || undefined,
    cross_dimensional_insights: crossDimensionalInsights?.length ? crossDimensionalInsights : undefined,
    UpstreamSupplyChain: normalizeConclusionSection(
      getConclusionSection(raw, ['UpstreamSupplyChain', 'upstreamSupplyChain', 'upstream_supply_chain']) ||
        sectionsRoot?.UpstreamSupplyChain ||
        sectionsRoot?.upstreamSupplyChain
    ),
    MarketPosition: normalizeConclusionSection(
      getConclusionSection(raw, ['MarketPosition', 'marketPosition', 'market_position']) ||
        sectionsRoot?.MarketPosition ||
        sectionsRoot?.marketPosition
    ),
    BusinessModel: normalizeConclusionSection(
      getConclusionSection(raw, ['BusinessModel', 'businessModel', 'business_model']) ||
        sectionsRoot?.BusinessModel ||
        sectionsRoot?.businessModel
    ),
    Financials: normalizeConclusionSection(
      getConclusionSection(raw, ['Financials', 'financials']) || sectionsRoot?.Financials || sectionsRoot?.financials
    ),
    OutlookRisks: normalizeConclusionSection(
      getConclusionSection(raw, ['OutlookRisks', 'outlookRisks', 'outlook_risks', 'risks']) ||
        sectionsRoot?.OutlookRisks ||
        sectionsRoot?.outlookRisks
    ),
    MarketSentiment: normalizeConclusionSection(
      getConclusionSection(raw, ['MarketSentiment', 'marketSentiment', 'market_sentiment']) ||
        sectionsRoot?.MarketSentiment ||
        sectionsRoot?.marketSentiment
    ),
    IndustryCycle: normalizeConclusionSection(
      getConclusionSection(raw, ['IndustryCycle', 'industryCycle', 'industry_cycle']) ||
        sectionsRoot?.IndustryCycle ||
        sectionsRoot?.industryCycle
    ),
  };
};
