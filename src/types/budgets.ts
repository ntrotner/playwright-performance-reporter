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

  /**
   * - `each` (default): every execution of a test or step is checked
   * - `median`, `mean`, `p75`, `p95`, `min`, `max`: the values of all executions of the same test or step,
   *   e.g. with `repeatEach`, are condensed first, so a single noisy execution doesn't fail the run
   */
  aggregate?: BudgetAggregate;
};

/**
 * How the values of the executions of a test or step are condensed before checking a budget
 */
export type BudgetAggregate = 'each' | 'median' | 'mean' | 'p75' | 'p95' | 'min' | 'max';

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

  /**
   * Name of the test the sample belongs to, identical for all repeats of a test
   */
  testName?: string;
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

  /**
   * How the values were condensed, if not checked per execution
   */
  aggregate?: Exclude<BudgetAggregate, 'each'>;

  /**
   * Amount of executions the aggregate is based on
   */
  executions?: number;
};
