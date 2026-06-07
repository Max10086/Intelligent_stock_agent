
import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CompanyAnalysis, Language, QnAResult } from '../types.ts';
import { getUIText } from '../constants.ts';
import { ChevronDownIcon, LinkIcon, LightBulbIcon, DocumentTextIcon, ChartBarIcon, BriefcaseIcon, ScaleIcon, ShieldExclamationIcon, StarIcon, CurrencyDollarIcon } from './icons.tsx';

interface CompanyReportProps {
  companyAnalysis: CompanyAnalysis;
  language: Language;
}

interface PeriodPoint {
  score: number;
  label: string;
}

const parsePeriods = (text: string): PeriodPoint[] => {
  const periods: PeriodPoint[] = [];
  const seen = new Set<string>();

  const addPeriod = (label: string, score: number) => {
    const key = `${label}-${score}`;
    if (!seen.has(key)) {
      seen.add(key);
      periods.push({ label, score });
    }
  };

  const monthMatches = text.matchAll(/\b(20\d{2})[-/.](0?[1-9]|1[0-2])\b/g);
  for (const match of monthMatches) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    addPeriod(`${year}-${String(month).padStart(2, '0')}`, year * 100 + month);
  }

  // Chinese month format, e.g. 2026年3月
  const monthCnMatches = text.matchAll(/(20\d{2})年\s*(0?[1-9]|1[0-2])月/g);
  for (const match of monthCnMatches) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    addPeriod(`${year}-${String(month).padStart(2, '0')}`, year * 100 + month);
  }

  const quarterMatches = text.matchAll(/\b(20\d{2})\s*[- ]?Q([1-4])\b/gi);
  for (const match of quarterMatches) {
    const year = Number(match[1]);
    const quarter = Number(match[2]);
    addPeriod(`${year}-Q${quarter}`, year * 100 + quarter * 3);
  }

  const quarterCnMatches = text.matchAll(/(20\d{2})年\s*([1-4])季度/g);
  for (const match of quarterCnMatches) {
    const year = Number(match[1]);
    const quarter = Number(match[2]);
    addPeriod(`${year}-Q${quarter}`, year * 100 + quarter * 3);
  }

  // Chinese quarter format with numerals, e.g. 2026年第一季度 / 2026年一季度
  const quarterCnWordMatches = text.matchAll(/(20\d{2})年\s*第?\s*([一二三四])\s*季度/g);
  const quarterWordMap: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4 };
  for (const match of quarterCnWordMatches) {
    const year = Number(match[1]);
    const quarter = quarterWordMap[match[2]];
    if (quarter) {
      addPeriod(`${year}-Q${quarter}`, year * 100 + quarter * 3);
    }
  }

  const annualMatches = text.matchAll(/(20\d{2})\s*(annual|year-end|fy|fiscal year|年报|财年|年度报告)/gi);
  for (const match of annualMatches) {
    const year = Number(match[1]);
    addPeriod(`${year}-FY`, year * 100 + 12);
  }

  return periods;
};

const buildFreshnessAudit = (qna: QnAResult[]) => {
  const now = new Date();
  const cutoff = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const cutoffScore = cutoff.getFullYear() * 100 + (cutoff.getMonth() + 1);
  const currentYear = now.getFullYear();
  const month = now.getMonth() + 1;
  const latestQuarterTarget =
    month <= 4 ? { year: currentYear - 1, quarter: 3 } :
    month <= 7 ? { year: currentYear, quarter: 1 } :
    month <= 10 ? { year: currentYear, quarter: 2 } :
    { year: currentYear, quarter: 3 };
  const latestAnnualYearTarget = currentYear - 1;

  let latest: PeriodPoint | null = null;
  let recentCount = 0;
  let fallbackCount = 0;
  let hasLatestQuarter = false;
  let hasLatestAnnual = false;

  for (const item of qna) {
    const sourceText = (item.sources || [])
      .map((source) => `${source.title || ''} ${source.uri || ''}`)
      .join(' ');
    const combinedText = `${item.question || ''}\n${item.answer || ''}\n${sourceText}`;
    const periods = parsePeriods(combinedText);

    if (periods.some((period) => period.score >= cutoffScore)) {
      recentCount += 1;
    }

    if (periods.some((period) => period.label.startsWith(`${latestQuarterTarget.year}-Q${latestQuarterTarget.quarter}`))) {
      hasLatestQuarter = true;
    }
    if (new RegExp(`(${latestAnnualYearTarget}[\\s-]*(annual|year-end|fy|fiscal year|年报|财年|年度报告))`, 'i').test(combinedText)) {
      hasLatestAnnual = true;
    }

    const bestForAnswer = periods.sort((a, b) => b.score - a.score)[0];
    if (bestForAnswer) {
      if (!latest || bestForAnswer.score > latest.score) {
        latest = bestForAnswer;
      }
      const year = Math.floor(bestForAnswer.score / 100);
      if (year <= currentYear - 2) {
        fallbackCount += 1;
      }
    } else {
      fallbackCount += 1;
    }
  }

  return {
    latestLabel: latest?.label || 'N/A',
    recentCoverage: qna.length > 0 ? `${recentCount}/${qna.length}` : '0/0',
    hasLatestQuarter,
    hasLatestAnnual,
    latestQuarterLabel: `${latestQuarterTarget.year}-Q${latestQuarterTarget.quarter}`,
    latestAnnualLabel: `${latestAnnualYearTarget}-FY`,
    fallbackCount,
  };
};

const AccordionItem: React.FC<{ item: QnAResult; language: Language }> = ({ item, language }) => {
  const [isOpen, setIsOpen] = useState(false);
  const uiText = getUIText(language);

  return (
    <div className="border-b border-gray-700">
      <h3>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex justify-between items-center w-full py-4 px-2 text-left text-gray-300 hover:bg-gray-800/50"
          aria-expanded={isOpen}
        >
          <span className="font-medium">{item.question}</span>
          <ChevronDownIcon className={`w-5 h-5 transform transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>
      </h3>
      {isOpen && (
        <div className="p-4 bg-gray-800/30 fade-in">
          <div className="prose prose-invert prose-sm max-w-none text-gray-300">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.answer}</ReactMarkdown>
          </div>
          {item.sources && item.sources.length > 0 && (
            <div className="mt-4">
              <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{uiText.sources}</h4>
              <ul className="mt-2 space-y-1">
                {item.sources.map((source, i) => (
                  <li key={i} className="flex items-center">
                    <LinkIcon className="w-3 h-3 mr-2 text-gray-500" />
                    <a href={source.uri} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-400 hover:underline truncate">
                      {source.title || source.uri}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const ConclusionSection: React.FC<{ title: string; data: { summary: string; evidence: string[] }; language: Language }> = ({ title, data, language }) => {
    const uiText = getUIText(language);
    const iconMap: { [key: string]: React.FC<any> } = {
        [uiText.conclusion.UpstreamSupplyChain]: BriefcaseIcon,
        [uiText.conclusion.MarketPosition]: ChartBarIcon,
        [uiText.conclusion.BusinessModel]: LightBulbIcon,
        [uiText.conclusion.Financials]: ScaleIcon,
        [uiText.conclusion.OutlookRisks]: ShieldExclamationIcon,
    };
    const Icon = iconMap[title] || DocumentTextIcon;

    return (
        <div className="bg-gray-800/50 p-4 rounded-lg">
            <h4 className="text-lg font-semibold text-gray-100 flex items-center gap-2"><Icon className="w-5 h-5 text-blue-400" /> {title}</h4>
            <div className="mt-2 prose prose-invert prose-sm max-w-none text-gray-300">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{data.summary}</ReactMarkdown>
            </div>
            <details className="mt-3 text-xs">
                <summary className="cursor-pointer font-medium text-gray-400 hover:text-gray-200">{uiText.conclusion.evidence}</summary>
                <ul className="mt-2 pl-5 list-disc space-y-1 text-gray-400">
                    {data.evidence.map((e, i) => <li key={i}>{e}</li>)}
                </ul>
            </details>
        </div>
    );
};

export const CompanyReport: React.FC<CompanyReportProps> = ({ companyAnalysis, language }) => {
  const uiText = getUIText(language);
  const { profile, status, qna, conclusion, finalConclusion } = companyAnalysis;
  const freshnessAudit = buildFreshnessAudit(qna);
  const yesLabel = language === 'cn' ? '是' : 'Yes';
  const noLabel = language === 'cn' ? '否' : 'No';

  const conclusionSections = conclusion ? [
    { title: uiText.conclusion.UpstreamSupplyChain, data: conclusion.UpstreamSupplyChain },
    { title: uiText.conclusion.MarketPosition, data: conclusion.MarketPosition },
    { title: uiText.conclusion.BusinessModel, data: conclusion.BusinessModel },
    { title: uiText.conclusion.Financials, data: conclusion.Financials },
    { title: uiText.conclusion.OutlookRisks, data: conclusion.OutlookRisks },
  ] : [];

  const formatPrice = (priceStr: string) => {
    if (!priceStr) return 'N/A';
    const price = parseFloat(priceStr);
    if (isNaN(price) || price === 0) return 'N/A';
    const currency = profile.exchange === 'HKEX' ? 'HKD' : (profile.exchange === 'SSE' || profile.exchange === 'SZSE') ? 'CNY' : 'USD';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(price);
  }

  const getChangeColor = (changeStr?: string) => {
    if (!changeStr) return 'text-gray-400';
    const change = parseFloat(changeStr);
    if (isNaN(change)) return 'text-gray-400';
    if (change > 0) return 'text-green-400';
    if (change < 0) return 'text-red-400';
    return 'text-gray-400';
  };

  const formatMetricNumber = (value?: string) => {
    if (!value) return 'N/A';
    const parsed = parseFloat(value);
    if (isNaN(parsed)) return 'N/A';
    return parsed.toFixed(2);
  };

  const formatPe = (value?: string) => {
    if (!value) return 'N/A';
    const parsed = parseFloat(value);
    if (isNaN(parsed)) return 'N/A';
    if (parsed < 0) return uiText.profitLoss;
    return parsed.toFixed(2);
  };

  return (
    <div className="space-y-8 fade-in">
      <section className="bg-gray-800 p-6 rounded-lg shadow-lg">
        <h3 className="text-xl font-bold text-white mb-4">{uiText.companyProfile}</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-sm">
          <div className="md:col-span-1">
              <p className="text-gray-400">{profile.name}</p>
              <p className="text-lg font-semibold text-white">{profile.ticker} ({profile.exchange})</p>
          </div>
          <div className="md:col-span-2 grid grid-cols-4 gap-6">
              <div>
                  <p className="text-gray-400 flex items-center gap-1"><CurrencyDollarIcon className="w-4 h-4"/> {uiText.currentPrice}</p>
                  <p className="text-lg font-semibold text-white">{formatPrice(profile.currentPrice)}</p>
              </div>
              <div>
                  <p className="text-gray-400">{uiText.dayChangePct}</p>
                  <p className={`text-lg font-semibold ${getChangeColor(profile.dayChangePct)}`}>{profile.dayChangePct || 'N/A'}</p>
              </div>
              <div>
                  <p className="text-gray-400">{uiText.high52w}/{uiText.low52w}</p>
                  <p className="text-lg font-semibold text-white">
                    {formatPrice(profile.high52w || '')} / {formatPrice(profile.low52w || '')}
                  </p>
              </div>
              <div>
                  <p className="text-gray-400">{uiText.peTtm}</p>
                  <p className="text-lg font-semibold text-white">{formatPe(profile.peTtm)}</p>
              </div>
          </div>
        </div>
      </section>

      {qna.length > 0 && (
        <section className="bg-gray-800/60 p-4 rounded-lg border border-blue-900/60">
          <h3 className="text-sm font-semibold text-blue-300 mb-2">{uiText.freshnessAuditTitle}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs text-gray-300">
            <p>{uiText.freshnessLatestPeriod}: <span className="text-gray-100">{freshnessAudit.latestLabel}</span></p>
            <p>{uiText.freshnessRecentCoverage}: <span className="text-gray-100">{freshnessAudit.recentCoverage}</span></p>
            <p>{uiText.freshnessLatestQuarter}: <span className={freshnessAudit.hasLatestQuarter ? 'text-green-300' : 'text-yellow-300'}>{freshnessAudit.hasLatestQuarter ? yesLabel : noLabel}</span> <span className="text-gray-400">({freshnessAudit.latestQuarterLabel})</span></p>
            <p>{uiText.freshnessLatestAnnual}: <span className={freshnessAudit.hasLatestAnnual ? 'text-green-300' : 'text-yellow-300'}>{freshnessAudit.hasLatestAnnual ? yesLabel : noLabel}</span> <span className="text-gray-400">({freshnessAudit.latestAnnualLabel})</span></p>
            <p>{uiText.freshnessFallbackCount}: <span className={freshnessAudit.fallbackCount > 0 ? 'text-yellow-300' : 'text-green-300'}>{freshnessAudit.fallbackCount}</span></p>
          </div>
        </section>
      )}

      {status === 'complete' && finalConclusion && (
        <section className="bg-gray-800 p-6 rounded-lg shadow-lg">
            <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                <StarIcon className="w-6 h-6 text-amber-400" /> {uiText.finalConclusion}
            </h3>
            <p className="mb-4 text-lg font-semibold text-blue-300">{finalConclusion.overall_conclusion}</p>
            <div className="space-y-4">
                {finalConclusion.bullet_points.map((point, index) => (
                    <div key={index} className="border-l-4 border-blue-500 pl-4">
                        <p className="font-semibold text-gray-100">{point.argument}</p>
                        <ul className="mt-2 pl-5 list-disc space-y-1 text-gray-400 text-sm">
                            {point.evidence.map((e, i) => <li key={i}>{e}</li>)}
                        </ul>
                    </div>
                ))}
            </div>
        </section>
      )}

      {status === 'complete' && conclusion && (
        <section>
          <h3 className="text-xl font-bold text-white mb-4">{uiText.investmentThesis}</h3>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {conclusionSections.filter(s => s && s.data).map(section => (
                <ConclusionSection key={section.title} title={section.title} data={section.data} language={language} />
            ))}
          </div>
        </section>
      )}

      {qna.length > 0 && (
        <section>
          <h3 className="text-xl font-bold text-white mb-4">{uiText.detailedAnalysis}</h3>
          <div className="bg-gray-800 rounded-lg shadow-lg overflow-hidden">
            {qna.map((item, index) => (
              <AccordionItem key={index} item={item} language={language} />
            ))}
          </div>
        </section>
      )}

      {status !== 'pending' && status !== 'generating_questions' && qna.length === 0 && status !== 'complete' && (
        <div className="text-center py-8">
          <div className="spinner w-8 h-8 mx-auto"></div>
          <p className="mt-2 text-gray-400">Fetching detailed analysis...</p>
        </div>
      )}

      {status === 'complete' && qna.length === 0 && !conclusion && !finalConclusion && (
        <div className="text-center py-8 bg-yellow-900/20 border border-yellow-600/50 rounded-lg">
          <p className="text-yellow-300">
            {language === 'cn'
              ? '分析已完成，但报告内容未能正确加载。请尝试重新分析。'
              : 'Analysis completed, but report content failed to load. Please try running the analysis again.'}
          </p>
        </div>
      )}
    </div>
  );
};
