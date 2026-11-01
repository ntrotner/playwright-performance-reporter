import type {
  AttributionResult,
  RegressionResult,
} from './result.js';

/**
 * Text that is safe in a markdown table cell
 *
 * @param text text of the cell
 */
function cell(text: string): string {
  return text.replaceAll('\\', '\\\\').replaceAll('|', String.raw`\|`).replaceAll(/\r?\n/g, ' ');
}

/**
 * Name of a test or step without the leading separator of the reporter, e.g. `chromium > app.spec.ts > test > step`
 *
 * @param name name of the test or step
 */
function displayName(name: string): string {
  return name.replace(/^\s*>\s*/, '');
}

/**
 * Text cut to the length of a table cell
 *
 * @param text text
 * @param maxLength maximum characters
 */
function shorten(text: string, maxLength = 240): string {
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

/**
 * Short commit
 *
 * @param commit full commit
 */
function short(commit: string | undefined): string {
  return commit ? `\`${commit.slice(0, 7)}\`` : 'unknown';
}

/**
 * Increased metrics of a regression, e.g. `TaskDuration +120%`
 *
 * @param regression regression of the result
 */
function describeChanges(regression: RegressionResult): string {
  return regression.changes.slice(0, 3).map(change => {
    const relative = change.relativeChange === undefined || !Number.isFinite(change.relativeChange) ? '' : ` +${Math.round(change.relativeChange * 100)}%`;
    return `${change.metric}${relative}`;
  }).join(', ') || '–';
}

/**
 * Row of a regression in the verdict table
 *
 * @param regression regression of the result
 */
function row(regression: RegressionResult): string {
  const [culprit] = regression.culprits;
  const [candidate] = regression.candidates;
  let culpritCell = '–';
  let confidence = '–';
  let evidence = regression.problems[0] ?? '';
  if (culprit) {
    culpritCell = `\`${culprit.file}:${culprit.line}\` (${culprit.symbol})`;
    confidence = culprit.confidence;
    evidence = culprit.evidence;
  } else if (regression.verdict === 'no-agent' && candidate) {
    culpritCell = `unverified: \`${candidate.file}:${candidate.line}\``;
    evidence = candidate.evidence;
  } else if (regression.verdict === 'no-culprit') {
    evidence ||= 'Nothing on the changed lines explains it';
  }

  return `| ${cell(displayName(regression.name))} | ${cell(describeChanges(regression))} | ${cell(regression.verdict)} | ${cell(culpritCell)} | ${cell(confidence)} | ${cell(shorten(evidence))} |`;
}

/**
 * Comment-ready markdown of an attribution: its status, a verdict per regression, and the reasons it couldn't attribute
 *
 * @param result attribution result
 */
export function renderMarkdown(result: AttributionResult): string {
  const lines = [
    '## Performance attribution',
    '',
    `**Status:** \`${result.status}\` · commit ${short(result.run.commit)}${result.run.branch ? ` (${cell(result.run.branch)})` : ''} against baseline ${short(result.run.baselineCommit)}`,
    '',
    `> ${result.message.replaceAll(/\r?\n/g, ' ')}`,
    '',
  ];

  if (result.regressions.length > 0) {
    lines.push(
      '| Test / step | Increased metrics | Verdict | Culprit | Confidence | Evidence |',
      '| --- | --- | --- | --- | --- | --- |',
      ...result.regressions.map(regression => row(regression)),
      '',
    );
  }

  const dropped = result.regressions.flatMap(regression => regression.dropped.map(culprit => `- ${cell(displayName(regression.name))}: \`${culprit.file}:${culprit.line}\` dropped, ${culprit.reason}`));
  if (dropped.length > 0) {
    lines.push('<details><summary>Dropped culprits of the agent</summary>', '', ...dropped, '', '</details>', '');
  }

  if (result.truncated.regressions > 0 || result.truncated.changedFiles > 0) {
    lines.push(`Capped: ${result.truncated.regressions} regression(s) and ${result.truncated.changedFiles} changed file(s) were left out.`, '');
  }

  lines.push('<sub>Culprits always lie inside a changed hunk and are backed by the trace or the heap snapshot. The confidence is computed from that evidence, not by the model.</sub>', '');
  return lines.join('\n');
}
