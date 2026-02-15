import path from 'node:path';
import fs, {
  type WriteStream,
} from 'node:fs';
import JSONStream from 'JSONStream';
import {
  type JsonWriter,
  type OptionsFileWrite,
} from '../types/index.js';
import {
  Logger,
} from './logger.js';

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
  public async write(content: Record<any, any>): Promise<boolean> {
    if (this.isClosed) {
      return false;
    }

    return new Promise(resolve => {
      try {
        // @ts-expect-error: writer is able to handle more types
        if (this.jsonStream.write(content)) {
          resolve(true);
        } else {
          this.fileStream?.once('drain', () => {
            resolve(true);
          });
        }
      } catch (error) {
        Logger.error(String(error));
        resolve(false);
      }
    });
  }

  /**
   * Finish json stream
   */
  public async close(): Promise<boolean> {
    this.isClosed = true;
    return new Promise(resolve => {
      try {
        this.jsonStream.end();
        this.fileStream?.end();
        this.fileStream?.once('finish', () => {
          resolve(true);
        });
      } catch (error) {
        Logger.error(String(error));
        resolve(false);
      }
    });
  }

  /**
   * Delete created file
   */
  public async delete(): Promise<boolean> {
    try {
      await this.close();
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
