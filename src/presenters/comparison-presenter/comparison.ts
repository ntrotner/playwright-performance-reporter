import {
  entityDurationMetric,
  higherIsBetterMetrics,
  metricUnit,
} from './constants.js';
import {
  type ComparisonEntity,
  type ComparisonReport,
  type ComparisonStatus,
  type MetricComparison,
  type MetricKind,
  type RunSummary,
  type StepComparison,
  type StepStatus,
} from './types.js';

/**
 * Thresholds to decide if a change is significant
 */
export type ComparisonSettings = Pick<ComparisonReport['settings'], 'minBaselineRuns' | 'relativeThreshold' | 'zScoreThreshold' | 'comparedMetrics'>;

/**
 * Value below which a given fraction of the values falls, interpolated between the closest values
 *
 * @param values list of numbers
 * @param fraction between 0 and 1
 */
export function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * fraction;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;
  return (sorted[lower] * (1 - weight)) + (sorted[upper] * weight);
}

/**
 * Median of a list
 *
 * @param values list of numbers
 */
export function median(values: number[]): number {
  return percentile(values, 0.5);
}

/**
 * Median absolute deviation scaled to be comparable with the standard deviation
 *
 * @param values list of numbers
 */
export function scaledMedianAbsoluteDeviation(values: number[]): number {
  const center = median(values);
  return 1.4826 * median(values.map(value => Math.abs(value - center)));
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
 * Decide the verdict of a change.
 * Once enough baseline runs exist, a change within the noise of the baseline is never reported.
 *
 * @param change difference between current value and baseline
 * @param settings thresholds
 */
function decideStatus(
  change: {absoluteChange: number; relativeChange: number | undefined; zScore: number | undefined; baselineRuns: number},
  settings: ComparisonSettings,
): ComparisonStatus {
  if (change.absoluteChange === 0) {
    return 'unchanged';
  }

  if (change.baselineRuns >= settings.minBaselineRuns && change.zScore !== undefined && Math.abs(change.zScore) < settings.zScoreThreshold) {
    return 'noisy';
  }

  if (change.relativeChange !== undefined && Math.abs(change.relativeChange) < settings.relativeThreshold) {
    return 'unchanged';
  }

  return change.absoluteChange > 0 ? 'increased' : 'decreased';
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
  const valueOf = (run: RunSummary, field: 'value' | 'rate') => run.entities[entity.key]?.metrics[metric]?.[field];
  const valuesOf = (runs: RunSummary[], field: 'value' | 'rate') => runs.map(run => valueOf(run, field)).filter(value => value !== undefined);
  const medianOf = (values: number[]) => values.length > 0 ? median(values) : undefined;
  const recentValues = valuesOf(recent, 'value');
  const baselineValues = valuesOf(baseline, 'value');
  const current = medianOf(recentValues);

  const comparison: MetricComparison = {
    entityKey: entity.key,
    entityName: describeEntity(entity),
    metric,
    kind,
    unit: metricUnit(metric),
    status: 'unchanged',
    current,
    currentRate: medianOf(valuesOf(recent, 'rate')),
    recentRuns: recentValues.length,
    baselineRuns: baselineValues.length,
    series: [...baseline, ...recent].map(run => ({runId: run.id, value: valueOf(run, 'value')})),
  };

  if (current === undefined) {
    comparison.status = 'missing';
    comparison.baselineMedian = medianOf(baselineValues);
    return comparison;
  }

  if (baselineValues.length === 0) {
    comparison.status = 'new';
    return comparison;
  }

  const baselineMedian = median(baselineValues);
  const spread = scaledMedianAbsoluteDeviation(baselineValues);
  const absoluteChange = current - baselineMedian;
  const relativeChange = baselineMedian === 0 ? undefined : absoluteChange / Math.abs(baselineMedian);
  const zScore = spread > 0 ? absoluteChange / spread : undefined;

  Object.assign(comparison, {
    baselineMedian,
    baselineSpread: spread,
    absoluteChange,
    relativeChange,
    zScore,
    baselineRateMedian: medianOf(valuesOf(baseline, 'rate')),
    status: decideStatus({
      absoluteChange, relativeChange, zScore, baselineRuns: baselineValues.length,
    }, settings),
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
      if (metric === entityDurationMetric || !settings.comparedMetrics || settings.comparedMetrics.includes(metric)) {
        comparisons.push(compareMetric(entity, metric, kind, context));
      }
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
  const duration = comparisons.find(comparison => comparison.metric === entityDurationMetric);
  if (duration?.status === 'missing' || duration?.status === 'new') {
    return duration.status;
  }

  const statuses = new Set(comparisons.map(comparison => comparison.status));
  statuses.delete('unchanged');
  if (statuses.size === 1 && statuses.has('noisy')) {
    return 'noisy';
  }

  // For most metrics more is worse, e.g. durations, for some it's better, e.g. a score
  const worse = comparisons.some(comparison => comparison.status === (higherIsBetterMetrics.has(comparison.metric) ? 'decreased' : 'increased'));
  const better = comparisons.some(comparison => comparison.status === (higherIsBetterMetrics.has(comparison.metric) ? 'increased' : 'decreased'));
  if (worse && better) {
    return 'mixed';
  }

  if (worse) {
    return 'regressed';
  }

  return better ? 'improved' : 'unchanged';
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
    const entityComparisons = byEntity.get(comparison.entityKey) ?? [];
    entityComparisons.push(comparison);
    byEntity.set(comparison.entityKey, entityComparisons);
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
