import fs from 'node:fs';
import path from 'node:path';
import {
  type PresenterWriter,
  type ResultAccumulator,
  testCaseParent,
} from '../../types/index.js';
import {
  type Har,
  type HarEntry,
  Logger,
} from '../../helpers/index.js';
import {
  type WaterfallPresenterOptions,
} from './types.js';

/**
 * HAR file written for a test or step
 */
type HarReference = {
  testName: string;
  stepName: string;
  file: string;
};

/**
 * Phases of a request in order, with their color
 */
const phases: Array<{key: keyof HarEntry['timings']; color: string}> = [
  {key: 'blocked', color: '#cbd5e1'},
  {key: 'dns', color: '#14b8a6'},
  {key: 'connect', color: '#f97316'},
  {key: 'send', color: '#a855f7'},
  {key: 'wait', color: '#22c55e'},
  {key: 'receive', color: '#3b82f6'},
];

/**
 * Escape text for HTML content and attributes
 *
 * @param text text to escape
 */
function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\'', '&#039;');
}

/**
 * Human readable size
 *
 * @param bytes size in bytes
 */
function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return `${(bytes / 1024).toFixed(1)} kB`;
}

/**
 * Host of a url
 *
 * @param url url of a request
 */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * Presenter that renders the HAR files of `networkActivity({har})` as waterfalls in a self-contained HTML report
 */
export class WaterfallPresenter implements PresenterWriter {
  private readonly references: HarReference[] = [];
  private readonly testNames = new Map<string, string>();
  private readonly filePath: string;

  constructor(private readonly options: WaterfallPresenterOptions) {
    this.filePath = path.join(options.outputDir, options.outputFile);
  }

  /**
   * @inheritdoc
   */
  async write(content: ResultAccumulator): Promise<boolean> {
    for (const [caseId, steps] of Object.entries(content)) {
      for (const [stepId, performance] of Object.entries(steps ?? {})) {
        if (stepId === testCaseParent) {
          this.testNames.set(caseId, performance.name);
        }

        for (const targetMetric of performance.stopMetrics ?? []) {
          const file = targetMetric?.metric?.harFile;
          if (typeof file === 'string') {
            this.references.push({testName: caseId, stepName: performance.name, file});
          }
        }
      }
    }

    return true;
  }

  /**
   * @inheritdoc
   */
  async close(): Promise<boolean> {
    try {
      const sections = await Promise.all(this.references.map(async reference => this.renderSection(reference)));
      await fs.promises.writeFile(this.filePath, this.renderPage(sections));
      return true;
    } catch (error) {
      Logger.error(`Failed to write waterfall: ${String(error)}`);
      return false;
    }
  }

  /**
   * @inheritdoc
   */
  async delete(): Promise<boolean> {
    fs.rmSync(this.filePath, {force: true, maxRetries: 5, retryDelay: 500});
    return true;
  }

  /**
   * Waterfall and domain totals of a HAR file
   *
   * @param reference HAR file of a test or step
   */
  private async renderSection(reference: HarReference): Promise<string> {
    const testName = this.testNames.get(reference.testName) ?? reference.testName;
    const title = `<h2>${escapeHtml(testName.replace(/^ > /, ''))} &rsaquo; ${escapeHtml(reference.stepName)}</h2>`;
    let har: Har;
    try {
      har = JSON.parse(await fs.promises.readFile(reference.file, 'utf8')) as Har;
    } catch (error) {
      return `<section>${title}<p class="muted">Unreadable HAR file ${escapeHtml(reference.file)}: ${escapeHtml(String(error))}</p></section>`;
    }

    const entries = [...har.log.entries]
      .sort((a, b) => Date.parse(a.startedDateTime) - Date.parse(b.startedDateTime))
      .slice(0, this.options.maxRequests ?? 200);
    const start = Math.min(...entries.map(entry => Date.parse(entry.startedDateTime)));
    const end = Math.max(...entries.map(entry => Date.parse(entry.startedDateTime) + entry.time));
    const span = Math.max(1, end - start);
    const href = path.relative(path.dirname(path.resolve(this.filePath)), path.resolve(reference.file)).split(path.sep).join('/');

    const rows = entries.map(entry => {
      const offset = Date.parse(entry.startedDateTime) - start;
      const bars = phases
        .filter(({key}) => entry.timings[key] > 0)
        .map(({key, color}) => `<span title="${key} ${entry.timings[key].toFixed(1)} ms" style="flex:${entry.timings[key]};background:${color}"></span>`)
        .join('');
      const status = entry.response._error ? escapeHtml(entry.response._error) : String(entry.response.status);
      return `<tr>
        <td class="url" title="${escapeHtml(entry.request.url)}">${escapeHtml(entry.request.url)}</td>
        <td>${escapeHtml(entry._resourceType)}</td>
        <td class="number">${status}</td>
        <td class="number">${formatBytes(entry._transferSize)}</td>
        <td class="number">${entry.time.toFixed(0)} ms</td>
        <td class="timeline"><div class="bar" style="margin-left:${(offset / span * 100).toFixed(2)}%;width:${Math.max(0.2, entry.time / span * 100).toFixed(2)}%">${bars}</div></td>
      </tr>`;
    });

    const domains = new Map<string, {requests: number; transferSize: number}>();
    for (const entry of har.log.entries) {
      const host = hostOf(entry.request.url);
      const domain = domains.get(host) ?? {requests: 0, transferSize: 0};
      domain.requests++;
      domain.transferSize += entry._transferSize;
      domains.set(host, domain);
    }

    const domainRows = [...domains.entries()]
      .sort((a, b) => b[1].transferSize - a[1].transferSize)
      .map(([host, domain]) => `<tr><td>${escapeHtml(host)}</td><td class="number">${domain.requests}</td><td class="number">${formatBytes(domain.transferSize)}</td></tr>`);

    return `<section>
    ${title}
    <p class="muted">${har.log.entries.length} request(s) in ${span.toFixed(0)} ms · <a href="${escapeHtml(href)}">HAR file</a></p>
    <table class="waterfall">
      <thead><tr><th>Url</th><th>Type</th><th>Status</th><th>Transfer</th><th>Time</th><th>Waterfall</th></tr></thead>
      <tbody>${rows.join('')}</tbody>
    </table>
    <details><summary>Domains</summary>
      <table><thead><tr><th>Host</th><th>Requests</th><th>Transfer</th></tr></thead><tbody>${domainRows.join('')}</tbody></table>
    </details>
  </section>`;
  }

  /**
   * Self-contained HTML page with all waterfalls
   *
   * @param sections rendered waterfalls
   */
  private renderPage(sections: string[]): string {
    const legend = phases.map(({key, color}) => `<span><i style="background:${color}"></i>${key}</span>`).join('');
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Network Waterfall</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; color: #1f2937; }
    section { background: #fff; border-radius: 8px; padding: 16px 20px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
    h1 { font-size: 22px; } h2 { font-size: 16px; margin: 0 0 4px; }
    .muted { color: #6b7280; font-size: 13px; margin: 0 0 8px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; table-layout: fixed; }
    th, td { text-align: left; padding: 3px 6px; border-bottom: 1px solid #f1f5f9; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .waterfall th:nth-child(1) { width: 34%; } .waterfall th:nth-child(2) { width: 8%; } .waterfall th:nth-child(3), .waterfall th:nth-child(4), .waterfall th:nth-child(5) { width: 7%; }
    .number { text-align: right; }
    .bar { display: flex; height: 10px; min-width: 2px; border-radius: 2px; overflow: hidden; }
    .legend span { margin-right: 12px; font-size: 12px; } .legend i { display: inline-block; width: 10px; height: 10px; margin-right: 4px; vertical-align: middle; }
    details { margin-top: 8px; font-size: 13px; }
  </style>
</head>
<body>
  <h1>Network Waterfall</h1>
  <p class="legend">${legend}</p>
  ${sections.length > 0 ? sections.join('\n') : '<section><p class="muted">No HAR files. Configure <code>networkActivity({har: {outputDir}})</code>.</p></section>'}
</body>
</html>`;
  }
}
