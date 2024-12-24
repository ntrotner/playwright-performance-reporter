import path from 'node:path';
import fs from 'node:fs';
import JSONStream from 'JSONStream';

type OptionsFileWrite = {
  outputDir: string;
  outputFile: string;
  content: any;
};

/**
 * Write raw output to filesystem
 */
export function writeReportToFile(options: OptionsFileWrite): boolean {
  const filePath = path.join(options.outputDir, options.outputFile);
  try {
    const fileStream = fs.createWriteStream(filePath, {flags: 'ax'});
    const jsonStream = JSONStream.stringify();
    jsonStream.pipe(fileStream);
    jsonStream.write(options.content as string);
    jsonStream.end();

    console.log(
      'Playwright-Performance-Reporter: successfully written json to %s/%s',
      options.outputDir,
      options.outputFile,
    );
    return true;
  } catch (error) {
    console.log(`Error writing json report:, ${String(error)}`);
    return false;
  }
}
