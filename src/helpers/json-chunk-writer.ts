import path from 'node:path';
import fs, {type WriteStream} from 'node:fs';
import JSONStream from 'JSONStream';
import {
  type JsonWriter,
  type OptionsFileWrite,
} from '../types/index.js';
import {Logger} from './logger.js';

/**
 * Write JSON chunks in an array of entries
 */
export class JsonChunkWriter implements JsonWriter {
  /**
   * Locator where to store the output
   */
  private filePath: string | undefined;

  /**
   * Status whether writer is usable
   */
  private isClosed = false;

  /**
   * File writer
   */
  private fileStream: WriteStream | undefined;

  /**
   * JSON chunk writer
   */
  private readonly jsonStream = JSONStream.stringify('[', ',', ']');

  /**
   * Initialize writer
   *
   * @param options defines target output
   */
  initialize(options: OptionsFileWrite): void {
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
      Logger.error(
        'JSONChunkWriter write operation failed',
        String(error),
      );
      return false;
    }
  }

  /**
   * Finish json stream
   */
  public close() {
    this.isClosed = true;
    this.jsonStream.end();
    this.fileStream?.end();
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

    if (this.filePath) {
      fs.rmSync(this.filePath, {maxRetries: 5, retryDelay: 500});
      return true;
    }

    return false;
  }
}
