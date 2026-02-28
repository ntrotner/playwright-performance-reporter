import path from "node:path";
import fs from "node:fs";
import {nativePresenters} from '../../src/presenters';
import {PresenterWriter} from "../../src";

describe('Json chunk presenter', () => {
  describe('JsonChunkPresenter', () => {
    let jsonChunkWriter: PresenterWriter;

    beforeEach(() => {
      const options = {
        outputDir: __dirname,
        outputFile: 'output.json',
      };
      try {
        fs.rmSync(path.join(options.outputDir, options.outputFile));
      } catch {}
      jsonChunkWriter = new nativePresenters.jsonChunkPresenter(options);
    });

    it('should write to file', async () => {
      const success = await jsonChunkWriter.write({key: { TEST_PARENT_KEY: {} }} as any);
      jsonChunkWriter.close();

      expect(success).toBe(true);
    });

    it('should fail when object is not serializable', async () => {
      const success = await jsonChunkWriter.write({key: 2n } as any);
      jsonChunkWriter.close();

      expect(success).toEqual(false);
    });

    it('should delete file', async () => {
      await jsonChunkWriter.write({key: { TEST_PARENT_KEY: {} }} as any);
      await new Promise((r) => setTimeout(r, 2000));
      const success = await jsonChunkWriter.delete();

      expect(success).toEqual(true);
    });
  });
});

