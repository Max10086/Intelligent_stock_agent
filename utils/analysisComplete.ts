import type { AnalysisState, CompanyAnalysis, FinalConclusion } from '../types.ts';
import { indexAnsweredQuestions } from './qnaHelpers.ts';
import { hasUsableInvestmentConclusion } from './synthesizeConclusionPrompt.ts';

export type FinalConclusionQualityOptions = {
  gapAssessment?: 'Limited' | 'Significant' | null;
};

const normalizeRatingToken = (rating: string): string | null => {
  const normalized = rating.replace(/[（(].*$/, '').trim();
  if (/strong buy|强烈买入|强力买入/i.test(normalized)) return 'Strong Buy';
  if (/^buy$|买入/i.test(normalized) && !/overweight|增持/i.test(normalized)) return 'Buy';
  if (/overweight|增持/i.test(normalized)) return 'Overweight';
  if (/^hold$|持有/i.test(normalized)) return 'Hold';
  if (/^reduce$|减持/i.test(normalized)) return 'Reduce';
  if (/^sell$|卖出/i.test(normalized)) return 'Sell';
  return normalized.split(/\s+/)[0] || null;
};

/** Prefer structured decision.rating, then legacy Step-3 line, then opening sentence. */
export const extractOfficialRating = (
  source: string | FinalConclusion | null | undefined
): string | null => {
  const fc =
    typeof source === 'string'
      ? ({ overall_conclusion: source } as FinalConclusion)
      : source;
  if (!fc) return null;

  const fromDecision = fc.decision?.rating?.trim();
  if (fromDecision) return normalizeRatingToken(fromDecision);

  const overall = fc.overall_conclusion || '';
  const ratingLine =
    overall.match(/【评级】\s*([^\n（(]+)/)?.[1]?.trim() ||
    overall.match(/\[Rating\]\s*([^\n(]+)/i)?.[1]?.trim() ||
    overall.match(/(?:^|\n)\s*(Strong Buy|Buy|Overweight|Hold|Reduce|Sell)\b/im)?.[1]?.trim() ||
    overall.match(/(?:^|\n)\s*(强烈买入|强力买入|买入|增持|持有|减持|卖出)\b/m)?.[1]?.trim();

  if (!ratingLine) return null;
  return normalizeRatingToken(ratingLine);
};

const isMandatoryCategoryBullet = (text: string): boolean => {
  const lower = text.toLowerCase();
  return (
    lower.includes('bear case') ||
    lower.includes('失效') ||
    lower.includes('invalidation') ||
    ((lower.includes('估值') || lower.includes('valuation')) &&
      (lower.includes('安全边际') || lower.includes('margin of safety') || lower.includes('中枢') || lower.includes('median'))) ||
    lower.includes('预期差有限') ||
    lower.startsWith('limited expectation gap') ||
    (lower.includes('预期差') && !lower.includes('预期差有限')) ||
    (lower.includes('expectation gap') && !lower.startsWith('limited expectation gap'))
  );
};

const countSubstantiveBullets = (bulletTexts: string[]): number =>
  bulletTexts.filter(text => !isMandatoryCategoryBullet(text)).length;

const isBullishRating = (rating: string | null): boolean =>
  Boolean(
    rating &&
      /^(Strong Buy|Buy|Overweight|强烈买入|强力买入|买入|增持)$/i.test(rating.trim())
  );

const isBuyTierRating = (rating: string | null): boolean =>
  Boolean(rating && /^(Strong Buy|Buy|强烈买入|强力买入|买入)$/i.test(rating.trim()));

const isOverweightRating = (rating: string | null): boolean =>
  Boolean(rating && /^(Overweight|增持)$/i.test(rating.trim()));

const validateBulletRequirements = (
  bulletTexts: string[],
  bulletTextsLower: string[],
  officialRating: string | null,
  isLimitedGap: boolean,
  issues: string[]
): void => {
  const hasBearCaseBullet = bulletTextsLower.some(
    t =>
      t.includes('bear case') ||
      t.includes('bear case:') ||
      t.includes('下行风险') ||
      t.includes('空头')
  );
  if (!hasBearCaseBullet) {
    issues.push('missing Bear Case bullet (argument should start with Bear Case: or mention 下行风险)');
  }

  const hasFailureBullet = bulletTextsLower.some(
    t => t.includes('失效') || t.includes('证伪') || t.includes('invalidation')
  );
  if (!hasFailureBullet) issues.push('missing thesis invalidation bullet');

  const hasValuationBullet = bulletTextsLower.some(
    t =>
      (t.includes('估值') || t.includes('valuation')) &&
      (t.includes('中枢') ||
        t.includes('同业') ||
        t.includes('安全边际') ||
        t.includes('median') ||
        t.includes('peer') ||
        t.includes('margin of safety'))
  );
  if (!hasValuationBullet) {
    issues.push('missing valuation margin bullet (估值/valuation + 中枢/同业/安全边际)');
  }

  if (isBullishRating(officialRating)) {
    const hasExpectationGapBullet = bulletTextsLower.some(
      t => t.includes('预期差') || t.includes('expectation gap') || t.includes('expectation-gap')
    );
    if (!hasExpectationGapBullet) {
      issues.push('bullish rating requires an ExpectationGap-related bullet');
    }
  }

  if (isLimitedGap) {
    const hasLimitedGapBullet = bulletTexts.some(
      t => t.includes('预期差有限') || /^limited expectation gap/i.test(t)
    );
    if (!hasLimitedGapBullet) {
      issues.push('Limited gap requires bullet argument starting with or containing 预期差有限');
    }
  }
};

const validateRatingCaps = (
  officialRating: string | null,
  confidenceScore: number | null,
  issues: string[]
): void => {
  if (confidenceScore == null || !officialRating) return;
  if (isBuyTierRating(officialRating) && confidenceScore < 4) {
    issues.push(`Buy-tier rating "${officialRating}" requires confidence >= 4 (got ${confidenceScore})`);
  }
  if (isOverweightRating(officialRating) && confidenceScore < 3) {
    issues.push(`Overweight rating requires confidence >= 3 (got ${confidenceScore})`);
  }
};

const validateLimitedGapRules = (
  officialRating: string | null,
  overall: string,
  isLimitedGap: boolean,
  issues: string[]
): void => {
  if (!isLimitedGap) return;
  if (/Strong Buy|强烈买入|强力买入/i.test(officialRating || overall)) {
    issues.push('Limited expectation gap forbids Strong Buy');
  }
  if (isBuyTierRating(officialRating) && !/预期差有限|\(limited expectation gap\)/i.test(overall)) {
    issues.push('Limited gap + Buy rating requires "预期差有限" note in overall_conclusion opening');
  }
};

const getNewFormatQualityIssues = (
  finalConclusion: FinalConclusion,
  options: FinalConclusionQualityOptions
): string[] => {
  const issues: string[] = [];
  const overall = (finalConclusion.overall_conclusion || '').trim();
  const decision = finalConclusion.decision!;
  const bullets = Array.isArray(finalConclusion.bullet_points) ? finalConclusion.bullet_points : [];
  const bulletTexts = bullets.map(b => (b.argument || '').trim());
  const bulletTextsLower = bulletTexts.map(t => t.toLowerCase());
  const officialRating = extractOfficialRating(finalConclusion);
  const gapAssessment =
    decision.gap_assessment ?? options.gapAssessment ?? null;
  const isLimitedGap = gapAssessment === 'Limited';

  if (!decision.rating?.trim()) issues.push('missing decision.rating');
  if (!Number.isFinite(decision.confidence_score) || decision.confidence_score < 1 || decision.confidence_score > 5) {
    issues.push('decision.confidence_score must be an integer 1-5');
  }
  if (!decision.bear_case_downside?.trim()) {
    issues.push('missing decision.bear_case_downside');
  }
  if (!decision.thesis_invalidation?.trim()) {
    issues.push('missing decision.thesis_invalidation');
  }
  if (!Array.isArray(decision.bear_case_conditions) || decision.bear_case_conditions.length < 3) {
    issues.push('decision.bear_case_conditions must contain at least 3 items');
  }

  if (overall.length < 150) {
    issues.push(`overall_conclusion too short (${overall.length} chars, need >= 150 for prose summary)`);
  }
  if (/【[^】]+】/.test(overall)) {
    issues.push('overall_conclusion must not contain 【】 section headers — use flowing prose only');
  }
  if (/【Bear Case|【Thesis|【评级】|【Executive|\[Bear Case Review\]|\[Thesis Confidence\]|\[Rating\]/i.test(overall)) {
    issues.push('overall_conclusion must not contain structured analysis section markers');
  }

  if (bullets.length < 8) issues.push(`bullet_points count ${bullets.length} (need >= 8)`);

  const substantiveCount = countSubstantiveBullets(bulletTexts);
  if (substantiveCount < 4) {
    issues.push(`need >= 4 substantive thesis bullets beyond risk/gap categories (got ${substantiveCount})`);
  }

  if (!officialRating) {
    issues.push('missing official rating in decision.rating or overall_conclusion opening');
  }

  validateRatingCaps(officialRating, decision.confidence_score, issues);
  validateLimitedGapRules(officialRating, overall, isLimitedGap, issues);
  validateBulletRequirements(bulletTexts, bulletTextsLower, officialRating, isLimitedGap, issues);

  return issues;
};

const getLegacyFormatQualityIssues = (
  finalConclusion: FinalConclusion,
  options: FinalConclusionQualityOptions
): string[] => {
  const issues: string[] = [];
  const overall = (finalConclusion.overall_conclusion || '').trim();
  const bullets = Array.isArray(finalConclusion.bullet_points) ? finalConclusion.bullet_points : [];
  const bulletTexts = bullets.map(b => (b.argument || '').trim());
  const bulletTextsLower = bulletTexts.map(t => t.toLowerCase());
  const officialRating = extractOfficialRating(finalConclusion);
  const gapAssessment = options.gapAssessment ?? null;
  const isLimitedGap =
    gapAssessment === 'Limited' ||
    /预期差有限|Limited Gap Identified|gap_assessment["']?\s*:\s*["']Limited/i.test(overall);

  if (overall.length < 120) issues.push(`overall_conclusion too short (${overall.length} chars, need >= 120)`);
  if (bullets.length < 5) issues.push(`bullet_points count ${bullets.length} (need >= 5)`);

  const hasConfidenceScore =
    /置信度[：:\】]?\s*[1-5]\s*\/\s*5/.test(overall) ||
    /【Thesis 置信度】\s*[1-5]\s*\/\s*5/.test(overall) ||
    /Confidence:\s*[1-5]\/5/i.test(overall);
  if (!hasConfidenceScore) {
    issues.push('missing confidence score (置信度：X/5 or Confidence: X/5 or 【Thesis 置信度】X/5)');
  }

  const hasBearCaseDownside =
    /Bear Case\s*下行[：:]\s*[\d\-]+%/i.test(overall) ||
    /Bear Case downside:\s*[\d\-]+%/i.test(overall) ||
    /下行空间[：:]\s*[\d\-]+%/.test(overall) ||
    /(?:股价)?可能下行[^%\n]{0,24}(-?\d+(?:\.\d+)?\s*[%％])/i.test(overall) ||
    /(-?\d+(?:\.\d+)?\s*[%％])\s*(?:至|to|-)\s*(-?\d+(?:\.\d+)?\s*[%％])/.test(overall);
  if (!hasBearCaseDownside) {
    issues.push('missing Bear Case downside estimate (Bear Case 下行：Y% or downside range)');
  }

  if (
    !officialRating &&
    !/(Strong Buy|Buy|Overweight|Hold|Reduce|Sell|强烈买入|强力买入|买入|增持|持有|减持|卖出)/i.test(overall)
  ) {
    issues.push('missing official rating in Step-3 rating line');
  }

  const hasThesisFailureCondition =
    /如果.{0,180}(将失效|发生.{0,60}失效)|失效条件|thesis.{0,30}失效|thesis fails|re-evaluate immediately/i.test(
      overall
    );
  if (!hasThesisFailureCondition) {
    issues.push('missing thesis invalidation condition (如果…将失效 / thesis fails / re-evaluate immediately)');
  }

  validateBulletRequirements(bulletTexts, bulletTextsLower, officialRating, isLimitedGap, issues);

  const scoreMatch =
    overall.match(/置信度[：:\】]?\s*([1-5])\s*\/\s*5/) ||
    overall.match(/【Thesis 置信度】\s*([1-5])\s*\/\s*5/) ||
    overall.match(/Confidence:\s*([1-5])\/5/i);
  if (scoreMatch) {
    validateRatingCaps(officialRating, Number.parseInt(scoreMatch[1], 10), issues);
  }

  validateLimitedGapRules(officialRating, overall, isLimitedGap, issues);

  return issues;
};

export const getFinalConclusionQualityIssues = (
  finalConclusion: FinalConclusion | null | undefined,
  options: FinalConclusionQualityOptions = {}
): string[] => {
  if (!finalConclusion) return ['missing finalConclusion'];

  if (finalConclusion.decision?.rating) {
    return getNewFormatQualityIssues(finalConclusion, options);
  }

  return getLegacyFormatQualityIssues(finalConclusion, options);
};

export const hasUsableFinalConclusion = (
  finalConclusion: FinalConclusion | null | undefined,
  options: FinalConclusionQualityOptions = {}
): boolean => getFinalConclusionQualityIssues(finalConclusion, options).length === 0;

export const buildFinalConclusionStrictRetrySuffix = (
  qualityIssues: string[] = []
): string => {
  const issueBlock =
    qualityIssues.length > 0
      ? `\n\nYour previous output FAILED these quality checks:\n${qualityIssues.map(i => `- ${i}`).join('\n')}`
      : '';

  return `
CRITICAL RETRY: 上次输出未通过质量门控。${issueBlock}

必须满足：
- "decision" 对象完整：rating、confidence_score(1-5)、bear_case_downside、bear_case_conditions(>=3)、thesis_invalidation、gap_assessment
- "overall_conclusion" 为简洁 prose executive summary（Meta 示例风格），150-400 字，禁止 【】 标题或四段结构化 dump
- overall_conclusion 首句 rating 须与 decision.rating 一致；Limited gap 时首句注明「预期差有限」
- bullet_points 8-12 条：含 Bear Case / 失效条件 / 估值安全边际 / 预期差 四类，外加 >=4 条实质性 thesis 论据（竞争优势、成长催化剂、财务健康、行业景气等）

请重新生成完整 JSON，不要省略 decision 或 prose summary。`.trim();
};

export const isCompanyAnalysisComplete = (
  company: CompanyAnalysis | null | undefined
): boolean => {
  if (!company) return false;

  const questions = Array.isArray(company.questions) ? company.questions : [];
  const qna = Array.isArray(company.qna) ? company.qna : [];
  if (questions.length === 0) return false;

  const { pendingIndices } = indexAnsweredQuestions(questions, qna);
  if (pendingIndices.length > 0) return false;

  return (
    hasUsableInvestmentConclusion(company.conclusion) &&
    hasUsableFinalConclusion(company.finalConclusion, {
      gapAssessment: company.conclusion?.ExpectationGap?.gap_assessment ?? null,
    })
  );
};

/** Companies that started Q&A but are missing thesis or final conclusion. */
export const isCandidateAwaitingUser = (
  company: CompanyAnalysis | null | undefined
): boolean => company?.status === 'awaiting_user';

export const findIncompleteCompanies = (
  companies: Array<CompanyAnalysis | null | undefined>
): CompanyAnalysis[] => {
  return companies.filter((company): company is CompanyAnalysis => {
    if (!company) return false;
    if (isCandidateAwaitingUser(company)) return false;
    const qna = Array.isArray(company.qna) ? company.qna : [];
    if (qna.length === 0) return false;
    return !isCompanyAnalysisComplete(company);
  });
};

/** Reconcile session/company status after loading from DB (JSON may lag UI ref on save). */
export const normalizeReportOnLoad = (state: AnalysisState): AnalysisState => {
  const normalizeCompany = (company: CompanyAnalysis | null | undefined): CompanyAnalysis | null => {
    if (!company) return null;
    if (isCandidateAwaitingUser(company)) return company;
    if (isCompanyAnalysisComplete(company)) {
      return { ...company, status: 'complete', error: undefined };
    }
    return company;
  };

  const focusCompany = normalizeCompany(state.focusCompany);
  const candidateCompanies = (state.candidateCompanies || [])
    .map(company => normalizeCompany(company))
    .filter(Boolean) as CompanyAnalysis[];

  const allCompanies = [focusCompany, ...candidateCompanies].filter(Boolean) as CompanyAnalysis[];
  const incomplete = findIncompleteCompanies(allCompanies);
  const hasAwaitingCandidates = candidateCompanies.some(isCandidateAwaitingUser);

  let status = state.status;
  if (state.status !== 'error' && state.status !== 'analyzing' && state.status !== 'finding_companies') {
    if (incomplete.length > 0 || hasAwaitingCandidates) {
      status = 'partial';
    } else if (allCompanies.every(c => isCompanyAnalysisComplete(c))) {
      status = 'complete';
    }
  }

  return {
    ...state,
    focusCompany,
    candidateCompanies,
    status,
  };
};
