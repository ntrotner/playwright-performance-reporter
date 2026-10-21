import {
  logNormalScore,
  performanceScore,
} from '../../src/helpers/index.js';

describe('Performance score', () => {
  it('should score the control points like Lighthouse', () => {
    const curve = {p10: 2500, median: 4000};

    expect(logNormalScore(curve, 4000)).toBeCloseTo(0.5, 5);
    expect(logNormalScore(curve, 2500)).toBeCloseTo(0.9, 5);
    expect(logNormalScore(curve, 0)).toBe(1);
    expect(logNormalScore(curve, 1000)).toBeGreaterThan(0.9);
    expect(logNormalScore(curve, 20_000)).toBeLessThan(0.05);
  });

  it('should weight the metrics and redistribute the missing Speed Index', () => {
    const atMedian = {firstContentfulPaint: 3000, largestContentfulPaint: 4000, totalBlockingTime: 600, cumulativeLayoutShift: 0.25};

    expect(performanceScore(atMedian, 'mobile')).toEqual({
      score: 50,
      breakdown: {
        firstContentfulPaint: expect.closeTo(0.5, 5) as number,
        largestContentfulPaint: expect.closeTo(0.5, 5) as number,
        totalBlockingTime: expect.closeTo(0.5, 5) as number,
        cumulativeLayoutShift: expect.closeTo(0.5, 5) as number,
      },
      missing: ['speedIndex'],
    });
    // Same values are better on the slower mobile curves than on desktop
    expect(performanceScore(atMedian, 'desktop')!.score).toBeLessThan(50);
    expect(performanceScore({...atMedian, speedIndex: 5800}, 'mobile')!.missing).toEqual([]);
  });

  it('should treat paints of 0 as not measured, but a blocking time of 0 as perfect', () => {
    const score = performanceScore({largestContentfulPaint: 1000, firstContentfulPaint: 0, totalBlockingTime: 0, cumulativeLayoutShift: 0});

    expect(score).toEqual({
      score: 98, breakdown: {largestContentfulPaint: expect.closeTo(0.95, 2) as number, totalBlockingTime: 1, cumulativeLayoutShift: 1}, missing: ['firstContentfulPaint', 'speedIndex'],
    });
  });

  it('should not score without a paint, e.g. right after a navigation', () => {
    expect(performanceScore({largestContentfulPaint: 0, firstContentfulPaint: 0, totalBlockingTime: 0, cumulativeLayoutShift: 0})).toBeUndefined();
  });

  it('should need a minimum amount of inputs', () => {
    expect(performanceScore({largestContentfulPaint: 1000})).toBeUndefined();
    expect(performanceScore({largestContentfulPaint: 1000}, 'desktop', 1)?.score).toBe(95);
    expect(performanceScore({largestContentfulPaint: 'slow', totalBlockingTime: Number.NaN})).toBeUndefined();
  });
});
