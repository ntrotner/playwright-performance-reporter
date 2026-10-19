import {
  metricUnit,
} from '../presenters/comparison-presenter/constants.js';
import {
  median,
  percentile,
} from '../presenters/comparison-presenter/comparison.js';
import {
  type BudgetAggregate,
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
 * Supported ways to condense the values of the executions of a test or step
 */
const budgetAggregates: BudgetAggregate[] = ['each', 'median', 'mean', 'p75', 'p95', 'min', 'max'];

/**
 * Condense the values of the executions of a test or step
 *
 * @param values values of all executions
 * @param aggregate how to condense
 */
export function aggregateValues(values: number[], aggregate: Exclude<BudgetAggregate, 'each'>): number {
  switch (aggregate) {
    case 'median': {
      return median(values);
    }

    case 'mean': {
      return values.reduce((total, value) => total + value, 0) / values.length;
    }

    case 'p75': {
      return percentile(values, 0.75);
    }

    case 'p95': {
      return percentile(values, 0.95);
    }

    case 'min': {
      return Math.min(...values);
    }

    case 'max': {
      return Math.max(...values);
    }
  }
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

    if (rule.aggregate !== undefined && !budgetAggregates.includes(rule.aggregate)) {
      throw new Error(`Invalid budget rule for "${rule.metric}": "aggregate" must be one of ${budgetAggregates.join(', ')}`);
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
    // Values per test or step, all executions of the same test or step share the key
    const groups = new Map<string, {name: string; values: number[]}>();

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

      const key = `${sample.testName ?? ''}|${sample.name}`;
      const group = groups.get(key) ?? {name: sample.name, values: []};
      group.values.push(actual);
      groups.set(key, group);
    }

    for (const {name, values} of groups.values()) {
      const aggregate = rule.aggregate ?? 'each';
      const checked = aggregate === 'each'
        ? values.map(actual => ({actual}))
        : [{actual: aggregateValues(values, aggregate), aggregate, executions: values.length}];

      for (const value of checked) {
        if (rule.max !== undefined && value.actual > rule.max) {
          violations.push({
            metric: rule.metric, name, limit: rule.max, direction: 'max', unit, ...value,
          });
        }

        if (rule.min !== undefined && value.actual < rule.min) {
          violations.push({
            metric: rule.metric, name, limit: rule.min, direction: 'min', unit, ...value,
          });
        }
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

  const aggregate = violation.aggregate ? ` ${violation.aggregate} of ${violation.executions ?? 0} execution(s)` : '';
  return `Budget violation: metric "${violation.metric}"${aggregate} = ${violation.actual} ${operator} ${violation.limit}${unit} (test: "${violation.name}")`;
}
