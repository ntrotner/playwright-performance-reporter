import type {
  Candidate,
} from './analysis/attribute.js';
import type {
  CappedBundle,
} from './analysis/bundle.js';
import type {
  DroppedCulprit,
} from './analysis/validate.js';
import type {
  AttributionBundle,
  BundleRegression,
  BundleStatus,
} from './types.js';

/**
 * Verdict of one regression
 * - attributed: a culprit with high confidence
 * - low-confidence: culprits, none with high confidence
 * - no-culprit: the agent found nothing on the changed lines, or every culprit was dropped
 * - no-agent: no agent ran, only the evidence is listed
 * - not-analyzed: the bundle has no changed hunks to attribute to, see the status of the result
 */
export type RegressionVerdict = 'attributed' | 'low-confidence' | 'no-culprit' | 'no-agent' | 'not-analyzed';

/**
 * Overall status of an attribution. Statuses of the bundle other than `ok` are passed through with their message.
 */
export type AttributionStatus = 'attributed' | 'low-confidence' | 'no-culprit' | 'no-agent' | 'error' | Exclude<BundleStatus, 'ok'>;

/**
 * Attribution of one regression
 */
export type RegressionResult = Pick<BundleRegression, 'entityKey' | 'name' | 'status'> & {
  changes: Array<Pick<BundleRegression['changes'][number], 'metric' | 'unit' | 'baselineMedian' | 'current' | 'relativeChange'>>;
  verdict: RegressionVerdict;

  /**
   * Validated culprits of the agent, best first
   */
  culprits: Candidate[];

  /**
   * Evidence inside the changed hunks, whether or not an agent ran
   */
  candidates: Candidate[];
  dropped: DroppedCulprit[];
  problems: string[];
};

/**
 * Machine-readable result of `performance-attribution attribute`, as written with `--json`
 */
export type AttributionResult = {
  schemaVersion: 1;
  status: AttributionStatus;
  message: string;
  run: AttributionBundle['run'];
  model?: string;
  agent?: {steps: number; stopReason?: string};
  truncated: CappedBundle['truncated'];
  regressions: RegressionResult[];
};
