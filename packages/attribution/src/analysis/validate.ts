import type {
  ChangedFile,
} from '../types.js';
import type {
  Candidate,
} from './attribute.js';
import type {
  AttributionBasis,
} from './confidence.js';
import {
  findChangedFile,
  findHunk,
} from './hunks.js';

/**
 * Culprit as an agent submits it. Any confidence it adds is ignored.
 */
export type SubmittedCulprit = {
  file: string;
  line: number;
  basis?: AttributionBasis;
};

/**
 * Submitted culprit that was dropped, and why
 */
export type DroppedCulprit = SubmittedCulprit & {reason: string};

/**
 * Keep the submitted culprits that lie inside a changed hunk and are backed by evidence in that hunk. A kept culprit is
 * the evidence candidate on that line, or the strongest one in the same hunk, with its recomputed confidence.
 *
 * @param submitted culprits of the agent
 * @param candidates evidence candidates of the regression, best first
 * @param changedFiles changed files of the bundle
 */
export function validateCulprits(submitted: SubmittedCulprit[], candidates: Candidate[], changedFiles: ChangedFile[]): {culprits: Candidate[]; dropped: DroppedCulprit[]} {
  const culprits: Candidate[] = [];
  const dropped: DroppedCulprit[] = [];
  for (const culprit of submitted) {
    const file = changedFiles.find(changed => changed.file === culprit.file) ?? findChangedFile(changedFiles, culprit.file);
    const hunk = file && Number.isInteger(culprit.line) ? findHunk(file, culprit.line) : undefined;
    if (!file || !hunk) {
      dropped.push({...culprit, reason: 'not inside a changed hunk'});
      continue;
    }

    const inHunk = candidates.filter(candidate => candidate.file === file.file && candidate.hunk.start === hunk.start && (culprit.basis === undefined || candidate.basis === culprit.basis));
    const match = inHunk.find(candidate => candidate.line === culprit.line) ?? inHunk[0];
    if (!match) {
      dropped.push({...culprit, reason: 'no trace or heap evidence in this hunk'});
    } else if (!culprits.includes(match)) {
      culprits.push(match);
    }
  }

  return {culprits, dropped};
}
