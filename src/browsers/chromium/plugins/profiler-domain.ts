import {
  type ChromiumMeasurePlugin,
} from '../../../types/index.js';

/**
 * Activates the `Profiler.*` domain in CDP
 *
 * @param developmentTools client for CDP
 */
export const profilerDomainPlugin: ChromiumMeasurePlugin = async developmentTools => new Promise(resolve => {
  developmentTools.send('Profiler.enable', error => {
    resolve(Boolean(error));
  });
});
