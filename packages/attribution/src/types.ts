import type {
  nativePresenters,
} from 'playwright-performance-reporter';

/**
 * Comparison presenter of the reporter, whose report the attribution presenter reads
 */
export type ComparisonPresenter = InstanceType<typeof nativePresenters['comparisonPresenter']>;

/**
 * Report of the comparison presenter
 */
export type ComparisonReport = NonNullable<Awaited<ReturnType<ComparisonPresenter['getReport']>>>;

/**
 * Comparison of a test or step against its baseline
 */
export type StepComparison = ComparisonReport['steps'][number];

/**
 * Significant change of a metric of a test or step
 */
export type MetricChange = StepComparison['changes'][number];

/**
 * Why the changed hunks of the commit range could not be resolved
 * - no-revision-metadata: the run or its baseline runs recorded no commit, or the history of the baseline is unknown
 * - git-unavailable: git failed, timed out, or a commit is missing from the checkout, e.g. of a shallow clone
 * - baseline-not-an-ancestor: the baseline commit is not an ancestor of the commit of the run
 */
export type RevisionReason = 'no-revision-metadata' | 'git-unavailable' | 'baseline-not-an-ancestor';

/**
 * Outcome of the hand-off
 * - ok: regressions and the changed hunks are resolved
 * - no-regressions: the comparison found no regressed or mixed test or step
 * - no-comparison: the comparison presenter has no report, e.g. nothing was measured or its comparison failed
 * - error: building the bundle failed, see `message`
 */
export type BundleStatus = 'ok' | 'no-regressions' | 'no-comparison' | RevisionReason | 'error';

/**
 * Artifact written by an observer, e.g. a trace or a heap snapshot
 */
export type ArtifactRef = {
  /**
   * Path exactly as the observer recorded it, usually relative to the working directory of the run
   */
  file: string;

  /**
   * Path resolved against the working directory of the run when the bundle was written
   */
  absoluteFile: string;
};

/**
 * Lines of a file, 1-based and inclusive
 */
export type LineRange = {start: number; end: number};

/**
 * Lines a file gained between the baseline commit and the commit of the run
 */
export type ChangedFile = {
  /**
   * Path relative to the root of the repository, as git reports it
   */
  file: string;
  addedRanges: LineRange[];
};

/**
 * Regressed or mixed test or step, reduced to its increased metrics, with the artifacts it wrote
 */
export type BundleRegression = {
  /**
   * Key of the test or step in the comparison report
   */
  entityKey: string;
  kind: StepComparison['kind'];
  name: string;
  testName: string;
  stepName?: string;
  status: 'regressed' | 'mixed';
  duration: StepComparison['duration'];

  /**
   * Metrics whose status is `increased`, sorted by severity as in the comparison report
   */
  changes: MetricChange[];
  traceFile?: ArtifactRef;
  heapDiffFile?: ArtifactRef;

  /**
   * Classes of the objects added during the test or step, the JSON string `heapDiff` records
   */
  heapDiffTopClasses?: string;

  /**
   * Set if the test or step wrote neither a trace nor a heap snapshot
   */
  artifactReason?: 'no-artifact';
};

/**
 * Self-contained hand-off of a run to the attribution step
 */
export type AttributionBundle = {
  schemaVersion: 1;
  generatedAt: string;
  status: BundleStatus;

  /**
   * Why the status was chosen, in words
   */
  message: string;
  run: {
    commit?: string;
    branch?: string;

    /**
     * Commit the changed hunks start from: the newest baseline run that recorded a commit other than `commit`
     */
    baselineCommit?: string;
    startedAt?: string;
  };

  /**
   * Status and message of the comparison the regressions come from
   */
  comparison?: Pick<ComparisonReport, 'status' | 'message'>;

  /**
   * Settings the regressions were judged against: baseline window, recent runs, thresholds and `minBaselineRuns`
   */
  settings?: ComparisonReport['settings'];
  regressions: BundleRegression[];

  /**
   * Empty if the changed hunks could not be resolved, see `status`
   */
  changedFiles: ChangedFile[];
};

/**
 * Default file name of the bundle in the output directory of the presenter
 */
export const bundleFileName = 'attribution-bundle.json';
