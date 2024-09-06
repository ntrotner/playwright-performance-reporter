import {
  buildTestCaseIdentifier,
  buildTestPerformance,
} from '../../src/helpers';

describe('TestCase helpers', () => {
  describe('buildTestPerformance', () => {
    it('should return a default object', () => {
      const name = 'stepName';
      const result = buildTestPerformance(name);

      expect(result.name).toEqual(name);
      expect(result.startMetrics.length).toEqual(0);
      expect(result.stopMetrics.length).toEqual(0);
    });
  });

  describe('buildTestCaseIdentifier', () => {
    it('should pass id and combine titlePath', () => {
      const input = {
        id: '123',
        titlePath: () => (['some', 'path']),
      };
      const result = buildTestCaseIdentifier(input as any);

      expect(result.id).toEqual(input.id);
      expect(result.name).toEqual('some > path');
    });

    it('should pass id and return empty string for empty titlePath', () => {
      const input = {
        id: '123',
        titlePath: () => ([]),
      };
      const result = buildTestCaseIdentifier(input as any);

      expect(result.id).toEqual(input.id);
      expect(result.name).toEqual('');
    });
  });
});

