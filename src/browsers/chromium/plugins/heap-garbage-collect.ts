import {type MeasurePlugin} from '../../../types/index.js';

/**
 * Triggers the heap gargabe collection.
 * Requires the `HeapProfiler` to be activated
 *
 * @param developmentTools client for CDP
 */
export const heapGarbageCollectorPlugin: MeasurePlugin = async developmentTools => new Promise(resolve => {
  developmentTools.send('HeapProfiler.collectGarbage', error => {
    resolve(Boolean(error));
  });
});
