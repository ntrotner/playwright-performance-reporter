import fs from 'node:fs';
import path from 'node:path';
import {
  type PresenterWriter,
  type ResultAccumulator,
  type TargetMetric,
  type TestExecution,
  testCaseParent,
} from '../../types/index.js';
import {
  Logger,
} from '../../helpers/index.js';
import {
  percentile,
  scaledMedianAbsoluteDeviation,
} from '../comparison-presenter/comparison.js';
import {
  entityDurationMetric,
} from '../comparison-presenter/constants.js';
import {
  type MetricStatistics,
  type StatisticsPresenterOptions,
  type StatisticsReport,
  type StepStatistics,
  type TestStatistics,
} from './types.js';

/**
 * Merged measurements of a test or step in one execution
 */
type ExecutionEntry = {
  stepId: string;
  name: string;
  start: number;
  end: number;

  /**
   * Latest stop value per metric, preferring pages over other targets
   */
  values: Record<string, number>;
};

/**
 * Measurements of one execution of a test
 */
type Execution = {
  name?: string;
  execution?: TestExecution;
  entries: Map<string, ExecutionEntry>;
};

/**
 * Executions of the same step of a test
 */
type StepGroup = {
  name: string;
  occurrence: number;

  /**
   * Position of the step in the first execution that contains it
   */
  order: number;
  entries: ExecutionEntry[];
};

/**
 * Presenter that writes statistics across the executions of every test and step, e.g. with `repeatEach`
 */
export class StatisticsPresenter implements PresenterWriter {
  /**
   * All executions in order of their start
   */
  private readonly executions: Execution[] = [];

  /**
   * Running execution per test id. Every repeat has its own test id, while retries share the id of their test.
   */
  private readonly currentExecutions = new Map<string, Execution>();

  private readonly filePath: string;

  private readonly percentiles: number[];

  constructor(private readonly options: StatisticsPresenterOptions) {
    this.filePath = path.join(options.outputDir, options.outputFile);
    this.percentiles = options.percentiles ?? [0.5, 0.75, 0.95];
    for (const fraction of this.percentiles) {
      if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1) {
        throw new Error(`Invalid percentile ${fraction}: must be between 0 and 1`);
      }
    }
  }

  /**
   * @inheritdoc
   */
  async write(content: ResultAccumulator): Promise<boolean> {
    for (const [caseId, steps] of Object.entries(content)) {
      // The start of a test carries its execution, so a retry begins a new execution
      const isStart = steps?.[testCaseParent]?.execution !== undefined;
      let execution = this.currentExecutions.get(caseId);
      if (!execution || isStart) {
        execution = {entries: new Map<string, ExecutionEntry>()};
        this.executions.push(execution);
        this.currentExecutions.set(caseId, execution);
      }

      for (const [stepId, performance] of Object.entries(steps ?? {})) {
        if (stepId === testCaseParent) {
          execution.name ??= performance.name;
          execution.execution ??= performance.execution;
        }

        const entry = execution.entries.get(stepId) ?? {
          stepId, name: performance.name, start: performance.startMeasurement, end: performance.endMeasurement, values: {},
        };
        entry.start = Math.min(entry.start, performance.startMeasurement);
        entry.end = Math.max(entry.end, performance.endMeasurement);
        collectValues(entry, performance.stopMetrics ?? []);
        execution.entries.set(stepId, entry);
      }
    }

    return true;
  }

  /**
   * @inheritdoc
   */
  async close(): Promise<boolean> {
    try {
      const report = this.buildReport();
      await fs.promises.writeFile(this.filePath, JSON.stringify(report, null, this.options.pretty ? 2 : undefined));
      return true;
    } catch (error) {
      Logger.error(`Failed to write statistics: ${String(error)}`);
      return false;
    }
  }

  /**
   * @inheritdoc
   */
  async delete(): Promise<boolean> {
    fs.rmSync(this.filePath, {force: true, maxRetries: 5, retryDelay: 500});
    return true;
  }

  /**
   * Statistics of every test and step across its executions
   */
  private buildReport(): StatisticsReport {
    const tests = new Map<string, Execution[]>();
    for (const execution of this.executions) {
      if (!execution.name || (!this.options.includeRetries && (execution.execution?.retry ?? 0) > 0)) {
        continue;
      }

      tests.set(execution.name, [...(tests.get(execution.name) ?? []), execution]);
    }

    return {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      percentiles: this.percentiles,
      tests: [...tests.entries()].map(([name, executions]) => this.summarizeTest(name, executions)),
    };
  }

  /**
   * Statistics of a test and its steps, steps matched by name and occurrence
   *
   * @param name name of the test
   * @param executions executions of the test
   */
  private summarizeTest(name: string, executions: Execution[]): TestStatistics {
    const groups = new Map<string, StepGroup>();
    for (const execution of executions) {
      const occurrences = new Map<string, number>();
      const ordered = [...execution.entries.values()].filter(entry => entry.stepId !== testCaseParent).sort((a, b) => a.start - b.start);
      for (const [order, entry] of ordered.entries()) {
        const occurrence = occurrences.get(entry.name) ?? 0;
        occurrences.set(entry.name, occurrence + 1);
        const key = `${entry.name}|${occurrence}`;
        const group = groups.get(key) ?? {
          name: entry.name, occurrence, order, entries: [],
        };
        group.entries.push(entry);
        groups.set(key, group);
      }
    }

    const testEntries = executions.map(execution => execution.entries.get(testCaseParent)).filter(entry => entry !== undefined);
    return {
      name,
      executions: executions.length,
      test: this.summarizeEntries(name, 0, testEntries),
      steps: [...groups.values()]
        .sort((a, b) => a.order - b.order)
        .map(group => this.summarizeEntries(group.name, group.occurrence, group.entries)),
    };
  }

  /**
   * Statistics of the executions of a test or step
   *
   * @param name name of the test or step
   * @param occurrence index of the step with the same name
   * @param entries executions of the test or step
   */
  private summarizeEntries(name: string, occurrence: number, entries: ExecutionEntry[]): StepStatistics {
    const valuesByMetric = new Map<string, number[]>([[entityDurationMetric, entries.map(entry => entry.end - entry.start)]]);
    for (const entry of entries) {
      for (const [metric, value] of Object.entries(entry.values)) {
        valuesByMetric.set(metric, [...(valuesByMetric.get(metric) ?? []), value]);
      }
    }

    return {
      name,
      occurrence,
      executions: entries.length,
      metrics: Object.fromEntries([...valuesByMetric.entries()]
        .filter(([, values]) => values.length > 0)
        .map(([metric, values]) => [metric, this.statisticsOf(values)])),
    };
  }

  /**
   * Statistics of a list of values
   *
   * @param values values of the executions
   */
  private statisticsOf(values: number[]): MetricStatistics {
    const statistics: MetricStatistics = {
      count: values.length,
      min: Math.min(...values),
      max: Math.max(...values),
      mean: values.reduce((total, value) => total + value, 0) / values.length,
      mad: scaledMedianAbsoluteDeviation(values),
    };
    for (const fraction of this.percentiles) {
      statistics[`p${Math.round(fraction * 100)}`] = percentile(values, fraction);
    }

    return statistics;
  }
}

/**
 * Keep the latest stop value of every numeric metric, preferring pages
 *
 * @param entry merged test or step
 * @param stopMetrics stop measurements of a chunk
 */
function collectValues(entry: ExecutionEntry, stopMetrics: TargetMetric[]): void {
  for (const targetMetric of stopMetrics) {
    for (const [metric, value] of Object.entries(targetMetric?.metric ?? {})) {
      if (typeof value === 'number' && Number.isFinite(value) && (targetMetric.type === 'page' || !(metric in entry.values))) {
        entry.values[metric] = value;
      }
    }
  }
}
