import {
  AllPerformanceMetrics,
} from './all-performance-metrics.js';
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
  TotalJsHeapSize,
} from './total-js-heap-size.js';
import {
  UsedJsHeapSize,
} from './used-js-heap-size.js';

export const nativeChromiumObservers = {
  allPerformanceMetrics: AllPerformanceMetrics,
  heapDump: HeapDump,
  heapObjectsTracking: HeapObjectsTracking,
  heapProfilerSampling: HeapProfilerSampling,
  totalJsHeapSize: TotalJsHeapSize,
  usedJsHeapSize: UsedJsHeapSize,
} as const;
