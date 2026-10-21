import {test as base} from '@playwright/test';
import {perWorkerDebuggingPort} from '../../lib/fixture/index.js';

// Every worker launches its browser on its own debugging port: 9222, 9223, ...
export const test = base.extend(perWorkerDebuggingPort({base: 9222}));
export {expect} from '@playwright/test';
