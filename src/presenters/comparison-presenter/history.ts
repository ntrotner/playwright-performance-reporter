import path from 'node:path';
import fs from 'node:fs';
import {
  testCaseParent,
  type ResultAccumulator,
  type TargetMetric,
} from '../../types/index.js';
import {
  unthrottledDescription,
} from '../../helpers/conditions.js';
import {
  classifyMetric,
  entityDurationMetric,
  ignoredMetrics,
} from './constants.js';
import {
  median,
  percentile,
} from './comparison.js';
import {
  type EntitySummary,
  type ExcludedRun,
  type MetricKind,
  type MetricSummary,
  type RunSummary,
  type WebVitalsAttribution,
} from './types.js';

/**
 * Single metric value at a point in time
 */
type Observation = {
  time: number;
  target: string;
  metric: TargetMetric['metric'];
};

/**
 * All chunks of a test or step merged together
 */
type RawEntity = {
  caseId: string;
  stepId: string;
  name: string;
  start: number | undefined;
  end: number | undefined;
  firstSeen: number;
  observations: Observation[];
};

/**
 * Result of reading a single history file
 */
export type LoadedRun = {run: RunSummary} | {excluded: ExcludedRun};

/**
 * Collect every metric name in the chunks
 *
 * @param chunks json chunks of a run
 */
function collectMetricNames(chunks: ResultAccumulator[]): Set<string> {
  const targetMetrics = chunks
    .flatMap(chunk => Object.values(chunk))
    .flatMap(steps => Object.values(steps ?? {}))
    .flatMap(performance => [...(performance?.startMetrics ?? []), ...(performance?.stopMetrics ?? []), ...(performance?.samplingMetrics ?? [])]);

  return new Set(targetMetrics.flatMap(targetMetric => Object.keys(targetMetric?.metric ?? {})));
}

/**
 * Merge all chunks of the same test or step
 *
 * @param chunks json chunks of a run
 */
function mergeChunks(chunks: ResultAccumulator[]): RawEntity[] {
  const entities = new Map<string, RawEntity>();

  const addObservations = (entity: RawEntity, metrics: TargetMetric[] | undefined, time: number) => {
    for (const targetMetric of metrics ?? []) {
      if (targetMetric?.metric) {
        entity.observations.push({time, target: targetMetric.id ?? 'default', metric: targetMetric.metric});
      }
    }
  };

  for (const chunk of chunks) {
    for (const [caseId, steps] of Object.entries(chunk)) {
      for (const [stepId, performance] of Object.entries(steps ?? {})) {
        const key = `${caseId}|${stepId}`;
        const entity = entities.get(key) ?? {
          caseId,
          stepId,
          name: performance.name,
          start: undefined,
          end: undefined,
          firstSeen: performance.startMeasurement,
          observations: [],
        };

        entity.firstSeen = Math.min(entity.firstSeen, performance.startMeasurement);
        if (performance.startMetrics?.length > 0 || performance.startMeasurementOffset !== undefined) {
          entity.start = performance.startMeasurement;
        }

        if (performance.stopMetrics?.length > 0 || (performance.endMeasurementOffset !== undefined && performance.samplingMetrics?.length === 0)) {
          entity.end = performance.endMeasurement;
        }

        addObservations(entity, performance.startMetrics, performance.startMeasurement);
        addObservations(entity, performance.samplingMetrics, performance.endMeasurement);
        addObservations(entity, performance.stopMetrics, performance.endMeasurement);
        entities.set(key, entity);
      }
    }
  }

  return [...entities.values()];
}

/**
 * Metric value at a point in time
 */
type Point = {time: number; value: number};

/**
 * Observations of every numeric metric per target across the whole run
 */
type Timelines = Map<string, Map<string, Point[]>>;

/**
 * Collect all numeric observations of a run, as counters and gauges continue across tests and steps
 *
 * @param rawEntities merged tests and steps
 */
function buildTimelines(rawEntities: RawEntity[]): Timelines {
  const timelines: Timelines = new Map();
  for (const observation of rawEntities.flatMap(entity => entity.observations)) {
    const metrics = timelines.get(observation.target) ?? new Map<string, Point[]>();
    for (const [metricName, value] of Object.entries(observation.metric)) {
      if (typeof value !== 'number' || Number.isNaN(value) || ignoredMetrics.has(metricName) || classifyMetric(metricName) === 'total') {
        continue;
      }

      const points = metrics.get(metricName) ?? [];
      points.push({time: observation.time, value});
      metrics.set(metricName, points);
    }

    timelines.set(observation.target, metrics);
  }

  for (const metrics of timelines.values()) {
    for (const points of metrics.values()) {
      points.sort((a, b) => a.time - b.time);
    }
  }

  return timelines;
}

/**
 * Estimate the value at a point in time from the surrounding observations.
 * Outside the observed range the closest observation is used, so nothing is extrapolated.
 *
 * @param points ordered observations
 * @param time point in time
 * @param kind kind of metric
 */
function valueAt(points: Point[], time: number, kind: MetricKind): number {
  if (time <= points[0].time) {
    return points[0].value;
  }

  const nextIndex = points.findIndex(point => point.time > time);
  if (nextIndex === -1) {
    return points.at(-1)!.value;
  }

  const previous = points[nextIndex - 1];
  const next = points[nextIndex];
  // A counter reset in between can't be interpolated
  if (kind === 'cumulative' && next.value < previous.value) {
    return previous.value;
  }

  return previous.value + ((next.value - previous.value) * (time - previous.time) / (next.time - previous.time));
}

/**
 * Growth of a counter, which tolerates resets of the counter
 *
 * @param values ordered values of a counter
 */
function computeGrowth(values: number[]): number {
  let growth = 0;
  for (let index = 1; index < values.length; index++) {
    const difference = values[index] - values[index - 1];
    growth += difference >= 0 ? difference : values[index];
  }

  return growth;
}

/**
 * Time weighted mean, which is independent of the amount of observations
 *
 * @param points ordered observations
 */
function computeTimeWeightedMean(points: Point[]): number {
  const totalTime = points.at(-1)!.time - points[0].time;
  if (totalTime <= 0) {
    return points.reduce((sum, point) => sum + point.value, 0) / points.length;
  }

  let area = 0;
  for (let index = 1; index < points.length; index++) {
    const previous = points[index - 1];
    const current = points[index];
    area += (current.time - previous.time) * (previous.value + current.value) / 2;
  }

  return area / totalTime;
}

/**
 * Percentile of weighted values, e.g. weighted by the time they were observed for
 *
 * @param values list of numbers
 * @param weights weight of each value
 * @param fraction between 0 and 1
 */
function weightedPercentile(values: number[], weights: number[], fraction: number): number {
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  if (totalWeight <= 0) {
    return percentile(values, fraction);
  }

  const order = [...values.keys()].sort((a, b) => values[a] - values[b]);
  let cumulativeWeight = 0;
  for (const index of order) {
    cumulativeWeight += weights[index];
    if (cumulativeWeight >= fraction * totalWeight) {
      return values[index];
    }
  }

  return values[order.at(-1)!];
}

/**
 * Condense a metric within the time window of a test or step.
 * The boundaries are estimated from the surrounding observations and gauges are weighted by time,
 * so the result doesn't depend on how many samples were taken within the window.
 *
 * @param metricName name of the metric
 * @param pointsPerTarget observations of the metric for each target
 * @param metricWindow time window of the entity
 * @param bandPercentile percentile of the lower band
 */
function summarizeMetric(metricName: string, pointsPerTarget: Point[][], metricWindow: {start: number; end: number}, bandPercentile: number): MetricSummary | undefined {
  const {start, end} = metricWindow;
  const kind = classifyMetric(metricName);
  const values: number[] = [];
  const weights: number[] = [];
  let value = 0;
  let observations = 0;

  for (const points of pointsPerTarget) {
    const inside = points.filter(point => point.time >= start && point.time <= end);
    const surrounds = points[0].time < start && points.at(-1)!.time > end;
    if (inside.length === 0 && !surrounds) {
      continue;
    }

    const window = [
      {time: start, value: valueAt(points, start, kind)},
      ...inside,
      {time: end, value: valueAt(points, end, kind)},
    ];
    observations += inside.length > 0 ? inside.length : window.length;
    if (kind === 'cumulative') {
      value += computeGrowth(window.map(point => point.value));
      continue;
    }

    value += computeTimeWeightedMean(window);
    for (const [index, point] of window.entries()) {
      values.push(point.value);
      weights.push((window[Math.min(index + 1, window.length - 1)].time - window[Math.max(index - 1, 0)].time) / 2);
    }
  }

  if (observations === 0) {
    return undefined;
  }

  const duration = end - start;
  // The growth of a counter has no spread within the entity
  const band = kind === 'cumulative'
    ? {lower: value, median: value, upper: value}
    : {
      lower: weightedPercentile(values, weights, bandPercentile),
      median: weightedPercentile(values, weights, 0.5),
      upper: weightedPercentile(values, weights, 1 - bandPercentile),
    };

  return {
    kind,
    value,
    rate: kind === 'cumulative' && duration > 0 ? value / (duration / 1000) : undefined,
    ...band,
    observations,
  };
}

/**
 * Condense metrics that are measured once for the whole test or step, like the CPU profile.
 * They only come from the own observations, as neighboring steps measure their own totals.
 *
 * @param observations observations of an entity
 */
function summarizeTotals(observations: Observation[]): Record<string, MetricSummary> {
  // Latest value per target, summed across targets
  const latest = new Map<string, Map<string, Point>>();
  for (const observation of observations) {
    for (const [metricName, value] of Object.entries(observation.metric)) {
      if (typeof value !== 'number' || Number.isNaN(value) || classifyMetric(metricName) !== 'total') {
        continue;
      }

      const perTarget = latest.get(metricName) ?? new Map<string, Point>();
      if ((perTarget.get(observation.target)?.time ?? Number.NEGATIVE_INFINITY) <= observation.time) {
        perTarget.set(observation.target, {time: observation.time, value});
      }

      latest.set(metricName, perTarget);
    }
  }

  const totals: Record<string, MetricSummary> = {};
  for (const [metricName, perTarget] of latest) {
    const value = [...perTarget.values()].reduce((sum, point) => sum + point.value, 0);
    totals[metricName] = {
      kind: 'total', value, lower: value, upper: value, median: value, observations: perTarget.size,
    };
  }

  return totals;
}

/**
 * Time window of a test or step, falling back to its observations if start or stop wasn't recorded
 *
 * @param raw merged test or step
 */
function timeWindowOf(raw: RawEntity): {start: number; end: number} {
  const times = raw.observations.map(observation => observation.time);
  const start = raw.start ?? (times.length > 0 ? Math.min(...times) : raw.firstSeen);
  const end = raw.end ?? (times.length > 0 ? Math.max(...times) : raw.firstSeen);
  return {start, end: Math.max(start, end)};
}

/**
 * Condense the chunks of a run into comparable entities
 *
 * @param chunks json chunks of a run
 * @param bandPercentile percentile of the lower band
 */
export function summarizeEntities(chunks: ResultAccumulator[], bandPercentile: number): Record<string, EntitySummary> {
  const rawEntities = mergeChunks(chunks);
  const metricTimelines = new Map<string, Point[][]>();
  for (const metrics of buildTimelines(rawEntities).values()) {
    for (const [metricName, points] of metrics) {
      metricTimelines.set(metricName, [...(metricTimelines.get(metricName) ?? []), points]);
    }
  }

  const testNames = new Map(rawEntities
    .filter(entity => entity.stepId === testCaseParent)
    .map(entity => [entity.caseId, entity.name]));

  // Same step name can occur multiple times within a test
  const occurrences = new Map<string, number>();
  const stepCounts = new Map<string, number>();
  const entities: Record<string, EntitySummary> = {};
  for (const raw of rawEntities.sort((a, b) => (a.start ?? a.firstSeen) - (b.start ?? b.firstSeen))) {
    const isTest = raw.stepId === testCaseParent;
    const occurrenceKey = `${raw.caseId}|${raw.name}`;
    const occurrence = occurrences.get(occurrenceKey) ?? 0;
    occurrences.set(occurrenceKey, occurrence + 1);
    const order = isTest ? 0 : (stepCounts.get(raw.caseId) ?? 0) + 1;
    if (!isTest) {
      stepCounts.set(raw.caseId, order);
    }

    const {start, end} = timeWindowOf(raw);
    const duration = end - start;

    const metrics: Record<string, MetricSummary> = {
      [entityDurationMetric]: {
        kind: 'cumulative', value: duration, lower: duration, upper: duration, median: duration, observations: 1,
      },
    };
    for (const [metricName, pointsPerTarget] of metricTimelines) {
      const summary = summarizeMetric(metricName, pointsPerTarget, {start, end}, bandPercentile);
      if (summary) {
        metrics[metricName] = summary;
      }
    }

    Object.assign(metrics, summarizeTotals(raw.observations));
    const attribution = summarizeAttribution(raw.observations);

    const key = isTest ? raw.caseId : `${raw.caseId}|${raw.name}|${occurrence}`;
    entities[key] = {
      key,
      kind: isTest ? 'test' : 'step',
      testId: raw.caseId,
      testName: testNames.get(raw.caseId) ?? raw.caseId,
      stepName: isTest ? undefined : raw.name,
      occurrence: isTest || occurrence === 0 ? undefined : occurrence,
      order,
      duration,
      metrics,
      ...(attribution ? {attribution} : {}),
    };
  }

  return entities;
}

/**
 * Throttling a run was measured under, taken from the first test that recorded it
 *
 * @param chunks json chunks of a run
 */
function conditionsOf(chunks: ResultAccumulator[]): string {
  for (const chunk of chunks) {
    for (const steps of Object.values(chunk)) {
      const description = steps?.[testCaseParent]?.conditions?.description;
      if (typeof description === 'string') {
        return description;
      }
    }
  }

  return unthrottledDescription;
}

/**
 * Repeat index per test id, for tests that recorded their execution
 *
 * @param chunks json chunks of a run
 */
function repeatsOf(chunks: ResultAccumulator[]): Map<string, number> {
  const repeats = new Map<string, number>();
  for (const chunk of chunks) {
    for (const [caseId, steps] of Object.entries(chunk)) {
      const repeatEachIndex = steps?.[testCaseParent]?.execution?.repeatEachIndex;
      if (typeof repeatEachIndex === 'number') {
        repeats.set(caseId, repeatEachIndex);
      }
    }
  }

  return repeats;
}

/**
 * Merge the repeats of a test, e.g. with `repeatEach`, into the entities of its first repeat.
 * Every repeat has its own test id, so they are matched by the name of the test and the step.
 * A metric is condensed to the median across the repeats, with the band across the repeats.
 *
 * @param entities entities of a run
 * @param repeats repeat index per test id
 * @param bandPercentile percentile of the lower band
 */
export function mergeRepeats(entities: Record<string, EntitySummary>, repeats: Map<string, number>, bandPercentile: number): Record<string, EntitySummary> {
  const groups = new Map<string, EntitySummary[]>();
  for (const entity of Object.values(entities)) {
    if (!repeats.has(entity.testId)) {
      continue;
    }

    const key = [entity.testName, entity.kind, entity.stepName ?? '', entity.occurrence ?? 0].join('|');
    groups.set(key, [...(groups.get(key) ?? []), entity]);
  }

  const merged = {...entities};
  for (const group of groups.values()) {
    if (group.length < 2) {
      continue;
    }

    const [first, ...others] = [...group].sort((a, b) => (repeats.get(a.testId) ?? 0) - (repeats.get(b.testId) ?? 0));
    const metricNames = new Set(group.flatMap(entity => Object.keys(entity.metrics)));
    const metrics: Record<string, MetricSummary> = {};
    for (const metricName of metricNames) {
      const summaries = group.map(entity => entity.metrics[metricName]).filter(summary => summary !== undefined);
      const values = summaries.map(summary => summary.value);
      const rates = summaries.map(summary => summary.rate).filter(rate => rate !== undefined);
      metrics[metricName] = {
        kind: summaries[0].kind,
        value: median(values),
        rate: rates.length > 0 ? median(rates) : undefined,
        lower: percentile(values, bandPercentile),
        upper: percentile(values, 1 - bandPercentile),
        median: median(values),
        observations: summaries.reduce((total, summary) => total + summary.observations, 0),
      };
    }

    merged[first.key] = {...first, duration: median(group.map(entity => entity.duration)), metrics};
    for (const other of others) {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete merged[other.key];
    }
  }

  return merged;
}

/**
 * Metadata of a run, taken from the first test that recorded it
 *
 * @param chunks json chunks of a run
 */
function metadataOf(chunks: ResultAccumulator[]): {metadata?: Record<string, string>} {
  for (const chunk of chunks) {
    for (const steps of Object.values(chunk)) {
      const metadata = steps?.[testCaseParent]?.metadata;
      if (metadata && typeof metadata === 'object') {
        return {metadata};
      }
    }
  }

  return {};
}

/**
 * Cause of the Web Vitals of an entity, taken from its latest observation that contains it
 *
 * @param observations observations of an entity
 */
function summarizeAttribution(observations: Observation[]): WebVitalsAttribution | undefined {
  const latest = (key: string) => observations
    .filter(observation => typeof observation.metric[key] === 'string')
    .sort((a, b) => b.time - a.time)[0]?.metric;

  const attribution: WebVitalsAttribution = {};
  const lcp = latest('lcpElement');
  if (lcp) {
    attribution.lcp = {element: String(lcp.lcpElement), url: String(lcp.lcpUrl ?? '')};
  }

  const cls = latest('clsLargestShiftSource');
  if (cls) {
    attribution.cls = {source: String(cls.clsLargestShiftSource)};
  }

  const inp = latest('inpTarget');
  if (inp) {
    attribution.inp = {target: String(inp.inpTarget), eventType: String(inp.inpEventType ?? '')};
  }

  return Object.keys(attribution).length > 0 ? attribution : undefined;
}

/**
 * Read a history file and verify it contains the necessary metrics
 *
 * @param filePath json chunk file of a run
 * @param requiredMetrics metrics that have to be present
 * @param bandPercentile percentile of the lower band
 */
export async function loadRun(filePath: string, requiredMetrics: string[], bandPercentile: number): Promise<LoadedRun> {
  const file = path.basename(filePath);
  let chunks: unknown;
  try {
    chunks = JSON.parse(await fs.promises.readFile(filePath, 'utf8'));
  } catch (error) {
    return {excluded: {file, reason: `Unreadable json: ${String(error)}`}};
  }

  if (!Array.isArray(chunks) || chunks.some(chunk => typeof chunk !== 'object' || chunk === null || Array.isArray(chunk))) {
    return {excluded: {file, reason: 'Not a list of json chunks'}};
  }

  const results = chunks as ResultAccumulator[];
  const metricNames = collectMetricNames(results);
  const missingMetrics = requiredMetrics.filter(metric => !metricNames.has(metric));
  if (missingMetrics.length > 0) {
    return {excluded: {file, reason: 'Missing required metrics', missingMetrics}};
  }

  const measurements = results.flatMap(chunk => Object.values(chunk).flatMap(steps => Object.values(steps ?? {}).map(performance => performance?.startMeasurement)))
    .filter(value => typeof value === 'number');
  let startedAt = Math.min(...measurements);
  if (measurements.length === 0) {
    const stats = await fs.promises.stat(filePath);
    startedAt = stats.mtimeMs;
  }

  return {
    run: {
      id: file.replace(/\.json$/, ''),
      file,
      startedAt,
      conditions: conditionsOf(results),
      ...metadataOf(results),
      entities: mergeRepeats(summarizeEntities(results, bandPercentile), repeatsOf(results), bandPercentile),
    },
  };
}

/**
 * Read all runs of the history directory, oldest first
 *
 * @param historyDir directory with json chunks
 * @param requiredMetrics metrics that have to be present
 * @param ignoredPaths files that are not part of the history
 * @param bandPercentile percentile of the lower band
 */
export async function loadHistory(historyDir: string, requiredMetrics: string[], ignoredPaths: string[], bandPercentile: number): Promise<{runs: RunSummary[]; excluded: ExcludedRun[]}> {
  const runs: RunSummary[] = [];
  const excluded: ExcludedRun[] = [];
  const ignored = new Set(ignoredPaths.map(filePath => path.resolve(filePath)));

  let files: string[];
  try {
    files = await fs.promises.readdir(historyDir);
  } catch {
    return {runs, excluded};
  }

  for (const file of files.sort()) {
    if (!file.endsWith('.json') || ignored.has(path.resolve(historyDir, file))) {
      continue;
    }

    // Sequential read to keep memory usage low for large histories
    // eslint-disable-next-line no-await-in-loop
    const loaded = await loadRun(path.join(historyDir, file), requiredMetrics, bandPercentile);
    if ('run' in loaded) {
      runs.push(loaded.run);
    } else {
      excluded.push(loaded.excluded);
    }
  }

  return {runs: runs.sort((a, b) => a.startedAt - b.startedAt), excluded};
}
