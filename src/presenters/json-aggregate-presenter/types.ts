/**
 * Options for json aggregate presenter
 */
export type JsonAggregatePresenterOptions = {
  outputDir: string;
  outputFile: string;

  /**
   * Indent the output for readability, compact by default
   */
  pretty?: boolean;
};
