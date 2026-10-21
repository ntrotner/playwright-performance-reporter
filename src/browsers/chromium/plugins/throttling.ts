import {
  type AppliedConditions,
  type ChromiumMeasurePlugin,
} from '../../../types/index.js';

/**
 * Convert kilobits per second into bytes per second, as expected by CDP.
 * Uses 1 kbit = 1024 bit like Lighthouse.
 *
 * @param kilobitsPerSecond throughput
 */
function toBytesPerSecond(kilobitsPerSecond: number): number {
  return kilobitsPerSecond * 1024 / 8;
}

/**
 * Creates a plugin that applies CPU and network throttling to a target
 *
 * @param conditions resolved throttling conditions
 */
export function createThrottlingPlugin(conditions: AppliedConditions): ChromiumMeasurePlugin {
  return async developmentTools => {
    if (conditions.cpuSlowdown > 1) {
      await developmentTools.send('Emulation.setCPUThrottlingRate', {rate: conditions.cpuSlowdown});
    }

    if (conditions.network !== undefined || conditions.disableCache) {
      await developmentTools.send('Network.enable');
    }

    if (conditions.network) {
      await developmentTools.send('Network.emulateNetworkConditions', {
        offline: conditions.network.offline,
        latency: conditions.network.latencyInMilliseconds,
        downloadThroughput: conditions.network.offline ? 0 : toBytesPerSecond(conditions.network.downloadKilobitsPerSecond),
        uploadThroughput: conditions.network.offline ? 0 : toBytesPerSecond(conditions.network.uploadKilobitsPerSecond),
      });
    }

    if (conditions.disableCache) {
      await developmentTools.send('Network.setCacheDisabled', {cacheDisabled: true});
    }
  };
}
