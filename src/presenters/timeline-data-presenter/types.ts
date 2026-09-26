/**
 * Data point for timeline visualization
 */
export type TimelineDataPoint = {
  labels: string[];

  /**
   * Name of the test this data point belongs to.
   */
  name: string;

  /**
   * Identifier of the single test execution this data point belongs to.
   * Playwright gives every execution, including every repeat, its own id, so data points of
   * different executions can be plotted as separate lines instead of one aggregated timeline.
   */
  execution: string;

  /**
   * Milliseconds since the start of the execution
   */
  timestamp: number;
  values: number[];
};

/**
 * Options for timeline data presenter
 */
export type ChartPresenterOptions = {
  outputDir: string;
  outputFile: string;
};
