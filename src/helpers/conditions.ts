import {
  type AppliedConditions,
  type NetworkPresetName,
  type NetworkProfile,
  type ThrottlingOptions,
} from '../types/index.js';
// Imported from its module, as the types index loads the observers, which depend on the helpers
import {
  networkPresetNames,
} from '../types/conditions.js';

/**
 * Network profiles of Chrome DevTools and Lighthouse
 * - slow-3g, fast-3g, fast-4g: presets of the DevTools network panel
 * - slow-4g: applied throttling of Lighthouse for mobile
 */
export const networkPresets: Record<Exclude<NetworkPresetName, 'offline'>, NetworkProfile> = {
  'slow-3g': {latencyInMilliseconds: 2000, downloadKilobitsPerSecond: 400, uploadKilobitsPerSecond: 400},
  'fast-3g': {latencyInMilliseconds: 562.5, downloadKilobitsPerSecond: 1440, uploadKilobitsPerSecond: 675},
  'slow-4g': {latencyInMilliseconds: 562.5, downloadKilobitsPerSecond: 1474.56, uploadKilobitsPerSecond: 675},
  'fast-4g': {latencyInMilliseconds: 165, downloadKilobitsPerSecond: 8100, uploadKilobitsPerSecond: 1350},
};

/**
 * Description of a run without throttling
 */
export const unthrottledDescription = 'unthrottled';

/**
 * Throw on conditions that can't be applied
 *
 * @param conditions throttling options
 */
function validateConditions(conditions: ThrottlingOptions): void {
  const {cpuSlowdown, network} = conditions;
  if (cpuSlowdown !== undefined && (!Number.isFinite(cpuSlowdown) || cpuSlowdown < 1)) {
    throw new Error('Invalid conditions: "cpuSlowdown" must be a finite number of at least 1');
  }

  if (typeof network === 'string' && !(networkPresetNames as readonly string[]).includes(network)) {
    throw new Error(`Invalid conditions: unknown network preset "${network}", use one of ${networkPresetNames.join(', ')}`);
  }

  if (typeof network === 'object') {
    for (const [key, value] of Object.entries(network)) {
      if (!Number.isFinite(value) || value < 0) {
        throw new Error(`Invalid conditions: "network.${key}" must be a finite number of at least 0`);
      }
    }
  }
}

/**
 * Human readable summary of the conditions
 *
 * @param conditions validated conditions
 */
function describe(conditions: Omit<AppliedConditions, 'description'>): string {
  const parts: string[] = [];
  if (conditions.cpuSlowdown > 1) {
    parts.push(`CPU ${conditions.cpuSlowdown}x slowdown`);
  }

  if (conditions.network?.offline) {
    parts.push('network offline');
  } else if (conditions.network) {
    const {name, latencyInMilliseconds, downloadKilobitsPerSecond, uploadKilobitsPerSecond} = conditions.network;
    parts.push(`network ${name} (${latencyInMilliseconds} ms, ${downloadKilobitsPerSecond}/${uploadKilobitsPerSecond} kbit/s)`);
  }

  if (conditions.disableCache) {
    parts.push('cache disabled');
  }

  return parts.length > 0 ? parts.join(', ') : unthrottledDescription;
}

/**
 * Validate the conditions and resolve the network profile
 *
 * @param conditions throttling options
 * @returns resolved conditions or undefined if nothing is throttled
 */
export function resolveConditions(conditions: ThrottlingOptions | undefined): AppliedConditions | undefined {
  if (!conditions) {
    return undefined;
  }

  validateConditions(conditions);
  const {network} = conditions;
  const resolved: Omit<AppliedConditions, 'description'> = {
    cpuSlowdown: conditions.cpuSlowdown ?? 1,
    disableCache: conditions.disableCache ?? false,
  };

  if (network === 'offline') {
    resolved.network = {
      name: 'offline', offline: true, latencyInMilliseconds: 0, downloadKilobitsPerSecond: 0, uploadKilobitsPerSecond: 0,
    };
  } else if (typeof network === 'string') {
    resolved.network = {name: network, offline: false, ...networkPresets[network]};
  } else if (network) {
    resolved.network = {name: 'custom', offline: false, ...network};
  }

  const description = describe(resolved);
  return description === unthrottledDescription ? undefined : {...resolved, description};
}
