import type CDP from 'chrome-remote-interface';
import {
  type ChromiumMetricObserver,
  type Metric,
  type ObserverOptions,
} from '../../../types/index.js';
import {
  nativeChromiumPlugins,
} from '../plugins/index.js';
import {
  enhanceGarbageCollectionPlugin,
} from '../../../helpers/index.js';

export class HeapProfilerSampling implements ChromiumMetricObserver {
  public readonly name = 'heapProfilerSampling';
  public readonly plugins = [
    nativeChromiumPlugins.heapProfilerDomainPlugin,
  ];

  constructor(protected options?: ObserverOptions) {
    enhanceGarbageCollectionPlugin(nativeChromiumPlugins.heapGarbageCollectorPlugin, this, this.options);
  }

  /**
   * @inheritdoc
   */
  async onStart(accumulator: Metric, developmentTools: CDP.Client): Promise<void> {
    return new Promise(async (resolve, reject) => {
      try {
        await developmentTools.HeapProfiler.startSampling();
      } catch {
        reject(new Error('HeapProfiler.startSampling command failed'));
      }

      resolve();
    });
  }

  /**
   * @inheritdoc
   */
  async onSampling(accumulator: Metric, developmentTools: CDP.Client): Promise<void> {}

  /**
   * @inheritdoc
   */
  async onStop(accumulator: Metric, developmentTools: CDP.Client): Promise<void> {
    return new Promise(async (resolve, reject) => {
      try {
        const stopSamplingResponse = await developmentTools.HeapProfiler.stopSampling();
        accumulator.heapProfilerSampling = JSON.stringify(stopSamplingResponse.profile);
      } catch {
        reject(new Error('HeapProfiler.stopSampling command failed'));
      }

      resolve();
    });
  }
}
