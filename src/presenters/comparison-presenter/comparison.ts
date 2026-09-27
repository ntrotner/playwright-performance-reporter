import {
  entityDurationMetric,
  madScaleFactor,
  metricUnit,
} from './constants.js';
import {
  type ComparisonEntity,
  type ComparisonStatus,
  type EntitySummary,
  type MetricComparison,
  type MetricKind,
  type RunSummary,
  type StepComparison,
  type StepStatus,
} from './types.js';

/**
 * Thresholds to decide if a change is significant
 */
export type ComparisonSettings = {
  minBaselineRuns: number;
  relativeThreshold: number;
  zScoreThreshold: number;
  comparedMetrics?: string[];
};

/**
 * Median of a list
 *
 * @param values list of numbers
 */
export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

/**
 * Median absolute deviation scaled to be comparable with the standard deviation
 *
 * @param values list of numbers
 */
export function scaledMedianAbsoluteDeviation(values: number[]): number {
  const center = median(values);
  return madScaleFactor * median(values.map(value => Math.abs(value - center)));
}

/**
 * Value of a metric of an entity in a run
 *
 * @param entity entity summary of a run
 * @param metric metric name
 */
function valueOf(entity: EntitySummary | undefined, metric: string): number | undefined {
  return entity?.metrics[metric]?.value;
}

/**
 * Human readable name of a test or step
 *
 * @param entity test or step
 */
function describeEntity(entity: ComparisonEntity): string {
  if (entity.kind === 'test') {
    return entity.testName;
  }

  const occurrence = entity.occurrence ? ` #${entity.occurrence + 1}` : '';
  return `${entity.testName} > ${entity.stepName ?? ''}${occurrence}`;
}

/**
 * Runs and thresholds of a comparison
 */
type ComparisonContext = {
  recent: RunSummary[];
  baseline: RunSummary[];
  settings: ComparisonSettings;
};

/**
 * Inputs to decide the verdict of a change
 */
type VerdictInput = {
  absoluteChange: number;
  baselineCount: number;
  spread: number;
  relativeChange: number | undefined;
  minBaselineRuns: number;
  relativeThreshold: number;
  zScore: number | undefined;
  zScoreThreshold: number;
};

/**
 * Decide the verdict of a change from the computed statistics
 */
function decideStatus(input: VerdictInput): ComparisonStatus {
  const {absoluteChange, baselineCount, spread, relativeChange, minBaselineRuns, relativeThreshold, zScore, zScoreThreshold} = input;
  if (absoluteChange === 0) {
    return 'unchanged';
  }

  const withinNoiseBand = baselineCount >= minBaselineRuns && spread > 0 && Math.abs(absoluteChange) < 3 * spread;
  const belowRelativeThreshold = relativeChange !== undefined && Math.abs(relativeChange) < relativeThreshold;
  if (withinNoiseBand && belowRelativeThreshold) {
    return 'noisy';
  }

  const exceedsRelative = relativeChange === undefined ? true : Math.abs(relativeChange) >= relativeThreshold;
  const exceedsNoise = baselineCount < minBaselineRuns || zScore === undefined || Math.abs(zScore) >= zScoreThreshold;
  return exceedsRelative && exceedsNoise ? (absoluteChange > 0 ? 'increased' : 'decreased') : 'unchanged';
}

/**
 * Compare a single metric of an entity against the baseline
 */
function compareMetric(
  entity: ComparisonEntity,
  metric: string,
  kind: MetricKind,
  {recent, baseline, settings}: ComparisonContext,
): MetricComparison {
  const entityKey = entity.key;
  const recentValues = recent
    .map(run => valueOf(run.entities[entityKey], metric))
    .filter(value => value !== undefined);
  const recentRates = recent
    .map(run => run.entities[entityKey]?.metrics[metric]?.rate)
    .filter(value => value !== undefined);
  const currentValue = recentValues.length > 0 ? median(recentValues) : undefined;
  const baselineEntities = baseline.map(run => run.entities[entityKey]);
  const baselineValues = baselineEntities
    .map(entity => valueOf(entity, metric))
    .filter(value => value !== undefined);
  const baselineRates = baselineEntities
    .map(entity => entity?.metrics[metric]?.rate)
    .filter(value => value !== undefined);

  const series = [...baseline, ...recent].map(run => ({runId: run.id, value: valueOf(run.entities[entityKey], metric)}));
  const comparison: MetricComparison = {
    entityKey,
    entityName: describeEntity(entity),
    metric,
    kind,
    unit: metricUnit(metric),
    status: 'unchanged',
    current: currentValue,
    currentRate: recentRates.length > 0 ? median(recentRates) : undefined,
    recentRuns: recentValues.length,
    baselineRuns: baselineValues.length,
    series,
  };

  if (currentValue === undefined) {
    comparison.status = 'missing';
    comparison.baselineMedian = baselineValues.length > 0 ? median(baselineValues) : undefined;
    return comparison;
  }

  if (baselineValues.length === 0) {
    comparison.status = 'new';
    return comparison;
  }

  const baselineMedian = median(baselineValues);
  const spread = scaledMedianAbsoluteDeviation(baselineValues);
  const absoluteChange = currentValue - baselineMedian;
  const relativeChange = baselineMedian === 0 ? undefined : absoluteChange / Math.abs(baselineMedian);
  const zScore = spread > 0 ? absoluteChange / spread : undefined;

  Object.assign(comparison, {
    baselineMedian,
    baselineSpread: spread,
    absoluteChange,
    relativeChange,
    zScore,
    baselineRateMedian: baselineRates.length > 0 ? median(baselineRates) : undefined,
    status: decideStatus({
      absoluteChange,
      baselineCount: baselineValues.length,
      spread,
      relativeChange,
      minBaselineRuns: settings.minBaselineRuns,
      relativeThreshold: settings.relativeThreshold,
      zScore,
      zScoreThreshold: settings.zScoreThreshold,
    }),
  });

  return comparison;
}

/**
 * Collect all entities that are part of the comparison
 *
 * @param runs runs to compare
 */
export function collectEntities(runs: RunSummary[]): ComparisonEntity[] {
  const entities = new Map<string, ComparisonEntity>();
  for (const run of runs) {
    for (const {duration, metrics, ...entity} of Object.values(run.entities)) {
      entities.set(entity.key, entity);
    }
  }

  return [...entities.values()].sort((a, b) => a.testName.localeCompare(b.testName) || a.testId.localeCompare(b.testId) || a.order - b.order);
}

/**
 * Split the runs into the recent runs, which are compared, and the baseline before them.
 * With a short history the recent runs shrink first, so the baseline keeps enough runs to estimate the noise.
 *
 * @param history previous runs, oldest first
 * @param latest current run
 * @param settings amount of runs per group
 */
export function splitRuns(
  history: RunSummary[],
  latest: RunSummary,
  settings: {recentRuns: number; baselineWindow: number; minBaselineRuns: number},
): {recent: RunSummary[]; baseline: RunSummary[]} {
  const recentCount = Math.max(1, Math.min(settings.recentRuns, history.length + 1 - settings.minBaselineRuns));
  const earlier = history.slice(0, history.length - (recentCount - 1));

  return {
    recent: [...history.slice(earlier.length), latest],
    baseline: earlier.slice(-settings.baselineWindow),
  };
}

/**
 * Compare every metric of every entity of the recent runs against the baseline
 *
 * @param recent recent runs, oldest first and the current run last
 * @param baseline runs before the recent runs, oldest first
 * @param settings thresholds
 */
export function compareRuns(recent: RunSummary[], baseline: RunSummary[], settings: ComparisonSettings): MetricComparison[] {
  const comparisons: MetricComparison[] = [];
  const context: ComparisonContext = {recent, baseline, settings};
  const current = recent.at(-1)!;

  for (const entity of collectEntities([...baseline, ...recent])) {
    // Entity that vanished from the current run is reported once instead of for every metric
    if (!current.entities[entity.key]) {
      comparisons.push(compareMetric(entity, entityDurationMetric, 'cumulative', context));
      continue;
    }

    const metrics = new Map<string, MetricKind>();
    for (const run of [...baseline, ...recent]) {
      for (const [metric, summary] of Object.entries(run.entities[entity.key]?.metrics ?? {})) {
        metrics.set(metric, summary.kind);
      }
    }

    for (const [metric, kind] of metrics) {
      const excluded = settings.comparedMetrics && settings.comparedMetrics.length > 0 && !settings.comparedMetrics.includes(metric);
      if (metric !== entityDurationMetric && excluded) {
        continue;
      }

      comparisons.push(compareMetric(entity, metric, kind, context));
    }
  }

  return comparisons;
}

const statusOrder: ComparisonStatus[] = ['increased', 'decreased', 'missing', 'new', 'unchanged', 'noisy'];

/**
 * Significant comparisons sorted by status and severity
 *
 * @param comparisons all comparisons
 */
function selectChanges(comparisons: MetricComparison[]): MetricComparison[] {
  const severity = (comparison: MetricComparison) => Math.abs(comparison.relativeChange ?? Number.MAX_VALUE);

  return comparisons
    .filter(comparison => comparison.status !== 'unchanged' && comparison.status !== 'noisy')
    .sort((a, b) => statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status) || severity(b) - severity(a));
}

/**
 * Verdict of a test or step based on its changes
 *
 * @param comparisons comparisons of the test or step
 */
function stepStatusOf(comparisons: MetricComparison[]): StepStatus {
  const statuses = new Set(comparisons.map(comparison => comparison.status));
  if (comparisons.some(comparison => comparison.metric === entityDurationMetric && (comparison.status === 'missing' || comparison.status === 'new'))) {
    return comparisons.find(comparison => comparison.metric === entityDurationMetric)!.status as StepStatus;
  }

  const notable = [...statuses].filter(s => s !== 'unchanged');
  if (notable.length > 0 && notable.every(s => s === 'noisy')) {
    return 'noisy';
  }

  if (statuses.has('increased') && statuses.has('decreased')) {
    return 'mixed';
  }

  if (statuses.has('increased')) {
    return 'regressed';
  }

  return statuses.has('decreased') ? 'improved' : 'unchanged';
}

/**
 * Group the comparisons by test and step in order of execution
 *
 * @param entities tests and steps in order of execution
 * @param comparisons all comparisons
 */
export function buildStepComparisons(entities: ComparisonEntity[], comparisons: MetricComparison[]): StepComparison[] {
  const byEntity = new Map<string, MetricComparison[]>();
  for (const comparison of comparisons) {
    byEntity.set(comparison.entityKey, [...(byEntity.get(comparison.entityKey) ?? []), comparison]);
  }

  return entities.map(entity => {
    const entityComparisons = byEntity.get(entity.key) ?? [];
    const duration = entityComparisons.find(comparison => comparison.metric === entityDurationMetric);

    return {
      ...entity,
      name: describeEntity(entity),
      status: stepStatusOf(entityComparisons),
      duration: {
        status: duration?.status ?? 'missing',
        current: duration?.current,
        baselineMedian: duration?.baselineMedian,
        absoluteChange: duration?.absoluteChange,
        relativeChange: duration?.relativeChange,
      },
      changes: selectChanges(entityComparisons).map(({entityKey, entityName, ...change}) => change),
    };
  });
}
