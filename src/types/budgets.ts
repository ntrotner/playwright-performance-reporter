import {
  type Metric,
} from './index.js';

/**
 * A single budget rule checked against the final ("onStop") metrics.
 * Values are compared in the native unit of the metric, as emitted in `stopMetrics[].metric`.
 */
export type BudgetRule = {
  /**
   * Metric key to evaluate, e.g. 'largestContentfulPaint' or 'JSHeapUsedSize'
   */
  metric: string;

  /**
   * Glob pattern (supports `*` and `?`) matched against the name of the test or step.
   * Defaults to `'*'`.
   */
  namePattern?: string;

  /**
   * Fail if any matching value is greater than this. At least one of `max`/`min` is required.
   */
  max?: number;

  /**
   * Fail if any matching value is less than this. At least one of `max`/`min` is required.
   */
  min?: number;
};

/**
 * Performance budgets enforced at the end of the run
 */
export type BudgetOptions = {
  rules: BudgetRule[];

  /**
   * 'fail' (default) fails the run when any rule is violated, 'warn' only logs the violation
   */
  onViolation?: 'fail' | 'warn';
};

/**
 * Final metrics of a test or step retained for budget evaluation
 */
export type BudgetSample = {
  name: string;
  metric: Metric;
};

/**
 * Rule violation found during budget evaluation
 */
export type BudgetViolation = {
  metric: string;

  /**
   * Name of the test or step that violated the rule
   */
  name: string;
  actual: number;
  limit: number;
  direction: 'max' | 'min';
  unit?: string;
};
