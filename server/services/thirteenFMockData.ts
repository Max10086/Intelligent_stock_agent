import type {
  ThirteenFInstitution,
  ThirteenFQuarterId,
  ThirteenFQuarterOption,
} from '../../types/thirteenF.js';
import { normalizeInstitutionCik } from '../../utils/thirteenFInstitutionSearch.js';

/** Searchable 13F filers (mock catalog; real SEC ingest will extend this). */
export const THIRTEEN_F_INSTITUTION_CATALOG: ThirteenFInstitution[] = [
  {
    cik: '0001350694',
    name: 'Bridgewater Associates LP',
    shortName: 'Bridgewater',
    description:
      'Founded by Ray Dalio in 1975, Bridgewater is one of the largest hedge funds globally, known for macro and risk-parity strategies.',
    latestQuarter: '2025-Q2',
  },
  {
    cik: '0001067983',
    name: 'Berkshire Hathaway Inc',
    shortName: 'Berkshire',
    description: 'Warren Buffett\'s conglomerate holding company with a concentrated long-term equity portfolio.',
    latestQuarter: '2025-Q2',
  },
  {
    cik: '0001167483',
    name: 'Tiger Global Management LLC',
    shortName: 'Tiger Global',
    description: 'Global investment firm focused on public and private technology-oriented equities.',
    latestQuarter: '2025-Q2',
  },
  {
    cik: '0001697748',
    name: 'ARK Investment Management LLC',
    shortName: 'ARK Invest',
    description: 'Actively managed ETFs centered on disruptive innovation themes (Cathie Wood).',
    latestQuarter: '2025-Q2',
  },
  {
    cik: '0001037389',
    name: 'Renaissance Technologies LLC',
    shortName: 'RenTech',
    description: 'Quantitative hedge fund pioneer using systematic models across global markets.',
    latestQuarter: '2025-Q2',
  },
  {
    cik: '0001336528',
    name: 'Pershing Square Capital Management LP',
    shortName: 'Pershing Square',
    description: 'Activist hedge fund led by Bill Ackman, known for concentrated high-conviction bets.',
    latestQuarter: '2025-Q2',
  },
  {
    cik: '0001423053',
    name: 'Citadel Advisors LLC',
    shortName: 'Citadel',
    description: 'Multi-strategy platform spanning quantitative and fundamental investing.',
    latestQuarter: '2025-Q2',
  },
  {
    cik: '0001061768',
    name: 'Baupost Group LLC',
    shortName: 'Baupost',
    description: 'Value-oriented hedge fund founded by Seth Klarman.',
    latestQuarter: '2025-Q2',
  },
  {
    cik: '0001040273',
    name: 'Third Point LLC',
    shortName: 'Third Point',
    description: 'Event-driven and activist hedge fund led by Daniel Loeb.',
    latestQuarter: '2025-Q2',
  },
  {
    cik: '0001103804',
    name: 'Viking Global Investors LP',
    shortName: 'Viking Global',
    description: 'Long/short equity hedge fund with a fundamental research process.',
    latestQuarter: '2025-Q2',
  },
  {
    cik: '0001512920',
    name: 'Sprott Inc.',
    shortName: 'Sprott',
    description:
      'Precious metals and critical materials asset manager (successor to legacy Sprott Asset Management 13F filer).',
    latestQuarter: '2025-Q2',
  },
  {
    cik: '0001273087',
    name: 'Millennium Management LLC',
    shortName: 'Millennium',
    description: 'Multi-manager platform running diverse quantitative and discretionary strategies.',
    latestQuarter: '2025-Q2',
  },
  {
    cik: '0001175483',
    name: 'Two Sigma Investments LP',
    shortName: 'Two Sigma',
    description: 'Systematic investing firm applying data science and technology at scale.',
    latestQuarter: '2025-Q2',
  },
  {
    cik: '0001649339',
    name: 'Scion Asset Management, LLC',
    shortName: 'Scion',
    description:
      'Michael Burry’s concentrated value fund; filed 13F-HR through 2025 (SEC registration terminated Nov 2025).',
    latestQuarter: '2025-Q2',
  },
  {
    cik: '0001536411',
    name: 'Duquesne Family Office LLC',
    shortName: 'Duquesne',
    description: 'Family office of Stanley Druckenmiller with macro and equity exposure.',
    latestQuarter: '2025-Q2',
  },
  {
    cik: '0001656456',
    name: 'Appaloosa LP',
    shortName: 'Appaloosa (Tepper)',
    description:
      'Global macro and distressed fund founded by David Tepper. SEC filer Appaloosa LP (replaced legacy Appaloosa Management LP).',
    latestQuarter: '2026-Q2',
  },
];

/** Default institutions used when seeding an empty watchlist. */
const PRESET_CIKS = [
  '0001350694', // Bridgewater
  '0001067983', // Berkshire
  '0001167483', // Tiger Global
  '0001697748', // ARK Invest
  '0001336528', // Pershing Square
  '0001536411', // Duquesne
  '0001656456', // Appaloosa
  '0001649339', // Scion
] as const;

export const THIRTEEN_F_PRESET_INSTITUTIONS: ThirteenFInstitution[] = PRESET_CIKS.map(cik => {
  const institution = THIRTEEN_F_INSTITUTION_CATALOG.find(
    item => normalizeInstitutionCik(item.cik) === cik
  );
  if (!institution) {
    throw new Error(`Missing preset institution CIK ${cik}`);
  }
  return institution;
});

export type SeedChangeHint = 'NEW' | 'CLEAR';

export interface SeedHolding {
  ticker: string;
  name: string;
  sector: string;
  weightPct: number;
  priceUsd: number;
  sharesDeltaPct?: number;
  /** Explicit NEW/CLEAR; overrides sharesDeltaPct heuristics. */
  changeHint?: SeedChangeHint;
}

/** Positions fully exited last quarter — not in current holdings table. */
export interface ClearedPosition {
  ticker: string;
  name: string;
  sector: string;
  priorWeightPct: number;
  priceUsd: number;
}

/** Futubull Bridgewater Q2 2025 sector weights (行业分布). */
export const BRIDGEWATER_SECTOR_DISTRIBUTION: Array<{
  key: string;
  label: string;
  weightPct: number;
}> = [
  { key: 'electronics', label: '电子', weightPct: 17.91 },
  { key: 'mining', label: '采掘', weightPct: 10.92 },
  { key: 'healthcare', label: '医药生物', weightPct: 10.16 },
  { key: 'computer', label: '计算机', weightPct: 8.96 },
  { key: 'trade', label: '商业贸易', weightPct: 6.33 },
  { key: 'other', label: '其他', weightPct: 45.72 },
];

const BRIDGEWATER_SEED: SeedHolding[] = [
  { ticker: 'NVDA', name: 'NVIDIA Corp', sector: 'Technology', weightPct: 4.84, priceUsd: 214.72, sharesDeltaPct: -0.5 },
  { ticker: 'AMZN', name: 'Amazon.com Inc', sector: 'Consumer', weightPct: 3.04, priceUsd: 258.63, sharesDeltaPct: -1.2 },
  { ticker: 'AVGO', name: 'Broadcom Inc', sector: 'Technology', weightPct: 2.81, priceUsd: 368.45, sharesDeltaPct: -0.3 },
  { ticker: 'GOOGL', name: 'Alphabet Inc Class A', sector: 'Communication', weightPct: 2.79, priceUsd: 344.82, sharesDeltaPct: -0.8 },
  { ticker: 'NEM', name: 'Newmont Corp', sector: 'Materials', weightPct: 2.05, priceUsd: 131.58, sharesDeltaPct: 2.1 },
  { ticker: 'MSFT', name: 'Microsoft Corp', sector: 'Technology', weightPct: 2.0, priceUsd: 483.24, sharesDeltaPct: -0.4 },
  { ticker: 'LRCX', name: 'Lam Research Corp', sector: 'Technology', weightPct: 1.69, priceUsd: 314.0, sharesDeltaPct: -1.5 },
  { ticker: 'AMD', name: 'Advanced Micro Devices', sector: 'Technology', weightPct: 1.46, priceUsd: 473.25, sharesDeltaPct: -1.8 },
  { ticker: 'ORCL', name: 'Oracle Corp', sector: 'Technology', weightPct: 1.23, priceUsd: 146.47, sharesDeltaPct: -0.2 },
  { ticker: 'JNJ', name: 'Johnson & Johnson', sector: 'Healthcare', weightPct: 1.05, priceUsd: 270.24, sharesDeltaPct: 0.1 },
  { ticker: 'STX', name: 'Seagate Technology', sector: 'Technology', weightPct: 0.98, priceUsd: 850.0, sharesDeltaPct: -0.9 },
  { ticker: 'PCG', name: 'PG&E Corp', sector: 'Utilities', weightPct: 0.61, priceUsd: 17.6, sharesDeltaPct: 8.5 },
  { ticker: 'EIX', name: 'Edison International', sector: 'Utilities', weightPct: 0.51, priceUsd: 71.59, sharesDeltaPct: 6.2 },
  { ticker: 'RIG', name: 'Transocean Ltd', sector: 'Energy', weightPct: 0.18, priceUsd: 4.12, sharesDeltaPct: 45 },
  { ticker: 'MU', name: 'Micron Technology', sector: 'Technology', weightPct: 0.65, priceUsd: 966.78, sharesDeltaPct: -3.2 },
  { ticker: 'AAPL', name: 'Apple Inc', sector: 'Technology', weightPct: 0.66, priceUsd: 309.35, sharesDeltaPct: -0.3 },
  { ticker: 'SHEL', name: 'Shell plc', sector: 'Energy', weightPct: 0.82, priceUsd: 93.33, sharesDeltaPct: 3.5 },
  { ticker: 'MPC', name: 'Marathon Petroleum', sector: 'Energy', weightPct: 0.73, priceUsd: 360.72, sharesDeltaPct: 4.1 },
  { ticker: 'KOS', name: 'Kosmos Energy', sector: 'Energy', weightPct: 0.09, priceUsd: 8.15, changeHint: 'NEW' },
  { ticker: 'NTNX', name: 'Nutanix Inc', sector: 'Technology', weightPct: 0.11, priceUsd: 68.2, changeHint: 'NEW' },
  { ticker: 'LLY', name: 'Eli Lilly & Co', sector: 'Healthcare', weightPct: 0.64, priceUsd: 1255.4, sharesDeltaPct: 0.5 },
  { ticker: 'WFC', name: 'Wells Fargo & Co', sector: 'Financials', weightPct: 0.56, priceUsd: 83.84, sharesDeltaPct: 1.2 },
  { ticker: 'VST', name: 'Vistra Corp', sector: 'Utilities', weightPct: 0.6, priceUsd: 136.21, sharesDeltaPct: 5.8 },
];

const BERKSHIRE_SEED: SeedHolding[] = [
  { ticker: 'AAPL', name: 'Apple Inc', sector: 'Technology', weightPct: 28.5, priceUsd: 309.35, sharesDeltaPct: -5 },
  { ticker: 'AXP', name: 'American Express', sector: 'Financials', weightPct: 18.2, priceUsd: 298.5, sharesDeltaPct: 0 },
  { ticker: 'BAC', name: 'Bank of America', sector: 'Financials', weightPct: 11.4, priceUsd: 46.2, sharesDeltaPct: -2 },
  { ticker: 'KO', name: 'Coca-Cola Co', sector: 'Consumer', weightPct: 10.8, priceUsd: 68.4, sharesDeltaPct: 0 },
  { ticker: 'CVX', name: 'Chevron Corp', sector: 'Energy', weightPct: 6.2, priceUsd: 158.3, sharesDeltaPct: 1.5 },
  { ticker: 'OXY', name: 'Occidental Petroleum', sector: 'Energy', weightPct: 5.1, priceUsd: 52.8, sharesDeltaPct: 3 },
  { ticker: 'KHC', name: 'Kraft Heinz Co', sector: 'Consumer', weightPct: 3.8, priceUsd: 34.2, sharesDeltaPct: 0 },
  { ticker: 'MCO', name: 'Moody\'s Corp', sector: 'Financials', weightPct: 2.9, priceUsd: 478.0, sharesDeltaPct: 0.5 },
  { ticker: 'CB', name: 'Chubb Ltd', sector: 'Financials', weightPct: 2.5, priceUsd: 312.0, sharesDeltaPct: 8 },
  { ticker: 'DVA', name: 'DaVita Inc', sector: 'Healthcare', weightPct: 1.2, priceUsd: 168.0, sharesDeltaPct: 0 },
];

const BRIDGEWATER_CLEARED: ClearedPosition[] = [
  { ticker: 'AMKR', name: 'Amkor Technology', sector: 'Technology', priorWeightPct: 0.18, priceUsd: 28.5 },
  { ticker: 'CRDO', name: 'Credo Technology', sector: 'Technology', priorWeightPct: 0.14, priceUsd: 92.4 },
  { ticker: 'ONTO', name: 'Onto Innovation', sector: 'Technology', priorWeightPct: 0.12, priceUsd: 88.6 },
  { ticker: 'INSP', name: 'Inspire Medical Systems', sector: 'Healthcare', priorWeightPct: 0.09, priceUsd: 145.2 },
];

const BERKSHIRE_CLEARED: ClearedPosition[] = [
  { ticker: 'HPQ', name: 'HP Inc', sector: 'Technology', priorWeightPct: 0.35, priceUsd: 32.4 },
  { ticker: 'VZ', name: 'Verizon Communications', sector: 'Communication', priorWeightPct: 0.28, priceUsd: 42.1 },
];

const INSTITUTION_CLEARED: Record<string, ClearedPosition[]> = {
  '0001350694': BRIDGEWATER_CLEARED,
  '0001067983': BERKSHIRE_CLEARED,
};

const INSTITUTION_SEEDS: Record<string, SeedHolding[]> = {
  '0001350694': BRIDGEWATER_SEED,
  '0001067983': BERKSHIRE_SEED,
  '0001167483': BRIDGEWATER_SEED.slice(0, 18).map(row => ({
    ...row,
    weightPct: row.weightPct * 0.85,
    sharesDeltaPct: (row.sharesDeltaPct ?? 0) * 1.2,
  })),
  '0001649339': [
    { ticker: 'BABA', name: 'Alibaba Group', sector: 'Consumer', weightPct: 16.4, priceUsd: 84.8, sharesDeltaPct: 0 },
    { ticker: 'BIDU', name: 'Baidu Inc', sector: 'Communication', weightPct: 11.2, priceUsd: 88.0, sharesDeltaPct: 2 },
    { ticker: 'JD', name: 'JD.com Inc', sector: 'Consumer', weightPct: 9.8, priceUsd: 38.5, sharesDeltaPct: -3 },
    { ticker: 'LULU', name: 'Lululemon Athletica', sector: 'Consumer', weightPct: 8.5, priceUsd: 342.0, sharesDeltaPct: 5 },
    { ticker: 'EL', name: 'Estée Lauder', sector: 'Consumer', weightPct: 7.1, priceUsd: 68.0, sharesDeltaPct: -8 },
    { ticker: 'GEO', name: 'Geo Group Inc', sector: 'Real Estate', weightPct: 6.4, priceUsd: 22.5, sharesDeltaPct: 12 },
    { ticker: 'VFC', name: 'VF Corp', sector: 'Consumer', weightPct: 5.9, priceUsd: 14.2, sharesDeltaPct: -5 },
  ],
  '0001697748': [
    { ticker: 'TSLA', name: 'Tesla Inc', sector: 'Consumer', weightPct: 8.5, priceUsd: 425.0, sharesDeltaPct: 2 },
    { ticker: 'COIN', name: 'Coinbase Global', sector: 'Financials', weightPct: 6.2, priceUsd: 285.0, sharesDeltaPct: 5 },
    { ticker: 'ROKU', name: 'Roku Inc', sector: 'Communication', weightPct: 4.8, priceUsd: 92.0, sharesDeltaPct: -12 },
    { ticker: 'TDOC', name: 'Teladoc Health', sector: 'Healthcare', weightPct: 3.1, priceUsd: 8.5, sharesDeltaPct: -20 },
    { ticker: 'PATH', name: 'UiPath Inc', sector: 'Technology', weightPct: 2.9, priceUsd: 14.2, sharesDeltaPct: 15 },
    { ticker: 'NVDA', name: 'NVIDIA Corp', sector: 'Technology', weightPct: 5.4, priceUsd: 214.72, sharesDeltaPct: 8 },
    { ticker: 'PLTR', name: 'Palantir Technologies', sector: 'Technology', weightPct: 4.2, priceUsd: 178.0, sharesDeltaPct: 12 },
  ],
  '0001037389': BRIDGEWATER_SEED.slice(0, 15).map(row => ({
    ...row,
    weightPct: row.weightPct * 0.6,
    sharesDeltaPct: (row.sharesDeltaPct ?? 0) * 0.3,
  })),
};

export const QUARTER_CALENDAR: ThirteenFQuarterOption[] = [
  { quarter: '2026-Q2', filingDate: '2026-08-14', reportDate: '2026-06-30', isLatest: true },
  { quarter: '2026-Q1', filingDate: '2026-05-15', reportDate: '2026-03-31', isLatest: false },
  { quarter: '2025-Q4', filingDate: '2026-02-14', reportDate: '2025-12-31', isLatest: false },
  { quarter: '2025-Q2', filingDate: '2025-08-14', reportDate: '2025-06-30', isLatest: false },
  { quarter: '2025-Q1', filingDate: '2025-05-15', reportDate: '2025-03-31', isLatest: false },
  { quarter: '2024-Q4', filingDate: '2025-02-14', reportDate: '2024-12-31', isLatest: false },
];

const TOTAL_AUM_USD = 17_250_000_000;

export const getInstitutionByCik = (cik: string): ThirteenFInstitution | undefined => {
  const normalized = normalizeInstitutionCik(cik);
  return THIRTEEN_F_INSTITUTION_CATALOG.find(
    item => normalizeInstitutionCik(item.cik) === normalized
  );
};

export const getSeedHoldings = (cik: string): SeedHolding[] =>
  INSTITUTION_SEEDS[cik] ?? BRIDGEWATER_SEED;

export const getClearedPositions = (cik: string): ClearedPosition[] =>
  INSTITUTION_CLEARED[cik] ?? BRIDGEWATER_CLEARED.slice(0, 2);

export const resolveQuarterMeta = (
  quarter?: ThirteenFQuarterId | null
): ThirteenFQuarterOption => {
  if (quarter) {
    const found = QUARTER_CALENDAR.find(item => item.quarter === quarter);
    if (found) return found;
  }
  return QUARTER_CALENDAR[0];
};

export const priorQuarter = (quarter: ThirteenFQuarterId): ThirteenFQuarterId => {
  const idx = QUARTER_CALENDAR.findIndex(item => item.quarter === quarter);
  if (idx >= 0 && idx < QUARTER_CALENDAR.length - 1) {
    return QUARTER_CALENDAR[idx + 1].quarter;
  }
  return '2025-Q1';
};

export const scaleAumForQuarter = (quarter: ThirteenFQuarterId): number => {
  const idx = QUARTER_CALENDAR.findIndex(item => item.quarter === quarter);
  const factor = 1 - idx * 0.02;
  return TOTAL_AUM_USD * factor;
};

