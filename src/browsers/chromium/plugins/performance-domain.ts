import {
  type MeasurePlugin,
} from '../../../types/index.js';

/**
 * Activates the `Performance.*` domain in CDP
 *
 * @param developmentTools client for CDP
 */
export const performanceDomainPlugin: MeasurePlugin = async developmentTools => new Promise(resolve => {
  developmentTools.send('Performance.enable', error => {
    resolve(Boolean(error));
  });
});
