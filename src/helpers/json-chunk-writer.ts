import path from 'node:path';
import fs from 'node:fs';
import JSONStream from 'JSONStream';

type OptionsFileWrite = {
  outputDir: string;
  outputFile: string;
};

/**
 * Write JSON chunks in an array of entries
 */
export class JsonChunkWriter {
  /**
   * Locator where to store the output
   */
  private readonly filePath: string;

  /**
   * JSON chunk writer
   */
  private readonly jsonStream = JSONStream.stringify('[', ',', ']');

  constructor(options: OptionsFileWrite) {
    this.filePath = path.join(options.outputDir, options.outputFile);
    const fileStream = fs.createWriteStream(this.filePath, {flags: 'ax'});
    this.jsonStream.pipe(fileStream);
  }

  /**
   * Create new entry of an object, that is serializable.
   *
   * @param content
   */
  public write(content: Record<any, any>): boolean {
    try {
      // @ts-expect-error: writer is able to handle more types
      return this.jsonStream.write(content);
    } catch (error) {
      console.log('JSONChunkWriter write failed:', error);
      return false;
    }
  }

  /**
   * Finish json stream
   */
  public close() {
    this.jsonStream.end();
  }
}
