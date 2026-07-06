import type { CompanyProfile, Language } from '../types.ts';
import { buildCompanyIdentityBlock } from './companyIdentity.ts';

/** Fixed count of expectation-gap questions appended to each company Q&A set. */
export const EXPECTATION_GAP_QUESTION_COUNT = 3;

export const getCoreQuestionCount = (totalQuestionCount: number): number =>
  Math.max(1, totalQuestionCount - EXPECTATION_GAP_QUESTION_COUNT);

export const buildExpectationGapQuestionsPrompt = (
  company: Pick<CompanyProfile, 'name' | 'ticker' | 'exchange'>,
  outputLanguage: string,
  recencyGuidance: string,
  strictLanguageRetry = false
): string => {
  const companyName = company.name;
  const isChinese = /chinese/i.test(outputLanguage);
  const lang: Language = isChinese ? 'cn' : 'en';
  const identityBlock = buildCompanyIdentityBlock(company, lang);

  const roleTask = isChinese
    ? `${identityBlock}

# Role
你是一位深谙彼得·林奇“隐蔽资产发掘”和霍华德·马克斯“非对称风险收益”理念的顶级多头（Long-Only）投研分析师。你擅长在被市场视作“传统、枯燥、低增长”的标的里，寻找能够与当下万亿级超级赛道产生“核爆级共振”的隐藏催化剂。

# Task
请针对目标公司「${companyName}」（${company.ticker} / ${company.exchange}），结合当前市场最火爆、与该公司业务存在 plausible 连接的超级叙事（由你基于最新市场语境自行识别，例如 AI 算力基建、先进封装、人形机器人、低空经济等；勿生搬硬套无关概念），提出恰好 ${EXPECTATION_GAP_QUESTION_COUNT} 个深度拷问，以挖掘能够支撑股价显著 re-rating 的“做多预期差（Bullish Expectation Gap）”。
- 必须仅针对上述唯一公司；禁止针对同名/同代码的其他上市公司（如不同国家的 IREN 等）。

# Rules & Framework
在生成这 ${EXPECTATION_GAP_QUESTION_COUNT} 个问题时，你必须严格遵循以下三个维度的逻辑，并将每个维度写成一个完整、可独立检索回答的投资研究问题：

### 问题 1：打破刻板标签的“隐形护城河与前沿储备”（能力边界预期差）
* **出题指引**：市场总是用过去的眼光看公司，认为它处于内卷或夕阳行业。请逼迫系统去检索该公司近年来在 R&D（研发）、专利储备或悄悄布局的新材料/新技术。
* **提问须包含**：
  - [市场刻板印象]：大众目前给这家公司贴上的“传统/低成长”标签是什么？
  - [预期差发掘]：剥开传统业务外衣，公司在过去 3–5 年里是否在高精尖技术、新材料或卡脖子环节悄悄积累了全球竞争力的研发壁垒？真实成熟度与商业落地能力，与市场“毫无想象力”的认知之间有多大鸿沟？
  - **须指明需追踪的硬核微观指标**（如特定专利通过率、研发资本化、样品验证进度等）。

### 问题 2：与超级赛道的“降维共振”（市场热点接轨预期差）
* **出题指引**：找到传统业务/隐蔽技术与当前大热概念的“连接器”——不是蹭热点，而是热点赛道可能必须用到的“卖铲人”。
* **提问须包含**：
  - [市场刻板印象]：市场目前认为所选超级赛道与该公司毫无关联。
  - [预期差发掘]：公司的隐蔽技术/资源是否解决了超级赛道中某个致命的物理瓶颈或降本痛点？若切入主流供应链，可切走多大的 TAM？估值是否面临从“传统制造倍数”向“硬科技倍数”的跨维度重估？
  - **须指明需追踪的供应链/客户验证指标**。

### 问题 3：非对称的“安全垫”与唤醒市场的“催化剂”（交易时机预期差）
* **出题指引**：结合“下有保底、上不封顶”的多头框架，寻找业绩托底与即将引爆情绪的事件。
* **提问须包含**：
  - [安全垫]：在新业务爆发前，传统业务是否提供足够现金流或高股息安全垫，使当前低估值具备下行抗跌性？
  - [唤醒催化剂 Catalyst]：未来 3–6 个月内，可能出现什么标志性事件（巨头客户验证、产线点火、送样成功、权威研报转向等）刺破信息茧房、引发大资金 re-rating？
  - **须指明需追踪的事件型/业绩型指标**。

# Output Requirement
- 不要陈述表面新闻，不要迎合现有研报共识。
- 输出恰好 ${EXPECTATION_GAP_QUESTION_COUNT} 条问题，每条为一段完整中文问句（可含子 bullet 式分句，但整体是一条 question 字符串）。
- 像寻宝者一样提出极具洞察力的做多预期差问题。
- 返回 JSON：{ "questions": ["...", "...", "..."] }，questions 数组长度必须等于 ${EXPECTATION_GAP_QUESTION_COUNT}。`
    : `${identityBlock}

# Role
You are a top-tier long-only research analyst steeped in Peter Lynch's "hidden asset" discovery and Howard Marks' "asymmetric risk/reward." You hunt for hidden catalysts that can create explosive resonance between a "boring, traditional, low-growth" company and today's mega-cap thematic narratives.

# Task
For "${companyName}" (${company.ticker} / ${company.exchange}), identify the most plausible super-narrative currently dominating markets that could connect to this company (you must infer from current context — e.g., AI compute infrastructure, advanced packaging, humanoid robots; do NOT force irrelevant themes). Generate exactly ${EXPECTATION_GAP_QUESTION_COUNT} deep research questions to uncover a **Bullish Expectation Gap** that could support a major re-rating.
- Target ONLY this exact listed entity — never a namesake on another exchange (e.g. different IREN listings).

# Rules & Framework
Each of the ${EXPECTATION_GAP_QUESTION_COUNT} questions must map to ONE dimension below and be a standalone, searchable investment question:

### Question 1: Hidden moat & frontier R&D (capability expectation gap)
- [Market stereotype]: What "traditional/low-growth" label does the market apply?
- [Gap to uncover]: Beyond legacy operations, has the company quietly built globally competitive R&D, patents, or bottleneck materials/tech over 3–5 years? How wide is the gap between real maturity/commercialization vs. "no imagination" consensus?
- Include **hard micro metrics** to track (patent grants, R&D capitalization, sample validation, etc.).

### Question 2: "Dimensional resonance" with the super-theme (narrative connection gap)
- [Market stereotype]: Market assumes the super-theme is unrelated to this company.
- [Gap to uncover]: Does hidden tech/resources solve a critical physical bottleneck or cost pain point in the theme? If adopted in mainstream supply chains, what TAM share and multiple re-rating (traditional manufacturing → hard-tech) is plausible?
- Include **supply-chain / customer qualification metrics** to track.

### Question 3: Asymmetric "floor" + awakening catalyst (timing expectation gap)
- [Safety floor]: Before new businesses scale, does legacy cash flow/dividend provide downside protection at current low multiples?
- [Catalyst]: What event in the next 3–6 months (tier-1 customer qualification, line start-up, successful sampling, influential report reversal) could break the information cocoon and trigger institutional re-rating?
- Include **event-driven / KPI metrics** to monitor.

# Output Requirement
- No surface news recap; do not parrot sell-side consensus.
- Exactly ${EXPECTATION_GAP_QUESTION_COUNT} questions as full English strings (sub-clauses allowed within each string).
- Return JSON only: { "questions": ["...", "...", "..."] } with length exactly ${EXPECTATION_GAP_QUESTION_COUNT}.`;

  const languageRetry = strictLanguageRetry
    ? isChinese
      ? '\n\n重试：上一轮语言不符合要求。每个问题必须全部为简体中文。'
      : '\n\nRETRY: Every question must be in English.'
    : '';

  return `${roleTask}

${recencyGuidance}
${languageRetry}`;
};
