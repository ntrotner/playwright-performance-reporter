/**
 * Options for chart presenter
 */
export type ChartPresenterOptions = {
  outputDir: string;
  outputFile: string;
};

/**
 * Data point for chart
 */
export type ChartDatapoint = {
  labels: string[];
  name: string;
  timestamp: number;
  values: number[];
};

/**
 * Summary statistics for a metric across multiple runs
 */
export type MetricSummary = {
  min: number;
  max: number;
  avg: number;
  latest: number;
  count: number;
};

/**
 * Data structure for metrics comparison display
 */
export type MetricsComparisonData = {
  testName: string;
  timestamp: number;
  metrics: Map<string, MetricSummary>;
};
