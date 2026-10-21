import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  nativePresenters,
  type ResultAccumulator,
} from '../../src/index.js';
import {
  buildHar,
  type NetworkRequestRecord,
} from '../../src/helpers/index.js';

const record = (url: string, wallTime: number, encodedDataLength: number, extra: Partial<NetworkRequestRecord> = {}): NetworkRequestRecord => ({
  requestId: url, url, method: 'GET', requestHeaders: {}, resourceType: 'Script', documentUrl: 'https://shop.com/', wallTime, timestamp: wallTime, status: 200, encodedDataLength, endTimestamp: wallTime + 0.2, ...extra,
});

describe('Waterfall presenter', () => {
  let outputDir: string;

  beforeEach(() => {
    outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'waterfall-presenter-'));
  });

  afterEach(() => {
    fs.rmSync(outputDir, {recursive: true, force: true});
  });

  const chunk = (stepName: string, harFile: string): ResultAccumulator => ({
    case: {
      TEST_CASE_PARENT: {name: ' > chromium > shop.spec.ts > Checkout', startMetrics: [], stopMetrics: [], samplingMetrics: [], startMeasurement: 0, endMeasurement: 0},
      [stepName]: {name: stepName, startMetrics: [], stopMetrics: [{metric: {harFile, totalNetworkRequests: 2}}], samplingMetrics: [], startMeasurement: 0, endMeasurement: 0},
    },
  });

  it('should render a waterfall and the domains of every HAR file', async () => {
    const harFile = path.join(outputDir, 'har', 'step.har');
    fs.mkdirSync(path.dirname(harFile));
    fs.writeFileSync(harFile, JSON.stringify(buildHar([
      record('https://shop.com/app.js', 1000, 2048),
      record('https://cdn.ads.net/<ad>.js', 1000.5, 1_048_576 * 2, {errorText: 'net::ERR_BLOCKED'}),
    ], {id: 'page_1', title: 'Open'}, {name: 'test', version: '1'})));
    const presenter = new nativePresenters.waterfallPresenter({outputDir, outputFile: 'waterfall.html'});

    await presenter.write(chunk('Open <cart>', harFile));
    await presenter.write(chunk('Pay', path.join(outputDir, 'missing.har')));
    expect(await presenter.close()).toBe(true);

    const html = fs.readFileSync(path.join(outputDir, 'waterfall.html'), 'utf8');
    expect(html).toContain('<h2>chromium &gt; shop.spec.ts &gt; Checkout &rsaquo; Open &lt;cart&gt;</h2>');
    expect(html).toContain('2 request(s) in 700 ms · <a href="har/step.har">HAR file</a>');
    expect(html).toContain('https://cdn.ads.net/&lt;ad&gt;.js');
    expect(html).toContain('net::ERR_BLOCKED');
    expect(html).toContain('<td>cdn.ads.net</td><td class="number">1</td><td class="number">2.0 MB</td>');
    expect(html).toContain('<td>shop.com</td><td class="number">1</td><td class="number">2.0 kB</td>');
    expect(html).toContain('Unreadable HAR file');
    expect(html).not.toContain('cdn.jsdelivr.net');

    await presenter.delete();
    expect(fs.existsSync(path.join(outputDir, 'waterfall.html'))).toBe(false);
  });

  it('should explain how to get waterfalls without HAR files', async () => {
    const presenter = new nativePresenters.waterfallPresenter({outputDir, outputFile: 'waterfall.html'});

    expect(await presenter.close()).toBe(true);
    expect(fs.readFileSync(path.join(outputDir, 'waterfall.html'), 'utf8')).toContain('No HAR files');
  });

  it('should report a failure to write', async () => {
    const presenter = new nativePresenters.waterfallPresenter({outputDir: path.join(outputDir, 'missing'), outputFile: 'waterfall.html'});

    expect(await presenter.close()).toBe(false);
  });
});
