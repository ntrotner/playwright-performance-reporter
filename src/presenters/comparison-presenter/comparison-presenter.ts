import path from 'node:path';
import fs from 'node:fs';
import {
  type PresenterWriter,
  type ResultAccumulator,
} from '../../types/index.js';
import {
  assignConfig,
  unthrottledDescription,
  Logger,
} from '../../helpers/index.js';
import {
  JsonChunkPresenter,
} from '../json-chunk-presenter/index.js';
import {
  buildStepComparisons,
  collectEntities,
  compareRuns,
  splitRuns,
} from './comparison.js';
import {
  loadHistory,
  loadRun,
} from './history.js';
import {
  renderComparisonHtml,
} from './html.js';
import {
  type ComparisonPresenterOptions,
  type ComparisonReport,
  type ExcludedRun,
  type RunSummary,
  type StepComparison,
} from './types.js';

/**
 * Compare the current run against previous runs and write a json and html report
 */
export class ComparisonPresenter implements PresenterWriter {
  /**
   * Writer of the current run into the history, created on the first write
   */
  private jsonChunkPresenter: JsonChunkPresenter | undefined;

  /**
   * Previous runs, loaded while the tests are running
   */
  private history: Promise<{runs: RunSummary[]; excluded: ExcludedRun[]}> | undefined;

  /**
   * Result of closing, to generate the reports only once
   */
  private closing: Promise<boolean> | undefined;

  /**
   * Comparison of the current run, once closed
   */
  private report: ComparisonReport | undefined;

  /**
   * File name of the current run in the history
   */
  private readonly runFile: string;

  /**
   * Settings for the comparison builder
   */
  private readonly settings: ComparisonReport['settings'];

  /**
   * Options for the whole comparison presenter
   */
  private readonly options: Required<ComparisonPresenterOptions> = {
    requiredMetrics: [
      'JSHeapUsedSize',
      'TaskDuration',
      'ScriptDuration',
      'totalNetworkRequests',
      'totalNetworkTransferSize',
      'cpuProfileActiveTime',
    ],
    comparedMetrics: [],
    bandPercentile: 0.05,
    historyDir: '',
    outputDir: '',
    recentRuns: 3,
    baselineWindow: 20,
    relativeThreshold: 0.1,
    zScoreThreshold: 2,
    minBaselineRuns: 3,
    visualReportOutputFile: 'performance-comparison.html',
    jsonReportOutputFile: 'performance-comparison.json',
    runFilePrefix: 'performance-run',
    runSortValue: ((run: RunSummary) => run.startedAt),
    runLabel: ((run: RunSummary) => new Date(run.startedAt).toLocaleString()),
  };

  constructor(options: ComparisonPresenterOptions) {
    assignConfig(this.options, options);
    this.runFile = `${this.options.runFilePrefix}-${new Date().toISOString().replaceAll(':', '-')}.json`;

    fs.mkdirSync(this.options.historyDir, {recursive: true});
    fs.mkdirSync(this.options.outputDir, {recursive: true});

    this.settings = {
      requiredMetrics: this.options.requiredMetrics,
      comparedMetrics: this.options.comparedMetrics.length > 0 ? this.options.comparedMetrics : undefined,
      bandPercentile: this.options.bandPercentile,
      recentRuns: this.options.recentRuns,
      baselineWindow: this.options.baselineWindow,
      relativeThreshold: this.options.relativeThreshold,
      zScoreThreshold: this.options.zScoreThreshold,
      minBaselineRuns: this.options.minBaselineRuns,
    };
  }

  /**
   * @inheritdoc
   */
  async write(content: ResultAccumulator): Promise<boolean> {
    return this.initialize().write(content);
  }

  /**
   * Finish the current run and generate the comparison
   */
  async close(): Promise<boolean> {
    this.closing ??= this.finish();
    return this.closing;
  }

  /**
   * Remove current run from the history and the generated reports
   */
  async delete(): Promise<boolean> {
    if (!this.jsonChunkPresenter) {
      // Reports in the output directory belong to a previous run
      return true;
    }

    await this.close();

    for (const filePath of [this.getRunPath(), this.getVisualReportPath(), this.getJsonReportPath()]) {
      fs.rmSync(filePath, {force: true, maxRetries: 5, retryDelay: 500});
    }

    return true;
  }

  /**
   * Comparison of the current run, available once the presenter is closed.
   * Closes the presenter, so call it only after all tests ran, e.g. from the `close` of another presenter.
   *
   * @returns the report, or undefined if nothing was measured or the comparison failed
   */
  async getReport(): Promise<ComparisonReport | undefined> {
    await this.close();
    return this.report;
  }

  /**
   * Read the history and create the json chunk file of the current run
   */
  private initialize(): JsonChunkPresenter {
    this.history ??= loadHistory(this.options.historyDir, this.settings.requiredMetrics, [this.getRunPath(), this.getVisualReportPath(), this.getJsonReportPath()], this.settings.bandPercentile);
    this.jsonChunkPresenter ??= new JsonChunkPresenter({outputDir: this.options.historyDir, outputFile: this.runFile});
    return this.jsonChunkPresenter;
  }

  /**
   * Close the current run and write the reports
   */
  private async finish(): Promise<boolean> {
    if (!this.jsonChunkPresenter) {
      // Nothing was measured, so there is nothing to compare
      return true;
    }

    if (!await this.jsonChunkPresenter.close()) {
      return false;
    }

    try {
      const {report, runs} = await this.compare();
      this.report = report;
      await fs.promises.writeFile(this.getJsonReportPath(), JSON.stringify(report, null, 2));
      await fs.promises.writeFile(this.getVisualReportPath(), renderComparisonHtml(report, runs, {sortValue: this.options.runSortValue, label: this.options.runLabel}));
      Logger.info(report.message);
      return true;
    } catch (error) {
      Logger.error(`Failed to compare runs: ${String(error)}`);
      return false;
    }
  }

  /**
   * Compare current run against the history
   */
  private async compare(): Promise<{report: ComparisonReport; runs: RunSummary[]}> {
    const history = await this.history!;
    const loaded = await loadRun(this.getRunPath(), this.settings.requiredMetrics, this.settings.bandPercentile);

    const report: ComparisonReport = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      status: 'ok',
      message: '',
      recentRuns: [],
      baselineRuns: [],
      excludedRuns: history.excluded,
      settings: this.settings,
      steps: [],
    };

    if ('excluded' in loaded) {
      const missing = loaded.excluded.missingMetrics ? ` (${loaded.excluded.missingMetrics.join(', ')})` : '';
      report.status = 'invalid-current-run';
      report.message = `Current run can't be compared: ${loaded.excluded.reason}${missing}. Make sure the observers of these metrics are configured.`;
      return {report, runs: []};
    }

    const current = loaded.run;
    const conditionsOf = (run: RunSummary) => run.conditions ?? unthrottledDescription;
    report.conditions = conditionsOf(current);
    // Runs under other throttling are not comparable, e.g. a CPU slowdown would look like a regression
    const comparableRuns = history.runs.filter(run => conditionsOf(run) === report.conditions);
    report.excludedRuns = [
      ...history.excluded,
      ...history.runs
        .filter(run => conditionsOf(run) !== report.conditions)
        .map(run => ({file: run.file, reason: `Different measurement conditions: ${conditionsOf(run)}`})),
    ];
    const {recent, baseline} = splitRuns(comparableRuns, current, this.settings);
    const describeRun = (run: RunSummary) => ({id: run.id, file: run.file, startedAt: new Date(run.startedAt).toISOString()});
    const comparisons = compareRuns(recent, baseline, this.settings);
    report.currentRun = describeRun(current);
    report.recentRuns = recent.map(run => describeRun(run));
    report.baselineRuns = baseline.map(run => describeRun(run));
    report.steps = buildStepComparisons(collectEntities([...baseline, ...recent]), comparisons);

    if (baseline.length === 0) {
      report.status = 'no-baseline';
      report.message = `No previous runs with the required metrics in ${this.options.historyDir}. The current run is the baseline for the next comparison.`;
      report.steps = report.steps.map(step => ({...step, changes: []}));
    } else {
      const count = (status: StepComparison['status']) => report.steps.filter(step => step.kind === 'step' && step.status === status).length;
      const stepCount = report.steps.filter(step => step.kind === 'step').length;
      report.message = `Compared ${stepCount} step(s) of the latest ${recent.length} run(s) to the median of ${baseline.length} earlier run(s): `
        + `${count('regressed')} regressed, ${count('improved')} improved, ${count('mixed')} mixed, ${count('missing')} missing, ${count('new')} new.`;
      if (baseline.length < this.settings.minBaselineRuns) {
        report.status = 'low-confidence';
        report.message += ` Noise can't be separated from real changes with less than ${this.settings.minBaselineRuns} previous runs, so every change above the relative threshold is reported.`;
      }
    }

    return {report, runs: [...baseline, ...recent]};
  }

  private getVisualReportPath(): string {
    return path.join(this.options.outputDir, this.options.visualReportOutputFile);
  }

  private getJsonReportPath(): string {
    return path.join(this.options.outputDir, this.options.jsonReportOutputFile);
  }

  private getRunPath(): string {
    return path.join(this.options.historyDir, this.runFile);
  }
}
