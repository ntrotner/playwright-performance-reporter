import fs from 'node:fs';
import path from 'node:path';
import type {
  ArtifactRef,
  AttributionBundle,
  BundleRegression,
} from '../types.js';
import {
  attributeToHunks,
  type Candidate,
  type OutsideEvidence,
} from './attribute.js';
import {
  type HeapGrowth,
  heapGrowth,
  parseTopClasses,
} from './heap.js';
import {
  type TraceSelfTime,
  traceSelfTime,
} from './trace.js';

/**
 * Result of an analysis, or why it has none
 */
export type Analysis<T> = {result?: T; problem?: string};

/**
 * Candidates of a regression on the changed hunks, with the evidence outside of them and what couldn't be analyzed
 */
export type RegressionAttribution = {
  candidates: Candidate[];
  outside: OutsideEvidence[];
  problems: string[];
};

/**
 * Analyses of the artifacts of a bundle, each run at most once
 */
export type Analyzer = {
  regression(entityKey: string): BundleRegression | undefined;
  trace(entityKey: string): Promise<Analysis<TraceSelfTime>>;
  heap(entityKey: string): Promise<Analysis<HeapGrowth>>;
  attribute(entityKey: string): Promise<RegressionAttribution>;
};

/**
 * Path of an artifact: the absolute path if it exists, else the recorded path resolved against the bundle directory
 *
 * @param artifact artifact of the bundle
 * @param bundleDir directory of the bundle
 */
export function resolveArtifact(artifact: ArtifactRef, bundleDir: string): string | undefined {
  return [artifact.absoluteFile, path.resolve(bundleDir, artifact.file)].find(file => file && fs.existsSync(file));
}

/**
 * Short message of an error, without a stack
 *
 * @param error error
 */
function describeError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).split('\n')[0].slice(0, 300);
}

/**
 * Analyzer of the artifacts of a bundle. Traces and heap snapshots are only read on demand, and only their index
 * (functions, classes, paths and lines) is kept.
 *
 * @param bundle capped bundle
 * @param bundleDir directory of the bundle
 */
export function createAnalyzer(bundle: AttributionBundle, bundleDir: string): Analyzer {
  const regressions = new Map(bundle.regressions.map(regression => [regression.entityKey, regression]));
  const cache = new Map<string, Promise<unknown>>();
  const once = async <T>(key: string, run: () => Promise<T>): Promise<T> => {
    if (!cache.has(key)) {
      cache.set(key, run());
    }

    return cache.get(key) as Promise<T>;
  };

  const analyze = async <T>(entityKey: string, artifact: 'traceFile' | 'heapDiffFile', run: (file: string, regression: BundleRegression) => Promise<T>): Promise<Analysis<T>> => once(`${artifact}|${entityKey}`, async () => {
    const regression = regressions.get(entityKey);
    if (!regression) {
      return {problem: `Unknown entityKey ${entityKey}`};
    }

    const ref = regression[artifact];
    if (!ref) {
      return {problem: `${regression.name} has no ${artifact === 'traceFile' ? 'trace' : 'heap snapshot'}`};
    }

    const file = resolveArtifact(ref, bundleDir);
    if (!file) {
      return {problem: `${ref.file} does not exist`};
    }

    try {
      return {result: await run(file, regression)};
    } catch (error) {
      return {problem: `${ref.file} could not be analyzed: ${describeError(error)}`};
    }
  });

  const analyzer: Analyzer = {
    regression: entityKey => regressions.get(entityKey),
    trace: async entityKey => analyze(entityKey, 'traceFile', async file => traceSelfTime(file)),
    heap: async entityKey => analyze(entityKey, 'heapDiffFile', async (file, regression) => heapGrowth(file, parseTopClasses(regression.heapDiffTopClasses))),
    attribute: async entityKey => once(`attribute|${entityKey}`, async () => {
      const regression = regressions.get(entityKey);
      if (!regression) {
        return {candidates: [], outside: [], problems: [`Unknown entityKey ${entityKey}`]};
      }

      const [trace, heap] = await Promise.all([
        regression.traceFile ? analyzer.trace(entityKey) : undefined,
        regression.heapDiffFile ? analyzer.heap(entityKey) : undefined,
      ]);
      const problems = [trace?.problem, heap?.problem].filter((problem): problem is string => problem !== undefined);
      if (regression.artifactReason) {
        problems.push(`${regression.name}: ${regression.artifactReason}`);
      }

      return {
        ...attributeToHunks(regression, {trace: trace?.result, heap: heap?.result}, bundle.changedFiles, bundle.comparison?.status),
        problems,
      };
    }),
  };
  return analyzer;
}
