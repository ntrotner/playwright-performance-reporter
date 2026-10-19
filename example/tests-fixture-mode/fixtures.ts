import {test as base} from '@playwright/test';
import {withPerformance} from '../../lib/fixture/index.js';
import {performanceOptions} from '../performance-options.fixture-mode';

// Measures every test inside its worker, no debugging port needed
export const test = withPerformance(base, performanceOptions);
export {expect} from '@playwright/test';
