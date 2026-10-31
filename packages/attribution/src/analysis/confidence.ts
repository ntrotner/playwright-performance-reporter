import type {
  MetricChange,
} from '../types.js';

/**
 * Weight of the share of the regression that runs through the changed lines
 */
const overlapWeight = 0.6;

/**
 * Weight of how clearly the metric moved away from its baseline
 */
const deltaWeight = 0.4;

/**
 * Robust z-score that counts as the strongest possible signal
 */
const zScoreSaturation = 10;

/**
 * Clamp a number to 0..1
 *
 * @param value number
 */
function clamp(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

/**
 * How clearly the strongest increased metric moved away from its baseline, between 0 and 1:
 * the mean of its relative change (100 % counts fully) and its robust z-score (10 counts fully).
 * Without a z-score, e.g. with too few baseline runs, only the relative change counts.
 *
 * @param changes increased metrics of a regression
 */
export function deltaStrength(changes: MetricChange[]): number {
  let strongest = 0;
  for (const change of changes) {
    const relative = clamp(change.relativeChange ?? 0);
    const zScore = change.zScore === undefined ? relative : clamp(Math.abs(change.zScore) / zScoreSaturation);
    strongest = Math.max(strongest, (relative + zScore) / 2);
  }

  return strongest;
}

/**
 * Confidence in a culprit, between 0 and 1, rounded to two decimals. Computed only from the evidence,
 * never taken from the agent: the share of the regression on the changed lines, and the strength of the change.
 *
 * @param overlap share of the self time (CPU) or of the sampled retainer paths (heap) on the changed lines, between 0 and 1
 * @param changes increased metrics of the regression
 */
export function culpritConfidence(overlap: number, changes: MetricChange[]): number {
  return Math.round(((overlapWeight * clamp(overlap)) + (deltaWeight * deltaStrength(changes))) * 100) / 100;
}
