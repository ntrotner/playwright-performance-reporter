import {sanitizeStringInput} from "../../src/helpers";

describe('Playwright Performance Reporter', () => {
  describe('sanitizeStringInput', () => {
    it('should return empty if prohibited key is used', () => {
      const prohibitedKeys = ['__proto__', 'constructor', 'prototype'];

      prohibitedKeys.forEach(key => {
        expect(sanitizeStringInput(key)).toEqual('')
      })
    })
  });
});

