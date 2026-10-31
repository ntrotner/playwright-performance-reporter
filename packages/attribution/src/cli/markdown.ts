import type {
  Verdict,
} from '../agent/context.js';
import type {
  CappedBundle,
} from '../analysis/bundle.js';
import type {
  MetricChange,
} from '../types.js';

/**
 * Icon and label of a verdict
 */
const statuses: Record<Verdict['status'], string> = {
  attributed: '🎯 attributed',
  'no-culprit': '❔ no-culprit',
  'no-agent': '⚪ no-agent',
};

/**
 * Text that is safe in a markdown table cell
 *
 * @param text text of the cell
 */
function cell(text: string): string {
  return text.replaceAll('\\', '\\\\').replaceAll('|', String.raw`\|`).replaceAll(/\r?\n/g, ' ');
}

/**
 * Shorten evidence for the report
 *
 * @param text evidence
 */
function clip(text: string): string {
  return text.length > 400 ? `${text.slice(0, 399)}…` : text;
}

/**
 * Format a value in the unit of its metric, like the markdown summary presenter
 *
 * @param unit unit of the metric
 * @param value value in that unit
 */
export function formatValue(unit: MetricChange['unit'], value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) {
    return '–';
  }

  switch (unit) {
    case 'bytes': {
      return Math.abs(value) >= 1024 * 1024 ? `${(value / (1024 * 1024)).toFixed(1)} MB` : `${(value / 1024).toFixed(1)} kB`;
    }

    case 'ms': {
      return Math.abs(value) >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${Math.round(value)} ms`;
    }

    case 's': {
      return `${value.toFixed(2)} s`;
    }

    case 'score': {
      return value.toFixed(3);
    }

    case 'count': {
      return Number.isInteger(value) ? String(value) : value.toFixed(2);
    }
  }
}

/**
 * Short commit for the summary
 *
 * @param commit full commit
 */
function short(commit: string | undefined): string {
  return commit ? `\`${commit.slice(0, 7)}\`` : 'an unknown commit';
}

/**
 * Comment-ready markdown of the attribution: a table of the regressions and their top-1 culprit, followed by the evidence
 *
 * @param bundle bundle within the caps, undefined if none was found
 * @param verdicts verdict per regression
 * @param notes remarks about the attribution, e.g. a missing bundle
 */
export function renderMarkdown(bundle: CappedBundle | undefined, verdicts: Verdict[], notes: string[]): string {
  const lines = ['## Performance attribution', ''];
  if (bundle) {
    const count = (status: Verdict['status']) => verdicts.filter(verdict => verdict.status === status).length;
    const highlights = [
      `${short(bundle.run.commit)} against baseline ${short(bundle.run.baselineCommit)}`,
      `${verdicts.length} regression(s)`,
      ...(['attributed', 'no-culprit', 'no-agent'] as const).filter(status => count(status) > 0).map(status => `${count(status)} ${status}`),
    ];
    lines.push(highlights.join(' · '), '');
  }

  if (bundle?.unresolved) {
    const detail = bundle.unresolvedDetail ? ` (${cell(bundle.unresolvedDetail)})` : '';
    lines.push(bundle.unresolved === 'no changes since the baseline commit'
      ? `> No lines changed since the baseline commit${detail}, so there is nothing to attribute to.`
      : `> The changed lines are unknown: ${bundle.unresolved}${detail}. In CI, fetch the baseline commit, e.g. \`actions/checkout\` with \`fetch-depth: 0\`, so the presenter can diff against it.`, '');
  }

  for (const note of notes) {
    lines.push(`> ${cell(note)}`, '');
  }

  if (verdicts.length > 0) {
    const regressions = new Map(bundle?.regressions.map(regression => [regression.entityKey, regression]) ?? []);
    lines.push('| Test / step | Metric | Baseline | Current | Culprit | Confidence | Status |', '|---|---|---:|---:|---|---:|---|');
    for (const verdict of verdicts) {
      const [change] = regressions.get(verdict.entityKey)?.changes ?? [];
      const relative = change?.relativeChange === undefined ? '' : ` (${change.relativeChange > 0 ? '+' : ''}${Math.round(change.relativeChange * 100)} %)`;
      const [culprit] = verdict.culprits;
      lines.push(`| ${[
        cell(verdict.name.replace(/^ > /, '')),
        change ? cell(`${change.metric}${relative}`) : '–',
        change ? formatValue(change.unit, change.baselineMedian) : '–',
        change ? formatValue(change.unit, change.current) : '–',
        culprit ? `\`${cell(`${culprit.file}:${culprit.startLine === culprit.endLine ? culprit.startLine : `${culprit.startLine}-${culprit.endLine}`}`)}\`${culprit.symbol ? ` ${cell(culprit.symbol)}` : ''}` : '–',
        culprit ? verdict.confidence.toFixed(2) : '–',
        statuses[verdict.status],
      ].join(' | ')} |`);
    }

    const explained = verdicts.filter(verdict => verdict.reason !== undefined || verdict.evidence.length > 0 || verdict.culprits.length > 0);
    if (explained.length > 0) {
      lines.push('', '### Evidence');
      for (const verdict of explained) {
        lines.push('', `**${cell(verdict.name.replace(/^ > /, ''))}**`, '');
        if (verdict.reason) {
          lines.push(`- ${cell(verdict.reason)}`);
        }

        for (const culprit of verdict.culprits) {
          lines.push(
            `- \`${cell(`${culprit.file}:${culprit.startLine}`)}\` (${[culprit.basis, ...(culprit.metric ? [cell(culprit.metric)] : [])].join(', ')}, confidence ${culprit.confidence.toFixed(2)})`,
            ...culprit.evidence.map(item => `  - ${cell(clip(item))}`),
          );
        }

        lines.push(...verdict.evidence.map(item => `- ${cell(item)}`));
      }
    }
  }

  return `${lines.join('\n').trimEnd()}\n`;
}
