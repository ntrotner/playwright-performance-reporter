/**
 * Device profile of the Lighthouse scoring curves
 */
export type ScoringDevice = 'mobile' | 'desktop';

/**
 * Metric of the performance score with its weight and the control points of its log-normal curve
 */
type ScoringCurve = {
  metric: string;
  weight: number;

  /**
   * Value with a score of 0.9
   */
  p10: number;

  /**
   * Value with a score of 0.5
   */
  median: number;

  /**
   * Whether 0 means "not measured yet", e.g. a paint that did not happen
   */
  zeroIsMissing: boolean;
};

/**
 * Speed Index, which is part of the Lighthouse score, but not measured by an observer
 */
export const speedIndexMetric = 'speedIndex';

/**
 * Weights and control points of Lighthouse 10 to 12
 * https://developer.chrome.com/docs/lighthouse/performance/performance-scoring
 */
const curves: Record<ScoringDevice, ScoringCurve[]> = {
  mobile: [
    {
      metric: 'firstContentfulPaint', weight: 0.1, p10: 1800, median: 3000, zeroIsMissing: true,
    },
    {
      metric: speedIndexMetric, weight: 0.1, p10: 3387, median: 5800, zeroIsMissing: true,
    },
    {
      metric: 'largestContentfulPaint', weight: 0.25, p10: 2500, median: 4000, zeroIsMissing: true,
    },
    {
      metric: 'totalBlockingTime', weight: 0.3, p10: 200, median: 600, zeroIsMissing: false,
    },
    {
      metric: 'cumulativeLayoutShift', weight: 0.25, p10: 0.1, median: 0.25, zeroIsMissing: false,
    },
  ],
  desktop: [
    {
      metric: 'firstContentfulPaint', weight: 0.1, p10: 934, median: 1600, zeroIsMissing: true,
    },
    {
      metric: speedIndexMetric, weight: 0.1, p10: 1311, median: 2300, zeroIsMissing: true,
    },
    {
      metric: 'largestContentfulPaint', weight: 0.25, p10: 1200, median: 2400, zeroIsMissing: true,
    },
    {
      metric: 'totalBlockingTime', weight: 0.3, p10: 150, median: 350, zeroIsMissing: false,
    },
    {
      metric: 'cumulativeLayoutShift', weight: 0.25, p10: 0.1, median: 0.25, zeroIsMissing: false,
    },
  ],
};

/**
 * Error function, approximated like Lighthouse (Abramowitz and Stegun 7.1.26)
 *
 * @param x input
 */
function erf(x: number): number {
  const sign = Math.sign(x);
  const absolute = Math.abs(x);
  const t = 1 / (1 + (0.327_591_1 * absolute));
  const y = t * (0.254_829_592 + (t * (-0.284_496_736 + (t * (1.421_413_741 + (t * (-1.453_152_027 + (t * 1.061_405_429))))))));
  return sign * (1 - (y * Math.exp(-absolute * absolute)));
}

/**
 * Score of a value between 0 and 1 on a log-normal curve, like Lighthouse's `getLogNormalScore`:
 * the median scores 0.5, the p10 value 0.9
 *
 * @param curve control points
 * @param value measured value
 */
export function logNormalScore(curve: {p10: number; median: number}, value: number): number {
  if (value <= 0) {
    return 1;
  }

  const inverseErfcOneFifth = 0.906_193_802_436_823_2;
  const xLogRatio = Math.log(Math.max(Number.MIN_VALUE, value / curve.median));
  const p10LogRatio = -Math.log(Math.max(Number.MIN_VALUE, curve.p10 / curve.median));
  const complementaryPercentile = (1 - erf(xLogRatio * inverseErfcOneFifth / p10LogRatio)) / 2;

  // Keep the score within the band of its control points despite the approximation of erf
  if (value <= curve.p10) {
    return Math.max(0.9, Math.min(1, complementaryPercentile));
  }

  if (value <= curve.median) {
    return Math.max(0.5, Math.min(0.899_999_999_999_99, complementaryPercentile));
  }

  return Math.max(0, Math.min(0.499_999_999_999_99, complementaryPercentile));
}

/**
 * Lighthouse-like performance score of measured metrics
 */
export type PerformanceScore = {
  /**
   * Score between 0 and 100
   */
  score: number;

  /**
   * Score between 0 and 1 per available metric
   */
  breakdown: Record<string, number>;

  /**
   * Metrics of the score that were not measured. Their weight is distributed over the measured ones.
   */
  missing: string[];
};

/**
 * Compute a Lighthouse-like performance score from Web Vitals and Total Blocking Time
 *
 * @param metrics measured metrics, e.g. of `webVitals` and `longTasks`
 * @param device scoring curves to use
 * @param minimumInputs amount of measured metrics needed for a score
 * @returns score, or undefined without a paint metric or with less inputs than required
 */
export function performanceScore(metrics: Record<string, unknown>, device: ScoringDevice = 'desktop', minimumInputs = 2): PerformanceScore | undefined {
  const breakdown: Record<string, number> = {};
  const missing: string[] = [];
  let weightedScore = 0;
  let totalWeight = 0;

  for (const curve of curves[device]) {
    const value = metrics[curve.metric];
    if (typeof value !== 'number' || !Number.isFinite(value) || (curve.zeroIsMissing && value === 0)) {
      missing.push(curve.metric);
      continue;
    }

    const score = logNormalScore(curve, value);
    breakdown[curve.metric] = score;
    weightedScore += score * curve.weight;
    totalWeight += curve.weight;
  }

  // Without a paint, e.g. right after a navigation, blocking time and layout shifts alone would score perfectly
  const hasPaint = 'largestContentfulPaint' in breakdown || 'firstContentfulPaint' in breakdown;
  if (!hasPaint || Object.keys(breakdown).length < minimumInputs) {
    return undefined;
  }

  return {score: Math.round(weightedScore / totalWeight * 100), breakdown, missing};
}
