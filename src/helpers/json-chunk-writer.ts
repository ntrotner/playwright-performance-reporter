import path from 'node:path';
import fs, {type WriteStream} from 'node:fs';
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
   * Status whether writer is usable
   */
  private isClosed = false;

  /**
   * File writer
   */
  private readonly fileStream: WriteStream;

  /**
   * JSON chunk writer
   */
  private readonly jsonStream = JSONStream.stringify('[', ',', ']');

  constructor(options: OptionsFileWrite) {
    this.filePath = path.join(options.outputDir, options.outputFile);
    this.fileStream = fs.createWriteStream(this.filePath, {flags: 'w'});
    this.jsonStream.pipe(this.fileStream);
  }

  /**
   * Create new entry of an object, that is serializable.
   *
   * @param content
   */
  public write(content: Record<any, any>): boolean {
    if (this.isClosed) {
      return false;
    }

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
    this.isClosed = true;
    this.jsonStream.end();
    this.fileStream.end();
  }

  /**
   * Delete created file
   */
  public delete(): boolean {
    try {
      this.close();
    } catch {
      return false;
    }

    fs.rmSync(this.filePath, {maxRetries: 5, retryDelay: 500});
    return true;
  }
}
