import type CDP from 'chrome-remote-interface';
import {
  type ChromiumMetricObserver,
  type Metric,
} from '../../../types/index.js';
import {
  nativeChromiumPlugins,
} from '../plugins/index.js';

/**
 * Counters of the Performance domain that grow with a leak
 */
/* eslint-disable @typescript-eslint/naming-convention */
const growthMetrics = {
  JSHeapUsedSize: 'heapGrowthBytes',
  Nodes: 'nodeGrowth',
  JSEventListeners: 'listenerGrowth',
  Documents: 'documentGrowth',
} as const;
/* eslint-enable @typescript-eslint/naming-convention */

/**
 * Growth of the memory between start and stop, each measured after a garbage collection
 */
export type HeapGrowthResult = {
  /**
   * Bytes of the used JS heap that survived the garbage collection
   */
  heapGrowthBytes: number;
  nodeGrowth: number;
  listenerGrowth: number;

  /**
   * Documents, e.g. of removed iframes that are still referenced
   */
  documentGrowth: number;

  /**
   * Heap growth per second of the test or step
   */
  heapGrowthPerSecond: number;
};

/**
 * Measures how much memory a test or step keeps alive. Garbage is collected before the start and
 * the stop, so the growth is what survived. A growth that persists across repeats is a leak.
 */
export class HeapGrowthObserver implements ChromiumMetricObserver {
  public readonly name = 'heapGrowth';
  public readonly plugins = [
    nativeChromiumPlugins.performanceDomainPlugin,
    nativeChromiumPlugins.heapProfilerDomainPlugin,
    nativeChromiumPlugins.heapGarbageCollectorPlugin,
  ];

  /**
   * Values and time of the latest start per client
   */
  private readonly starts = new WeakMap<CDP.Client, {time: number; values: Record<string, number>}>();

  /**
   * @inheritdoc
   */
  async onStart(accumulator: Metric, developmentTools: CDP.Client): Promise<void> {
    this.starts.set(developmentTools, {time: Date.now(), values: await this.readCounters(developmentTools)});
  }

  /**
   * @inheritdoc
   */
  async onSampling(accumulator: Metric, developmentTools: CDP.Client): Promise<void> {}

  /**
   * @inheritdoc
   */
  async onStop(accumulator: Metric, developmentTools: CDP.Client): Promise<void> {
    const start = this.starts.get(developmentTools);
    if (!start) {
      return;
    }

    this.starts.delete(developmentTools);
    const values = await this.readCounters(developmentTools);
    const result: Partial<HeapGrowthResult> = {};
    for (const [counter, key] of Object.entries(growthMetrics)) {
      if (values[counter] !== undefined && start.values[counter] !== undefined) {
        result[key] = values[counter] - start.values[counter];
      }
    }

    const seconds = (Date.now() - start.time) / 1000;
    if (result.heapGrowthBytes !== undefined && seconds > 0) {
      result.heapGrowthPerSecond = result.heapGrowthBytes / seconds;
    }

    Object.assign(accumulator, result);
  }

  /**
   * Counters of the Performance domain
   *
   * @param client client of the target
   */
  private async readCounters(client: CDP.Client): Promise<Record<string, number>> {
    const {metrics} = await client.Performance.getMetrics();
    return Object.fromEntries(metrics.filter(metric => metric.name in growthMetrics).map(metric => [metric.name, metric.value]));
  }
}
