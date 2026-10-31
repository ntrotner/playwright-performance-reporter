import path from 'node:path';
import {
  type CappedBundle,
  resolveArtifact,
} from '../analysis/bundle.js';
import {
  type HeapGrowth,
  heapGrowth,
  parseTopClasses,
} from '../analysis/heap-growth.js';
import {
  attributeToHunks,
  type Culprit,
  type HunkAttribution,
} from '../analysis/hunk-match.js';
import {
  type TraceSelfTime,
  traceSelfTime,
} from '../analysis/trace-self-time.js';
import type {
  AttributionBasis,
  BundleRegression,
} from '../types.js';

/**
 * Verdict of a regression
 * - attributed: at least one culprit on the changed lines
 * - no-culprit: the agent found nothing on the changed lines that explains the regression, or nothing could be validated
 * - no-agent: no agent verdict: none configured, or it failed or stopped (API error, time, step or byte budget) before one
 */
export type Verdict = {
  entityKey: string;
  name: string;
  status: 'attributed' | 'no-culprit' | 'no-agent';

  /**
   * Validated culprits, strongest first. The top-1 culprit is the first.
   */
  culprits: Culprit[];

  /**
   * Confidence of the top-1 culprit, 0 without one
   */
  confidence: number;
  reason?: string;

  /**
   * Findings outside of the culprits, e.g. dropped culprits or unreadable artifacts
   */
  evidence: string[];
};

/**
 * Culprit as the agent submits it
 */
export type SubmittedCulprit = {
  file: string;
  line: number;
  endLine?: number;
  basis: AttributionBasis;
  symbol?: string;
  evidence?: string[];
};

/**
 * Result of an analysis of an artifact, or why there is none
 */
type Analyzed<T> = {result?: T; problem?: string};

/**
 * Evidence items kept per verdict and per agent claim
 */
const maxEvidenceItems = 8;
const maxEvidenceLength = 300;

/**
 * Shorten a text the agent or an analysis produced
 *
 * @param text evidence
 */
function clip(text: string): string {
  return text.length > maxEvidenceLength ? `${text.slice(0, maxEvidenceLength - 1)}…` : text;
}

/**
 * State of an attribution: the bundle, the analyses of its artifacts (each run at most once)
 * and the verdicts the agent submitted. The tools of the agent operate on it.
 */
export class AttributionContext {
  private readonly traces = new Map<string, Promise<Analyzed<TraceSelfTime>>>();
  private readonly heaps = new Map<string, Promise<Analyzed<HeapGrowth>>>();
  private readonly submissions = new Map<string, {culprits: Culprit[]; dropped: string[]}>();
  private readonly bundleDir: string;

  constructor(readonly bundle: CappedBundle, bundleFile: string) {
    this.bundleDir = path.dirname(path.resolve(bundleFile));
  }

  /**
   * Regression of an entity key
   *
   * @param entityKey key of the test or step
   */
  regression(entityKey: string): BundleRegression {
    const regression = this.bundle.regressions.find(candidate => candidate.entityKey === entityKey);
    if (!regression) {
      throw new Error(`Unknown entityKey ${entityKey}. Call read_bundle for the regressions.`);
    }

    return regression;
  }

  /**
   * Self time of the trace of a regression
   *
   * @param entityKey key of the test or step
   */
  async traceSelfTime(entityKey: string): Promise<Analyzed<TraceSelfTime>> {
    const regression = this.regression(entityKey);
    let analysis = this.traces.get(entityKey);
    if (!analysis) {
      analysis = this.analyze('trace', regression.artifacts.traceFile, async file => traceSelfTime(file));
      this.traces.set(entityKey, analysis);
    }

    return analysis;
  }

  /**
   * Class growth of the heap snapshot of a regression
   *
   * @param entityKey key of the test or step
   */
  async heapGrowth(entityKey: string): Promise<Analyzed<HeapGrowth>> {
    const regression = this.regression(entityKey);
    let analysis = this.heaps.get(entityKey);
    if (!analysis) {
      const topClasses = parseTopClasses(regression.heapDiffTopClasses);
      analysis = regression.artifacts.heapDiffFile && topClasses.length === 0
        ? Promise.resolve({problem: 'heap snapshot has no recorded class growth (heapDiffTopClasses)'})
        : this.analyze('heap snapshot', regression.artifacts.heapDiffFile, async file => heapGrowth(file, topClasses));
      this.heaps.set(entityKey, analysis);
    }

    return analysis;
  }

  /**
   * Candidates of a regression on the changed lines, from every artifact it has
   *
   * @param entityKey key of the test or step
   * @param cachedOnly use only the analyses that already ran, without starting one
   */
  async attribution(entityKey: string, cachedOnly = false): Promise<HunkAttribution & {problems: string[]}> {
    const regression = this.regression(entityKey);
    const notAnalyzed = (label: string): Analyzed<never> => ({problem: `the agent did not analyze the ${label}`});
    const trace = regression.artifacts.traceFile
      ? (cachedOnly && !this.traces.has(entityKey) ? notAnalyzed('trace') : await this.traceSelfTime(entityKey))
      : {};
    const heap = regression.artifacts.heapDiffFile
      ? (cachedOnly && !this.heaps.has(entityKey) ? notAnalyzed('heap snapshot') : await this.heapGrowth(entityKey))
      : {};
    const problems = [trace.problem, heap.problem].filter((problem): problem is string => problem !== undefined);
    if (regression.reason === 'no-artifact') {
      problems.push('no trace or heap snapshot was written for this test or step');
    }

    return {...attributeToHunks(regression, {trace: trace.result, heap: heap.result}, this.bundle.hunks, {sourceRoots: this.bundle.sourceRoots}), problems};
  }

  /**
   * Record the culprits the agent submitted for a regression. A culprit is kept only if it matches a candidate
   * on the changed lines with the same basis; its lines, metric and confidence come from that candidate.
   *
   * @param entityKey key of the test or step
   * @param submitted culprits of the agent, any confidence it claims is not part of them
   */
  async submit(entityKey: string, submitted: SubmittedCulprit[]): Promise<{accepted: string[]; dropped: string[]}> {
    const {culprits: candidates} = await this.attribution(entityKey);
    const accepted: Culprit[] = [];
    // Claims that overlap the same candidate, or repeat it, count once
    const acceptedKeys = new Set<string>();
    const dropped: string[] = [];
    for (const claim of submitted) {
      const endLine = Math.max(claim.line, claim.endLine ?? claim.line);
      const candidate = candidates.find(entry => entry.file === claim.file && entry.basis === claim.basis && entry.startLine <= endLine && entry.endLine >= claim.line);
      if (!candidate) {
        dropped.push(clip(`dropped ${claim.file}:${claim.line} (${claim.basis}): not backed by ${claim.basis === 'cpu' ? 'self time' : 'a retainer path'} on a changed line`));
        continue;
      }

      const key = `${candidate.basis}|${candidate.file}:${candidate.startLine}`;
      if (!acceptedKeys.has(key)) {
        acceptedKeys.add(key);
        accepted.push({...candidate, evidence: [...candidate.evidence, ...(claim.evidence ?? []).slice(0, 3).map(item => clip(`agent: ${item}`))]});
      }
    }

    // Ranked by the confidence computed from the evidence, then by the order of the agent
    const ranked = accepted.map((culprit, order) => ({culprit, order})).sort((a, b) => b.culprit.confidence - a.culprit.confidence || a.order - b.order).map(({culprit}) => culprit);
    this.submissions.set(entityKey, {culprits: ranked, dropped});
    return {accepted: ranked.map(culprit => `${culprit.file}:${culprit.startLine}`), dropped};
  }

  /**
   * Verdict of every regression from the submissions of the agent
   *
   * @param agentProblem why the agent failed or stopped before it finished, if it did
   */
  async verdicts(agentProblem?: string): Promise<Verdict[]> {
    const verdicts: Verdict[] = [];
    for (const regression of this.bundle.regressions) {
      const submission = this.submissions.get(regression.entityKey);
      if (!submission && agentProblem) {
        // The agent never got to it, which says nothing about the changed lines
        verdicts.push({
          entityKey: regression.entityKey, name: regression.name, status: 'no-agent', culprits: [], confidence: 0, reason: clip(`the agent stopped before a verdict: ${agentProblem}`), evidence: [],
        });
        continue;
      }

      // Nothing is analyzed once the agent finished: it ran within its budget, this would not
      const analyzed = regression.reason === 'no-artifact' || this.traces.has(regression.entityKey) || this.heaps.has(regression.entityKey);
      if (!submission && !analyzed) {
        verdicts.push({
          entityKey: regression.entityKey, name: regression.name, status: 'no-agent', culprits: [], confidence: 0, reason: 'the agent finished without analyzing it', evidence: [],
        });
        continue;
      }

      // eslint-disable-next-line no-await-in-loop
      const attribution = await this.attribution(regression.entityKey, true);
      const culprits = submission?.culprits ?? [];
      const evidence = [...attribution.problems, ...(submission?.dropped ?? []), ...(culprits.length === 0 ? attribution.evidence : [])].slice(0, maxEvidenceItems);
      verdicts.push({
        entityKey: regression.entityKey,
        name: regression.name,
        status: culprits.length > 0 ? 'attributed' : 'no-culprit',
        culprits,
        confidence: culprits[0]?.confidence ?? 0,
        ...(submission ? {} : {reason: 'the agent finished without a verdict for it'}),
        evidence,
      });
    }

    return verdicts;
  }

  /**
   * Analyze an artifact, turning a missing or unreadable file into a stated problem
   *
   * @param label name of the artifact
   * @param artifact recorded path
   * @param analyze analysis of the file
   */
  private async analyze<T>(label: string, artifact: CappedBundle['regressions'][number]['artifacts']['traceFile'], analyze: (file: string) => Promise<T>): Promise<Analyzed<T>> {
    if (!artifact) {
      return {problem: `no ${label} was written for this test or step`};
    }

    const file = resolveArtifact(artifact, this.bundleDir);
    if (!file) {
      return {problem: `${label} ${artifact.file} is missing`};
    }

    try {
      return {result: await analyze(file)};
    } catch (error) {
      return {problem: clip(`${label} ${artifact.file} is unreadable: ${error instanceof Error ? error.message : String(error)}`)};
    }
  }
}
