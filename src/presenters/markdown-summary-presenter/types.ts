import {
  type ComparisonPresenter,
} from '../comparison-presenter/index.js';

/**
 * Options for the markdown summary presenter
 */
export type MarkdownSummaryPresenterOptions = {
  outputDir: string;
  outputFile: string;

  /**
   * Append the summary to the GitHub Actions job summary (`$GITHUB_STEP_SUMMARY`) when it's set. Defaults to true.
   */
  githubStepSummary?: boolean;

  /**
   * Metrics shown as columns, besides the duration.
   * Defaults to `largestContentfulPaint`, `totalBlockingTime`, `JSHeapUsedSize` and `totalNetworkTransferSize`.
   */
  metrics?: string[];

  /**
   * Comparison presenter of the same run, to show the verdict of every test and step
   */
  comparison?: ComparisonPresenter;

  /**
   * Title of the summary. Defaults to `Performance report`.
   */
  title?: string;
};

/**
 * Merged measurements of a test or step
 */
export type SummaryRow = {
  caseId: string;
  stepId: string;
  name: string;
  isTest: boolean;
  start: number;
  end: number;

  /**
   * Latest stop value per metric, preferring pages over other targets
   */
  values: Record<string, number>;
  metadata?: Record<string, string>;

  /**
   * Index of the repeat with `repeatEach`, recorded on the test
   */
  repeatEachIndex?: number;
};
