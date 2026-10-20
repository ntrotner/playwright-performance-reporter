import fs from 'node:fs';
import path from 'node:path';
import type CDP from 'chrome-remote-interface';
import {
  type ChromiumMetricObserver,
  type Metric,
} from '../../../types/index.js';
import {
  nativeChromiumPlugins,
} from '../plugins/index.js';
import {
  assignConfig,
  diffHeapSnapshots,
  heapSnapshotIds,
  takeHeapSnapshot,
} from '../../../helpers/index.js';

/**
 * Options for the HeapDiffObserver
 */
export type HeapDiffObserverOptions = {
  /**
   * Amount of classes in `heapDiffTopClasses`. Defaults to 20.
   */
  topClasses: number;

  /**
   * Write the snapshot of the stop into `outputDir`, e.g. to inspect retainers in DevTools. Defaults to false.
   */
  writeSnapshots: boolean;

  /**
   * Folder of the snapshots. Defaults to `./heap`.
   */
  outputDir: string;
};

/**
 * Compares heap snapshots of the start and the stop, and reports the classes of the objects that were
 * added and survived the garbage collection. Snapshots stall the page, so use it to diagnose a leak.
 */
export class HeapDiffObserver implements ChromiumMetricObserver {
  public readonly name = 'heapDiff';
  public readonly plugins = [
    nativeChromiumPlugins.heapProfilerDomainPlugin,
    nativeChromiumPlugins.heapGarbageCollectorPlugin,
  ];

  private readonly options: HeapDiffObserverOptions = {
    topClasses: 20,
    writeSnapshots: false,
    outputDir: './heap',
  };

  /**
   * Node ids of the snapshot of the latest start per client, instead of the whole snapshot
   */
  private readonly startIds = new WeakMap<CDP.Client, Set<number>>();

  private snapshotCounter = 0;

  constructor(options?: Partial<HeapDiffObserverOptions>) {
    assignConfig(this.options, options);
  }

  /**
   * @inheritdoc
   */
  async onStart(accumulator: Metric, developmentTools: CDP.Client): Promise<void> {
    try {
      this.startIds.set(developmentTools, heapSnapshotIds(await takeHeapSnapshot(developmentTools)));
    } catch (error: unknown) {
      throw new Error(`HeapDiffObserver.onStart command failed: ${String(error)}`);
    }
  }

  /**
   * @inheritdoc
   */
  async onSampling(accumulator: Metric, developmentTools: CDP.Client): Promise<void> {}

  /**
   * @inheritdoc
   */
  async onStop(accumulator: Metric, developmentTools: CDP.Client): Promise<void> {
    const startIds = this.startIds.get(developmentTools);
    if (!startIds) {
      return;
    }

    this.startIds.delete(developmentTools);
    try {
      const snapshot = await takeHeapSnapshot(developmentTools);
      const diff = diffHeapSnapshots(startIds, snapshot, this.options.topClasses);
      Object.assign(accumulator, {
        heapDiffAddedObjects: diff.addedObjects,
        heapDiffAddedBytes: diff.addedBytes,
        heapDiffDetachedNodes: diff.detachedNodes,
        heapDiffTopClasses: JSON.stringify(diff.topClasses),
      });

      if (this.options.writeSnapshots) {
        this.snapshotCounter++;
        const timestamp = new Date().toISOString().replaceAll(':', '-');
        const heapDiffFile = path.join(this.options.outputDir, `heap-${timestamp}-${this.snapshotCounter}.heapsnapshot`);
        await fs.promises.mkdir(this.options.outputDir, {recursive: true});
        await fs.promises.writeFile(heapDiffFile, snapshot);
        accumulator.heapDiffFile = heapDiffFile;
      }
    } catch (error: unknown) {
      throw new Error(`HeapDiffObserver.onStop command failed: ${String(error)}`);
    }
  }
}
