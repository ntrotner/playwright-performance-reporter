import {
  type ChromiumMeasurePlugin,
} from '../../../types/index.js';

/**
 * Activates the `HeapProfiler.*` domain in CDP
 *
 * @param developmentTools client for CDP
 */
export const heapProfilerDomainPlugin: ChromiumMeasurePlugin = async developmentTools => new Promise(resolve => {
  developmentTools.send('HeapProfiler.enable', error => {
    resolve(Boolean(error));
  });
});
