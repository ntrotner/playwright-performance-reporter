import {
  Logger,
} from '../../src/helpers';

describe('Logger', () => {
  let log: jest.SpyInstance;

  beforeEach(() => {
    log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    log.mockRestore();
  });

  it.each([
    ['info', '[info]'],
    ['warning', '[warning]'],
    ['error', '[error]'],
  ] as const)('should log %s with prefix and level', (level, label) => {
    Logger[level]('message', 'a', 'b');

    expect(log).toHaveBeenCalledWith('[PerformanceLogger]', expect.any(String), label, 'message', 'a, b');
  });
});
