import {
  metricUnit,
} from '../presenters/comparison-presenter/constants.js';
import {
  type BudgetRule,
  type BudgetSample,
  type BudgetViolation,
} from '../types/index.js';
import {
  Logger,
} from './logger.js';

/**
 * Convert a glob pattern with `*` and `?` wildcards into an anchored regular expression
 *
 * @param pattern glob pattern
 */
export function globToRegExp(pattern: string): RegExp {
  const source = pattern
    .replaceAll(/[.+^${}()|[\]\\]/g, String.raw`\$&`)
    .replaceAll('*', '.*')
    .replaceAll('?', '.');

  return new RegExp(`^${source}$`, 's');
}

/**
 * Throw on budget rules that can never be evaluated meaningfully
 *
 * @param rules budget rules from the options
 */
export function validateBudgetRules(rules: BudgetRule[]): void {
  if (!Array.isArray(rules)) {
    throw new TypeError('Invalid budgets: "rules" must be an array');
  }

  for (const rule of rules) {
    if (typeof rule.metric !== 'string' || rule.metric.trim() === '') {
      throw new Error('Invalid budget rule: "metric" must be a non-empty string');
    }

    if (rule.max === undefined && rule.min === undefined) {
      throw new Error(`Invalid budget rule for "${rule.metric}": at least one of "max" or "min" is required`);
    }

    for (const bound of [rule.max, rule.min]) {
      if (bound !== undefined && !Number.isFinite(bound)) {
        throw new Error(`Invalid budget rule for "${rule.metric}": "max" and "min" must be finite numbers`);
      }
    }

    if (rule.max !== undefined && rule.min !== undefined && rule.max < rule.min) {
      throw new Error(`Invalid budget rule for "${rule.metric}": "max" must not be less than "min"`);
    }
  }
}

/**
 * Check the final metrics against the budget rules
 *
 * @param samples final metrics of all tests and steps
 * @param rules budget rules from the options
 */
export function evaluateBudgets(samples: BudgetSample[], rules: BudgetRule[]): BudgetViolation[] {
  const violations: BudgetViolation[] = [];

  for (const rule of rules) {
    const namePattern = globToRegExp(rule.namePattern ?? '*');
    const unit = metricUnit(rule.metric);
    let measured = false;

    for (const sample of samples) {
      if (!namePattern.test(sample.name) || !Object.hasOwn(sample.metric, rule.metric)) {
        continue;
      }

      measured = true;
      const actual = sample.metric[rule.metric];
      if (typeof actual !== 'number' || !Number.isFinite(actual)) {
        Logger.warning(`Budget skipped non-numeric value of metric "${rule.metric}"`, sample.name);
        continue;
      }

      if (rule.max !== undefined && actual > rule.max) {
        violations.push({
          metric: rule.metric, name: sample.name, actual, limit: rule.max, direction: 'max', unit,
        });
      }

      if (rule.min !== undefined && actual < rule.min) {
        violations.push({
          metric: rule.metric, name: sample.name, actual, limit: rule.min, direction: 'min', unit,
        });
      }
    }

    if (!measured) {
      Logger.warning(`Budget metric "${rule.metric}" was never measured for tests matching "${rule.namePattern ?? '*'}"`);
    }
  }

  return violations;
}

/**
 * Human readable description of a budget violation
 *
 * @param violation violation to describe
 */
export function formatBudgetViolation(violation: BudgetViolation): string {
  const operator = violation.direction === 'max' ? '>' : '<';
  const unit = violation.unit ? ` (${violation.unit})` : '';

  return `Budget violation: metric "${violation.metric}" = ${violation.actual} ${operator} ${violation.limit}${unit} (test: "${violation.name}")`;
}
