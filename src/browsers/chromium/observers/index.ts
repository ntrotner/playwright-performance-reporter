import {
  AllPerformanceMetrics,
} from './all-performance-metrics.js';
import {
  CpuProfilerObserver,
} from './cpu-profiler.js';
import {
  HeapDump,
} from './heap-dump.js';
import {
  HeapObjectsTracking,
} from './heap-objects-tracking.js';
import {
  HeapProfilerSampling,
} from './heap-profiler-sampling.js';
import {
  LongTasksObserver,
} from './long-tasks.js';
import {
  NavigationTimingObserver,
} from './navigation-timing.js';
import {
  NetworkActivityObserver,
} from './network-activity.js';
import {
  RequestTimingObserver,
} from './request-timing.js';
import {
  ResourceTimingObserver,
} from './resource-timing.js';
import {
  TraceCaptureObserver,
} from './trace-capture.js';
import {
  TotalJsHeapSize,
} from './total-js-heap-size.js';
import {
  UsedJsHeapSize,
} from './used-js-heap-size.js';
import {
  WebVitalsObserver,
} from './web-vitals.js';

export const nativeChromiumObservers = {
  allPerformanceMetrics: AllPerformanceMetrics,
  cpuProfiler: CpuProfilerObserver,
  heapDump: HeapDump,
  heapObjectsTracking: HeapObjectsTracking,
  heapProfilerSampling: HeapProfilerSampling,
  longTasks: LongTasksObserver,
  navigationTiming: NavigationTimingObserver,
  networkActivity: NetworkActivityObserver,
  requestTiming: RequestTimingObserver,
  resourceTiming: ResourceTimingObserver,
  totalJsHeapSize: TotalJsHeapSize,
  traceCapture: TraceCaptureObserver,
  usedJsHeapSize: UsedJsHeapSize,
  webVitals: WebVitalsObserver,
} as const;
