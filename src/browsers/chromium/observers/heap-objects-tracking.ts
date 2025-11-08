import type CDP from 'chrome-remote-interface';
import type Protocol from 'devtools-protocol';
import {
  type Metric,
  type MetricObserver,
} from '../../../types/index.js';
import {
  heapGarbageCollectorPlugin,
  heapProfilerDomainPlugin,
} from '../plugins/index.js';

export class HeapObjectsTracking implements MetricObserver {
  public readonly name = 'heapObjectsTracking';
  public readonly separator = '';
  public readonly plugins = [
    heapProfilerDomainPlugin,
    heapGarbageCollectorPlugin,
  ];

  /**
   * Options to call `HeapProfiler.startTrackingHeapObjects` which are mandatory to collect
   *
   * @private
   */
  private readonly startTrackingHeapObjectsOptions: Protocol.HeapProfiler.StartTrackingHeapObjectsRequest = {
    trackAllocations: true,
  };

  /**
   * @inheritdoc
   */
  async onStart(accumulator: Metric, developmentTools: CDP.Client): Promise<void> {
    return new Promise(async (resolve, reject) => {
      try {
        await developmentTools.HeapProfiler.startTrackingHeapObjects(this.startTrackingHeapObjectsOptions);
      } catch {
        reject(new Error('HeapProfiler.startTrackingHeapObjects command failed'));
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
      const subscriptions: Array<() => void> = [];
      const chunks: string[] = [];

      try {
        subscriptions.push(this.listenForNextChunk(developmentTools, chunks));
        await this.stopTrackingHeapObjects(developmentTools);
        accumulator.heapObjectsTracking = chunks.join('');
      } catch {} finally {
        for (const subscription of subscriptions) {
          subscription();
        }
      }

      resolve();
    });
  }

  /**
   * Wrapper for `HeapProfiler.addHeapSnapshotChunk` and report response continuously
   */
  private listenForNextChunk(client: CDP.Client, chunkAggregation: string[]) {
    const unsubscribe = client.HeapProfiler.addHeapSnapshotChunk(cdpResponse => {
      chunkAggregation.push(cdpResponse.chunk);
    });

    return unsubscribe;
  }

  private async stopTrackingHeapObjects(developmentTools: CDP.Client): Promise<void> {
    return new Promise(async (resolve, reject) => {
      try {
        await developmentTools.HeapProfiler.stopTrackingHeapObjects();
      } catch {
        reject(new Error('HeapProfiler.stopSampling command failed'));
      }

      resolve();
    });
  }
}
