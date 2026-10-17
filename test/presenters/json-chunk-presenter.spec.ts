import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import {
  nativePresenters,
} from '../../src/presenters';
import {
  type PresenterWriter,
} from '../../src';

describe('Json chunk presenter', () => {
  describe('JsonChunkPresenter', () => {
    let jsonChunkWriter: PresenterWriter;
    let outputDir: string;

    beforeEach(() => {
      outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'json-chunk-presenter-'));
      jsonChunkWriter = new nativePresenters.jsonChunkPresenter({outputDir, outputFile: 'output.json'});
    });

    afterEach(async () => {
      await jsonChunkWriter.close();
      fs.rmSync(outputDir, {recursive: true, force: true});
    });

    it('should write to file', async () => {
      const success = await jsonChunkWriter.write({key: {TEST_PARENT_KEY: {}}} as any);
      await jsonChunkWriter.close();

      expect(success).toBe(true);
    });

    it('should fail when object is not serializable', async () => {
      const success = await jsonChunkWriter.write({key: 2n} as any);
      await jsonChunkWriter.close();

      expect(success).toEqual(false);
    });

    it('should delete file', async () => {
      await jsonChunkWriter.write({key: {TEST_PARENT_KEY: {}}} as any);
      await new Promise(r => setTimeout(r, 2000));
      const success = await jsonChunkWriter.delete();

      expect(success).toEqual(true);
    });
  });
});

