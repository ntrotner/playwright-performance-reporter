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
import {
  microsecondsToMilliseconds,
  enhanceGarbageCollectionPlugin,
  assignConfig,
  Lock,
} from '../../../helpers/index.js';

/**
 * Options for the CpuProfilerObserver
 */
export type CpuProfilerObserverOptions = ObserverOptions & {
  /**
   * Sampling interval of the V8 CPU profiler in microseconds.
   */
  samplingIntervalInMicroseconds: number;
};

/**
 * General CPU usage of a profile, all times in milliseconds
 */
export type CpuProfileSummary = {
  /**
   * Duration of the profile
   */
  cpuProfileDuration: number;
  cpuProfileSampleCount: number;

  /**
   * Time the CPU was not idle
   */
  cpuProfileActiveTime: number;

  /**
   * Time spent executing JavaScript
   */
  cpuProfileScriptTime: number;

  /**
   * Time spent in garbage collection
   */
  cpuProfileGarbageCollectorTime: number;

  /**
   * Time spent in native browser code
   */
  cpuProfileProgramTime: number;

  /**
   * Time the CPU was idle
   */
  cpuProfileIdleTime: number;
};

export class CpuProfilerObserver implements ChromiumMetricObserver {
  public readonly name = 'cpuProfiler';
  public readonly plugins = [
    nativeChromiumPlugins.profilerDomainPlugin,
  ];

  private readonly options: CpuProfilerObserverOptions = {
    triggerGarbageCollectionOnObserve: true,
    samplingIntervalInMicroseconds: 1000,
  };

  private readonly startLock = new Lock();

  constructor(options?: Partial<CpuProfilerObserverOptions>) {
    assignConfig(this.options, options);
    enhanceGarbageCollectionPlugin(nativeChromiumPlugins.heapGarbageCollectorPlugin, this, this.options);
  }

  /**
   * @inheritdoc
   */
  async onStart(accumulator: Metric, developmentTools: CDP.Client): Promise<void> {
    const unlock = this.startLock.lock();
    if (!unlock) {
      throw new Error('CpuProfilerObserver.onStart command failed: Start already running');
    }

    try {
      await developmentTools.Profiler.setSamplingInterval({interval: this.options.samplingIntervalInMicroseconds});
    } catch (error: unknown) {
      unlock();
      throw new Error(`CpuProfilerObserver.onStart command failed: ${String(error)}`);
    }

    try {
      await developmentTools.Profiler.start();
    } catch (error: unknown) {
      throw new Error(`CpuProfilerObserver.onStart command failed: ${String(error)}`);
    } finally {
      unlock();
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
    try {
      const {profile} = await developmentTools.Profiler.stop();
      Object.assign(accumulator, this.summarizeCpuProfile(profile));
    } catch (error: unknown) {
      throw new Error(`CpuProfilerObserver.onStop command failed: ${String(error)}`);
    }
  }

  /**
   * Condense a V8 CPU profile into the time spent per category
   *
   * @param profile V8 CPU profile
   */
  private summarizeCpuProfile(profile: Protocol.Profiler.Profile): CpuProfileSummary {
    const functionNames = new Map(profile.nodes.map(node => [node.id, node.callFrame.functionName]));
    const samples = profile.samples ?? [];
    const timeDeltas = profile.timeDeltas ?? [];
    const times = {
      script: 0, garbageCollector: 0, program: 0, idle: 0,
    };

    let timestamp = profile.startTime;
    for (const [index, nodeId] of samples.entries()) {
      timestamp += timeDeltas[index] ?? 0;
      const nextTimestamp = index + 1 < samples.length ? timestamp + (timeDeltas[index + 1] ?? 0) : profile.endTime;
      const duration = Math.max(0, nextTimestamp - timestamp);
      const functionName = functionNames.get(nodeId);

      switch (functionName) {
        case '(idle)': {
          times.idle += duration;
          break;
        }

        case '(garbage collector)': {
          times.garbageCollector += duration;
          break;
        }

        case '(program)':
        case '(root)': {
          times.program += duration;
          break;
        }

        case undefined: {
          times.script += duration;
          break;
        }

        default: {
          times.script += duration;
        }
      }
    }

    return {
      cpuProfileDuration: microsecondsToMilliseconds(profile.endTime - profile.startTime),
      cpuProfileSampleCount: samples.length,
      cpuProfileActiveTime: microsecondsToMilliseconds(times.script + times.garbageCollector + times.program),
      cpuProfileScriptTime: microsecondsToMilliseconds(times.script),
      cpuProfileGarbageCollectorTime: microsecondsToMilliseconds(times.garbageCollector),
      cpuProfileProgramTime: microsecondsToMilliseconds(times.program),
      cpuProfileIdleTime: microsecondsToMilliseconds(times.idle),
    };
  }
}
