import type { ThirteenFConsensusStock } from '../types/thirteenF.ts';
import { consensusPriorityScore } from './thirteenFConsensus.ts';

const GRID = { left: 88, right: 32, top: 40, bottom: 56 };
const MIN_CLUSTER_SIZE = 3;
const CLUSTER_BAND_RATIO = 0.1;
const MIN_CLUSTER_BAND_USD = 3_000_000;
const LOCAL_SPREAD_PASSES = 8;
const LOCAL_MIN_GAP_PX = 8;

export interface ConsensusBubbleCluster {
  id: string;
  institutionCount: number;
  direction: ThirteenFConsensusStock['direction'];
  stocks: ThirteenFConsensusStock[];
  centroidY: number;
  totalAbsDeltaUsd: number;
  netDeltaUsd: number;
}

export type ConsensusBubbleDisplayKind = 'single' | 'cluster' | 'member';

export interface ConsensusBubbleDisplayItem {
  kind: ConsensusBubbleDisplayKind;
  clusterId: string | null;
  stock: ThirteenFConsensusStock;
  cluster: ConsensusBubbleCluster | null;
  x: number;
  y: number;
  sizePx: number;
  score: number;
}

export interface ConsensusBubbleLayoutResult {
  items: ConsensusBubbleDisplayItem[];
  clusters: ConsensusBubbleCluster[];
  yMin: number;
  yMax: number;
  maxInstitutions: number;
  maxScore: number;
  grid: typeof GRID;
}

const groupKey = (stock: ThirteenFConsensusStock): string =>
  `${stock.institutionCount}:${stock.direction}`;

const clusterIdFor = (
  institutionCount: number,
  direction: ThirteenFConsensusStock['direction'],
  index: number
): string => `${institutionCount}-${direction}-${index}`;

const bubbleSizePx = (absDelta: number, maxAbsDelta: number, count = 1): number => {
  const countBoost = count > 1 ? Math.sqrt(count) * 0.22 + 0.78 : 1;
  return (Math.sqrt(absDelta / maxAbsDelta) * 68 + 16) * countBoost;
};

const buildCluster = (
  stocks: ThirteenFConsensusStock[],
  institutionCount: number,
  direction: ThirteenFConsensusStock['direction'],
  index: number
): ConsensusBubbleCluster => {
  const netDeltaUsd = stocks.reduce((sum, stock) => sum + stock.netMarketValueDeltaUsd, 0);
  const totalAbsDeltaUsd = stocks.reduce(
    (sum, stock) => sum + Math.abs(stock.netMarketValueDeltaUsd),
    0
  );
  return {
    id: clusterIdFor(institutionCount, direction, index),
    institutionCount,
    direction,
    stocks,
    centroidY: netDeltaUsd / stocks.length,
    totalAbsDeltaUsd,
    netDeltaUsd,
  };
};

const clusterWithinBand = (
  stocks: ThirteenFConsensusStock[],
  maxAbsDelta: number
): ConsensusBubbleCluster[] => {
  if (stocks.length === 0) {
    return [];
  }

  const band = Math.max(maxAbsDelta * CLUSTER_BAND_RATIO, MIN_CLUSTER_BAND_USD);
  const sorted = [...stocks].sort(
    (a, b) => a.netMarketValueDeltaUsd - b.netMarketValueDeltaUsd
  );
  const rawGroups: ThirteenFConsensusStock[][] = [];
  let group: ThirteenFConsensusStock[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i += 1) {
    const mean = group.reduce((sum, item) => sum + item.netMarketValueDeltaUsd, 0) / group.length;
    if (Math.abs(sorted[i].netMarketValueDeltaUsd - mean) <= band) {
      group.push(sorted[i]);
    } else {
      rawGroups.push(group);
      group = [sorted[i]];
    }
  }
  rawGroups.push(group);

  const institutionCount = stocks[0]?.institutionCount ?? 0;
  const direction = stocks[0]?.direction ?? 'BUY';

  return rawGroups
    .filter(chunk => chunk.length >= MIN_CLUSTER_SIZE)
    .map((chunk, index) => buildCluster(chunk, institutionCount, direction, index));
};

export const buildConsensusBubbleClusters = (
  stocks: ThirteenFConsensusStock[]
): {
  clusters: ConsensusBubbleCluster[];
  clusteredTickers: Set<string>;
} => {
  const maxAbsDelta = Math.max(
    ...stocks.map(stock => Math.abs(stock.netMarketValueDeltaUsd)),
    1
  );
  const byGroup = new Map<string, ThirteenFConsensusStock[]>();

  for (const stock of stocks) {
    const key = groupKey(stock);
    const bucket = byGroup.get(key) ?? [];
    bucket.push(stock);
    byGroup.set(key, bucket);
  }

  const clusters: ConsensusBubbleCluster[] = [];
  const clusteredTickers = new Set<string>();

  for (const bucket of byGroup.values()) {
    const groupClusters = clusterWithinBand(bucket, maxAbsDelta);
    for (const cluster of groupClusters) {
      clusters.push(cluster);
      for (const stock of cluster.stocks) {
        clusteredTickers.add(stock.ticker);
      }
    }
  }

  return { clusters, clusteredTickers };
};

const spreadLocalColumn = (
  members: ConsensusBubbleDisplayItem[],
  dataPerPx: number,
  anchorY: number,
  maxSpread: number
): void => {
  for (const member of members) {
    member.y = member.stock.netMarketValueDeltaUsd;
  }

  const gap = LOCAL_MIN_GAP_PX * dataPerPx;
  const radius = (item: ConsensusBubbleDisplayItem) => (item.sizePx / 2) * dataPerPx;

  for (let pass = 0; pass < LOCAL_SPREAD_PASSES; pass += 1) {
    members.sort((a, b) => a.y - b.y);

    for (let i = 1; i < members.length; i += 1) {
      const prev = members[i - 1];
      const curr = members[i];
      const minDist = radius(prev) + radius(curr) + gap;
      if (curr.y - prev.y < minDist) {
        curr.y = prev.y + minDist;
      }
    }

    for (let i = members.length - 2; i >= 0; i -= 1) {
      const curr = members[i];
      const next = members[i + 1];
      const minDist = radius(curr) + radius(next) + gap;
      if (next.y - curr.y < minDist) {
        curr.y = next.y - minDist;
      }
    }

    const center = members.reduce((sum, item) => sum + item.y, 0) / members.length;
    const offset = anchorY - center;
    for (const member of members) {
      member.y += offset;
    }

    const minY = Math.min(...members.map(item => item.y));
    const maxY = Math.max(...members.map(item => item.y));
    const halfSpread = (maxY - minY) / 2;
    if (halfSpread > maxSpread) {
      const scale = maxSpread / halfSpread;
      for (const member of members) {
        member.y = anchorY + (member.y - anchorY) * scale;
      }
    }
  }
};

export const layoutConsensusBubbles = (
  stocks: ThirteenFConsensusStock[],
  chartHeight: number,
  expandedClusterIds: ReadonlySet<string>
): ConsensusBubbleLayoutResult | null => {
  if (stocks.length === 0) {
    return null;
  }

  const maxAbsDelta = Math.max(
    ...stocks.map(stock => Math.abs(stock.netMarketValueDeltaUsd)),
    1
  );
  const maxInstitutions = Math.max(...stocks.map(stock => stock.institutionCount), 2);
  const maxScore = Math.max(
    ...stocks.map(stock =>
      consensusPriorityScore(stock.institutionCount, stock.netMarketValueDeltaUsd)
    ),
    1
  );

  const { clusters, clusteredTickers } = buildConsensusBubbleClusters(stocks);
  const items: ConsensusBubbleDisplayItem[] = [];
  const ySamples: number[] = [];

  for (const stock of stocks) {
    if (clusteredTickers.has(stock.ticker)) {
      continue;
    }

    const absDelta = Math.abs(stock.netMarketValueDeltaUsd);
    items.push({
      kind: 'single',
      clusterId: null,
      stock,
      cluster: null,
      x: stock.institutionCount,
      y: stock.netMarketValueDeltaUsd,
      sizePx: bubbleSizePx(absDelta, maxAbsDelta),
      score: consensusPriorityScore(stock.institutionCount, stock.netMarketValueDeltaUsd),
    });
    ySamples.push(stock.netMarketValueDeltaUsd);
  }

  for (const cluster of clusters) {
    if (expandedClusterIds.has(cluster.id)) {
      const members: ConsensusBubbleDisplayItem[] = cluster.stocks.map(stock => {
        const absDelta = Math.abs(stock.netMarketValueDeltaUsd);
        return {
          kind: 'member',
          clusterId: cluster.id,
          stock,
          cluster,
          x: cluster.institutionCount,
          y: stock.netMarketValueDeltaUsd,
          sizePx: bubbleSizePx(absDelta, maxAbsDelta),
          score: consensusPriorityScore(stock.institutionCount, stock.netMarketValueDeltaUsd),
        };
      });

      const plotHeight = Math.max(chartHeight - GRID.top - GRID.bottom, 240);
      const provisionalSpan = Math.max(maxAbsDelta * 0.35, 1);
      const dataPerPx = provisionalSpan / plotHeight;
      const maxLocalSpread = Math.max(maxAbsDelta * 0.06, MIN_CLUSTER_BAND_USD * 0.75);
      spreadLocalColumn(members, dataPerPx, cluster.centroidY, maxLocalSpread);

      for (const member of members) {
        items.push(member);
        ySamples.push(member.y);
      }
      continue;
    }

    items.push({
      kind: 'cluster',
      clusterId: cluster.id,
      stock: cluster.stocks[0],
      cluster,
      x: cluster.institutionCount,
      y: cluster.centroidY,
      sizePx: bubbleSizePx(cluster.totalAbsDeltaUsd, maxAbsDelta, cluster.stocks.length),
      score: Math.max(
        ...cluster.stocks.map(item =>
          consensusPriorityScore(item.institutionCount, item.netMarketValueDeltaUsd)
        )
      ),
    });
    ySamples.push(cluster.centroidY);
  }

  const trueYMin = Math.min(...ySamples, 0);
  const trueYMax = Math.max(...ySamples, 0);
  const span = Math.max(trueYMax - trueYMin, maxAbsDelta * 0.18);
  const padding = span * 0.12;

  return {
    items,
    clusters,
    yMin: trueYMin - padding,
    yMax: trueYMax + padding,
    maxInstitutions,
    maxScore,
    grid: GRID,
  };
};

export const consensusBubbleChartHeight = (
  stocks: ThirteenFConsensusStock[],
  expandedClusterIds: ReadonlySet<string>
): number => {
  const { clusters } = buildConsensusBubbleClusters(stocks);
  const collapsedClusterCount = clusters.filter(cluster => !expandedClusterIds.has(cluster.id)).length;
  const expandedMemberCount = clusters
    .filter(cluster => expandedClusterIds.has(cluster.id))
    .reduce((sum, cluster) => sum + cluster.stocks.length, 0);
  const visibleCount =
    stocks.length - clusters.reduce((sum, cluster) => sum + cluster.stocks.length, 0) +
    collapsedClusterCount +
    expandedMemberCount;

  return Math.max(520, Math.min(760, 420 + visibleCount * 10 + expandedMemberCount * 6));
};
