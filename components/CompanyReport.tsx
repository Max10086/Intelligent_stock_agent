
import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CompanyAnalysis, Language, QnAResult } from '../types.ts';
import { getUIText } from '../constants.ts';
import { ChevronDownIcon, LinkIcon, LightBulbIcon, DocumentTextIcon, ChartBarIcon, BriefcaseIcon, ScaleIcon, ShieldExclamationIcon, StarIcon, CurrencyDollarIcon, CalendarDaysIcon, CalendarIcon } from './icons.tsx';

interface CompanyReportProps {
  companyAnalysis: CompanyAnalysis;
  language: Language;
}

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

  const getChangeColor = (changeStr: string) => {
    if (!changeStr) return 'text-gray-400';
    const change = parseFloat(changeStr);
    if (isNaN(change)) return 'text-gray-400';
    if (change > 0) return 'text-green-400';
    if (change < 0) return 'text-red-400';
    return 'text-gray-400';
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
          <div className="md:col-span-2 grid grid-cols-3 gap-6">
              <div>
                  <p className="text-gray-400 flex items-center gap-1"><CurrencyDollarIcon className="w-4 h-4"/> {uiText.currentPrice}</p>
                  <p className="text-lg font-semibold text-white">{formatPrice(profile.currentPrice)}</p>
              </div>
              <div>
                  <p className="text-gray-400 flex items-center gap-1"><CalendarDaysIcon className="w-4 h-4"/> {uiText.weekChange}</p>
                  <p className={`text-lg font-semibold ${getChangeColor(profile.weekChange)}`}>{profile.weekChange}</p>
              </div>
              <div>
                  <p className="text-gray-400 flex items-center gap-1"><CalendarIcon className="w-4 h-4"/> {uiText.monthChange}</p>
                  <p className={`text-lg font-semibold ${getChangeColor(profile.monthChange)}`}>{profile.monthChange}</p>
              </div>
          </div>
        </div>
      </section>

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
    </div>
  );
};
