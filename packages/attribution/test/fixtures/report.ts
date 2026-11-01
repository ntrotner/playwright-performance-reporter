import fs from 'node:fs';
import path from 'node:path';
import type {
  AttributionBundle,
  BundleRegression,
} from '../../src/types.js';
import {
  change,
  temporaryDirectory,
} from '../helpers.js';
import {
  writeTrace,
} from './trace.js';

export const appFile = 'example/seeded-regressions/app/server.mjs';
export const appUrl = 'http://localhost:4321/app/server.mjs';

/**
 * Report directory of a run with one regressed step `Render rows`, whose trace spends 30 ms on the changed line 55
 * and 50 ms in an unchanged vendor file, and one regressed step without artifacts
 *
 * @param overrides fields of the bundle to replace
 */
export function createReportDir(overrides: Partial<AttributionBundle> = {}): {dir: string; bundlePath: string; bundle: AttributionBundle} {
  const dir = temporaryDirectory('attribution-report-');
  const traceFile = path.join(dir, 'traces', 'trace-1.json.gz');
  writeTrace(traceFile, [
    {
      functionName: 'heavyRender', url: appUrl, lineNumber: 46, samples: [[55, 30], [52, 5]],
    },
    {
      functionName: 'vendor', url: 'http://localhost:4321/vendor/lib.js', lineNumber: 0, samples: [[3, 50]],
    },
  ]);
  const regression = (entityKey: string, name: string, withTrace: boolean): BundleRegression => ({
    entityKey,
    kind: 'step',
    name,
    testName: 'heavy render',
    stepName: name,
    status: 'regressed',
    duration: {status: 'increased', current: 900, baselineMedian: 300},
    changes: [change('TaskDuration')],
    // The recorded path doesn't exist, so the absolute path is used
    ...(withTrace ? {traceFile: {file: 'traces/moved.json.gz', absoluteFile: traceFile}} : {artifactReason: 'no-artifact' as const}),
  });
  const bundle: AttributionBundle = {
    schemaVersion: 1,
    generatedAt: '2026-11-01T00:00:00.000Z',
    status: 'ok',
    message: '2 regression(s) and 1 changed file(s) between 1111111 and 2222222.',
    run: {
      commit: '2222222aaaa', branch: 'seeded-regressions', baselineCommit: '1111111bbbb', startedAt: '2026-11-01T00:00:00.000Z',
    },
    comparison: {status: 'ok', message: 'Compared 3 step(s)'},
    regressions: [regression('case1|Render rows|0', 'Render rows', true), regression('case2|Idle|0', 'Idle', false)],
    changedFiles: [{file: appFile, addedRanges: [{start: 54, end: 56}]}],
    ...overrides,
  };
  const bundlePath = path.join(dir, 'attribution-bundle.json');
  fs.writeFileSync(bundlePath, JSON.stringify(bundle, null, 2));
  return {dir, bundlePath, bundle};
}
