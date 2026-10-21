import fs from 'node:fs';
import path from 'node:path';
import type CDP from 'chrome-remote-interface';
import type Protocol from 'devtools-protocol/types/protocol';
import {
  type ChromiumMetricObserver,
  type Metric,
  type ObserverOptions,
} from '../../../types/index.js';
import {
  nativeChromiumPlugins,
} from '../plugins/index.js';
import {
  buildHar,
  globToRegExp,
  type NetworkRequestRecord,
  siteOf,
} from '../../../helpers/index.js';

/**
 * Options for the NetworkActivityObserver
 */
export type NetworkActivityObserverOptions = Partial<ObserverOptions> & {
  /**
   * When true, sampling returns full details array. When false (default), only aggregated values.
   */
  includeDetailsInSampling?: boolean;

  /**
   * Write the requests of a target between start and stop as HAR 1.2 file, e.g. one per step
   */
  har?: NetworkHarOptions;

  /**
   * Glob patterns (`*` and `?`) of hosts that are first party, e.g. `['example.com', '*.example.com']`.
   * Defaults to requests to the same site as the document that started them.
   */
  firstPartyHosts?: string[];
};

/**
 * Options of the HAR export
 */
export type NetworkHarOptions = {
  /**
   * Folder for the HAR files. Created if missing.
   */
  outputDir: string;

  /**
   * Prefix of the HAR file names. Defaults to `network`.
   */
  filePrefix?: string;

  /**
   * Only include requests whose url matches, a glob pattern (`*` and `?`) or a regular expression
   */
  urlFilter?: string | RegExp;
};

/**
 * Network activity data for a single request
 */
export type NetworkActivity = {
  requestId: string;
  url: string;
  method: string;
  status?: number;
  transferSize?: number;
  duration?: number;
  timestamp: number;
};

/**
 * Aggregated network metrics
 */
export type NetworkAggregatedMetrics = {
  totalNetworkRequests: number;
  totalNetworkTransferSize: number;
  totalNetworkDuration: number;
};

/**
 * Network activity observer result
 */
export type NetworkActivityResult = NetworkAggregatedMetrics & NetworkBreakdownMetrics & {
  networkActivities: NetworkActivity[];

  /**
   * Path of the HAR file, with the `har` option
   */
  harFile?: string;
};

/**
 * Requests and transfer size of third parties and per resource type, e.g. `totalNetworkScriptTransferSize`.
 * Resource types are only reported once a request of the type was seen.
 */
export type NetworkBreakdownMetrics = {
  totalNetworkThirdPartyRequests: number;
  totalNetworkThirdPartyTransferSize: number;
} & Record<`totalNetwork${string}Requests` | `totalNetwork${string}TransferSize`, number>;

/**
 * Resource types of CDP that get their own breakdown, all others count as `Other`
 */
const breakdownResourceTypes = new Set(['Document', 'Script', 'Stylesheet', 'Image', 'Font', 'XHR', 'Fetch', 'Media']);

/**
 * Name and version written into the HAR files
 */
const harCreator = {name: 'playwright-performance-reporter', version: '1'};

/**
 * Typical return value for a cdp client listener
 */
type CdpClientSubscription = () => CDP.Client;

export class NetworkActivityObserver implements ChromiumMetricObserver {
  public readonly name = 'networkActivity';
  public readonly plugins = [
    nativeChromiumPlugins.networkDomainPlugin,
  ];

  private readonly includeDetailsInSampling: boolean;
  private readonly requestStartTimes: Map<string, number>;
  private readonly requestMethods: Map<string, string>;
  private readonly networkActivities: NetworkActivity[];
  private readonly subscriptions: CdpClientSubscription[];

  /**
   * Clients with listeners. The reporter connects new clients for every test, so each client is subscribed.
   */
  private readonly subscribedClients = new WeakSet<CDP.Client>();

  /**
   * Requests per client, including the headers and timing for the HAR export
   */
  private readonly records = new WeakMap<CDP.Client, NetworkRequestRecord[]>();

  /**
   * Running request per client and request id. A redirect reuses the id for the next request.
   */
  private readonly runningRecords = new WeakMap<CDP.Client, Map<string, NetworkRequestRecord>>();

  /**
   * Wall time in seconds of the latest start per client, which begins a HAR file
   */
  private readonly startTimes = new WeakMap<CDP.Client, number>();

  private readonly firstPartyHosts: RegExp[] | undefined;
  private readonly harUrlFilter: RegExp | undefined;
  private harCounter = 0;

  constructor(protected options?: NetworkActivityObserverOptions) {
    this.includeDetailsInSampling = options?.includeDetailsInSampling ?? false;
    this.requestStartTimes = new Map<string, number>();
    this.requestMethods = new Map<string, string>();
    this.networkActivities = [];
    this.subscriptions = [];
    this.firstPartyHosts = options?.firstPartyHosts?.map(pattern => globToRegExp(pattern));
    const urlFilter = options?.har?.urlFilter;
    this.harUrlFilter = typeof urlFilter === 'string' ? globToRegExp(urlFilter) : urlFilter;
  }

  /**
   * @inheritdoc
   */
  async onStart(accumulator: Metric, developmentTools: CDP.Client): Promise<void> {
    this.startTimes.set(developmentTools, Date.now() / 1000);
    this.common(accumulator, developmentTools, true);
  }

  /**
   * @inheritdoc
   */
  async onSampling(accumulator: Metric, developmentTools: CDP.Client): Promise<void> {
    this.common(accumulator, developmentTools, this.includeDetailsInSampling);
  }

  /**
   * @inheritdoc
   */
  async onStop(accumulator: Metric, developmentTools: CDP.Client): Promise<void> {
    this.common(accumulator, developmentTools, true);
    if (this.options?.har) {
      const harFile = await this.writeHar(developmentTools, this.options.har);
      if (harFile) {
        accumulator.harFile = harFile;
      }
    }
  }

  /**
   * Common function for all lifecycle hooks
   */
  private common(accumulator: Metric, client: CDP.Client, includeDetails: boolean): void {
    if (!this.subscribedClients.has(client)) {
      this.setupListeners(client);
    }

    const result: NetworkActivityResult = {
      ...this.calculateAggregatedMetrics(),
      ...this.calculateBreakdown(client),
      networkActivities: includeDetails ? [...this.networkActivities] : [],
    };

    Object.assign(accumulator, result);
  }

  /**
   * Setup network event listeners
   */
  private setupListeners(client: CDP.Client): void {
    this.subscribedClients.add(client);
    this.records.set(client, []);
    this.runningRecords.set(client, new Map());

    // Listen for request start
    this.subscriptions.push(
      this.setupRequestWillBeSent(client),
      this.setupResponseReceived(client),
      this.setupLoadingFinished(client),
      this.setupLoadingFailed(client),
    );
  }

  /**
   * Setup requestWillBeSent event listener
   *
   * @param client
   */
  private setupRequestWillBeSent(client: CDP.Client): CdpClientSubscription {
    return client.Network.requestWillBeSent(cdpResponse => {
      this.requestStartTimes.set(cdpResponse.requestId, Date.now());
      this.requestMethods.set(cdpResponse.requestId, cdpResponse.request.method);
      this.recordRequest(client, cdpResponse);
    });
  }

  /**
   * Setup responseReceived event listener
   *
   * @param client
   */
  private setupResponseReceived(client: CDP.Client): CdpClientSubscription {
    return client.Network.responseReceived(cdpResponse => {
      const {requestId} = cdpResponse;
      const startTime = this.requestStartTimes.get(requestId);
      if (!startTime) {
        return;
      }

      const activity: NetworkActivity = {
        requestId,
        url: cdpResponse.response.url,
        method: this.requestMethods.get(requestId) ?? 'UNKNOWN',
        status: cdpResponse.response.status,
        timestamp: startTime,
      };

      activity.duration = Date.now() - startTime;
      this.networkActivities.push(activity);
      const record = this.runningRecords.get(client)?.get(requestId);
      if (record) {
        this.applyResponse(record, cdpResponse.response);
      }
    });
  }

  /**
   * Setup loadingFinished event listener
   *
   * @param client
   */
  private setupLoadingFinished(client: CDP.Client): CdpClientSubscription {
    return client.Network.loadingFinished(cdpResponse => {
      const {requestId} = cdpResponse;
      const activity = this.networkActivities.find(a => a.requestId === requestId);

      if (activity) {
        activity.transferSize = cdpResponse.encodedDataLength;
      }

      this.finishRecord(client, requestId, cdpResponse.timestamp, {encodedDataLength: cdpResponse.encodedDataLength});
    });
  }

  /**
   * Setup loadingFailed event listener
   *
   * @param client
   */
  private setupLoadingFailed(client: CDP.Client): CdpClientSubscription {
    return client.Network.loadingFailed(cdpResponse => {
      const {requestId} = cdpResponse;
      const activity = this.networkActivities.find(a => a.requestId === requestId);

      if (activity) {
        activity.duration = Date.now() - (this.requestStartTimes.get(requestId) ?? Date.now());
      }

      this.finishRecord(client, requestId, cdpResponse.timestamp, {errorText: cdpResponse.errorText});
    });
  }

  /**
   * Record a new request. A redirect finishes the previous request of the same id with its response.
   *
   * @param client client of the target
   * @param event request event of CDP
   */
  private recordRequest(client: CDP.Client, event: Protocol.Network.RequestWillBeSentEvent): void {
    const running = this.runningRecords.get(client);
    const previous = running?.get(event.requestId);
    if (previous && event.redirectResponse) {
      this.applyResponse(previous, event.redirectResponse);
      previous.redirectURL = event.request.url;
      this.finishRecord(client, event.requestId, event.timestamp, {encodedDataLength: event.redirectResponse.encodedDataLength});
    }

    const record: NetworkRequestRecord = {
      requestId: event.requestId,
      url: event.request.url,
      method: event.request.method,
      requestHeaders: event.request.headers as Record<string, string>,
      resourceType: event.type ?? 'Other',
      documentUrl: event.documentURL,
      wallTime: event.wallTime,
      timestamp: event.timestamp,
    };
    running?.set(event.requestId, record);
    this.records.get(client)?.push(record);
  }

  /**
   * Add the response to a request
   *
   * @param record observed request
   * @param response response of CDP
   */
  private applyResponse(record: NetworkRequestRecord, response: Protocol.Network.Response): void {
    Object.assign(record, {
      status: response.status,
      statusText: response.statusText,
      responseHeaders: response.headers as Record<string, string>,
      mimeType: response.mimeType,
      protocol: response.protocol,
      timing: response.timing,
      fromCache: Boolean(response.fromDiskCache) || Boolean(response.fromPrefetchCache) || Boolean(response.fromServiceWorker),
    });
  }

  /**
   * Finish a running request
   *
   * @param client client of the target
   * @param requestId id of the request
   * @param timestamp monotonic end time in seconds
   * @param result transferred bytes or error of the request
   */
  private finishRecord(client: CDP.Client, requestId: string, timestamp: number, result: Pick<NetworkRequestRecord, 'encodedDataLength' | 'errorText'>): void {
    const running = this.runningRecords.get(client);
    const record = running?.get(requestId);
    if (!record) {
      return;
    }

    Object.assign(record, result, {endTimestamp: timestamp});
    running?.delete(requestId);
  }

  /**
   * Whether a request goes to a third party
   *
   * @param record observed request
   */
  private isThirdParty(record: NetworkRequestRecord): boolean {
    if (this.firstPartyHosts) {
      let hostname = '';
      try {
        ({hostname} = new URL(record.url));
      } catch {}

      return !this.firstPartyHosts.some(pattern => pattern.test(hostname));
    }

    const site = siteOf(record.url);
    return site !== '' && siteOf(record.documentUrl) !== '' && site !== siteOf(record.documentUrl);
  }

  /**
   * Requests and transferred bytes of third parties and per resource type of a client
   *
   * @param client client of the target
   */
  private calculateBreakdown(client: CDP.Client): NetworkBreakdownMetrics {
    const breakdown: NetworkBreakdownMetrics = {totalNetworkThirdPartyRequests: 0, totalNetworkThirdPartyTransferSize: 0};
    for (const record of this.records.get(client) ?? []) {
      const transferSize = record.fromCache ? 0 : (record.encodedDataLength ?? 0);
      const type = breakdownResourceTypes.has(record.resourceType) ? record.resourceType : 'Other';
      breakdown[`totalNetwork${type}Requests`] = (breakdown[`totalNetwork${type}Requests`] ?? 0) + 1;
      breakdown[`totalNetwork${type}TransferSize`] = (breakdown[`totalNetwork${type}TransferSize`] ?? 0) + transferSize;
      if (this.isThirdParty(record)) {
        breakdown.totalNetworkThirdPartyRequests++;
        breakdown.totalNetworkThirdPartyTransferSize += transferSize;
      }
    }

    return breakdown;
  }

  /**
   * Write the requests of a client since its latest start into a HAR file
   *
   * @param client client of the target
   * @param options options of the HAR export
   * @returns path of the file, or undefined without requests
   */
  private async writeHar(client: CDP.Client, options: NetworkHarOptions): Promise<string | undefined> {
    const start = this.startTimes.get(client) ?? 0;
    const records = (this.records.get(client) ?? [])
      .filter(record => record.wallTime >= start && (!this.harUrlFilter || this.harUrlFilter.test(record.url)));
    if (records.length === 0) {
      return undefined;
    }

    this.harCounter++;
    const timestamp = new Date().toISOString().replaceAll(':', '-');
    const filePath = path.join(options.outputDir, `${options.filePrefix ?? 'network'}-${timestamp}-${this.harCounter}.har`);
    const title = records.find(record => record.resourceType === 'Document')?.url ?? records[0].documentUrl;
    const har = buildHar(records, {id: `page_${this.harCounter}`, title}, harCreator);

    await fs.promises.mkdir(options.outputDir, {recursive: true});
    await fs.promises.writeFile(filePath, JSON.stringify(har));
    return filePath;
  }

  /**
   * Calculate aggregated metrics from collected activities
   */
  private calculateAggregatedMetrics(): NetworkAggregatedMetrics {
    return {
      totalNetworkRequests: this.networkActivities.length,
      totalNetworkTransferSize: this.networkActivities.reduce((sum, a) => sum + (a.transferSize ?? 0), 0),
      totalNetworkDuration: this.networkActivities.reduce((sum, a) => sum + (a.duration ?? 0), 0),
    };
  }
}
