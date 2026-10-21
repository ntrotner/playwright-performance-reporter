/**
 * Options for the statistics presenter
 */
export type StatisticsPresenterOptions = {
  outputDir: string;
  outputFile: string;

  /**
   * Percentiles between 0 and 1 to report, as `p50`, `p75`, ... Defaults to `[0.5, 0.75, 0.95]`.
   */
  percentiles?: number[];

  /**
   * Include retries of failed executions. Defaults to false, as retries are not independent samples.
   */
  includeRetries?: boolean;

  /**
   * Indent the output for readability, compact by default
   */
  pretty?: boolean;
};

/**
 * Statistics of a metric across the executions of a test or step
 */
export type MetricStatistics = {
  count: number;
  min: number;
  max: number;
  mean: number;

  /**
   * Scaled median absolute deviation, a robust estimate of the spread
   */
  mad: number;
} & Record<`p${number}`, number>;

/**
 * Statistics of a test or step
 */
export type StepStatistics = {
  name: string;

  /**
   * Index of the step, if the same step name occurs multiple times in a test
   */
  occurrence: number;

  /**
   * Amount of executions that contain the step
   */
  executions: number;

  /**
   * Statistics per metric, including `entityDuration` (ms)
   */
  metrics: Record<string, MetricStatistics>;
};

/**
 * Statistics of a test across its executions, e.g. with `repeatEach`
 */
export type TestStatistics = {
  name: string;
  executions: number;

  /**
   * The test itself
   */
  test: StepStatistics;
  steps: StepStatistics[];
};

/**
 * Output of the statistics presenter
 */
export type StatisticsReport = {
  schemaVersion: 1;
  generatedAt: string;
  percentiles: number[];
  tests: TestStatistics[];
};
