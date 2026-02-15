import type CDP from 'chrome-remote-interface';
import {
  type Metric,
  type MetricObserver,
} from '../../../types/index.js';
import {
  nativeChromiumPlugins,
} from '../plugins/index.js';

export class HeapProfilerSampling implements MetricObserver {
  public readonly name = 'heapProfilerSampling';
  public readonly plugins = [
    nativeChromiumPlugins.heapProfilerDomainPlugin,
    nativeChromiumPlugins.heapGarbageCollectorPlugin,
  ];

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
