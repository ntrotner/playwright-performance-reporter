import {buildTestStepIdentifier} from '../../src/helpers';

describe('TestStep helpers', () => {
  describe('buildTestStepIdentifier', () => {
    it('should pass id and combine titlePath', () => {
      const input = {
        id: '123',
        startTime: 0,
        titlePath: () => (['some', 'path']),
      };
      const result = buildTestStepIdentifier(input as any);

      expect(result.id).toEqual('9e1c2ace42e367df26a385d3ea20ccf7');
      expect(result.name).toEqual('some > path');
    });

    it('should pass id and return empty string for empty titlePath', () => {
      const input = {
        id: '123',
        startTime: 0,
        titlePath: () => ([]),
      };
      const result = buildTestStepIdentifier(input as any);

      expect(result.id).toEqual('cfcd208495d565ef66e7dff9f98764da');
      expect(result.name).toEqual('');
    });
  });
});

