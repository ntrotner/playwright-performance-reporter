/**
 * Options for the waterfall presenter
 */
export type WaterfallPresenterOptions = {
  outputDir: string;
  outputFile: string;

  /**
   * Requests per waterfall, sorted by start. Defaults to 200.
   */
  maxRequests?: number;
};
