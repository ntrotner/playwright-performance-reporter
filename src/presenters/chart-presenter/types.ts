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
