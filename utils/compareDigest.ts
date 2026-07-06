import type { CompanyAnalysis } from '../types.ts';
import type { CompanyCompareDigest, CompanyRole, ComparisonItem } from '../types/compare.ts';
import { normalizeInvestmentConclusion } from './investmentConclusionNormalize.ts';
import {
  classifyQuestionTopics,
  compressAnswerPreserveFacts,
  type TopicBucket,
} from './qnaTopicCompression.ts';
import { THESIS_SECTION_KEYS, type ThesisSectionKey } from './synthesizeConclusionPrompt.ts';

const MAX_EVIDENCE_PER_SECTION = 3;
const MAX_QNA_HIGHLIGHTS = 8;
const QNA_EXCERPT_CHARS = 300;

export const buildComparisonItemId = (reportId: string, companyId: string): string =>
  `${reportId}::${companyId}`;

export const parseComparisonItemId = (
  itemId: string
): { reportId: string; companyId: string } | null => {
  const idx = itemId.indexOf('::');
  if (idx <= 0 || idx >= itemId.length - 2) return null;
  return {
    reportId: itemId.slice(0, idx),
    companyId: itemId.slice(idx + 2),
  };
};

const scoreQnaForCompare = (question: string, topics: TopicBucket[]): number => {
  let score = 0;
  if (topics.includes('ExpectationGap')) score += 5;
  if (topics.includes('OutlookRisks')) score += 2;
  if (topics.includes('MarketSentiment')) score += 2;
  if (topics.includes('Financials')) score += 1;
  if (/(final|conclusion|rating|买入|卖出|增持|减持|strong buy|hold|sell)/i.test(question)) score += 2;
  return score;
};

export const buildCompanyCompareDigest = (
  company: CompanyAnalysis,
  item: Pick<ComparisonItem, 'reportId' | 'companyId' | 'companyRole' | 'snapshotAt'>
): CompanyCompareDigest => {
  const conclusion = normalizeInvestmentConclusion(company.conclusion);
  const thesis: CompanyCompareDigest['thesis'] = {};

  for (const key of THESIS_SECTION_KEYS) {
    const section = conclusion?.[key];
    if (!section) continue;
    thesis[key] = {
      summary: (section.summary || '').trim(),
      topEvidence: (section.evidence || []).slice(0, MAX_EVIDENCE_PER_SECTION),
    };
  }

  const qna = Array.isArray(company.qna) ? company.qna : [];
  const questions = Array.isArray(company.questions) ? company.questions : [];
  const qnaHighlights = qna
    .map((entry, index) => {
      const question = (entry.question || questions[index] || '').trim();
      const answer = (entry.answer || '').trim();
      if (!question || !answer) return null;
      const topics = classifyQuestionTopics(question);
      return {
        question,
        answerExcerpt: compressAnswerPreserveFacts(answer, QNA_EXCERPT_CHARS),
        score: scoreQnaForCompare(question, topics),
      };
    })
    .filter((item): item is { question: string; answerExcerpt: string; score: number } => item !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_QNA_HIGHLIGHTS)
    .map(({ question, answerExcerpt }) => ({ question, answerExcerpt }));

  const bullets = Array.isArray(company.finalConclusion?.bullet_points)
    ? company.finalConclusion!.bullet_points.map(point => ({
        argument: (point.argument || '').trim(),
        evidence: (point.evidence || []).filter(Boolean).slice(0, 3),
      }))
    : [];

  return {
    itemId: buildComparisonItemId(item.reportId, item.companyId),
    ticker: company.profile.ticker,
    name: company.profile.name,
    exchange: company.profile.exchange,
    snapshotAt: item.snapshotAt,
    companyRole: item.companyRole,
    profileSnapshot: {
      price: company.profile.currentPrice || '',
      peTtm: company.profile.peTtm,
      marketCap: company.profile.marketCap,
      weekChange: company.profile.weekChange,
      monthChange: company.profile.monthChange,
    },
    finalConclusion: {
      overall: (company.finalConclusion?.overall_conclusion || '').trim(),
      bullets,
    },
    thesis,
    qnaHighlights,
  };
};

export const listComparableCompaniesFromReport = (
  focusCompany: CompanyAnalysis | null,
  candidateCompanies: CompanyAnalysis[]
): Array<{ company: CompanyAnalysis; role: CompanyRole }> => {
  const results: Array<{ company: CompanyAnalysis; role: CompanyRole }> = [];
  if (focusCompany) results.push({ company: focusCompany, role: 'focus' });
  for (const candidate of candidateCompanies || []) {
    results.push({ company: candidate, role: 'candidate' });
  }
  return results;
};
