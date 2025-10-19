import type CDP from 'chrome-remote-interface';
import type Protocol from 'devtools-protocol/types/protocol';
import {
  type Metric,
  type MetricObserver,
} from '../../../types/index.js';
import {
  heapGarbageCollectorPlugin,
  heapProfilerDomainPlugin,
} from '../plugins/index.js';

export class HeapDump implements MetricObserver {
  public readonly name = 'heapDump';
  public readonly plugins = [
    heapProfilerDomainPlugin,
    heapGarbageCollectorPlugin,
  ];

  /**
   * Options to call `HeapProfiler.takeHeapSnapshot` which are mandatory to collect
   *
   * @private
   */
  private readonly takeHeapSnapshotOptions: Protocol.HeapProfiler.TakeHeapSnapshotRequest = {
    captureNumericValue: true,
    reportProgress: true,
    treatGlobalObjectsAsRoots: true,
  };

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
   * Common function for onStart and onStop hook
   */
  private async common(accumulator: Metric, client: CDP.Client) {
    return new Promise(async resolve => {
      const subscriptions: Array<() => void> = [];
      const chunks: string[] = [];

      try {
        subscriptions.push(this.listenForNextChunk(client, chunks));
        await Promise.all([
          this.waitForHeapDumpCompletion(client),
          this.takeHeapSnapshot(client),
        ]);
        accumulator.heap = chunks.join('');
      } catch {
        resolve(false);
      } finally {
        for (const subscription of subscriptions) {
          subscription();
        }
      }

      resolve(true);
    });
  }

  /**
   * Wrapper for `HeapProfiler.takeHeapSnapshot` and check if request was successful
   */
  private async takeHeapSnapshot(client: CDP.Client) {
    return new Promise(async (resolve, reject) => {
      try {
        await client.HeapProfiler.takeHeapSnapshot(this.takeHeapSnapshotOptions);
        resolve(true);
      } catch {
        reject(new Error('HeapProfiler.takeHeapSnapshot command failed'));
      }
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

  /**
   * Wrapper for `HeapProfiler.reportHeapSnapshotProgress` and report response continuously
   */
  private async waitForHeapDumpCompletion(client: CDP.Client) {
    return new Promise(resolve => {
      const unsubscribe = client.HeapProfiler.reportHeapSnapshotProgress(cdpResponse => {
        if (cdpResponse.finished) {
          unsubscribe();
          resolve(true);
        }
      });
    });
  }
}
