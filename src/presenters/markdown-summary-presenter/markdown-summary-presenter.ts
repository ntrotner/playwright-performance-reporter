import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
  type BudgetViolation,
  type PresenterWriter,
  type ResultAccumulator,
  type TargetMetric,
  testCaseParent,
} from '../../types/index.js';
import {
  formatBudgetViolation,
  Logger,
} from '../../helpers/index.js';
import {
  metricUnit,
} from '../comparison-presenter/constants.js';
import {
  type ComparisonReport,
  type StepComparison,
} from '../comparison-presenter/types.js';
import {
  type MarkdownSummaryPresenterOptions,
  type SummaryRow,
} from './types.js';

/**
 * Column labels of well known metrics
 */
/* eslint-disable @typescript-eslint/naming-convention */
const metricLabels: Record<string, string> = {
  largestContentfulPaint: 'LCP',
  firstContentfulPaint: 'FCP',
  cumulativeLayoutShift: 'CLS',
  interactionToNextPaint: 'INP',
  totalBlockingTime: 'TBT',
  JSHeapUsedSize: 'JS heap',
  totalNetworkTransferSize: 'Transfer',
  totalNetworkRequests: 'Requests',
  cpuProfileActiveTime: 'CPU active',
  timeToFirstByte: 'TTFB',
};
/* eslint-enable @typescript-eslint/naming-convention */

/**
 * Icon and label of a verdict of the comparison presenter
 */
const verdicts: Record<StepComparison['status'], string> = {
  regressed: '🔴 regressed',
  improved: '🟢 improved',
  mixed: '🟡 mixed',
  unchanged: '⚪ unchanged',
  noisy: '⚪ noisy',
  new: '🆕 new',
  missing: '❔ missing',
};

/**
 * Format a value in the unit of its metric
 *
 * @param metric metric name
 * @param value value in the native unit of the metric
 */
export function formatMetricValue(metric: string, value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) {
    return '–';
  }

  switch (metricUnit(metric)) {
    case 'bytes': {
      if (Math.abs(value) >= 1024 * 1024) {
        return `${(value / (1024 * 1024)).toFixed(1)} MB`;
      }

      return `${(value / 1024).toFixed(1)} kB`;
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
 * Text that is safe in a markdown table cell
 *
 * @param text text of the cell
 */
function cell(text: string): string {
  return text.replaceAll('\\', '\\\\').replaceAll('|', String.raw`\|`).replaceAll(/\r?\n/g, ' ');
}

/**
 * Presenter that writes a markdown summary, e.g. for a pull request comment or the GitHub Actions job summary
 */
export class MarkdownSummaryPresenter implements PresenterWriter {
  /**
   * Merged measurements per test and step
   */
  private readonly rows = new Map<string, SummaryRow>();

  /**
   * Budget violations of the run, if budgets are configured
   */
  private violations: BudgetViolation[] | undefined;

  private readonly filePath: string;

  /**
   * Result of closing, to write the summary only once
   */
  private closing: Promise<boolean> | undefined;

  constructor(private readonly options: MarkdownSummaryPresenterOptions) {
    this.filePath = path.join(options.outputDir, options.outputFile);
  }

  /**
   * @inheritdoc
   */
  async write(content: ResultAccumulator): Promise<boolean> {
    for (const [caseId, steps] of Object.entries(content)) {
      for (const [stepId, performance] of Object.entries(steps ?? {})) {
        const key = `${caseId}|${stepId}`;
        const row = this.rows.get(key) ?? {
          caseId, stepId, name: performance.name, isTest: stepId === testCaseParent, start: performance.startMeasurement, end: performance.endMeasurement, values: {},
        };
        row.start = Math.min(row.start, performance.startMeasurement);
        row.end = Math.max(row.end, performance.endMeasurement);
        row.metadata ??= performance.metadata;
        row.repeatEachIndex ??= performance.execution?.repeatEachIndex;

        this.collectValues(row, performance.stopMetrics ?? []);
        this.rows.set(key, row);
      }
    }

    return true;
  }

  /**
   * @inheritdoc
   */
  async onBudgetViolations(violations: BudgetViolation[]): Promise<void> {
    this.violations = violations;
  }

  /**
   * @inheritdoc
   */
  async close(): Promise<boolean> {
    this.closing ??= this.finish();
    return this.closing;
  }

  /**
   * @inheritdoc
   */
  async delete(): Promise<boolean> {
    await this.close();
    fs.rmSync(this.filePath, {force: true, maxRetries: 5, retryDelay: 500});
    return true;
  }

  /**
   * Keep the latest stop value of every numeric metric
   *
   * @param row merged test or step
   * @param stopMetrics stop measurements of a chunk
   */
  private collectValues(row: SummaryRow, stopMetrics: TargetMetric[]): void {
    for (const targetMetric of stopMetrics) {
      for (const [metric, value] of Object.entries(targetMetric?.metric ?? {})) {
        // Pages describe the test better than workers or frames
        if (typeof value === 'number' && (targetMetric.type === 'page' || !(metric in row.values))) {
          row.values[metric] = value;
        }
      }
    }
  }

  /**
   * Render the summary and write it
   */
  private async finish(): Promise<boolean> {
    try {
      const report = await this.options.comparison?.getReport();
      const markdown = this.render(report);
      await fs.promises.writeFile(this.filePath, markdown);

      const stepSummary = process.env.GITHUB_STEP_SUMMARY;
      if (stepSummary && (this.options.githubStepSummary ?? true)) {
        await fs.promises.appendFile(stepSummary, `${markdown}\n`);
      }

      return true;
    } catch (error) {
      Logger.error(`Failed to write markdown summary: ${String(error)}`);
      return false;
    }
  }

  /**
   * Render tests and steps as a table, followed by the budget violations
   *
   * @param report comparison of the run
   */
  private render(report: ComparisonReport | undefined): string {
    const metrics = this.options.metrics ?? ['largestContentfulPaint', 'totalBlockingTime', 'JSHeapUsedSize', 'totalNetworkTransferSize'];
    const rows = this.orderedRows();
    const verdictOf = new Map(report?.steps.map(step => [step.key, step]) ?? []);
    const stepRows = rows.filter(({row}) => !row.isTest);

    const highlights = [`${stepRows.length} step(s)`];
    if (report && report.status !== 'invalid-current-run') {
      const count = (status: StepComparison['status']) => report.steps.filter(step => step.kind === 'step' && step.status === status).length;
      highlights.push(`${count('regressed')} regressed`, `${count('improved')} improved`, `${count('mixed')} mixed`);
    }

    if (this.violations) {
      highlights.push(`${this.violations.length} budget violation(s)`);
    }

    const metadata = rows.find(({row}) => row.metadata)?.row.metadata;
    if (metadata?.commit) {
      highlights.push(`commit \`${metadata.commit.slice(0, 7)}\``);
    }

    const header = ['Test / step', 'Duration', ...metrics.map(metric => metricLabels[metric] ?? metric), ...(report ? ['Verdict'] : [])];
    const lines = [
      `## ${this.options.title ?? 'Performance report'}`,
      '',
      highlights.join(' · '),
      '',
    ];

    if (report) {
      lines.push(`> ${cell(report.message)}`, '');
    }

    // Text columns left, numbers right
    const alignment = header.map((_, index) => index === 0 || (report && index === header.length - 1) ? '---' : '---:');
    lines.push(`| ${header.join(' | ')} |`, `|${alignment.join('|')}|`);
    for (const {row, key, repeat} of rows) {
      const testName = repeat === undefined ? row.name.replace(/^ > /, '') : `${row.name.replace(/^ > /, '')} (repeat ${repeat + 1})`;
      const name = row.isTest ? `**${cell(testName)}**` : cell(row.name);
      const values = metrics.map(metric => formatMetricValue(metric, row.values[metric]));
      const verdict = report ? [this.describeVerdict(verdictOf.get(key))] : [];
      lines.push(`| ${[name, formatMetricValue('entityDuration', row.end - row.start), ...values, ...verdict].join(' | ')} |`);
    }

    if (this.violations && this.violations.length > 0) {
      lines.push('', '### Budget violations', '', ...this.violations.map(violation => `- ${cell(formatBudgetViolation(violation).replace(/^Budget violation: /, ''))}`));
    }

    return `${lines.join('\n')}\n`;
  }

  /**
   * Verdict of a test or step and its most severe change
   *
   * @param step comparison of the test or step
   */
  private describeVerdict(step: StepComparison | undefined): string {
    if (!step) {
      return '–';
    }

    const [change] = step.changes;
    const detail = change?.relativeChange === undefined
      ? ''
      : ` (${change.relativeChange > 0 ? '+' : ''}${Math.round(change.relativeChange * 100)} % ${metricLabels[change.metric] ?? change.metric})`;
    return `${verdicts[step.status]}${cell(detail)}`;
  }

  /**
   * Tests with their steps in order of execution, keyed like the entities of the comparison presenter.
   * The comparison merges the repeats of a test into its first repeat, so every repeat refers to that one.
   */
  private orderedRows(): Array<{row: SummaryRow; key: string; repeat?: number}> {
    const occurrences = new Map<string, number>();
    const rows = [...this.rows.values()].sort((a, b) => a.start - b.start);
    const repeats = this.repeatsOf(rows);
    const keyed = rows.map(row => {
      const occurrenceKey = `${row.caseId}|${row.name}`;
      const occurrence = occurrences.get(occurrenceKey) ?? 0;
      occurrences.set(occurrenceKey, occurrence + 1);
      const repeat = repeats.get(row.caseId);
      const caseKey = repeat?.firstCaseId ?? row.caseId;
      return {row, key: row.isTest ? caseKey : `${caseKey}|${row.name}|${occurrence}`, repeat: repeat?.index};
    });

    // Group the steps below their test, tests in order of their start
    const tests = keyed.filter(({row}) => row.isTest);
    const orphans = keyed.filter(({row}) => !row.isTest && !tests.some(test => test.row.caseId === row.caseId));
    return [
      ...tests.flatMap(test => [test, ...keyed.filter(({row}) => !row.isTest && row.caseId === test.row.caseId)]),
      ...orphans,
    ];
  }

  /**
   * Repeat index and first repeat of every test that ran more than once with `repeatEach`
   *
   * @param rows merged tests and steps
   */
  private repeatsOf(rows: SummaryRow[]): Map<string, {index: number; firstCaseId: string}> {
    const testsByName = new Map<string, SummaryRow[]>();
    for (const row of rows) {
      if (row.isTest && row.repeatEachIndex !== undefined) {
        testsByName.set(row.name, [...(testsByName.get(row.name) ?? []), row]);
      }
    }

    const repeats = new Map<string, {index: number; firstCaseId: string}>();
    for (const tests of testsByName.values()) {
      if (tests.length < 2) {
        continue;
      }

      const [first] = [...tests].sort((a, b) => (a.repeatEachIndex ?? 0) - (b.repeatEachIndex ?? 0));
      for (const test of tests) {
        repeats.set(test.caseId, {index: test.repeatEachIndex ?? 0, firstCaseId: first.caseId});
      }
    }

    return repeats;
  }
}
