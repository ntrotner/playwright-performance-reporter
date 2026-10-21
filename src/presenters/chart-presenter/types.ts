/**
 * Summary statistics for a metric across multiple runs
 */
export type MetricSummary = {
  min: number;
  max: number;
  avg: number;
  count: number;
};

/**
 * File written by an observer for a test or step, e.g. a trace
 */
export type ArtifactLink = {
  caseId: string;

  /**
   * Name of the test or step
   */
  step: string;

  /**
   * Metric that holds the path of the file
   */
  metric: string;
  file: string;
};
