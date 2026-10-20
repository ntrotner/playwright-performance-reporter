import type CDP from 'chrome-remote-interface';
import type Protocol from 'devtools-protocol/types/protocol';
import {
  type ChromiumMetricObserver,
  type Metric,
} from '../../../types/index.js';

/**
 * Options for the NavigationTimingObserver
 */
export type NavigationTimingObserverOptions = {
  /**
   * When true (default), include the transfer, encoded and decoded body size and the nextHopProtocol of the document.
   */
  includeSizes?: boolean;

  /**
   * When true (default), include the domContentLoaded, domComplete and loadEvent milestones.
   */
  includeLoadMilestones?: boolean;
};

const sizeMetrics = ['nextHopProtocol', 'navigationTransferSize', 'navigationEncodedBodySize', 'navigationDecodedBodySize'];
const loadMilestoneMetrics = ['domContentLoadedTime', 'domCompleteTime', 'loadEventTime'];

export class NavigationTimingObserver implements ChromiumMetricObserver {
  public readonly name = 'navigationTiming';
  public readonly plugins = [];

  /**
   * Only evaluates JavaScript in the page, so it also works in Firefox and WebKit
   */
  public readonly capabilities = ['evaluate'] as const;

  private readonly excludedMetrics: Set<string>;

  constructor(protected options?: NavigationTimingObserverOptions) {
    this.excludedMetrics = new Set([
      ...(options?.includeSizes ?? true ? [] : sizeMetrics),
      ...(options?.includeLoadMilestones ?? true ? [] : loadMilestoneMetrics),
    ]);
  }

  /**
   * @inheritdoc
   */
  async onStart(accumulator: Metric, developmentTools: CDP.Client): Promise<void> {
    await this.common(accumulator, developmentTools);
  }

  /**
   * @inheritdoc
   */
  async onSampling(accumulator: Metric, developmentTools: CDP.Client): Promise<void> {
    await this.common(accumulator, developmentTools);
  }

  /**
   * @inheritdoc
   */
  async onStop(accumulator: Metric, developmentTools: CDP.Client): Promise<void> {
    await this.common(accumulator, developmentTools);
  }

  /**
   * Read the navigation timing of the current document and write it into the accumulator
   */
  private async common(accumulator: Metric, client: CDP.Client) {
    return new Promise(resolve => {
      client.send('Runtime.evaluate', {expression: this.getNavigationTimingExpression(), returnByValue: true}, (error, cdpResponse) => {
        const result = (cdpResponse as Protocol.Runtime.EvaluateResponse | undefined)?.result;
        // A missing navigation entry is returned as null with type 'object'
        if (error || result?.type !== 'object' || result.value === undefined || result.value === null) {
          resolve(false);
          return;
        }

        const entries = Object.entries(result.value as Record<string, unknown>).filter(([key]) => !this.excludedMetrics.has(key));
        Object.assign(accumulator, Object.fromEntries(entries));
        resolve(true);
      });
    });
  }

  /**
   * Reads the navigation entry of the current document. Durations are in milliseconds and relative to the navigation start.
   *
   * Note: Without `Timing-Allow-Origin` cross-origin phases are zeroed by the browser.
   */
  private getNavigationTimingExpression() {
    return `
  (() => {
    const [entry] = performance.getEntriesByType('navigation');
    if (!entry) {
      return null;
    }

    return {
      timeToFirstByte: entry.responseStart - entry.startTime,
      redirectTime: entry.redirectEnd - entry.redirectStart,
      dnsLookupTime: entry.domainLookupEnd - entry.domainLookupStart,
      tcpConnectTime: entry.connectEnd - entry.connectStart,
      tlsTime: entry.secureConnectionStart > 0 ? entry.connectEnd - entry.secureConnectionStart : 0,
      requestTime: entry.responseStart - entry.requestStart,
      responseTime: entry.responseEnd - entry.responseStart,
      domContentLoadedTime: entry.domContentLoadedEventEnd - entry.startTime,
      domCompleteTime: entry.domComplete - entry.startTime,
      loadEventTime: entry.loadEventEnd - entry.startTime,
      nextHopProtocol: entry.nextHopProtocol || '',
      navigationTransferSize: entry.transferSize,
      navigationEncodedBodySize: entry.encodedBodySize,
      navigationDecodedBodySize: entry.decodedBodySize,
    };
  })()
`;
  }
}
