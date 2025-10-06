import type CDP from 'chrome-remote-interface';
import {
  type Metric,
  type MetricObserver,
} from '../../../types/index.js';
import {
  heapGarbageCollectorPlugin,
  heapProfilerDomainPlugin,
} from '../plugins/index.js';

export class HeapDumpSampling implements MetricObserver {
  public readonly name = 'heapDumpSampling';
  public readonly plugins = [
    heapProfilerDomainPlugin,
    heapGarbageCollectorPlugin,
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
        accumulator.heapSampling = JSON.stringify(stopSamplingResponse.profile);
      } catch {
        reject(new Error('HeapProfiler.stopSampling command failed'));
      }

      resolve();
    });
  }
}
