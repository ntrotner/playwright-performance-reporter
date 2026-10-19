import {
  heapGarbageCollectorPlugin,
} from './heap-garbage-collect.js';
import {
  heapProfilerDomainPlugin,
} from './heap-profiler-domain.js';
import {
  networkDomainPlugin,
} from './network-domain.js';
import {
  createThrottlingPlugin,
} from './throttling.js';
import {
  performanceDomainPlugin,
} from './performance-domain.js';
import {
  profilerDomainPlugin,
} from './profiler-domain.js';

export const nativeChromiumPlugins = {
  heapGarbageCollectorPlugin,
  heapProfilerDomainPlugin,
  networkDomainPlugin,
  performanceDomainPlugin,
  profilerDomainPlugin,
  createThrottlingPlugin,
} as const;
