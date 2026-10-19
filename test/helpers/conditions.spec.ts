import {
  networkPresets,
  resolveConditions,
} from '../../src/helpers/index.js';
import {
  type ThrottlingOptions,
} from '../../src/types/index.js';

describe('Conditions', () => {
  it('should resolve nothing without throttling', () => {
    expect(resolveConditions(undefined)).toBeUndefined();
    expect(resolveConditions({})).toBeUndefined();
    expect(resolveConditions({cpuSlowdown: 1, disableCache: false})).toBeUndefined();
  });

  it('should resolve a network preset and describe the conditions', () => {
    expect(resolveConditions({cpuSlowdown: 4, network: 'slow-4g', disableCache: true})).toEqual({
      cpuSlowdown: 4,
      disableCache: true,
      network: {name: 'slow-4g', offline: false, ...networkPresets['slow-4g']},
      description: 'CPU 4x slowdown, network slow-4g (562.5 ms, 1474.56/675 kbit/s), cache disabled',
    });
  });

  it('should resolve a custom network profile and offline', () => {
    expect(resolveConditions({network: {latencyInMilliseconds: 100, downloadKilobitsPerSecond: 2000, uploadKilobitsPerSecond: 500}})).toEqual(expect.objectContaining({
      cpuSlowdown: 1,
      network: {
        name: 'custom', offline: false, latencyInMilliseconds: 100, downloadKilobitsPerSecond: 2000, uploadKilobitsPerSecond: 500,
      },
      description: 'network custom (100 ms, 2000/500 kbit/s)',
    }));
    expect(resolveConditions({network: 'offline'})).toEqual(expect.objectContaining({
      network: expect.objectContaining({name: 'offline', offline: true}),
      description: 'network offline',
    }));
  });

  it('should describe identical conditions identically', () => {
    expect(resolveConditions({network: 'fast-4g', cpuSlowdown: 2})?.description).toEqual(resolveConditions({cpuSlowdown: 2, network: 'fast-4g'})?.description);
  });

  it.each<[string, ThrottlingOptions]>([
    ['a slowdown below 1', {cpuSlowdown: 0.5}],
    ['a slowdown that is not finite', {cpuSlowdown: Number.NaN}],
    ['an unknown preset', {network: 'dial-up' as 'slow-3g'}],
    ['a negative latency', {network: {latencyInMilliseconds: -1, downloadKilobitsPerSecond: 1, uploadKilobitsPerSecond: 1}}],
  ])('should throw on %s', (_, conditions) => {
    expect(() => resolveConditions(conditions)).toThrow('Invalid conditions');
  });
});
