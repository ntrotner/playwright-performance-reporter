import type {
  BundleRegression,
  ChangedFile,
  ComparisonReport,
  LineRange,
} from '../types.js';
import {
  type AttributionBasis,
  basisOfMetric,
  type Confidence,
  computeConfidence,
} from './confidence.js';
import type {
  HeapGrowth,
} from './heap.js';
import {
  findChangedFile,
  findHunk,
} from './hunks.js';
import type {
  TraceSelfTime,
} from './trace.js';

/**
 * Line inside a changed hunk that the evidence of a regression points at
 */
export type Candidate = {
  /**
   * Changed file, relative to the root of the repository
   */
  file: string;

  /**
   * 1-based line inside `hunk`
   */
  line: number;
  hunk: LineRange;
  basis: AttributionBasis;

  /**
   * Function with the self time, or the grown class
   */
  symbol: string;

  /**
   * Increased metric of the regression the basis explains, the most severe one
   */
  metric?: string;

  /**
   * Share of the evidence: of the trace's self time for cpu, of the sampled objects for heap
   */
  share: number;

  /**
   * The evidence in words
   */
  evidence: string;
  confidence: Confidence;
};

/**
 * Finding outside of the changed hunks, which is never a culprit
 */
export type OutsideEvidence = {
  basis: AttributionBasis;
  symbol: string;
  url: string;
  line: number;
  share: number;
};

/**
 * Analysis results of the artifacts of a regression
 */
export type RegressionEvidence = {
  trace?: TraceSelfTime;
  heap?: HeapGrowth;
};

/**
 * Percentage with one decimal
 *
 * @param share share between 0 and 1
 */
function percent(share: number): string {
  return `${Math.round(share * 1000) / 10}%`;
}

/**
 * Candidates of a regression on the changed hunks, best first. CPU: a line whose own self time samples lie inside a
 * hunk. Heap: the deepest closure on the retainer path of a grown class that lies inside a hunk. Everything else is
 * outside evidence, never a candidate.
 *
 * @param regression regression of the bundle
 * @param evidence analysis results of its artifacts
 * @param changedFiles changed files of the bundle
 * @param comparisonStatus status of the comparison the regression comes from
 */
export function attributeToHunks(regression: BundleRegression, evidence: RegressionEvidence, changedFiles: ChangedFile[], comparisonStatus?: ComparisonReport['status']): {candidates: Candidate[]; outside: OutsideEvidence[]} {
  const explained = (basis: AttributionBasis) => regression.changes.findIndex(change => basisOfMetric(change.metric) === basis);
  const metricOf = (basis: AttributionBasis) => regression.changes[explained(basis)]?.metric;
  const candidates = new Map<string, Candidate>();
  const outside: OutsideEvidence[] = [];
  const add = (candidate: Omit<Candidate, 'confidence' | 'metric'>) => {
    const metric = metricOf(candidate.basis);
    const key = `${candidate.basis}|${candidate.file}|${candidate.line}`;
    const existing = candidates.get(key);
    // Self time on the same line adds up; the share of sampled objects is a fraction of each class, so the strongest class counts
    const share = candidate.basis === 'cpu' ? (existing?.share ?? 0) + candidate.share : Math.max(existing?.share ?? 0, candidate.share);
    candidates.set(key, {
      ...candidate,
      ...(existing ? {evidence: `${existing.evidence}; ${candidate.evidence}`} : {}),
      share,
      ...(metric ? {metric} : {}),
      confidence: computeConfidence({
        inHunk: true, basis: candidate.basis, share, metric, regressionStatus: regression.status, comparisonStatus,
      }),
    });
  };

  const {trace} = evidence;
  for (const fn of trace?.functions ?? []) {
    const file = findChangedFile(changedFiles, fn.url);
    for (const {line, selfTime} of fn.lines) {
      const share = trace!.totalSelfTime > 0 ? selfTime / trace!.totalSelfTime : 0;
      const hunk = file ? findHunk(file, line) : undefined;
      if (file && hunk) {
        add({
          file: file.file, line, hunk, basis: 'cpu', symbol: fn.functionName || '(anonymous)', share, evidence: `${fn.functionName || '(anonymous)'} spent ${selfTime} ms self time on line ${line} (${percent(share)} of ${trace!.totalSelfTime} ms)`,
        });
      } else {
        outside.push({
          basis: 'cpu', symbol: fn.functionName || '(anonymous)', url: fn.url, line, share,
        });
      }
    }
  }

  for (const growth of evidence.heap?.classes ?? []) {
    // Frames are sorted deepest first, so the first one inside a hunk is the deepest
    const inside = growth.frames
      .map(frame => ({frame, file: findChangedFile(changedFiles, frame.url)}))
      .map(entry => ({...entry, hunk: entry.file ? findHunk(entry.file, entry.frame.line) : undefined}))
      .find(entry => entry.hunk);
    if (inside?.file && inside.hunk && growth.sampled > 0) {
      const share = inside.frame.hits / growth.sampled;
      add({
        file: inside.file.file,
        line: inside.frame.line,
        hunk: inside.hunk,
        basis: 'heap',
        symbol: growth.name,
        share,
        evidence: `${inside.frame.functionName || '(anonymous)'} retains ${growth.count} added ${growth.name} (${growth.selfSize} bytes): on the retainer path of ${inside.frame.hits} of ${growth.sampled} sampled objects, ${inside.frame.distance} edge(s) away`,
      });
    } else {
      for (const frame of growth.frames.slice(0, 3)) {
        outside.push({
          basis: 'heap', symbol: growth.name, url: frame.url, line: frame.line, share: growth.sampled > 0 ? frame.hits / growth.sampled : 0,
        });
      }
    }
  }

  // Rank of the increased metric a candidate explains, unexplained last
  const rank = (candidate: Candidate) => candidate.metric === undefined ? Number.MAX_SAFE_INTEGER : explained(candidate.basis);
  return {
    candidates: [...candidates.values()].sort((a, b) => rank(a) - rank(b)
      || Number(b.confidence === 'high') - Number(a.confidence === 'high')
      || b.share - a.share
      || a.file.localeCompare(b.file)
      || a.line - b.line),
    outside: outside.sort((a, b) => b.share - a.share || a.url.localeCompare(b.url) || a.line - b.line).slice(0, 8),
  };
}
