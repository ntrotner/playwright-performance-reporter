import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  nativePresenters,
  type ResultAccumulator,
  type TargetMetric,
} from '../../src/index.js';

const entry = (name: string, stopMetrics: TargetMetric[]) => ({
  name,
  startMetrics: [],
  stopMetrics,
  samplingMetrics: [],
  startMeasurement: 1000,
  endMeasurement: 2000,
});

describe('Chart presenter', () => {
  let outputDir: string;

  beforeEach(() => {
    outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chart-presenter-'));
  });

  afterEach(() => {
    fs.rmSync(outputDir, {recursive: true, force: true});
  });

  const generate = async (chunks: ResultAccumulator[]) => {
    const presenter = new nativePresenters.chartPresenter({outputDir, outputFile: 'chart.html'});
    for (const chunk of chunks) {
      // eslint-disable-next-line no-await-in-loop
      await presenter.write(chunk);
    }

    await presenter.close();
    return fs.readFileSync(path.join(outputDir, 'chart.html'), 'utf8');
  };

  it('should link files written by observers relative to the report, grouped by test', async () => {
    const traceFile = path.join(outputDir, 'traces', 'trace-1.json.gz');
    const html = await generate([
      {'case-a': {TEST_CASE_PARENT: entry('Profile test', [])}},
      {'case-a': {step1: entry('Open <profile>', [{id: 'page', metric: {traceFile, traceSizeBytes: 120, JSHeapUsedSize: 5}}])}},
    ]);

    expect(html).toContain('<h2>Artifacts</h2>');
    expect(html).toContain('<h3>Profile test</h3>');
    expect(html).toContain('<li>Open &lt;profile&gt;: <a href="traces/trace-1.json.gz">trace-1.json.gz</a> (traceFile)</li>');
  });

  it('should leave out the artifacts section without files', async () => {
    const html = await generate([
      {'case-a': {step1: entry('Open profile', [{id: 'page', metric: {JSHeapUsedSize: 5, someFile: ''}}])}},
    ]);

    expect(html).not.toContain('<h2>Artifacts</h2>');
  });
});
