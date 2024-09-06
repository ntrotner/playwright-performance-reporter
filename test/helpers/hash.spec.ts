import {md5} from '../../src/helpers';

describe('Hash helpers', () => {
  describe('md5', () => {
    it('should return the same hash for the same input', () => {
      const input = 'click login';

      expect(md5(input)).toEqual('5fff217726a0650689cbe22fb933e5de');
    });
  });
});

