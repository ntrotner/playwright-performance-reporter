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

const chunk: ResultAccumulator = {
  case: {
    TEST_CASE_PARENT: {
      name: 'test', startMetrics: [{metric: {Nodes: 10}}], stopMetrics: [], samplingMetrics: [], startMeasurement: 0, endMeasurement: 100,
    },
  },
};

describe('Chart presenter', () => {
  let outputDir: string;

  beforeEach(() => {
    outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chart-presenter-'));
  });

  afterEach(() => {
    fs.rmSync(outputDir, {recursive: true, force: true});
  });

  const generate = async (chunks: ResultAccumulator[], inlineAssets?: boolean) => {
    const presenter = new nativePresenters.chartPresenter({outputDir, outputFile: 'chart.html', inlineAssets});
    for (const chunk of chunks) {
      // eslint-disable-next-line no-await-in-loop
      await presenter.write(chunk);
    }

    await presenter.close();
    return fs.readFileSync(path.join(outputDir, 'chart.html'), 'utf8');
  };

  const render = async (inlineAssets?: boolean) => generate([chunk], inlineAssets);

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

  it('should embed Chart.js by default, so the report works offline', async () => {
    const html = await render();

    expect(html).toContain('Chart.js v4');
    expect(html).not.toContain('cdn.jsdelivr.net');
    expect(html).toContain('<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\';');
  });

  it('should load the pinned Chart.js from the CDN on request', async () => {
    const html = await render(false);

    expect(html).toMatch(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/chart\.js@4\.\d+\.\d+\/dist\/chart\.umd\.min\.js"><\/script>/);
    expect(html).not.toContain('Chart.js v4');
  });
});
