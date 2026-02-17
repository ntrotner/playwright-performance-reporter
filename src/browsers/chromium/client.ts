import CDP from 'chrome-remote-interface';
import {
  type BrowserClient,
} from '../client.js';
import {
  type SupportedBrowsers,
  type HookOrder,
  type TargetMetric,
  type ChromiumMetricObserver,
} from '../../types/index.js';
import {
  Lock,
  Logger,
} from '../../helpers/index.js';

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
   * Indicates if all options are correctly set for connection
   */
  private areClientOptionsValid = false;

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
  public async getMetric(metric: ChromiumMetricObserver, hookOrder: HookOrder): Promise<TargetMetric[]> {
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
      metricRequests.push(...currentAvailableTargets.map(async targetId => this.runPredefinedMetricFetch(targetId, targetMetric, metric, hookOrder)));

      // Check if new targets were yielded from connection
      await newConnectionRequests;
      const newTargets = Object.keys(this.clients).filter(targetId => !currentAvailableTargets.includes(targetId));
      if (newTargets.length > 0) {
        metricRequests.push(...newTargets.map(async targetId => this.runPredefinedMetricFetch(targetId, targetMetric, metric, hookOrder)));
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
   * @param metric type of metric or observer
   * @param hookOrder hook order
   */
  private async runPredefinedMetricFetch(targetId: string, targetMetric: Record<string, TargetMetric>, metric: ChromiumMetricObserver, hookOrder: HookOrder): Promise<void> {
    const newTargetMetric: TargetMetric = {
      metric: {},
    };

    const client = this.clients[targetId];
    if (!client) {
      return;
    }

    await this.runPlugins(targetId, metric);
    await metric[hookOrder](newTargetMetric.metric, client);
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

    let foundPort = false;
    for (const argument of ((this.options.launchOptions?.args ?? []) as string[])) {
      if (argument.includes('--remote-debugging-port')) {
        const port = argument.split('=')[1].trim();
        options.port = Number(port);
        foundPort = true;
      }
    }

    if (!this.areClientOptionsValid && foundPort) {
      Logger.info('Port for Chromium found', options.port);
      this.areClientOptionsValid = true;
    } else if (!this.areClientOptionsValid && !foundPort) {
      Logger.error('Port for Chromium not found. Metrics fetch will not work!');
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
   * Runs every plugin for a metric.
   *
   * @param targetId target to fill
   * @param metric
   */
  private async runPlugins(targetId: string, metric: ChromiumMetricObserver) {
    const client = this.clients[targetId];
    if (!client) {
      return;
    }

    for (const plugin of metric.plugins) {
      try {
        // Plugins can depend on the execution order
        // eslint-disable-next-line no-await-in-loop
        await plugin(client);
      } catch {}
    }
  }
}
