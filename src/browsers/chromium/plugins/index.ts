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
  performanceDomainPlugin,
} from './performance-domain.js';

export const nativeChromiumPlugins = {
  heapGarbageCollectorPlugin,
  heapProfilerDomainPlugin,
  networkDomainPlugin,
  performanceDomainPlugin,
} as const;
