/**
 * Custom network throughput and latency
 */
export type NetworkProfile = {
  /**
   * Added round trip latency of every request in milliseconds
   */
  latencyInMilliseconds: number;

  /**
   * Maximal download throughput in kilobits per second (1 kbit = 1024 bit)
   */
  downloadKilobitsPerSecond: number;

  /**
   * Maximal upload throughput in kilobits per second (1 kbit = 1024 bit)
   */
  uploadKilobitsPerSecond: number;
};

/**
 * Names of the predefined network profiles
 */
export const networkPresetNames = ['slow-3g', 'fast-3g', 'slow-4g', 'fast-4g', 'offline'] as const;
export type NetworkPresetName = typeof networkPresetNames[number];

/**
 * Conditions to measure under, e.g. to simulate a mid-range phone on a mobile network
 */
export type ThrottlingOptions = {
  /**
   * CPU slowdown factor, 1 is no slowdown. Lighthouse uses 4 for mobile.
   */
  cpuSlowdown?: number;

  /**
   * Predefined or custom network profile
   */
  network?: NetworkPresetName | NetworkProfile;

  /**
   * Disable the HTTP cache to measure a cold cache. Defaults to false.
   */
  disableCache?: boolean;
};

/**
 * Validated conditions with the network profile resolved
 */
export type AppliedConditions = {
  cpuSlowdown: number;
  network?: NetworkProfile & {
    /**
     * Name of the preset, or `custom`
     */
    name: string;
    offline: boolean;
  };
  disableCache: boolean;

  /**
   * Human readable summary, identical for identical conditions
   */
  description: string;
};
