import fs from 'node:fs';
import path from 'node:path';
import {
  type ArtifactPath,
  type AttributionBundle,
  type AttributionCaps,
  defaultCaps,
} from '../types.js';

/**
 * Bundle within the caps of the attribution step
 */
export type CappedBundle = AttributionBundle & {
  caps: AttributionCaps;

  /**
   * Regressions and changed files left out by the caps
   */
  omitted: {regressions: number; changedFiles: number};
};

/**
 * Read and verify a bundle of the attribution presenter
 *
 * @param file `performance-attribution.json`
 */
export async function readBundle(file: string): Promise<AttributionBundle> {
  const bundle = JSON.parse(await fs.promises.readFile(file, 'utf8')) as Partial<AttributionBundle>;
  if (bundle?.schemaVersion !== 1 || !Array.isArray(bundle.regressions) || !Array.isArray(bundle.hunks)) {
    throw new Error(`${file} is not an attribution bundle with schemaVersion 1`);
  }

  return bundle as AttributionBundle;
}

/**
 * Limit the regressions and the changed files of a bundle. Caps of the CLI win over the caps in the bundle.
 *
 * @param bundle bundle of the run
 * @param caps caps of the CLI
 */
export function capBundle(bundle: AttributionBundle, caps: Partial<AttributionCaps> = {}): CappedBundle {
  const effective: AttributionCaps = {
    ...defaultCaps,
    ...bundle.caps,
    ...Object.fromEntries(Object.entries(caps).filter(([, value]) => value !== undefined)),
  };
  return {
    ...bundle,
    caps: effective,
    regressions: bundle.regressions.slice(0, effective.maxRegressions),
    hunks: bundle.hunks.slice(0, effective.maxChangedFiles),
    omitted: {
      regressions: Math.max(0, bundle.regressions.length - effective.maxRegressions),
      changedFiles: Math.max(0, bundle.hunks.length - effective.maxChangedFiles),
    },
  };
}

/**
 * Path of an artifact on this machine: the absolute path if it exists, otherwise the recorded path
 * resolved against the directory of the bundle
 *
 * @param artifact recorded artifact
 * @param bundleDir directory of the bundle
 * @returns the existing path, or undefined if the artifact is missing
 */
export function resolveArtifact(artifact: ArtifactPath, bundleDir: string): string | undefined {
  const candidates = [artifact.absoluteFile, path.resolve(bundleDir, artifact.file)];
  return candidates.find(candidate => candidate && fs.existsSync(candidate));
}
