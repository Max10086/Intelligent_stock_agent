import { getUIText } from '../constants.ts';
import type {
  AnalysisState,
  CompanyAnalysis,
  CompanyProfile,
  ConclusionSectionData,
  FinalConclusion,
  InvestmentConclusion,
  Language,
  QnAResult,
} from '../types.ts';
import { THESIS_SECTION_KEYS } from './synthesizeConclusionPrompt.ts';
import { normalizeDisplayText, mergeBrokenEvidenceFragments } from './textNormalize.ts';
import { formatMarketCapDisplay } from './priceFormat.ts';
import { sanitizeFilenamePart } from './downloadTextFile.ts';
import type { ConclusionCategory } from './conclusionCategory.ts';
import { getCatalogCategoryLabelKey } from './conclusionCategory.ts';

const MAIN_DIVIDER = '='.repeat(80);
const SUB_DIVIDER = '-'.repeat(80);

const pushLine = (lines: string[], line = '') => {
  lines.push(line);
};

const pushSectionTitle = (lines: string[], title: string) => {
  pushLine(lines);
  pushLine(lines, title);
  pushLine(lines, SUB_DIVIDER);
};

const appendTextBlock = (lines: string[], label: string, value?: string | null) => {
  const normalized = normalizeDisplayText(value || '');
  if (!normalized) return;
  pushLine(lines, `${label}:`);
  pushLine(lines, normalized);
  pushLine(lines);
};

const labelFor = (language: Language, en: string, cn: string) => (language === 'cn' ? cn : en);

const appendProfile = (
  lines: string[],
  profile: CompanyProfile,
  language: Language,
  ui: ReturnType<typeof getUIText>
) => {
  pushSectionTitle(lines, language === 'cn' ? '公司概况' : 'Company profile');

  const rows: Array<[string, string | undefined]> = [
    [language === 'cn' ? '公司名称' : 'Company', profile.name],
    [language === 'cn' ? '股票代码' : 'Ticker', profile.ticker],
    [language === 'cn' ? '交易所' : 'Exchange', profile.exchange],
    [ui.currentPrice, profile.currentPrice],
    [ui.dayChangePct, profile.dayChangePct],
    [labelFor(language, 'Day change', '日涨跌'), profile.dayChange],
    [labelFor(language, 'Previous close', '昨收'), profile.prevClose],
    [labelFor(language, 'Open', '开盘'), profile.openPrice],
    [labelFor(language, 'Day high', '最高'), profile.dayHigh],
    [labelFor(language, 'Day low', '最低'), profile.dayLow],
    [ui.weekChange, profile.weekChange],
    [ui.monthChange, profile.monthChange],
    [ui.peTtm, profile.peTtm],
    [labelFor(language, 'P/B', '市净率'), profile.pb],
    [
      ui.marketCap,
      profile.marketCap
        ? formatMarketCapDisplay(profile.marketCap, profile.exchange, profile.currency)
        : undefined,
    ],
    [
      ui.floatMarketCap,
      profile.floatMarketCap
        ? formatMarketCapDisplay(profile.floatMarketCap, profile.exchange, profile.currency)
        : undefined,
    ],
    [ui.high52w, profile.high52w],
    [ui.low52w, profile.low52w],
    [labelFor(language, 'Volume', '成交量'), profile.volume],
    [labelFor(language, 'Amount', '成交额'), profile.amount],
    [labelFor(language, 'Turnover rate', '换手率'), profile.turnoverRate],
    [labelFor(language, 'Amplitude', '振幅'), profile.amplitude],
    [language === 'cn' ? '报价时间' : 'Quote time', profile.quoteTime],
    [language === 'cn' ? '货币' : 'Currency', profile.currency],
    [language === 'cn' ? '数据来源' : 'Data source', profile.dataSource],
  ];

  for (const [label, value] of rows) {
    const text = (value || '').trim();
    if (!text) continue;
    pushLine(lines, `${label}: ${text}`);
  }
  pushLine(lines);
};

const appendConclusionSection = (
  lines: string[],
  title: string,
  data: ConclusionSectionData,
  ui: ReturnType<typeof getUIText>
) => {
  pushLine(lines, title);
  appendTextBlock(lines, ui.conclusion.summary, data.summary);
  if (data.gap_assessment) {
    appendTextBlock(lines, 'Gap assessment', data.gap_assessment);
  }
  const evidence = mergeBrokenEvidenceFragments(
    Array.isArray(data.evidence) ? data.evidence.map(item => String(item || '')) : []
  ).filter(Boolean);
  if (evidence.length > 0) {
    pushLine(lines, `${ui.conclusion.evidence}:`);
    evidence.forEach((item, index) => {
      pushLine(lines, `  ${index + 1}. ${normalizeDisplayText(item)}`);
    });
    pushLine(lines);
  }
};

const appendInvestmentConclusion = (
  lines: string[],
  conclusion: InvestmentConclusion,
  ui: ReturnType<typeof getUIText>
) => {
  pushSectionTitle(lines, ui.investmentThesis);
  appendTextBlock(lines, ui.investmentNarrative, conclusion.investment_narrative);
  if (Array.isArray(conclusion.cross_dimensional_insights) && conclusion.cross_dimensional_insights.length > 0) {
    pushLine(lines, `${ui.crossDimensionalInsights}:`);
    conclusion.cross_dimensional_insights.forEach((item, index) => {
      pushLine(lines, `  ${index + 1}. ${normalizeDisplayText(item)}`);
    });
    pushLine(lines);
  }

  for (const key of THESIS_SECTION_KEYS) {
    const section = conclusion[key];
    if (!section) continue;
    appendConclusionSection(lines, ui.conclusion[key], section, ui);
  }
};

const appendFinalConclusion = (
  lines: string[],
  finalConclusion: FinalConclusion,
  language: Language,
  ui: ReturnType<typeof getUIText>
) => {
  pushSectionTitle(lines, ui.finalConclusion);

  if (finalConclusion.decision) {
    appendTextBlock(lines, ui.finalConclusionConfidence, `${finalConclusion.decision.confidence_score}/5`);
    appendTextBlock(lines, labelFor(language, 'Rating', '评级'), finalConclusion.decision.rating);
    appendTextBlock(lines, ui.finalConclusionBearDownside, finalConclusion.decision.bear_case_downside);
    if (finalConclusion.decision.gap_assessment) {
      appendTextBlock(
        lines,
        labelFor(language, 'Gap assessment', '预期差评估'),
        finalConclusion.decision.gap_assessment === 'Limited'
          ? ui.finalConclusionGapLimited
          : ui.finalConclusionGapSignificant
      );
    }
    appendTextBlock(lines, ui.finalConclusionInvalidation, finalConclusion.decision.thesis_invalidation);
    if (finalConclusion.decision.bear_case_conditions?.length) {
      pushLine(lines, `${labelFor(language, 'Bear case conditions', 'Bear Case 条件')}:`);
      finalConclusion.decision.bear_case_conditions.forEach((item, index) => {
        pushLine(lines, `  ${index + 1}. ${normalizeDisplayText(item)}`);
      });
      pushLine(lines);
    }
  }

  appendTextBlock(
    lines,
    labelFor(language, 'Overall conclusion', '总体结论'),
    finalConclusion.overall_conclusion
  );

  if (finalConclusion.vs_prior) {
    appendTextBlock(
      lines,
      ui.followUpPriorConclusion,
      finalConclusion.vs_prior.prior_overall_conclusion
    );
    if (finalConclusion.vs_prior.rating_change) {
      appendTextBlock(
        lines,
        labelFor(language, 'Rating change', '评级变化'),
        finalConclusion.vs_prior.rating_change
      );
    }
    appendTextBlock(
      lines,
      labelFor(language, 'Change summary', '变化摘要'),
      finalConclusion.vs_prior.change_summary
    );
  }

  if (finalConclusion.bullet_points?.length) {
    pushLine(lines, ui.finalConclusionKeyArguments + ':');
    finalConclusion.bullet_points.forEach((point, index) => {
      pushLine(lines, `${index + 1}. ${normalizeDisplayText(point.argument)}`);
      const evidence = mergeBrokenEvidenceFragments(
        Array.isArray(point.evidence) ? point.evidence.map(item => String(item || '')) : []
      ).filter(Boolean);
      evidence.forEach(item => {
        pushLine(lines, `   - ${normalizeDisplayText(item)}`);
      });
      pushLine(lines);
    });
  }
};

const appendQna = (lines: string[], qna: QnAResult[], ui: ReturnType<typeof getUIText>) => {
  pushSectionTitle(lines, ui.detailedAnalysis);
  qna.forEach((item, index) => {
    pushLine(lines, `${index + 1}. ${normalizeDisplayText(item.question)}`);
    pushLine(lines, normalizeDisplayText(item.answer));
    if (item.sources?.length) {
      pushLine(lines, `${ui.sources}:`);
      item.sources.forEach(source => {
        const title = normalizeDisplayText(source.title || source.uri || '');
        if (source.uri) {
          pushLine(lines, `  - ${title} (${source.uri})`);
        } else {
          pushLine(lines, `  - ${title}`);
        }
      });
    }
    pushLine(lines);
  });
};

export const formatCompanyAnalysisAsText = (
  company: CompanyAnalysis,
  language: Language,
  options?: { heading?: string }
): string => {
  const ui = getUIText(language);
  const lines: string[] = [];

  if (options?.heading) {
    pushLine(lines, options.heading);
    pushLine(lines, MAIN_DIVIDER);
  }

  appendProfile(lines, company.profile, language, ui);

  if (company.quickTake) {
    appendTextBlock(lines, language === 'cn' ? '快速概览' : 'Quick take', company.quickTake);
  }

  if (company.priorBaseline) {
    pushSectionTitle(lines, language === 'cn' ? '对比基准' : 'Prior baseline');
    appendTextBlock(lines, language === 'cn' ? '基准日期' : 'Baseline date', company.priorBaseline.analysisDate);
    appendTextBlock(lines, ui.currentPrice, company.priorBaseline.price);
    appendTextBlock(lines, ui.peTtm, company.priorBaseline.peTtm);
    appendTextBlock(lines, ui.marketCap, company.priorBaseline.marketCap);
    appendTextBlock(lines, language === 'cn' ? '当时结论' : 'Prior conclusion', company.priorBaseline.overallConclusion);
  }

  if (company.questions?.length) {
    pushSectionTitle(lines, language === 'cn' ? '研究问题' : 'Research questions');
    company.questions.forEach((question, index) => {
      pushLine(lines, `${index + 1}. ${normalizeDisplayText(question)}`);
    });
    pushLine(lines);
  }

  if (company.finalConclusion) {
    appendFinalConclusion(lines, company.finalConclusion, language, ui);
  }

  if (company.conclusion) {
    appendInvestmentConclusion(lines, company.conclusion, ui);
  }

  if (company.qna?.length) {
    appendQna(lines, company.qna, ui);
  }

  if (company.followUpQuestions?.length) {
    pushSectionTitle(lines, ui.followUp);
    company.followUpQuestions.forEach((question, index) => {
      pushLine(lines, `${index + 1}. ${normalizeDisplayText(question)}`);
    });
    pushLine(lines);
  }

  if (company.error) {
    appendTextBlock(lines, ui.errorTitle, company.error);
  }

  return lines.join('\n').trim();
};

export const formatAnalysisStateAsText = (state: AnalysisState, language: Language): string => {
  const ui = getUIText(language);
  const lines: string[] = [];

  pushLine(lines, MAIN_DIVIDER);
  pushLine(lines, language === 'cn' ? '完整分析报告' : 'Full Analysis Report');
  pushLine(lines, MAIN_DIVIDER);
  pushLine(lines);

  appendTextBlock(lines, language === 'cn' ? '查询' : 'Query', state.query);
  appendTextBlock(lines, ui.reportGeneratedAt, state.timestamp);
  appendTextBlock(lines, language === 'cn' ? '语言' : 'Language', state.language);
  appendTextBlock(lines, language === 'cn' ? '分析类型' : 'Analysis type', state.analysisType || 'initial');
  appendTextBlock(lines, language === 'cn' ? '状态' : 'Status', state.status);
  if (state.error) {
    appendTextBlock(lines, ui.errorTitle, state.error);
  }

  if (state.followUpMeta) {
    pushSectionTitle(lines, ui.followUpAnalysis);
    appendTextBlock(lines, language === 'cn' ? '上级分析 ID' : 'Parent analysis ID', state.followUpMeta.parentAnalysisId);
    appendTextBlock(lines, language === 'cn' ? '上级分析时间' : 'Parent timestamp', state.followUpMeta.parentTimestamp);
    appendTextBlock(lines, language === 'cn' ? '上级查询' : 'Parent query', state.followUpMeta.parentQuery);
  }

  if (state.focusCompany) {
    pushLine(lines);
    pushLine(lines, formatCompanyAnalysisAsText(state.focusCompany, language, {
      heading: language === 'cn' ? '【焦点公司】' : '[FOCUS COMPANY]',
    }));
  }

  for (const candidate of state.candidateCompanies || []) {
    pushLine(lines);
    pushLine(lines);
    pushLine(
      lines,
      formatCompanyAnalysisAsText(candidate, language, {
        heading:
          language === 'cn'
            ? `【候选公司：${candidate.profile.name} (${candidate.profile.ticker})】`
            : `[CANDIDATE: ${candidate.profile.name} (${candidate.profile.ticker})]`,
      })
    );
  }

  if (state.stepLogs?.length) {
    pushSectionTitle(lines, language === 'cn' ? '分析步骤日志' : 'Analysis step logs');
    state.stepLogs.forEach(log => {
      pushLine(
        lines,
        `- ${log.companyName} | ${log.label || log.step} | ${log.durationMs}ms | ${log.startedAt}`
      );
    });
    pushLine(lines);
  }

  pushLine(lines);
  pushLine(lines, MAIN_DIVIDER);
  pushLine(lines, language === 'cn' ? '报告结束' : 'End of report');
  pushLine(lines, MAIN_DIVIDER);

  return lines.join('\n');
};

export const buildReportTxtFilename = (
  ticker: string,
  companyName: string | null | undefined,
  completedAt?: string | null
): string => {
  const date = (completedAt || new Date().toISOString()).slice(0, 10);
  return `${sanitizeFilenamePart(ticker.toUpperCase())}_${sanitizeFilenamePart(companyName || ticker)}_${date}.txt`;
};

export const buildCategoryTxtFilename = (
  category: ConclusionCategory,
  language: Language
): string => {
  const ui = getUIText(language);
  const label = ui[getCatalogCategoryLabelKey(category)];
  const date = new Date().toISOString().slice(0, 10);
  return `catalog_${sanitizeFilenamePart(label)}_${date}.txt`;
};

export const formatCategoryReportsAsText = (params: {
  category: ConclusionCategory;
  language: Language;
  reports: Array<{ ticker: string; companyName: string | null; content: string }>;
}): string => {
  const ui = getUIText(params.language);
  const categoryLabel = ui[getCatalogCategoryLabelKey(params.category)];
  const lines: string[] = [];

  pushLine(lines, MAIN_DIVIDER);
  pushLine(
    lines,
    params.language === 'cn'
      ? `分析结论库导出 — ${categoryLabel}`
      : `Analysis Catalog Export — ${categoryLabel}`
  );
  pushLine(lines, MAIN_DIVIDER);
  pushLine(lines, `${params.language === 'cn' ? '导出时间' : 'Exported at'}: ${new Date().toISOString()}`);
  pushLine(lines, `${params.language === 'cn' ? '报告数量' : 'Report count'}: ${params.reports.length}`);
  pushLine(lines);

  params.reports.forEach((report, index) => {
    if (index > 0) {
      pushLine(lines);
      pushLine(lines, MAIN_DIVIDER);
      pushLine(lines);
    }
    pushLine(
      lines,
      params.language === 'cn'
        ? `报告 ${index + 1} / ${params.reports.length} — ${report.companyName || report.ticker} (${report.ticker})`
        : `Report ${index + 1} / ${params.reports.length} — ${report.companyName || report.ticker} (${report.ticker})`
    );
    pushLine(lines, SUB_DIVIDER);
    pushLine(lines);
    pushLine(lines, report.content);
  });

  pushLine(lines);
  pushLine(lines, MAIN_DIVIDER);
  pushLine(lines, params.language === 'cn' ? '分类导出结束' : 'End of category export');
  pushLine(lines, MAIN_DIVIDER);

  return lines.join('\n');
};
