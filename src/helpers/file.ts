import path from 'node:path';
import fs from 'node:fs';

type OptionsFileWrite = {
  outputDir: string;
  outputFile: string;
  content: any;
};

/**
 * Write raw output to filesystem
 *
 * Credits to https://github.com/ctrf-io/playwright-ctrf-json-report
 */
export function writeReportToFile(options: OptionsFileWrite): boolean {
  const filePath = path.join(options.outputDir, options.outputFile);
  try {
    const output = JSON.stringify(options.content, null, 2);
    fs.writeFileSync(filePath, output + '\n', {flag: 'ax'});
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
