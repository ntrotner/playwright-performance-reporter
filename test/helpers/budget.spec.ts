import {
  evaluateBudgets,
  formatBudgetViolation,
  globToRegExp,
  Logger,
  validateBudgetRules,
} from '../../src/helpers/index.js';
import {
  type BudgetRule,
  type BudgetSample,
} from '../../src/types/index.js';

describe('Budget helpers', () => {
  let warningSpy: jest.SpyInstance;

  beforeEach(() => {
    warningSpy = jest.spyOn(Logger, 'warning').mockImplementation(() => {});
  });

  afterEach(() => {
    warningSpy.mockRestore();
  });

  describe('globToRegExp', () => {
    it('should match anything with *', () => {
      expect(globToRegExp('*').test('')).toBe(true);
      expect(globToRegExp('*').test(' > chromium > profile.spec.ts > Profile')).toBe(true);
    });

    it('should match substrings of the title path', () => {
      expect(globToRegExp('*Profile*').test(' > chromium > profile.spec.ts > Profile')).toBe(true);
      expect(globToRegExp('*Profile*').test(' > chromium > checkout.spec.ts > Checkout')).toBe(false);
    });

    it('should match a single character with ?', () => {
      expect(globToRegExp('a?c').test('abc')).toBe(true);
      expect(globToRegExp('a?c').test('ac')).toBe(false);
    });

    it('should match literally without wildcards', () => {
      expect(globToRegExp('Profile').test('Profile')).toBe(true);
      expect(globToRegExp('Profile').test('My Profile')).toBe(false);
    });

    it('should escape regex specials', () => {
      expect(globToRegExp('a.b (c) [d] +$').test('a.b (c) [d] +$')).toBe(true);
      expect(globToRegExp('a.b').test('axb')).toBe(false);
    });
  });

  describe('validateBudgetRules', () => {
    it('should accept valid rules', () => {
      expect(() => {
        validateBudgetRules([{metric: 'a', max: 1}, {metric: 'b', min: 1}, {metric: 'c', min: 1, max: 1}]);
      }).not.toThrow();
    });

    it.each<[string, BudgetRule]>([
      ['missing bounds', {metric: 'a'}],
      ['max less than min', {metric: 'a', min: 2, max: 1}],
      ['empty metric', {metric: ' ', max: 1}],
      ['NaN bound', {metric: 'a', max: Number.NaN}],
      ['infinite bound', {metric: 'a', min: Number.POSITIVE_INFINITY}],
    ])('should throw on %s', (_, rule) => {
      expect(() => {
        validateBudgetRules([rule]);
      }).toThrow();
    });

    it('should throw if rules are not an array', () => {
      expect(() => {
        validateBudgetRules(undefined as unknown as BudgetRule[]);
      }).toThrow();
    });
  });

  describe('evaluateBudgets', () => {
    it('should report a violated max', () => {
      const violations = evaluateBudgets([{name: 'X', metric: {lcp: 3000}}], [{metric: 'lcp', max: 2500}]);

      expect(violations).toEqual([{
        metric: 'lcp', name: 'X', actual: 3000, limit: 2500, direction: 'max', unit: 'count',
      }]);
    });

    it('should report a violated min', () => {
      const violations = evaluateBudgets([{name: 'X', metric: {lcp: 50}}], [{metric: 'lcp', min: 100}]);

      expect(violations).toEqual([expect.objectContaining({actual: 50, limit: 100, direction: 'min'})]);
    });

    it('should evaluate a closed interval', () => {
      const rules: BudgetRule[] = [{metric: 'value', min: 100, max: 200}];

      expect(evaluateBudgets([{name: 'X', metric: {value: 50}}], rules)).toHaveLength(1);
      expect(evaluateBudgets([{name: 'X', metric: {value: 250}}], rules)).toHaveLength(1);
      expect(evaluateBudgets([{name: 'X', metric: {value: 150}}], rules)).toHaveLength(0);
    });

    it('should scope rules by namePattern', () => {
      const samples: BudgetSample[] = [
        {name: ' > chromium > Profile', metric: {value: 10}},
        {name: ' > chromium > Checkout', metric: {value: 10}},
      ];
      const violations = evaluateBudgets(samples, [{metric: 'value', max: 5, namePattern: '*Profile*'}]);

      expect(violations).toEqual([expect.objectContaining({name: ' > chromium > Profile'})]);
    });

    it('should report only the samples that violate', () => {
      const samples: BudgetSample[] = [
        {name: 'X', metric: {value: 1}},
        {name: 'Y', metric: {value: 10}},
        {name: 'Z', metric: {value: 2}},
      ];

      expect(evaluateBudgets(samples, [{metric: 'value', max: 5}])).toEqual([expect.objectContaining({name: 'Y', actual: 10})]);
    });

    it('should warn without violation if the metric was never measured', () => {
      const violations = evaluateBudgets([{name: 'X', metric: {other: 1}}], [{metric: 'value', max: 5}]);

      expect(violations).toHaveLength(0);
      expect(warningSpy).toHaveBeenCalledWith(expect.stringContaining('never measured'));
    });

    it('should skip non-numeric values', () => {
      const violations = evaluateBudgets([{name: 'X', metric: {nextHopProtocol: 'h2'}}], [{metric: 'nextHopProtocol', max: 5}]);

      expect(violations).toHaveLength(0);
      expect(warningSpy).toHaveBeenCalledWith(expect.stringContaining('non-numeric'), 'X');
    });

    it('should skip non-finite values', () => {
      const samples: BudgetSample[] = [
        {name: 'X', metric: {value: Number.NaN}},
        {name: 'Y', metric: {value: Number.POSITIVE_INFINITY}},
      ];

      expect(evaluateBudgets(samples, [{metric: 'value', max: 5}])).toHaveLength(0);
    });

    it('should annotate the unit of known metrics', () => {
      const violations = evaluateBudgets([{name: 'X', metric: {largestContentfulPaint: 3000}}], [{metric: 'largestContentfulPaint', max: 2500}]);

      expect(violations[0].unit).toEqual('ms');
    });
  });

  describe('formatBudgetViolation', () => {
    it('should describe max and min violations', () => {
      expect(formatBudgetViolation({
        metric: 'largestContentfulPaint', name: ' > Profile', actual: 3120.5, limit: 2500, direction: 'max', unit: 'ms',
      })).toEqual('Budget violation: metric "largestContentfulPaint" = 3120.5 > 2500 (ms) (test: " > Profile")');
      expect(formatBudgetViolation({
        metric: 'value', name: 'X', actual: 1, limit: 2, direction: 'min',
      })).toEqual('Budget violation: metric "value" = 1 < 2 (test: "X")');
    });
  });

  describe('aggregate', () => {
    const samples: BudgetSample[] = [
      {name: 'Open', testName: 'Profile', metric: {lcp: 2000}},
      {name: 'Open', testName: 'Profile', metric: {lcp: 2100}},
      {name: 'Open', testName: 'Profile', metric: {lcp: 9000}},
      // Same step title in another test
      {name: 'Open', testName: 'Settings', metric: {lcp: 3000}},
    ];

    it('should check every execution by default', () => {
      expect(evaluateBudgets(samples, [{metric: 'lcp', max: 2500}]).map(violation => violation.actual)).toEqual([9000, 3000]);
    });

    it('should check the aggregate of the executions of each test and step', () => {
      expect(evaluateBudgets(samples, [{metric: 'lcp', max: 2500, aggregate: 'median'}])).toEqual([{
        metric: 'lcp', name: 'Open', actual: 3000, limit: 2500, direction: 'max', unit: 'count', aggregate: 'median', executions: 1,
      }]);
      expect(evaluateBudgets(samples, [{metric: 'lcp', min: 2050, aggregate: 'min'}]).map(violation => [violation.actual, violation.executions])).toEqual([[2000, 3]]);
      expect(evaluateBudgets(samples, [{metric: 'lcp', max: 8000, aggregate: 'max'}]).map(violation => violation.actual)).toEqual([9000]);
      expect(evaluateBudgets(samples, [{metric: 'lcp', max: 4000, aggregate: 'mean'}]).map(violation => violation.actual)).toEqual([4366.666_666_666_667]);
      expect(evaluateBudgets(samples, [{metric: 'lcp', max: 8000, aggregate: 'p95'}]).map(violation => violation.actual)).toEqual([8310]);
      expect(evaluateBudgets(samples, [{metric: 'lcp', max: 5000, aggregate: 'p75'}]).map(violation => violation.actual)).toEqual([5550]);
    });

    it('should throw on an unknown aggregate', () => {
      expect(() => validateBudgetRules([{metric: 'lcp', max: 1, aggregate: 'p99' as 'p95'}])).toThrow('"aggregate" must be one of');
    });

    it('should describe an aggregated violation', () => {
      expect(formatBudgetViolation({
        metric: 'lcp', name: 'Open', actual: 3000, limit: 2500, direction: 'max', aggregate: 'median', executions: 3,
      })).toEqual('Budget violation: metric "lcp" median of 3 execution(s) = 3000 > 2500 (test: "Open")');
    });
  });
});
