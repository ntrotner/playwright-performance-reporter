import {
  Buffer,
} from 'node:buffer';
import type {
  AttributionBundle,
  BundleRegression,
  ChangedFile,
} from '../types.js';

/**
 * Limits of the attribution step
 */
export type AttributionCaps = {
  maxRegressions: number;
  maxChangedFiles: number;

  /**
   * Upper bound of a request to the model, in bytes
   */
  maxPromptBytes: number;
};

export const defaultCaps: AttributionCaps = {
  maxRegressions: 25,
  maxChangedFiles: 200,
  maxPromptBytes: 200_000,
};

/**
 * Bundle within the caps, with the amount of entries the caps dropped
 */
export type CappedBundle = {
  bundle: AttributionBundle;
  truncated: {regressions: number; changedFiles: number};
};

/**
 * The bundle is missing or not a bundle of the attribution presenter
 */
export class BundleError extends Error {
  override name = 'BundleError';
}

/**
 * Files that can run in a page, preferred when the changed files are capped
 */
const scriptPattern = /\.(?:[cm]?js|jsx|tsx?|[cm]ts|vue|svelte|html?)$/i;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Parse and validate a bundle of the attribution presenter
 *
 * @param text content of the bundle file
 */
export function parseBundle(text: string): AttributionBundle {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new BundleError(`The bundle is no valid json: ${String(error)}`);
  }

  const fail = (reason: string): never => {
    throw new BundleError(`The bundle is malformed: ${reason}`);
  };

  if (!isObject(json)) {
    return fail('it is not an object');
  }

  if (json.schemaVersion !== 1) {
    fail(`unknown schemaVersion ${String(json.schemaVersion)}`);
  }

  if (typeof json.status !== 'string' || !isObject(json.run)) {
    fail('status or run is missing');
  }

  if (!Array.isArray(json.regressions) || !Array.isArray(json.changedFiles)) {
    fail('regressions or changedFiles is not a list');
  }

  for (const regression of json.regressions as unknown[]) {
    if (!isObject(regression) || typeof regression.entityKey !== 'string' || typeof regression.name !== 'string' || typeof regression.status !== 'string' || !Array.isArray(regression.changes)) {
      return fail('a regression has no entityKey, name, status or changes');
    }

    if (!(regression.changes as unknown[]).every(change => isObject(change) && typeof change.metric === 'string')) {
      fail(`a change of ${regression.entityKey} has no metric`);
    }
  }

  for (const file of json.changedFiles as unknown[]) {
    const ranges = isObject(file) && typeof file.file === 'string' && Array.isArray(file.addedRanges) ? file.addedRanges as unknown[] : undefined;
    const valid = ranges?.every(range => isObject(range) && Number.isInteger(range.start) && Number.isInteger(range.end) && (range.start as number) >= 1 && (range.start as number) <= (range.end as number));
    if (!valid) {
      fail('a changed file has no file or valid addedRanges');
    }
  }

  return json as AttributionBundle;
}

/**
 * Cap the regressions and the changed files, deterministically. Kept first: regressions with an artifact, the largest
 * relative change of their most severe metric first; changed files that can run in a page, in order of the diff.
 *
 * @param bundle parsed bundle
 * @param caps limits
 */
export function capBundle(bundle: AttributionBundle, caps: AttributionCaps): CappedBundle {
  const largestChange = (regression: BundleRegression) => Math.abs(regression.changes[0]?.relativeChange ?? 0);
  const regressions = bundle.regressions
    .map((regression, index) => ({regression, index}))
    .sort((a, b) => Number(a.regression.artifactReason === 'no-artifact') - Number(b.regression.artifactReason === 'no-artifact')
      || largestChange(b.regression) - largestChange(a.regression)
      || a.index - b.index)
    .map(entry => entry.regression);
  const changedFiles = bundle.changedFiles
    .map((file, index) => ({file, index}))
    .sort((a, b) => Number(!scriptPattern.test(a.file.file)) - Number(!scriptPattern.test(b.file.file)) || a.index - b.index)
    .map(entry => entry.file);
  const keptRegressions = regressions.slice(0, Math.max(0, caps.maxRegressions));
  const keptFiles: ChangedFile[] = changedFiles.slice(0, Math.max(0, caps.maxChangedFiles));
  return {
    bundle: {...bundle, regressions: keptRegressions, changedFiles: keptFiles},
    truncated: {regressions: regressions.length - keptRegressions.length, changedFiles: changedFiles.length - keptFiles.length},
  };
}

/**
 * Size of a value as json in a request, in bytes
 *
 * @param value value of a prompt or tool result
 */
export function promptBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value) ?? '');
}

/**
 * Drop the least important entries of a list until the value built from it fits into a byte budget
 *
 * @param entries entries of the list
 * @param build value of the kept entries
 * @param maxBytes byte budget
 * @param compare order of importance, most important first
 */
export function fitWithinBytes<T, R>(entries: T[], build: (kept: T[]) => R, maxBytes: number, compare: (a: T, b: T) => number): {value: R; dropped: number} {
  const sorted = [...entries].sort(compare);
  let kept = sorted.length;
  let value = build(sorted);
  while (kept > 0 && promptBytes(value) > maxBytes) {
    kept--;
    value = build(sorted.slice(0, kept));
  }

  return {value, dropped: sorted.length - kept};
}
