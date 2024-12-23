import CDP from 'chrome-remote-interface';
import {type BrowserClient} from '../client.js';
import {
  type Metrics,
  type SupportedBrowsers,
  type ChromiumSupportedMetrics,
  type MetricObserver,
  type HookOrder,
  type OnStartMeasure,
  type OnStopMeasure,
  type TargetMetric,
} from '../../types/index.js';
import {Lock} from '../../helpers/index.js';
import {
  AllPerformanceMetrics,
  HeapDump,
  TotalJsHeapSize,
  UsedJsHeapSize,
} from './observers/index.js';

export class ChromiumDevelopmentTools implements BrowserClient {
  /**
   * Chrome dev tools protocol client
   */
  private readonly clients: Record<string, CDP.Client> = {};

  /**
   * Chrome dev tools target for metadata extraction
   */
  private readonly targets: Record<string, CDP.Target> = {};

  /**
   * Lock to indicate if connection request is going on
   */
  private readonly connectLock = new Lock();

  /**
   * @inheritdoc
   */
  constructor(private readonly options: Record<string, any>) {}

  /**
   * @inheritdoc
   */
  public async connect() {
    let unlockCallback;
    while (!unlockCallback) {
      unlockCallback = this.connectLock.lock();
    }

    try {
      const customOptions = this.buildOptions();
      const targetList = await CDP.List(customOptions);
      await Promise.allSettled(targetList.map(async target => this.connectToTarget(target)));
    } catch {}

    unlockCallback();
  }

  /**
   * @inheritdoc
   */
  public async getMetric(metric: ChromiumSupportedMetrics, hookOrder: HookOrder): Promise<TargetMetric[]> {
    return new Promise(async resolve => {
      let newConnectionRequests: Promise<void> | undefined;
      if (this.connectLock.isLocked()) {
        await this.connectLock.notifyOnUnlock();
      } else {
        newConnectionRequests = this.connect();
      }

      const currentAvailableTargets = Object.keys(this.clients);
      const targetMetric: Record<string, TargetMetric> = {};
      const metricRequests = [];

      // Get metrics from available targets
      metricRequests.push(
        ...currentAvailableTargets.map(async targetId => this.runPredefinedMetricFetch(targetId, targetMetric, metric, hookOrder)),
      );

      // Check if new targets were yielded from connection
      await newConnectionRequests;
      const newTargets = Object.keys(this.clients).filter(targetId => !currentAvailableTargets.includes(targetId));
      if (newTargets.length > 0) {
        metricRequests.push(
          ...newTargets.map(async targetId => this.runPredefinedMetricFetch(targetId, targetMetric, metric, hookOrder)),
        );
      }

      // Wait for metric request to be done and fill targets with metadata
      await Promise.allSettled(metricRequests);
      for (const targetId of Object.keys(targetMetric)) {
        Object.assign(targetMetric[targetId], {...this.targets[targetId]});
      }

      resolve(Object.values(targetMetric));
    });
  }

  /**
   * @inheritdoc
   */
  public async runCustomObserver(observer: OnStartMeasure | OnStopMeasure): Promise<TargetMetric[]> {
    return new Promise(async resolve => {
      const targetMetric: TargetMetric[] = [];
      await this.connect();

      await Promise.allSettled(
        Object.keys(this.clients).map(async targetId => {
          const newTargetMetric: TargetMetric = {
            ...this.targets[targetId],
            metric: {},
          };

          const client = this.clients[targetId];
          if (!client) {
            return;
          }

          await observer(newTargetMetric.metric, client);
          targetMetric.push(newTargetMetric);
        }),
      );

      resolve(targetMetric);
    });
  }

  /**
   * Cleans up client connection.
   * If `targetId` is not provided, then all clients are destroyed.
   *
   * @param {string=} targetId id to indicate which client to destroy
   */
  public async destroy(targetId?: string) {
    const listOfClients: string[] = [];

    if (targetId) {
      listOfClients.push(targetId);
    } else {
      listOfClients.push(...Object.keys(this.clients));
    }

    for (const id of listOfClients) {
      const client = this.clients[id];
      if (!client) {
        continue;
      }

      try {
        client.send('IO.close', () => {});
      } catch {}

      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete this.clients[id];
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete this.targets[id];
    }
  }

  /**
   * @inheritdoc
   */
  public getBrowserName(): SupportedBrowsers {
    return 'chromium';
  }

  /**
   * Fetch metric for a target
   *
   * @param targetId target to fill
   * @param targetMetric mapping of all targets
   * @param metric type of metric
   * @param hookOrder hook order
   */
  private async runPredefinedMetricFetch(targetId: string, targetMetric: Record<string, TargetMetric>, metric: ChromiumSupportedMetrics, hookOrder: HookOrder): Promise<void> {
    const newTargetMetric: TargetMetric = {
      metric: {},
    };

    const mapping = this.mapMetric(metric);
    const client = this.clients[targetId];
    if (!mapping || !client) {
      return;
    }

    await this.activateDomain(targetId, mapping);
    await mapping[hookOrder](newTargetMetric.metric, client);
    targetMetric[targetId] = newTargetMetric;
  }

  /**
   * Builds options object to use for CDP
   *
   * @param {string=} targetId id to specify target to run CDP on
   */
  private buildOptions(targetId?: string): CDP.Options {
    const options: CDP.Options = {
      host: 'localhost',
      port: 9222,
    };

    for (const argument of ((this.options.launchOptions?.args ?? []) as string[])) {
      if (argument.includes('--remote-debugging-port')) {
        const port = argument.split('=')[1].trim();
        options.port = Number(port);
      }
    }

    if (targetId) {
      options.target = targetId;
    }

    return options;
  }

  /**
   * Check client to target and create new connection if not available
   *
   * @param target reference to run CDP commands on
   */
  private async connectToTarget(target: CDP.Target) {
    if (this.clients[target.id]) {
      this.targets[target.id] = target;
      return;
    }

    try {
      const customOptions = this.buildOptions(target.id);
      this.clients[target.id] = await CDP(customOptions);
      this.targets[target.id] = target;
      this.clients[target.id].on('disconnect', async () => {
        await this.destroy(target.id);
      });
    } catch {}
  }

  /**
   * Provide observer to collect metric
   *
   * @param metric observer to create
   */
  private mapMetric(metric: Metrics & ChromiumSupportedMetrics): MetricObserver | undefined {
    switch (metric) {
      case 'usedJsHeapSize': {
        return new UsedJsHeapSize();
      }

      case 'totalJsHeapSize': {
        return new TotalJsHeapSize();
      }

      case 'allPerformanceMetrics': {
        return new AllPerformanceMetrics();
      }

      case 'heapDump': {
        return new HeapDump();
      }
    }
  }

  /**
   * Activate performance metric collection
   *
   * @param targetId id to start performance on
   */
  private async startPerformance(targetId: string): Promise<boolean> {
    return new Promise(resolve => {
      const client = this.clients[targetId];
      if (!client) {
        resolve(false);
        return;
      }

      client.send('Performance.enable', error => {
        resolve(Boolean(error));
      });
    });
  }

  /**
   * Activate heap metric collection
   *
   * @param targetId id to start heap on
   */
  private async startHeapProfiler(targetId: string): Promise<boolean> {
    return new Promise(resolve => {
      const client = this.clients[targetId];
      if (!client) {
        resolve(false);
        return;
      }

      client.send('HeapProfiler.enable', error => {
        resolve(Boolean(error));
      });
    });
  }

  /**
   * Setup domain which need a setup
   *
   * @param targetId id to start performance on
   * @param metricObserver observer that will be executed
   */
  private async activateDomain(targetId: string, metricObserver: MetricObserver): Promise<void> {
    if (['totalJsHeapSize', 'usedJsHeapSize', 'allPerformanceMetrics'].includes(metricObserver.name)) {
      await this.startPerformance(targetId);
    }

    if (['heapDump'].includes(metricObserver.name)) {
      await this.startHeapProfiler(targetId);
    }
  }
}
