import {sanitizeStringInput} from '../../src/helpers';

describe('Sanitizer helpers', () => {
  describe('sanitizeStringInput', () => {
    it('should return empty if prohibited key is used', () => {
      const prohibitedKeys = ['__proto__', 'constructor', 'prototype'];

      for (const key of prohibitedKeys) {
        expect(sanitizeStringInput(key)).toEqual('');
      }
    });

    it('should pass the key that is not prohibited', () => {
      const allowedKeys = ['title', 'name', 'id'];

      for (const key of allowedKeys) {
        expect(sanitizeStringInput(key)).toEqual(key);
      }
    });
  });
});

