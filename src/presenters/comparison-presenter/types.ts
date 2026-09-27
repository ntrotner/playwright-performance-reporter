/**
 * Options for comparison presenter
 */
export type ComparisonPresenterOptions = {
  /**
   * Folder containing the json chunks of all previous runs. The current run is written into it as well.
   */
  historyDir: string;

  /**
   * Folder for the comparison reports
   */
  outputDir: string;

  /**
   * Prefix of the json chunk file of the current run. Defaults to `performance-run`.
   */
  runFilePrefix?: string;

  /**
   * Visual report. Defaults to `performance-comparison.html`.
   */
  visualReportOutputFile?: string;

  /**
   * Json report. Defaults to `performance-comparison.json`.
   */
  JsonReportOutputFile?: string;

  /**
   * Metric names a run has to contain to be part of the comparison.
   * Defaults to metrics of `allPerformanceMetrics`, `networkActivity` and `cpuProfiler`.
   */
  requiredMetrics?: string[];

  /**
   * Metric names to compare against the baseline. `entityDuration` is always compared.
   * Defaults to every metric a run contains.
   */
  comparedMetrics?: string[];

  /**
   * Percentile used for the lower band of the timeline chart, between 0 and 0.5.
   * The upper band is its mirror (1 - `bandPercentile`). Defaults to 0.05 (p5/p95).
   */
  bandPercentile?: number;

  /**
   * Amount of latest runs, including the current one, whose median is compared against the baseline.
   * Smooths out a single noisy run. Defaults to 3.
   */
  recentRuns?: number;

  /**
   * Amount of runs before the recent runs used as baseline. Defaults to 10.
   */
  baselineWindow?: number;

  /**
   * Minimum relative change to be reported, e.g. 0.1 for 10%. Defaults to 0.1.
   */
  relativeThreshold?: number;

  /**
   * Minimum robust z-score to be reported, once enough baseline runs exist. Defaults to 2.
   */
  zScoreThreshold?: number;

  /**
   * Amount of previous runs needed to separate noise from real changes. With less runs the report is marked as `low-confidence`. Defaults to 3.
   */
  minBaselineRuns?: number;

  /**
   * Sort key of a run on the x-axis of the timeline chart. Runs are ordered ascending by this value.
   * Defaults to the time the run was performed.
   */
  runSortValue?: (run: RunSummary) => number;

  /**
   * Label of a run on the x-axis of the timeline chart.
   * Defaults to the date the run was performed.
   */
  runLabel?: (run: RunSummary) => string;
};

/**
 * Semantic of a metric to decide how to condense observations
 * - cumulative: counter that only grows (durations, counts), compared by its growth within the entity
 * - gauge: point in time value (heap size, nodes), compared by its time weighted mean
 * - total: measured once for the whole entity (cpu profile), compared as is
 */
export type MetricKind = 'cumulative' | 'gauge' | 'total';

/**
 * Unit of a metric value
 */
export type MetricUnit = 'bytes' | 'ms' | 's' | 'count' | 'score';

/**
 * Condensed value of a metric for an entity in a single run
 */
export type MetricSummary = {
  kind: MetricKind;

  /**
   * Value used for the comparison
   */
  value: number;

  /**
   * Value normalized by the entity duration (per second), only for cumulative metrics
   */
  rate?: number;

  /**
   * 5th percentile of the observations within the entity
   */
  lower: number;

  /**
   * 95th percentile of the observations within the entity
   */
  upper: number;

  /**
   * Median of the observations within the entity, always between `lower` and `upper`
   */
  median: number;

  /**
   * Amount of observations the summary is based on
   */
  observations: number;
};

/**
 * Test or test step that is comparable across runs
 */
export type ComparisonEntity = {
  /**
   * Stable identifier across runs
   */
  key: string;
  kind: 'test' | 'step';
  testId: string;
  testName: string;
  stepName?: string;

  /**
   * Index of the step, if the same step name occurs multiple times in a test
   */
  occurrence?: number;

  /**
   * Position of the step within its test in order of execution, starting at 1. The test itself is 0.
   */
  order: number;
};

/**
 * Attribution of a single Web Vital, explaining what caused the value
 */
export type WebVitalsAttribution = {
  /**
   * Element that triggered the largest contentful paint
   */
  lcp?: {elementTag?: string; url?: string};

  /**
   * Source of the largest layout shift
   */
  cls?: {source?: string};

  /**
   * Interaction type of the slowest interaction to next paint
   */
  inp?: {interactionType?: string};
};

/**
 * Condensed metrics of an entity in a single run
 */
export type EntitySummary = ComparisonEntity & {
  /**
   * Duration of the entity in milliseconds
   */
  duration: number;
  metrics: Record<string, MetricSummary>;

  /**
   * Non-numeric attribution of the Web Vitals, when captured for this entity
   */
  attribution?: WebVitalsAttribution;
};

/**
 * Condensed result of a single run
 */
export type RunSummary = {
  id: string;
  file: string;
  startedAt: number;
  entities: Record<string, EntitySummary>;
};

/**
 * History file that was not included in the comparison
 */
export type ExcludedRun = {
  file: string;
  reason: string;
  missingMetrics?: string[];
};

export type ComparisonStatus = 'increased' | 'decreased' | 'unchanged' | 'noisy' | 'new' | 'missing';

/**
 * Comparison of a metric of an entity between the current run and the baseline
 */
export type MetricComparison = {
  entityKey: string;
  entityName: string;
  metric: string;
  kind: MetricKind;
  unit: MetricUnit;
  status: ComparisonStatus;

  /**
   * Median of the recent runs
   */
  current?: number;
  baselineMedian?: number;

  /**
   * Scaled median absolute deviation of the baseline
   */
  baselineSpread?: number;
  absoluteChange?: number;
  relativeChange?: number;

  /**
   * Change divided by the baseline spread
   */
  zScore?: number;
  currentRate?: number;
  baselineRateMedian?: number;

  /**
   * Amount of recent runs the current value is based on
   */
  recentRuns: number;
  baselineRuns: number;

  /**
   * Values of all included runs, oldest first
   */
  series: Array<{runId: string; value: number | undefined}>;
};

/**
 * Machine readable comparison report
 */
export type ComparisonReport = {
  schemaVersion: 1;
  generatedAt: string;
  status: 'ok' | 'low-confidence' | 'no-baseline' | 'invalid-current-run';
  message: string;
  currentRun?: {id: string; file: string; startedAt: string};

  /**
   * Latest runs including the current run, which are compared against the baseline
   */
  recentRuns: Array<{id: string; file: string; startedAt: string}>;
  baselineRuns: Array<{id: string; file: string; startedAt: string}>;
  excludedRuns: ExcludedRun[];
  settings: {
    requiredMetrics: string[];
    comparedMetrics?: string[];
    bandPercentile: number;
    recentRuns: number;
    baselineWindow: number;
    relativeThreshold: number;
    zScoreThreshold: number;
    minBaselineRuns: number;
  };
  /**
   * Tests and their steps in order of execution, including their significant changes
   */
  steps: StepComparison[];
};

/**
 * Overall verdict of a test or step
 * - regressed: only increases, improved: only decreases, mixed: both
 */
export type StepStatus = 'regressed' | 'improved' | 'mixed' | 'unchanged' | 'noisy' | 'new' | 'missing';

/**
 * Comparison of a test or step against the baseline
 */
export type StepComparison = ComparisonEntity & {
  name: string;
  status: StepStatus;

  /**
   * Duration of the test or step in milliseconds
   */
  duration: Pick<MetricComparison, 'status' | 'current' | 'baselineMedian' | 'absoluteChange' | 'relativeChange'>;

  /**
   * Significant changes of the test or step sorted by severity
   */
  changes: Array<Omit<MetricComparison, 'entityKey' | 'entityName'>>;
};
