import {JsonChunkWriter} from '../../src/helpers';
import path from "node:path";
import fs from "node:fs";

describe('Json chunk writer helpers', () => {
  describe('JsonChunkWriter', () => {
    let jsonChunkWriter: JsonChunkWriter;

    beforeEach(() => {
      try {
        fs.rmSync(path.join(__dirname, 'output.json'));
      } catch {}

      const options = {
        outputDir: __dirname,
        outputFile: 'output.json',
      };
      jsonChunkWriter = new JsonChunkWriter(options);
    });

    it('should write to file', () => {
      const success = jsonChunkWriter.write({key: 'value'});
      jsonChunkWriter.close();

      expect(success).toBe(true);
    });

    it('should fail when object is not serializable', () => {
      const success = jsonChunkWriter.write({x: 2n});
      jsonChunkWriter.close();

      expect(success).toEqual(false);
    });
  });
});

