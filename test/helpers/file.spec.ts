import path from 'node:path';
import fs from 'node:fs';
import {writeReportToFile} from '../../src/helpers';

describe('File helpers', () => {
  describe('writeReportToFile', () => {
    beforeEach(() => {
      try {
        fs.rmSync(path.join(__dirname, 'output.json'));
      } catch {}
    });

    it('should write to file', () => {
      const input = {
        outputDir: __dirname,
        outputFile: 'output.json',
        content: {key: 'value'},
      };
      const result = writeReportToFile(input);

      expect(result).toEqual(true);
    });

    it('should fail when object is not serializable', () => {
      const input = {
        outputDir: __dirname,
        outputFile: 'output.json',
        content: {x: 2n},
      };
      const result = writeReportToFile(input);

      expect(result).toEqual(false);
    });
  });
});

