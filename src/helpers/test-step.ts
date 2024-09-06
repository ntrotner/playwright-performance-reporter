import {type TestStep} from '@playwright/test/reporter';
import {md5} from './hash.js';
import {sanitizeStringInput} from './index.js';

/**
 * Get id and name from test hierarchy
 *
 * @param testStep step from test suite
 */
export function buildTestStepIdentifier(testStep: TestStep): {id: string; name: string} {
  const customName = testStep.titlePath().join(' > ');
  const customId = md5(customName + String(testStep.startTime));

  return {id: sanitizeStringInput(customId), name: sanitizeStringInput(customName)};
}
