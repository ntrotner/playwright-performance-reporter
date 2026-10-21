import {
  type TestStep,
} from '@playwright/test/reporter';
import {
  type StepSelection,
} from '../types/index.js';
// Imported from its module, as the types index loads the observers, which depend on the helpers
import {
  stepCategories,
} from '../types/constants.js';
import {
  globToRegExp,
} from './budget.js';

/**
 * Create a filter of the steps to measure, by default every `test.step()`
 *
 * @param selection steps to measure
 * @returns whether a step is measured
 */
export function createStepFilter(selection: StepSelection = {}): (step: TestStep) => boolean {
  const categories = new Set<string>(selection.categories ?? ['test.step']);
  for (const category of categories) {
    if (!(stepCategories as readonly string[]).includes(category)) {
      throw new Error(`Invalid steps: unknown category "${category}", use one of ${stepCategories.join(', ')}`);
    }
  }

  const titlePattern = globToRegExp(selection.titlePattern ?? '*');
  const isSelected = (step: TestStep) => categories.has(step.category) && titlePattern.test(step.title);

  return step => {
    if (!isSelected(step)) {
      return false;
    }

    // Every `test.step()` is measured, also nested ones, as without a selection
    if (selection.nested === true || step.category === 'test.step') {
      return true;
    }

    // Measured within the selected step that contains it
    let {parent} = step;
    while (parent) {
      if (isSelected(parent)) {
        return false;
      }

      ({parent} = parent);
    }

    return true;
  };
}
