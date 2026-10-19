export const testCaseParent = 'TEST_CASE_PARENT';

/**
 * Port the browser of the first worker listens on, unless configured otherwise
 */
export const defaultDebuggingPort = 9222;

/**
 * Name of the attachment that carries the measurements of a test in fixture mode
 */
export const fixtureAttachmentName = 'playwright-performance-reporter';

/**
 * Categories of Playwright steps that can be measured
 */
export const stepCategories = ['test.step', 'pw:api', 'expect', 'fixture', 'hook'] as const;
export type StepCategory = typeof stepCategories[number];
