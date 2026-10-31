import type {
  nativePresenters,
} from 'playwright-performance-reporter';

/**
 * Comparison presenter of the reporter, whose report the attribution presenter reads
 */
export type ComparisonPresenterInstance = InstanceType<typeof nativePresenters['comparisonPresenter']>;

/**
 * Report of the comparison presenter
 */
export type ComparisonReport = NonNullable<Awaited<ReturnType<ComparisonPresenterInstance['getReport']>>>;

/**
 * Comparison of a test or step against its baseline
 */
export type StepComparison = ComparisonReport['steps'][number];

/**
 * Significant change of a metric of a test or step
 */
export type MetricChange = StepComparison['changes'][number];

/**
 * Artifact written by an observer, e.g. a trace or a heap snapshot
 */
export type ArtifactPath = {
  /**
   * Path exactly as the observer recorded it, usually relative to the working directory of the run
   */
  file: string;

  /**
   * Path resolved when the bundle was written
   */
  absoluteFile: string;
};

/**
 * Why the changed lines of code could not be resolved
 */
export type UnresolvedReason = 'no revision metadata' | 'git unavailable' | 'baseline commit is not an ancestor' | 'no changes since the baseline commit';

/**
 * Lines a file gained between the baseline commit and the current commit
 */
export type ChangedHunk = {
  /**
   * Path relative to the root of the repository, as git reports it
   */
  file: string;
  absoluteFile: string;

  /**
   * Added or changed lines, 1-based and inclusive
   */
  addedRanges: LineRange[];

  /**
   * Text of the added lines, to match the variables and properties on a retainer path to the lines that changed them.
   * Capped per file; lines beyond the cap are only known by their number.
   */
  addedLines?: Array<{line: number; text: string}>;
};

/**
 * Where the app serves files of the repository, e.g. `{url: 'http://localhost:4321/', path: 'example/app'}`
 * serves `example/app/server.mjs` as `http://localhost:4321/server.mjs`. Scripts below `url` are matched to exactly
 * that file, never by a guess.
 */
export type SourceRoot = {
  /**
   * Prefix of the script urls, including the origin
   */
  url: string;

  /**
   * Directory relative to the root of the repository
   */
  path: string;
};

/**
 * Lines of a file, 1-based and inclusive
 */
export type LineRange = {start: number; end: number};

/**
 * What a regression is attributed by: function self time of the trace, or class growth of the heap
 */
export type AttributionBasis = 'cpu' | 'heap';

/**
 * Regressed test or step with its increased metrics and artifacts
 */
export type BundleRegression = {
  /**
   * Key of the entity in the comparison report
   */
  entityKey: string;
  name: string;
  kind: StepComparison['kind'];
  testId: string;
  testName: string;
  stepName?: string;
  occurrence?: number;
  status: 'regressed' | 'mixed';
  duration: StepComparison['duration'];

  /**
   * Metrics that increased, sorted by severity as in the comparison report
   */
  changes: MetricChange[];

  /**
   * Analyses that fit the increased metrics
   */
  basis: AttributionBasis[];
  artifacts: {
    traceFile?: ArtifactPath;
    heapDiffFile?: ArtifactPath;
  };

  /**
   * Classes of the objects that were added during the test or step, as recorded by `heapDiff`
   */
  heapDiffTopClasses?: string;

  /**
   * Set if the test or step wrote neither a trace nor a heap snapshot
   */
  reason?: 'no-artifact';
};

/**
 * Limits of the attribution step, enforced by the CLI
 */
export type AttributionCaps = {
  maxRegressions: number;
  maxChangedFiles: number;

  /**
   * Upper bound of the serialized request to the model, in bytes
   */
  maxPromptBytes: number;
};

export const defaultCaps: AttributionCaps = {
  maxRegressions: 25,
  maxChangedFiles: 200,
  maxPromptBytes: 200_000,
};

/**
 * Self-contained hand-off of a run to the attribution step
 */
export type AttributionBundle = {
  schemaVersion: 1;
  generatedAt: string;

  /**
   * Set if the run has nothing to attribute: `no-regressions` if the comparison found none,
   * `comparison-unavailable` if there was no comparison to take regressions from, see `noteDetail`
   */
  note?: 'no-regressions' | 'comparison-unavailable';

  /**
   * Why the comparison is unavailable, e.g. the error of the comparison presenter or its status
   */
  noteDetail?: string;
  run: {
    commit?: string;
    branch?: string;

    /**
     * Commit of the newest baseline run, the start of the changed lines
     */
    baselineCommit?: string;
    metadata?: Record<string, string>;
  };

  /**
   * Set if the changed lines could not be resolved, in which case `hunks` is empty
   */
  unresolved?: UnresolvedReason;

  /**
   * Details of `unresolved`, e.g. which history file couldn't be read or what git reported
   */
  unresolvedDetail?: string;
  hunks: ChangedHunk[];

  /**
   * Where the app serves files of the repository, see `SourceRoot`
   */
  sourceRoots?: SourceRoot[];
  regressions: BundleRegression[];
  caps: AttributionCaps;

  /**
   * Comparison report the regressions come from, without its tests and steps
   */
  comparison?: Omit<ComparisonReport, 'steps'>;
};

/**
 * File name of the bundle in the output directory of the presenter
 */
export const bundleFileName = 'performance-attribution.json';
