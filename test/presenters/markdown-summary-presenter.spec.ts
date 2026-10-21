import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import {
  nativePresenters,
  type ResultAccumulator,
} from '../../src/index.js';
import {
  formatMetricValue,
} from '../../src/presenters/markdown-summary-presenter/index.js';
import {
  type ComparisonReport,
} from '../../src/presenters/comparison-presenter/types.js';

const entry = (name: string, start: number, end: number, stopMetrics: Array<{type?: string; metric: Record<string, string | number>}>, extra: Record<string, unknown> = {}) => ({
  [name === 'test' ? 'TEST_CASE_PARENT' : `id-${name}`]: {
    name: name === 'test' ? ' > chromium > example.spec.ts > Profile' : name,
    startMetrics: [],
    stopMetrics,
    samplingMetrics: [],
    startMeasurement: start,
    endMeasurement: end,
    ...extra,
  },
});

const chunks: ResultAccumulator[] = [
  {case: entry('test', 1000, 1000, [], {metadata: {commit: 'abcdef1234567890'}})},
  {case: entry('Open | profile', 1100, 1100, [])},
  {case: entry('Open | profile', 1100, 2360, [{type: 'worker', metric: {JSHeapUsedSize: 1}}, {type: 'page', metric: {largestContentfulPaint: 1380, JSHeapUsedSize: 8_311_228, totalNetworkTransferSize: 421_888}}])},
  {case: entry('Open tab', 2400, 2500, [{type: 'page', metric: {largestContentfulPaint: 640, totalBlockingTime: 48}}])},
  {case: entry('test', 1000, 2600, [])},
] as unknown as ResultAccumulator[];

const report = {
  status: 'ok',
  message: 'Compared 2 step(s): 1 regressed',
  steps: [
    {key: 'case', kind: 'test', status: 'mixed', changes: []},
    {key: 'case|Open | profile|0', kind: 'step', status: 'regressed', changes: [{metric: 'largestContentfulPaint', relativeChange: 0.234}]},
    {key: 'case|Open tab|0', kind: 'step', status: 'improved', changes: [{metric: 'TaskDuration', relativeChange: -0.1}]},
  ],
} as unknown as ComparisonReport;

describe('Markdown summary presenter', () => {
  let outputDir: string;
  let stepSummary: string | undefined;

  beforeEach(() => {
    outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'markdown-summary-presenter-'));
    stepSummary = process.env.GITHUB_STEP_SUMMARY;
    delete process.env.GITHUB_STEP_SUMMARY;
  });

  afterEach(() => {
    fs.rmSync(outputDir, {recursive: true, force: true});
    if (stepSummary === undefined) {
      delete process.env.GITHUB_STEP_SUMMARY;
    } else {
      process.env.GITHUB_STEP_SUMMARY = stepSummary;
    }
  });

  const render = async (options: Partial<ConstructorParameters<typeof nativePresenters.markdownSummaryPresenter>[0]> = {}, violations?: unknown[]) => {
    const presenter = new nativePresenters.markdownSummaryPresenter({outputDir, outputFile: 'summary.md', ...options});
    for (const chunk of chunks) {
      // eslint-disable-next-line no-await-in-loop
      await presenter.write(chunk);
    }

    if (violations) {
      await presenter.onBudgetViolations(violations as any);
    }

    expect(await presenter.close()).toBe(true);
    return {presenter, markdown: fs.readFileSync(path.join(outputDir, 'summary.md'), 'utf8')};
  };

  it('should render tests and steps with their duration and metrics', async () => {
    const {markdown} = await render();

    expect(markdown).toBe([
      '## Performance report',
      '',
      '2 step(s) · commit `abcdef1`',
      '',
      '| Test / step | Duration | LCP | TBT | JS heap | Transfer |',
      '|---|---:|---:|---:|---:|---:|',
      '| **chromium > example.spec.ts > Profile** | 1.60 s | – | – | – | – |',
      String.raw`| Open \| profile | 1.26 s | 1.38 s | – | 7.9 MB | 412.0 kB |`,
      '| Open tab | 100 ms | 640 ms | 48 ms | – | – |',
      '',
    ].join('\n'));
  });

  it('should add the verdicts of the comparison and the budget violations', async () => {
    const comparison = {getReport: jest.fn().mockResolvedValue(report)};
    const {markdown} = await render({comparison: comparison as any, metrics: ['largestContentfulPaint'], title: 'Perf'}, [{
      metric: 'largestContentfulPaint', name: 'Open | profile', actual: 3120, limit: 2500, direction: 'max', unit: 'ms',
    }]);

    expect(markdown).toContain('## Perf\n\n2 step(s) · 1 regressed · 1 improved · 0 mixed · 1 budget violation(s) · commit `abcdef1`\n\n> Compared 2 step(s): 1 regressed\n');
    expect(markdown).toContain('| Test / step | Duration | LCP | Verdict |\n|---|---:|---:|---|');
    expect(markdown).toContain(String.raw`| Open \| profile | 1.26 s | 1.38 s | 🔴 regressed (+23 % LCP) |`);
    expect(markdown).toContain('| Open tab | 100 ms | 640 ms | 🟢 improved (-10 % TaskDuration) |');
    expect(markdown).toContain('| **chromium > example.spec.ts > Profile** | 1.60 s | – | 🟡 mixed |');
    expect(markdown).toContain(String.raw`### Budget violations` + '\n\n' + String.raw`- metric "largestContentfulPaint" = 3120 > 2500 (ms) (test: "Open \| profile")`);
  });

  it('should label the repeats of a test and give them the verdict of the merged first repeat', async () => {
    const presenter = new nativePresenters.markdownSummaryPresenter({
      outputDir, outputFile: 'summary.md', metrics: ['largestContentfulPaint'], comparison: {getReport: jest.fn().mockResolvedValue(report)} as any,
    });
    for (const [caseId, offset] of [['case', 0], ['case-repeat-1', 5000]] as const) {
      // eslint-disable-next-line no-await-in-loop
      await presenter.write({[caseId]: {
        ...entry('test', 1000 + offset, 2600 + offset, [], {execution: {repeatEachIndex: offset / 5000, retry: 0}}),
        ...entry('Open tab', 2400 + offset, 2500 + offset, [{type: 'page', metric: {largestContentfulPaint: 640 + offset}}]),
      }} as unknown as ResultAccumulator);
    }

    await presenter.close();
    const markdown = fs.readFileSync(path.join(outputDir, 'summary.md'), 'utf8');

    expect(markdown).toContain('| **chromium > example.spec.ts > Profile (repeat 1)** | 1.60 s | – | 🟡 mixed |\n| Open tab | 100 ms | 640 ms | 🟢 improved (-10 % TaskDuration) |');
    expect(markdown).toContain('| **chromium > example.spec.ts > Profile (repeat 2)** | 1.60 s | – | 🟡 mixed |\n| Open tab | 100 ms | 5.64 s | 🟢 improved (-10 % TaskDuration) |');
  });

  it('should append to the GitHub Actions job summary and write only once', async () => {
    const summaryFile = path.join(outputDir, 'step-summary.md');
    process.env.GITHUB_STEP_SUMMARY = summaryFile;

    const {presenter, markdown} = await render();
    await presenter.close();
    expect(fs.readFileSync(summaryFile, 'utf8')).toBe(`${markdown}\n`);

    fs.rmSync(summaryFile);
    await render({githubStepSummary: false});
    expect(fs.existsSync(summaryFile)).toBe(false);
  });

  it('should delete the summary', async () => {
    const {presenter} = await render();

    await presenter.delete();

    expect(fs.existsSync(path.join(outputDir, 'summary.md'))).toBe(false);
  });

  it('should report a failure to write', async () => {
    const presenter = new nativePresenters.markdownSummaryPresenter({outputDir: path.join(outputDir, 'missing'), outputFile: 'summary.md'});

    expect(await presenter.close()).toBe(false);
  });

  it.each([
    ['JSHeapUsedSize', 512, '0.5 kB'],
    ['largestContentfulPaint', 999.6, '1000 ms'],
    ['ScriptDuration', 0.271, '0.27 s'],
    ['cumulativeLayoutShift', 0.12345, '0.123'],
    ['Nodes', 7951, '7951'],
    ['Nodes', 1.234, '1.23'],
    ['Nodes', undefined, '–'],
  ])('should format %s %s as %s', (metric, value, expected) => {
    expect(formatMetricValue(metric, value)).toBe(expected);
  });
});
