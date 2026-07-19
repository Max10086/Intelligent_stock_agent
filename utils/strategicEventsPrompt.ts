import type { CompanyProfile, Language } from '../types.ts';
import { STRATEGIC_EVENTS_QUESTION_COUNT } from './questionCounts.ts';

export { STRATEGIC_EVENTS_QUESTION_COUNT };

/** Deterministic hard questions — every company analysis must answer these (web search). */
export const buildStrategicEventsQuestions = (
  company: Pick<CompanyProfile, 'name' | 'ticker' | 'exchange'>,
  lang: Language
): string[] => {
  const { name, ticker, exchange } = company;

  if (lang === 'cn') {
    return [
      `「${name}」（${ticker} / ${exchange}）在过去 90 个自然日内是否签署或披露了任何重大战略合作协议、合作备忘录（MoU）、合资/联营安排、或具名战略供应商/客户绑定协议？请逐条列出：公告或权威新闻日期（YYYY-MM-DD）、合作方全称、合作领域与技术方向、协议有效期或关键里程碑、当前进展（意向/签约/送样/量产/终止），并注明信息来源；若无相关事件亦须明确说明并给出检索范围。`,
      `「${name}」（${ticker} / ${exchange}）在过去 90 个自然日内有哪些可能改变投资论点的重大外部事件（含监管批复、产线通线/投产、产品送样、回购/增发、产能扩张、技术突破、并购/资产出售）？请按时间顺序列出事件、量化细节（金额/产能/份额/良率等）、对业务结构或供应链的影响，并区分已落地事实与尚未兑现的前瞻性表述。`,
    ].slice(0, STRATEGIC_EVENTS_QUESTION_COUNT);
  }

  return [
    `For "${name}" (${ticker} / ${exchange}), in the last 90 calendar days, were any major strategic cooperation agreements, memoranda of understanding (MoU), JVs/alliances, or named strategic supplier/customer binding deals signed or disclosed? List each with: announcement date (YYYY-MM-DD), counterparty legal name, scope/technology area, term or milestones, current status (intent/signed/sampling/mass production/terminated), and sources; if none, state that explicitly and describe what was searched.`,
    `For "${name}" (${ticker} / ${exchange}), what material external events in the last 90 calendar days could change the investment thesis (regulatory approval, line ramp/start-up, customer sampling, buyback/offering, capacity adds, tech breakthroughs, M&A/divestitures)? List chronologically with quantified details (amount/capacity/share/yield), impact on business mix or supply chain, and separate confirmed facts from forward-looking statements.`,
  ].slice(0, STRATEGIC_EVENTS_QUESTION_COUNT);
};

const formatFollowUpWindow = (sinceDate: string, today: Date): { sinceStr: string; todayStr: string } => ({
  sinceStr: sinceDate.slice(0, 10),
  todayStr: today.toISOString().slice(0, 10),
});

/** Deterministic hard questions for follow-up — window since prior analysis completion. */
export const buildFollowUpStrategicEventsQuestions = (
  company: Pick<CompanyProfile, 'name' | 'ticker' | 'exchange'>,
  lang: Language,
  sinceDate: string,
  today: Date = new Date()
): string[] => {
  const { name, ticker, exchange } = company;
  const { sinceStr, todayStr } = formatFollowUpWindow(sinceDate, today);

  if (lang === 'cn') {
    return [
      `「${name}」（${ticker} / ${exchange}）自上次分析完成日 ${sinceStr} 至 ${todayStr} 期间，是否签署或披露了任何重大战略合作协议、合作备忘录（MoU）、合资/联营安排、或具名战略供应商/客户绑定协议？请逐条列出：公告或权威新闻日期（YYYY-MM-DD）、合作方全称、合作领域与技术方向、协议有效期或关键里程碑、当前进展（意向/签约/送样/量产/终止），并注明信息来源；若无相关事件亦须明确说明并给出检索范围。`,
      `「${name}」（${ticker} / ${exchange}）在 ${sinceStr} 至 ${todayStr} 期间有哪些可能改变投资论点的重大外部事件（含监管批复、产线通线/投产、产品送样、回购/增发、产能扩张、技术突破、并购/资产出售）？请按时间顺序列出事件、量化细节（金额/产能/份额/良率等）、对业务结构或供应链的影响，并区分已落地事实与尚未兑现的前瞻性表述。`,
    ].slice(0, STRATEGIC_EVENTS_QUESTION_COUNT);
  }

  return [
    `For "${name}" (${ticker} / ${exchange}), between ${sinceStr} and ${todayStr} (since the prior analysis), were any major strategic cooperation agreements, memoranda of understanding (MoU), JVs/alliances, or named strategic supplier/customer binding deals signed or disclosed? List each with: announcement date (YYYY-MM-DD), counterparty legal name, scope/technology area, term or milestones, current status (intent/signed/sampling/mass production/terminated), and sources; if none, state that explicitly and describe what was searched.`,
    `For "${name}" (${ticker} / ${exchange}), what material external events between ${sinceStr} and ${todayStr} could change the investment thesis (regulatory approval, line ramp/start-up, customer sampling, buyback/offering, capacity adds, tech breakthroughs, M&A/divestitures)? List chronologically with quantified details (amount/capacity/share/yield), impact on business mix or supply chain, and separate confirmed facts from forward-looking statements.`,
  ].slice(0, STRATEGIC_EVENTS_QUESTION_COUNT);
};
