import {JsonChunkWriter} from '../../src/helpers';
import path from "node:path";
import fs from "node:fs";

describe('Json chunk writer helpers', () => {
  describe('JsonChunkWriter', () => {
    let jsonChunkWriter: JsonChunkWriter;

    beforeEach(() => {
      const options = {
        outputDir: __dirname,
        outputFile: 'output.json',
      };
      try {
        fs.rmSync(path.join(options.outputDir, options.outputFile));
      } catch {}
      jsonChunkWriter = new JsonChunkWriter();
      jsonChunkWriter.initialize(options);
    });

    it('should write to file', async () => {
      const success = await jsonChunkWriter.write({key: 'value'});
      jsonChunkWriter.close();

      expect(success).toBe(true);
    });

    it('should fail when object is not serializable', async () => {
      const success = await jsonChunkWriter.write({x: 2n});
      jsonChunkWriter.close();

      expect(success).toEqual(false);
    });

    it('should delete file', async () => {
      await jsonChunkWriter.write({x: 1});
      await new Promise((r) => setTimeout(r, 2000));
      const success = await jsonChunkWriter.delete();

      expect(success).toEqual(true);
    });
  });
});

