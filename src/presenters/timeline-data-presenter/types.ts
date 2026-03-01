/**
 * Data point for timeline visualization
 */
export type TimelineDataPoint = {
  labels: string[];
  name: string;
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
