import {type TestCase} from '@playwright/test/reporter';
import {type TestPerformance} from '../types/index.js';
import {sanitizeStringInput} from './index.js';

/**
 * Create generic `TestPerformance` object to fill during measurements
 *
 * @param name identifier for the performance metrics
 */
export function buildTestPerformance(name: string): TestPerformance {
  return {
    name,
    startMetrics: [],
    stopMetrics: [],
    samplingMetrics: [],
    startMeasurement: Date.now(),
    endMeasurement: Date.now(),
  };
}

/**
 * Get id and name from test hierarchy
 *
 * @param testCase case from test suite
 */
export function buildTestCaseIdentifier(testCase: TestCase): {id: string; name: string} {
  const customName = testCase.titlePath().join(' > ');
  return {id: sanitizeStringInput(testCase.id), name: sanitizeStringInput(customName)};
}
