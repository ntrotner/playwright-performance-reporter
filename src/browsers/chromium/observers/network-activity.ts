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

/**
 * Options for the NetworkActivityObserver
 */
export type NetworkActivityObserverOptions = ObserverOptions & {
  /**
   * When true, sampling returns full details array. When false (default), only aggregated values.
   */
  includeDetailsInSampling?: boolean;
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
export type NetworkActivityResult = NetworkAggregatedMetrics & {
  networkActivities: NetworkActivity[];
};

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
  private isEnabled: boolean;

  constructor(protected options?: NetworkActivityObserverOptions) {
    this.includeDetailsInSampling = options?.includeDetailsInSampling ?? false;
    this.requestStartTimes = new Map<string, number>();
    this.requestMethods = new Map<string, string>();
    this.networkActivities = [];
    this.subscriptions = [];
    this.isEnabled = false;
  }

  /**
   * @inheritdoc
   */
  async onStart(accumulator: Metric, developmentTools: CDP.Client): Promise<void> {
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
  }

  /**
   * Common function for all lifecycle hooks
   */
  private common(accumulator: Metric, client: CDP.Client, includeDetails: boolean): void {
    if (!this.isEnabled) {
      this.setupListeners(client);
    }

    const result: NetworkActivityResult = {
      ...this.calculateAggregatedMetrics(),
      networkActivities: includeDetails ? [...this.networkActivities] : [],
    };

    Object.assign(accumulator, result);
  }

  /**
   * Setup network event listeners
   */
  private setupListeners(client: CDP.Client): void {
    this.isEnabled = true;

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
    });
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
