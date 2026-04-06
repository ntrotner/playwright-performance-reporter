import {
  type ChromiumMeasurePlugin,
} from '../../../types/index.js';

/**
 * Activates the `Network.*` domain in CDP
 *
 * @param developmentTools client for CDP
 */
export const networkDomainPlugin: ChromiumMeasurePlugin = async developmentTools => new Promise(resolve => {
  developmentTools.send('Network.enable', error => {
    resolve(Boolean(error));
  });
});
