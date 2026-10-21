import fs from 'node:fs';
import {
  createRequire,
} from 'node:module';
import path from 'node:path';
import process from 'node:process';
import {
  Logger,
} from '../helpers/index.js';

/**
 * Chart.js bundle of the installed package
 */
type ChartJsBundle = {
  version: string;
  source: string;
};

/**
 * Bundle read once per process, as every report embeds the same file
 */
let bundle: ChartJsBundle | undefined;

/**
 * Package name of this library, to resolve its dependencies from its own location
 */
const packageName = 'playwright-performance-reporter';

/**
 * Entry of the installed Chart.js. It's resolved from this library as installed in the project, which also works
 * if the package manager doesn't hoist dependencies, and else from the project itself, e.g. in this repository.
 * `import.meta` is avoided, as Playwright transpiles libraries outside of `node_modules` without supporting it.
 */
function resolveChartJs(): string {
  const projectRequire = createRequire(path.join(process.cwd(), 'package.json'));
  try {
    return createRequire(projectRequire.resolve(packageName)).resolve('chart.js');
  } catch {
    return projectRequire.resolve('chart.js');
  }
}

/**
 * Read the UMD bundle and the version of the installed Chart.js
 */
function readChartJs(): ChartJsBundle {
  if (!bundle) {
    // The package only exports its modules, so the bundle is resolved next to them
    const distDir = path.dirname(resolveChartJs());
    const {version} = JSON.parse(fs.readFileSync(path.join(distDir, '..', 'package.json'), 'utf8')) as {version: string};
    bundle = {version, source: fs.readFileSync(path.join(distDir, 'chart.umd.min.js'), 'utf8')};
  }

  return bundle;
}

/**
 * Url of the installed Chart.js version on jsDelivr
 *
 * @param version version of Chart.js
 */
export function chartJsCdnUrl(version: string): string {
  return `https://cdn.jsdelivr.net/npm/chart.js@${version}/dist/chart.umd.min.js`;
}

/**
 * Script tag of Chart.js for a self-contained report, or a tag of the pinned version on the CDN
 *
 * @param inline whether to embed the bundle into the report
 */
export function chartJsScriptTag(inline: boolean): string {
  let chartJs: ChartJsBundle;
  try {
    chartJs = readChartJs();
  } catch (error) {
    Logger.warning(`Chart.js could not be read, the report loads it from the CDN: ${String(error)}`);
    return `<script src="${chartJsCdnUrl('4')}"></script>`;
  }

  if (!inline) {
    return `<script src="${chartJsCdnUrl(chartJs.version)}"></script>`;
  }

  // The bundle must not end the script element early
  return `<script>${chartJs.source.replaceAll('</script', String.raw`<\/script`)}</script>`;
}

/**
 * Content Security Policy of a report, which only allows its own inline code and, if not inlined, the CDN
 *
 * @param inline whether Chart.js is embedded into the report
 */
export function reportContentSecurityPolicy(inline: boolean): string {
  const scripts = inline ? '\'unsafe-inline\'' : '\'unsafe-inline\' https://cdn.jsdelivr.net';
  return `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${scripts}; style-src 'unsafe-inline'; img-src data:">`;
}
