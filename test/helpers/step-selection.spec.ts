import {
  type TestStep,
} from '@playwright/test/reporter';
import {
  createStepFilter,
} from '../../src/helpers/index.js';
import {
  type StepSelection,
} from '../../src/types/index.js';

const step = (category: string, title: string, parent?: TestStep) => ({category, title, parent}) as unknown as TestStep;

describe('Step selection', () => {
  const outer = step('test.step', 'Open profile');
  const navigation = step('pw:api', 'Navigate to "/profile"', outer);
  const click = step('pw:api', 'Click getByRole(\'link\')', outer);
  const topLevelNavigation = step('pw:api', 'Navigate to "/"');
  const assertion = step('expect', 'Expect "toHaveURL"', outer);

  it('should measure every test.step() by default', () => {
    const isMeasured = createStepFilter();

    expect([outer, navigation, click, assertion].map(isMeasured)).toEqual([true, false, false, false]);
    expect(isMeasured(step('test.step', 'inner', outer))).toBe(true);
  });

  it('should measure the selected categories and titles', () => {
    const isMeasured = createStepFilter({categories: ['pw:api'], titlePattern: 'Navigate to *'});

    expect([outer, navigation, click, topLevelNavigation, assertion].map(isMeasured)).toEqual([false, true, false, true, false]);
  });

  it('should skip selected steps within selected steps unless nested', () => {
    const selection: StepSelection = {categories: ['test.step', 'pw:api']};

    expect([outer, navigation, click].map(createStepFilter(selection))).toEqual([true, false, false]);
    expect(createStepFilter(selection)(step('test.step', 'inner', outer))).toBe(true);
    expect([outer, navigation, click].map(createStepFilter({...selection, nested: true}))).toEqual([true, true, true]);
  });

  it('should throw on unknown categories', () => {
    expect(() => createStepFilter({categories: ['test.attach' as 'hook']})).toThrow('Invalid steps: unknown category "test.attach"');
  });
});
