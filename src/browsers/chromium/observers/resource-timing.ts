import type CDP from 'chrome-remote-interface';
import type Protocol from 'devtools-protocol/types/protocol';
import {
  type ChromiumMetricObserver,
  type Metric,
} from '../../../types/index.js';

/**
 * Options for the ResourceTimingObserver
 */
export type ResourceTimingObserverOptions = {
  /**
   * When true (default), the per-resource details are written to `resourceTimings`.
   */
  includeDetails?: boolean;

  /**
   * Size of the resource timing buffer of the page, to avoid dropping entries. Defaults to 500.
   */
  bufferSize?: number;
};

/**
 * Timing breakdown of a single resource in milliseconds
 */
export type ResourceTimingDetail = {
  name: string;
  initiatorType: string;
  nextHopProtocol: string;
  transferSize: number;
  encodedBodySize: number;
  decodedBodySize: number;
  dnsTime: number;
  tcpTime: number;
  tlsTime: number;
  requestTime: number;
  responseTime: number;
  redirectTime: number;
  blockedTime: number;
  cached: boolean;
  timingHidden: boolean;
};

/**
 * Aggregated resource timing metrics
 */
export type ResourceTimingAggregate = {
  totalResources: number;
  totalTransferSize: number;
  totalEncodedBodySize: number;
  totalDecodedBodySize: number;
  totalDnsTime: number;
  totalTcpTime: number;
  totalTlsTime: number;
  totalRequestTime: number;
  totalResponseTime: number;
  totalRedirectTime: number;
  totalBlockedTime: number;
  cacheHits: number;
  timingHiddenResources: number;
};

/**
 * Resource timing observer result
 */
export type ResourceTimingResult = ResourceTimingAggregate & {
  resourceTimings: ResourceTimingDetail[];
};

export class ResourceTimingObserver implements ChromiumMetricObserver {
  public readonly name = 'resourceTiming';
  public readonly plugins = [];

  private readonly includeDetails: boolean;
  private readonly bufferSize: number;

  constructor(protected options?: ResourceTimingObserverOptions) {
    this.includeDetails = options?.includeDetails ?? true;
    const bufferSize = options?.bufferSize;
    this.bufferSize = typeof bufferSize === 'number' && Number.isFinite(bufferSize) && bufferSize > 0 ? Math.floor(bufferSize) : 500;
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
   * Evaluate the resource timings in the page and write them into the accumulator
   */
  private async common(accumulator: Metric, client: CDP.Client) {
    return new Promise(resolve => {
      client.send('Runtime.evaluate', {expression: this.getResourceTimingExpression(), returnByValue: true}, (error, cdpResponse) => {
        const result = (cdpResponse as Protocol.Runtime.EvaluateResponse | undefined)?.result;
        if (error || result?.type !== 'object' || result.value === undefined || result.value === null) {
          resolve(false);
          return;
        }

        const {resourceTimings, ...aggregates} = result.value as ResourceTimingResult;
        Object.assign(accumulator, aggregates, this.includeDetails ? {resourceTimings} : {});
        resolve(true);
      });
    });
  }

  /**
   * Reads all resource entries of the page and breaks them down into their phases.
   *
   * Note: a phase is 0 if its start is unavailable, e.g. for cross-origin resources without `Timing-Allow-Origin`.
   */
  private getResourceTimingExpression() {
    return `
  (() => {
    try {
      performance.setResourceTimingBufferSize(${this.bufferSize});
    } catch {}

    const phase = (start, end) => start > 0 ? end - start : 0;
    const resourceTimings = performance.getEntriesByType('resource').map(entry => ({
      name: entry.name,
      initiatorType: entry.initiatorType,
      nextHopProtocol: entry.nextHopProtocol || '',
      transferSize: entry.transferSize,
      encodedBodySize: entry.encodedBodySize,
      decodedBodySize: entry.decodedBodySize,
      dnsTime: phase(entry.domainLookupStart, entry.domainLookupEnd),
      tcpTime: phase(entry.connectStart, entry.connectEnd),
      tlsTime: phase(entry.secureConnectionStart, entry.connectEnd),
      requestTime: phase(entry.requestStart, entry.responseStart),
      responseTime: phase(entry.responseStart, entry.responseEnd),
      redirectTime: phase(entry.redirectStart, entry.redirectEnd),
      blockedTime: entry.fetchStart - entry.startTime,
      cached: entry.transferSize === 0 && entry.decodedBodySize > 0,
      timingHidden: entry.responseStart === 0,
    }));

    const sum = key => resourceTimings.reduce((total, resource) => total + (resource[key] || 0), 0);
    const count = key => resourceTimings.filter(resource => resource[key]).length;

    return {
      totalResources: resourceTimings.length,
      totalTransferSize: sum('transferSize'),
      totalEncodedBodySize: sum('encodedBodySize'),
      totalDecodedBodySize: sum('decodedBodySize'),
      totalDnsTime: sum('dnsTime'),
      totalTcpTime: sum('tcpTime'),
      totalTlsTime: sum('tlsTime'),
      totalRequestTime: sum('requestTime'),
      totalResponseTime: sum('responseTime'),
      totalRedirectTime: sum('redirectTime'),
      totalBlockedTime: sum('blockedTime'),
      cacheHits: count('cached'),
      timingHiddenResources: count('timingHidden'),
      resourceTimings,
    };
  })()
`;
  }
}
