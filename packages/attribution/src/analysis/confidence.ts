import type {
  BundleRegression,
  ComparisonReport,
} from '../types.js';

/**
 * Confidence of a culprit, computed from the evidence only. A model never sets it.
 */
export type Confidence = 'high' | 'low';

/**
 * What a culprit is attributed by: function self time of the trace, or the retainer path of grown heap objects
 */
export type AttributionBasis = 'cpu' | 'heap';

/**
 * Minimum share of the evidence for a high confidence: of the trace's self time for cpu, of the sampled objects of
 * the grown class whose retainer path contains the frame for heap
 */
export const minimumShare: Record<AttributionBasis, number> = {cpu: 0.1, heap: 0.5};

/**
 * Metrics of the heap, explained by retainer paths. Network metrics are explained by neither basis.
 */
const heapMetricPattern = /heap|detached/i;
const networkMetricPattern = /network|transfer|request|resource/i;

/**
 * Basis that explains a metric, if any
 *
 * @param metric metric name
 */
export function basisOfMetric(metric: string): AttributionBasis | undefined {
  if (heapMetricPattern.test(metric)) {
    return 'heap';
  }

  return networkMetricPattern.test(metric) ? undefined : 'cpu';
}

/**
 * Evidence of a culprit that its confidence is computed from
 */
export type ConfidenceInput = {
  /**
   * The file and line lie inside a changed hunk
   */
  inHunk: boolean;
  basis: AttributionBasis;

  /**
   * Share of the evidence, see `minimumShare`
   */
  share: number;

  /**
   * Increased metric of the regression that the basis explains, undefined if none does
   */
  metric?: string;
  regressionStatus: BundleRegression['status'];

  /**
   * Status of the comparison the regression comes from
   */
  comparisonStatus?: ComparisonReport['status'];
};

/**
 * Deterministic confidence: high only if the culprit lies inside a changed hunk, its basis explains an increased
 * metric, the evidence is a material share, the test or step only regressed (not mixed), and the comparison had enough
 * baseline runs to separate noise from real changes (`ok`, not `low-confidence`). Otherwise low.
 *
 * @param input evidence of the culprit
 */
export function computeConfidence(input: ConfidenceInput): Confidence {
  const high = input.inHunk
    && input.metric !== undefined
    && input.share >= minimumShare[input.basis]
    && input.regressionStatus === 'regressed'
    && input.comparisonStatus === 'ok';
  return high ? 'high' : 'low';
}
