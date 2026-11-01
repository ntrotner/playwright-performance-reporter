import {
  type Analyzer,
  createAnalyzer,
} from '../analysis/analyzer.js';
import type {
  Candidate,
} from '../analysis/attribute.js';
import {
  defaultCaps,
} from '../analysis/bundle.js';
import {
  type DroppedCulprit,
  type SubmittedCulprit,
  validateCulprits,
} from '../analysis/validate.js';
import type {
  AttributionBundle,
} from '../types.js';

/**
 * Verdict of the agent for one regression, after validation
 */
export type Verdict = {
  /**
   * Culprits inside the changed hunks and backed by evidence, with the recomputed confidence
   */
  culprits: Candidate[];
  dropped: DroppedCulprit[];
};

/**
 * State the tools of the agent share: the analyses of the artifacts and the submitted verdicts
 */
export type AttributionContext = {
  bundle: AttributionBundle;
  analyzer: Analyzer;

  /**
   * Byte budget of a request; a tool result gets a quarter of it
   */
  maxPromptBytes: number;

  /**
   * Validated verdicts by entityKey, the latest submission wins
   */
  verdicts: Map<string, Verdict>;
  submit(entityKey: string, culprits: SubmittedCulprit[]): Promise<Verdict | {error: string}>;
};

/**
 * Context of the attribution tools
 *
 * @param options bundle, its directory and the byte budget
 * @param options.bundle capped bundle
 * @param options.bundleDir directory of the bundle, to resolve artifacts
 * @param options.maxPromptBytes byte budget of a request
 */
export function createAttributionContext(options: {bundle: AttributionBundle; bundleDir: string; maxPromptBytes?: number}): AttributionContext {
  const analyzer = createAnalyzer(options.bundle, options.bundleDir);
  const verdicts = new Map<string, Verdict>();
  return {
    bundle: options.bundle,
    analyzer,
    maxPromptBytes: options.maxPromptBytes ?? defaultCaps.maxPromptBytes,
    verdicts,
    async submit(entityKey, culprits) {
      if (!analyzer.regression(entityKey)) {
        return {error: `Unknown entityKey ${entityKey}`};
      }

      const {candidates} = await analyzer.attribute(entityKey);
      const verdict = validateCulprits(culprits, candidates, options.bundle.changedFiles);
      verdicts.set(entityKey, verdict);
      return verdict;
    },
  };
}
