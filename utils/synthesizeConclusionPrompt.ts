import { InvestmentConclusion } from '../types.ts';
import { formatQnaForConclusion, formatQnaForSection } from './qnaTopicCompression.ts';

export interface SynthesizeConclusionQnA {
  question: string;
  answer: string;
  sources?: Array<{ title?: string; uri?: string }>;
}

const THESIS_WRITING_RULES_CN = `写作质量（对标卖方深度研报，务必达到以下密度）：
- "summary" 是一段连贯的分析性叙述（4-5句，约180-280字），不是短句堆砌。结构：最新时点事实与核心指标 → 关键战略/结构变化 → 技术或竞争动态（如适用）→ 对成本、护城河或周期敞口的投资含义。
- "evidence" 存放 summary 引述但未逐字重复的颗粒度证据，4-5条；每条必须是完整句子，含明确日期（YYYY-Qx / YYYY-MM / FYxxxx）、具体数字（金额/百分比/产能/份额）及实体名称（产品/客户/竞争对手/工厂）。
- 若 Q&A 含多年数据，至少一条 evidence 须做历史对比（如低谷期 vs 当前恢复期）。
- 优先采用最新披露期，并标明财年/自然年季度。
- 禁止空泛套话（如"公司前景良好"）；每句须可追溯到 Q&A 中的事实或由其推导的逻辑。`;

const THESIS_WRITING_RULES_EN = `Writing quality (institutional equity-research depth):
- "summary" is a connected analytical mini-essay (4-5 sentences, ~100-150 words), NOT telegraphic fragments. Structure: latest-period facts & metrics → key strategic/structural moves → technology or competitive dynamics (if relevant) → investment meaning for costs, moat, or cyclical exposure.
- "evidence" holds granular proof referenced by the summary but NOT copied verbatim. Provide 4-5 items; each MUST be a complete sentence with explicit dates (YYYY-Qx, YYYY-MM, FYxxxx), numbers ($/%/ capacity / share), and named entities (products, customers, competitors, fabs) when available.
- When Q&A contains multi-year data, include at least one evidence item contrasting trough vs recovery (e.g., 2023 vs 2026).
- Prefer the freshest disclosed period; label fiscal vs calendar quarters explicitly.
- No vague filler ("well positioned"). Every sentence must carry a verifiable fact or implication tied to facts.`;

const SECTION_EXAMPLES_CN: Record<
  ThesisSectionKey,
  { summary: string; evidence: string[] }
> = {
  UpstreamSupplyChain: {
    summary:
      '闪迪与铠侠共同运营日本四日市和北上合资工厂，2026-Q1及2026-03至2026-05期间呈现约50%实体装机稼动率与可交付产能100%售罄并存。2026-02闪迪支付11.65亿美元并将合资协议延长至2034年底，锁定长期晶圆供应控制权；同时加速从218层BiCS8向332层BiCS10及高带宽闪存（HBF）过渡，显著降低每GB成本并强化供应链韧性。',
    evidence: [
      '2026-06-02铠侠投资者日披露，四日市Fab 7与北上Fab 2 (K2)实体产能利用率约50%，计划以年均4700亿日元Capex在2029财年将产能翻倍。',
      '2026全年已安装可交付NAND产能于2026年初被完全预订，双方合资工厂2026年Capex预算约45亿美元（同比+41%）。',
      '2026-02闪迪与铠侠将合资协议延长5年至2034-12-31，并承诺2026-2029年分期支付11.65亿美元以锁定优先晶圆分配。',
      '218层BiCS8预计2026财年末占公司Bit产量多数；北上K2厂房已确定用于量产332层BiCS10（存储密度提升59%）。',
      '闪迪计划2026-H2提供首批高带宽闪存（HBF）系统样品，介质耐久性介于DRAM与NAND之间。',
    ],
  },
  MarketPosition: {
    summary:
      '闪迪仍是全球消费级存储卡与移动SSD领头羊。2026-Q1长江存储在低端快速抢份额，全球营收份额与闪迪极度逼近；但闪迪主动收缩低毛利商品化闪存，全力向高端企业级eSSD、UFS 4.1及旗舰消费/移动SSD倾斜，以技术迭代与品牌生态护城河避开价格肉搏并维持中高端溢价。',
    evidence: [
      '2026-Q1全球NAND营收市场中，长江存储份额由去年同期8%升至13%（营收同比+445%），与闪迪、美光、铠侠在1%区间内缠斗。',
      '2026-04 NAB Show发布读写3700MB/s、获VPG-1600认证的CFexpress 4.0 Type B 4TB卡，及Extreme PRO Portable SSD - E83（获最佳移动存储奖）。',
      '2026-04正式出货基于BiCS8 QLC并支持UFS 4.1的iNAND MC EU721，以及面向AI PC的PCIe Gen5 Optimus GX PRO 8100内置SSD。',
      '2026-Q1（2026财年Q3）数据中心业务同比大幅增长，非GAAP毛利率由一年前22.5%暴增至78.4%，印证高端转型避开低端肉搏。',
    ],
  },
  BusinessModel: {
    summary:
      '商业模式从商品化NAND向"高端消费+企业数据中心+端侧AI存储"三层变现演进。2026-Q1数据中心与高毛利产品线占比提升，驱动收入结构从周期Beta向技术溢价Alpha迁移；合资晶圆+自有控制器/固件的垂直整合仍是核心盈利引擎。',
    evidence: [
      '2026-Q1（2026财年Q3）数据中心相关业务营收同比显著增长，成为毛利率扩张主驱动力。',
      '消费端以CFexpress、Extreme PRO及UFS 4.1等高端SKU维持品牌溢价，低端commodity NAND主动让出份额。',
      '2026-04出货iNAND MC EU721与Optimus GX PRO 8100，标志端侧AI/AI PC存储新变现曲线启动。',
      '与铠侠合资模式+BiCS代际迭代构成"晶圆成本+技术密度"双轮驱动的收入模型。',
    ],
  },
  Financials: {
    summary:
      '随着行业走出2023-2024严重低谷，闪迪2026年财务呈现近乎垂直的"V型"反转。2026-Q1（2026财年Q3）营收同比+251%，非GAAP毛利率创纪录78.4%，单季调整后自由现金流近30亿美元；公司未计提资产减值，还清全部定期贷款，实现零长期债务与极高现金安全垫。',
    evidence: [
      '对比历史低谷：2023年毛利率仅7%，自由现金流-9.32亿美元；2024年毛利率16%，自由现金流-3.38亿美元。',
      '2025财年全年毛利率回升至30.1%，自由现金流减亏至-1.20亿美元接近盈亏平衡。',
      '2026-Q1（截至2026-04-03）：单季营收59.50亿美元（同比+251%），非GAAP毛利率78.4%创历史新高，调整后FCF 29.55亿美元（FCF利润率49.7%）。',
      '截至2026-04-03存货22.4亿美元，存货周转天数约121天，未计提商誉或长期资产减值。',
      '2026-Q1还清剩余6.5亿美元定期贷款，实现零长期债务，现金及等价物37.35亿美元。',
    ],
  },
  OutlookRisks: {
    summary:
      '上行驱动来自AI/端侧算力带动的eSSD与HBF需求、BiCS10量产降本及合资产能翻倍；主要风险为NAND价格再度下行、长江存储等本土竞争加剧及Capex高峰对FCF的阶段性挤压。2026-H2 HBF样品与客户验证进度是近端关键催化剂。',
    evidence: [
      '2026年合资工厂Capex约45亿美元（+41% YoY），短期可能压制FCF但为2029财年产能翻倍奠基。',
      '长江存储2026-Q1全球份额升至13%，低端价格竞争或拖累commodity segment。',
      'BiCS10量产与HBF 2026-H2样品交付若顺利，有望巩固高端定价权。',
      '管理层在2026-Q1业绩会强调可交付产能已100%预订，但需跟踪2026-H2 ASP走势。',
    ],
  },
  MarketSentiment: {
    summary:
      '市场情绪随"V型"业绩反转显著回暖，78.4%毛利率与近30亿美元单季FCF强化周期反转叙事；但NAND同业份额缠斗及前期股价波动意味着乐观预期部分已计价。后续 re-rating 取决于2026-H2 ASP能否维持及HBF/AI存储新品能否兑现溢价。',
    evidence: [
      '2026-Q1业绩公布后，卖方普遍上调2026财年EPS预测，反映盈利预期修正。',
      '2026-Q1非GAAP毛利率78.4% vs 一年前22.5%，超预期幅度驱动正面情绪。',
      '同业长江存储份额快速上升引发对长期竞争格局的讨论，部分压制估值扩张空间。',
      '2026-H2 HBF样品与BiCS10放量为潜在情绪催化剂。',
    ],
  },
  IndustryCycle: {
    summary:
      'NAND行业自2023-2024深度低谷进入2026年强劲复苏，产能利用率与ASP同步回升；闪迪凭借高端mix与合资产能锁定处于复苏前端。但50%实体稼动率与100%可交付预订并存，暗示供给扩张与价格拐点风险仍存，周期弹性双向放大。',
    evidence: [
      '2023-2024行业低谷期闪迪毛利率7%-16%，2026-Q1回升至78.4%，印证周期反转强度。',
      '2026-06铠侠披露合资厂实体稼动率约50%，可交付产能2026年初已100%预订。',
      '2026年行业Capex预算同比+41%，2029财年产能翻倍计划或改变中期供需平衡。',
      '2026-Q1全球NAND份额前五厂商差距收窄至1%区间，竞争强度随复苏上升。',
    ],
  },
  ExpectationGap: {
    summary:
      '市场仍将闪迪视为"周期Beta存储股"，对其在AI先进封装/HBF等硬科技叙事的定价几乎为零。预期差在于：332层BiCS10与HBF若于2026-H2完成Tier-1验证，估值框架或从周期商品倍数切换至AI基础设施溢价；当前78.4%毛利率与零长期债务提供罕见的安全垫，而100%产能预订与HBF样品进度构成3–6个月内可验证的唤醒催化剂。',
    evidence: [
      '[刻板印象] 卖方普遍以NAND ASP周期与commodity倍数定价，对HBF/玻璃基板类硬科技optionality几乎未计价。',
      '[隐蔽能力] 2026-02合资延期至2034+BiCS10路线图显示59%密度跃升，专利与产线转换进度领先市场认知。',
      '[赛道共振] AI算力/先进封装对高带宽存储介质需求刚性，HBF样品2026-H2交付是切入数万亿TAM的关键验证节点。',
      '[安全垫] 2026-Q1 FCF近30亿美元、零长期债务，即便新叙事延迟，下行空间有限。',
      '[催化剂] 跟踪2026-H2 HBF客户Qual结果、BiCS10量产良率及Tier-1 CSP/design-in公告。',
    ],
  },
};

const SECTION_EXAMPLES_EN: Record<
  ThesisSectionKey,
  { summary: string; evidence: string[] }
> = {
  UpstreamSupplyChain: {
    summary:
      'SanDisk and Kioxia jointly operate Yokkaichi and Kitakami fabs; in 2026-Q1 and Mar-May 2026, physical utilization ran ~50% while installable deliverable capacity was 100% sold out. A Feb-2026 $1.165B payment and JV extension through 2034 locked long-term wafer control, while the tech stack accelerates from 218-layer BiCS8 to 332-layer BiCS10 and HBF, cutting $/GB cost and strengthening supply resilience.',
    evidence: [
      'On 2026-06-02 Kioxia disclosed Fab 7 (Yokkaichi) and Fab 2 K2 (Kitakami) physical utilization ~50%, targeting capacity doubling by FY2029 with ~¥470B annual capex.',
      'Full-year 2026 installable NAND deliverable capacity was fully booked by early 2026; JV 2026 capex budget ~$4.5B (+41% YoY).',
      'Feb-2026 agreement extended the JV to 2034-12-31 with $1.165B paid over 2026-2029 for priority wafer allocation.',
      '218-layer BiCS8 expected to dominate bit output by FY2026-end; Kitakami K2 qualified for 332-layer BiCS10 (+59% density).',
      'First HBF system samples planned for 2026-H2, durability between DRAM and NAND.',
    ],
  },
  MarketPosition: {
    summary:
      'SanDisk remains the global leader in consumer cards and portable SSDs. In 2026-Q1 Yangtze Memory rapidly gained low-end share, narrowing global revenue share to within ~1% of SanDisk; SanDisk deliberately exited low-margin commodity NAND, pivoting to enterprise eSSD, UFS 4.1, and flagship consumer/mobile SSDs, using tech iteration and brand ecosystem to avoid price wars and preserve premium mix.',
    evidence: [
      '2026-Q1 global NAND revenue share: Yangtze Memory rose from 8% to 13% YoY (+445% revenue), battling SanDisk, Micron, and Kioxia within a 1% band.',
      'Apr-2026 NAB Show: CFexpress 4.0 Type B 4TB card at 3700MB/s with VPG-1600; Extreme PRO Portable SSD E83 won best mobile storage.',
      'Apr-2026 shipments: BiCS8 QLC iNAND MC EU721 (UFS 4.1) and AI PC PCIe Gen5 Optimus GX PRO 8100 SSD.',
      '2026-Q1 (FY2026 Q3) datacenter revenue surged YoY; non-GAAP gross margin jumped from 22.5% to 78.4%, validating the premium pivot.',
    ],
  },
  BusinessModel: {
    summary:
      'The model is evolving from commodity NAND toward three monetization layers: premium consumer, enterprise datacenter, and edge-AI storage. 2026-Q1 mix shift toward high-margin lines moves earnings from cycle beta toward tech-premium alpha; JV wafers plus in-house controllers/firmware remain the core profit engine.',
    evidence: [
      '2026-Q1 (FY2026 Q3) datacenter-related revenue grew sharply YoY, driving most of the margin expansion.',
      'Premium SKUs (CFexpress, Extreme PRO, UFS 4.1) sustain brand pricing while commodity NAND share is deliberately reduced.',
      'Apr-2026 iNAND MC EU721 and Optimus GX PRO 8100 shipments mark a new edge-AI / AI PC revenue line.',
      'Kioxia JV plus BiCS generational cadence underpin a wafer-cost + density-driven revenue model.',
    ],
  },
  Financials: {
    summary:
      'Emerging from the 2023-2024 trough, SanDisk’s 2026 financials show a near-vertical V-shaped reversal. 2026-Q1 (FY2026 Q3) revenue rose 251% YoY, non-GAAP gross margin hit a record 78.4%, and adjusted FCF approached $3B in one quarter; with zero impairments, all term loans repaid, and no long-term debt, balance-sheet quality is exceptionally strong.',
    evidence: [
      'Trough comparison: FY2023 gross margin 7%, FCF -$932M; FY2024 gross margin 16%, FCF -$338M.',
      'FY2025 gross margin recovered to 30.1%; FCF narrowed to -$120M, near breakeven.',
      '2026-Q1 (through 2026-04-03): revenue $5.95B (+251% YoY), non-GAAP GM 78.4% record, adjusted FCF $2.955B (49.7% FCF margin).',
      'As of 2026-04-03 inventory $2.24B, ~121 DIO, no goodwill or long-asset impairments.',
      '2026-Q1 repaid remaining $650M term loans; zero long-term debt; cash $3.735B.',
    ],
  },
  OutlookRisks: {
    summary:
      'Upside drivers include AI/edge eSSD and HBF demand, BiCS10 cost-down, and JV capacity doubling; key risks are NAND ASP relapse, intensifying China competition, and capex peaks pressuring near-term FCF. 2026-H2 HBF sampling and customer qualification are the nearest catalysts.',
    evidence: [
      '2026 JV capex ~$4.5B (+41% YoY) may temporarily constrain FCF but funds FY2029 capacity doubling.',
      'Yangtze Memory share hit 13% in 2026-Q1; low-end price competition may drag commodity segments.',
      'BiCS10 ramp and 2026-H2 HBF samples, if successful, could reinforce premium pricing.',
      'Management noted 100% deliverable capacity booked in 2026-Q1 but 2026-H2 ASP trends need monitoring.',
    ],
  },
  MarketSentiment: {
    summary:
      'Sentiment warmed sharply on the V-shaped reversal—78.4% GM and ~$3B quarterly FCF reinforce the upcycle narrative—but NAND share battles and prior volatility mean optimism is partly priced in. Further re-rating depends on 2026-H2 ASP durability and AI-storage product premium delivery.',
    evidence: [
      'Post-2026-Q1 earnings, brokers broadly raised FY2026 EPS estimates.',
      'Non-GAAP GM 78.4% vs 22.5% a year ago exceeded expectations and fueled positive tone.',
      'Rapid Yangtze Memory share gains sparked debate on long-term competitive structure, capping multiple expansion.',
      '2026-H2 HBF samples and BiCS10 volume are potential sentiment catalysts.',
    ],
  },
  IndustryCycle: {
    summary:
      'NAND moved from the 2023-2024 deep trough into a strong 2026 recovery with utilization and ASP rebounding; SanDisk sits at the recovery front with premium mix and locked JV supply. Yet ~50% physical utilization alongside 100% deliverable bookings signals supply expansion and price-turn risk—cycle beta works both ways.',
    evidence: [
      'SanDisk GM trough 7%-16% in 2023-2024 vs 78.4% in 2026-Q1 confirms reversal magnitude.',
      'Jun-2026 Kioxia disclosed ~50% physical utilization while 2026 deliverable capacity was fully booked early in the year.',
      '2026 industry capex +41% YoY; FY2029 doubling plan may shift mid-cycle supply/demand.',
      '2026-Q1 top-five NAND vendors clustered within a 1% revenue-share band as competition intensifies with recovery.',
    ],
  },
  ExpectationGap: {
    summary:
      'The market still prices SanDisk as a cyclical NAND beta with near-zero credit for AI/advanced-packaging/HBF optionality. The bullish expectation gap: if 332-layer BiCS10 and HBF pass Tier-1 validation in 2026-H2, multiples could re-rate from commodity cycle to AI-infrastructure; 78.4% GM and zero net debt provide a rare floor while 100% bookings and HBF sampling are verifiable 3–6 month awakening catalysts.',
    evidence: [
      '[Stereotype] Consensus uses NAND ASP cycle/commodity multiples; little value ascribed to HBF/hard-tech narrative.',
      '[Hidden capability] Feb-2026 JV extension to 2034 + BiCS10 +59% density roadmap ahead of market perception.',
      '[Theme resonance] AI compute/advanced packaging needs high-bandwidth memory media; 2026-H2 HBF samples are the TAM entry proof point.',
      '[Safety floor] ~$3B quarterly FCF and zero long-term debt limit downside if narrative delays.',
      '[Catalyst] Track 2026-H2 HBF qual results, BiCS10 yield ramp, Tier-1 CSP/design-in announcements.',
    ],
  },
};

export const THESIS_SECTION_KEYS = [
  'UpstreamSupplyChain',
  'MarketPosition',
  'BusinessModel',
  'Financials',
  'OutlookRisks',
  'MarketSentiment',
  'IndustryCycle',
  'ExpectationGap',
] as const;

export type ThesisSectionKey = (typeof THESIS_SECTION_KEYS)[number];

const buildFullJsonExample = (examples: typeof SECTION_EXAMPLES_CN): string =>
  JSON.stringify(
    Object.fromEntries(
      THESIS_SECTION_KEYS.map(key => [key, examples[key]])
    ),
    null,
    2
  );

const SECTION_GUIDES: Record<ThesisSectionKey, string> = {
  UpstreamSupplyChain:
    'suppliers, JV/partnerships, fab capacity & utilization, capex, offtake agreements, technology node transitions, input cost & supply resilience',
  MarketPosition:
    'global/regional share, competitive ranking vs named peers, product launches, pricing/mix strategy, moat (brand/tech/channel), share gains/losses',
  BusinessModel:
    'revenue mix by segment, monetization layers, vertical integration, strategic pivot (commodity vs premium), new product lines',
  Financials:
    'revenue/margin/FCF trajectory, multi-year V-shape or trend, balance sheet (debt/cash/inventory/impairments), YoY and vs-trough comparisons',
  OutlookRisks:
    'growth drivers, near-term catalysts, competitive/policy/supply risks, capex cycle, what would change the thesis',
  MarketSentiment:
    'what is priced in, broker/flow sentiment, earnings surprise vs expectations, catalysts that could re-rate or de-rate the stock',
  IndustryCycle:
    'cycle phase (trough/recovery/expansion/peak), utilization & ASP dynamics, capex/supply pipeline, company positioning vs peers in the cycle',
  ExpectationGap:
    'market expectation gap vs current consensus: what the market still misprices or oversimplifies from today forward (next 3–6 months), near-term narrative correction, verifiable milestones/catalysts — synthesize ONLY from expectation-gap Q&A; do NOT rehash already-priced-in past-year events',
};

export const buildSynthesizeConclusionPrompt = (
  companyName: string,
  outputLanguage: string,
  recencyGuidance: string,
  qna: SynthesizeConclusionQnA[],
  strictRetry = false
): string => {
  const isChinese = /chinese/i.test(outputLanguage);
  const jsonExample = buildFullJsonExample(isChinese ? SECTION_EXAMPLES_CN : SECTION_EXAMPLES_EN);
  const writingRules = isChinese ? THESIS_WRITING_RULES_CN : THESIS_WRITING_RULES_EN;
  const qnaPayload = formatQnaForConclusion(qna);

  const base = `You are a senior investment analyst. Based on the Q&A below for "${companyName}", synthesize a structured investment thesis in ${outputLanguage}.

HARD REQUIREMENTS (must follow exactly):
- Return ONLY valid JSON. No markdown fences, no commentary, no extra keys.
- Top-level keys MUST be exactly: UpstreamSupplyChain, MarketPosition, BusinessModel, Financials, OutlookRisks, MarketSentiment, IndustryCycle, ExpectationGap.
- Each section MUST contain "summary" AND "evidence" (array of strings).
- Each section's "evidence" MUST contain 4 to 5 items. Empty arrays are NOT allowed.
- Each evidence item MUST cite specific numbers, dates, periods (YYYY-Qx / YYYY-MM / FYxxxx), or discrete facts taken directly from the Q&A.
- Do NOT put all facts only in "summary" and leave "evidence" empty.
- Prefer the freshest data per recency rules; note period labels explicitly.
- When citing sources from Q&A, you may reference the source title in parentheses when available.

${writingRules}

Required JSON shape (match this depth and structure — replace with facts for "${companyName}", not the example company):
${jsonExample}

Section mapping guide:
- UpstreamSupplyChain: ${SECTION_GUIDES.UpstreamSupplyChain}
- MarketPosition: ${SECTION_GUIDES.MarketPosition}
- BusinessModel: ${SECTION_GUIDES.BusinessModel}
- Financials: ${SECTION_GUIDES.Financials}
- OutlookRisks: ${SECTION_GUIDES.OutlookRisks}
- MarketSentiment: ${SECTION_GUIDES.MarketSentiment}
- IndustryCycle: ${SECTION_GUIDES.IndustryCycle}
- ExpectationGap: ${SECTION_GUIDES.ExpectationGap}

IMPORTANT — ExpectationGap section:
- Must distill the three market expectation-gap research questions and their answers.
- Focus on what consensus may still miss **from now forward** (next 3–6 months), not long-past events already priced in.
- Explicitly contrast [current market framing] vs [near-term verifiable upside or correction].
- Do NOT recycle generic consensus or rehash last year's news as if it were new alpha.

${recencyGuidance}
When evidence conflicts across years, prioritize the latest period and explain differences briefly.

Respond ONLY with a valid JSON object matching the required shape.

Q&A Context: ${JSON.stringify(qnaPayload)}`;

  if (!strictRetry) return base;

  return `${base}

CRITICAL RETRY: Your previous response was too thin or had missing evidence. Put the FULL JSON in the response content field. EVERY section needs a 4-5 sentence summary (~180-280 Chinese chars) AND 4-5 evidence strings with dates and numbers from the Q&A.`;
};

export const buildSynthesizeSectionPrompt = (
  companyName: string,
  outputLanguage: string,
  recencyGuidance: string,
  qna: SynthesizeConclusionQnA[],
  sectionKey: ThesisSectionKey,
  strictRetry = false,
  marketContext?: string
): string => {
  const isChinese = /chinese/i.test(outputLanguage);
  const examples = isChinese ? SECTION_EXAMPLES_CN : SECTION_EXAMPLES_EN;
  const example = examples[sectionKey];
  const writingRules = isChinese ? THESIS_WRITING_RULES_CN : THESIS_WRITING_RULES_EN;
  const jsonExample = JSON.stringify(
    {
      [sectionKey]: {
        summary: example.summary,
        evidence: example.evidence,
      },
    },
    null,
    2
  );
  const qnaPayload = formatQnaForSection(qna, sectionKey, 12, 2000);

  const base = `You are a senior investment analyst. Based on the Q&A below for "${companyName}", write ONLY the "${sectionKey}" section of an investment thesis in ${outputLanguage}.

HARD REQUIREMENTS (must follow exactly):
- Return ONLY valid JSON. No markdown fences, no commentary, no extra keys.
- Top-level key MUST be exactly "${sectionKey}".
- "${sectionKey}" MUST contain "summary" AND "evidence" (array of 4-5 strings).
- Each evidence item MUST cite specific numbers, dates, periods, or discrete facts from the Q&A.
- Do NOT leave "evidence" empty.
- Use facts for "${companyName}" only — the JSON example below shows desired depth/style, not content to copy.
${marketContext ? '- For stock price / valuation / sentiment at current levels, use the VERIFIED MARKET SNAPSHOT — reject stale pre-split or historical prices as "current".' : ''}

${writingRules}

Focus for this section: ${SECTION_GUIDES[sectionKey]}

Required JSON shape (match this depth):
${jsonExample}

${marketContext ? `${marketContext}\n\n` : ''}${recencyGuidance}
When evidence conflicts across years, prioritize the latest period.

Q&A Context (topic-filtered & fact-compressed): ${JSON.stringify(qnaPayload)}`;

  if (!strictRetry) return base;

  return `${base}

CRITICAL RETRY: Previous output was too thin. Put the FULL JSON in the response content field with a 4-5 sentence summary AND 4-5 evidence strings containing quantitative facts from the Q&A.`;
};

export const hasUsableInvestmentSection = (
  sectionKey: ThesisSectionKey,
  section: InvestmentConclusion[ThesisSectionKey] | undefined,
  minEvidence = 3
): boolean => {
  const summary = (section?.summary || '').trim();
  const evidence = Array.isArray(section?.evidence) ? section.evidence.filter(Boolean) : [];
  const minSummaryLength = 80;
  return summary.length >= minSummaryLength && evidence.length >= minEvidence;
};

export const hasUsableInvestmentConclusion = (
  conclusion: InvestmentConclusion | null | undefined,
  minEvidencePerSection = 3
): boolean => {
  if (!conclusion) return false;

  let sectionsWithSummary = 0;
  let sectionsWithEvidence = 0;

  for (const key of THESIS_SECTION_KEYS) {
    const section = conclusion[key];
    const summary = (section?.summary || '').trim();
    const evidence = Array.isArray(section?.evidence) ? section.evidence.filter(Boolean) : [];
    if (summary.length >= 80) sectionsWithSummary += 1;
    if (evidence.length >= minEvidencePerSection) sectionsWithEvidence += 1;
  }

  const totalSections = THESIS_SECTION_KEYS.length;
  return sectionsWithSummary >= totalSections && sectionsWithEvidence >= totalSections - 1;
};

export { formatQnaForConclusion, formatQnaForSection } from './qnaTopicCompression.ts';
