import type CDP from 'chrome-remote-interface';
import type {
  APIRequestContext,
  BrowserContext,
  Page,
  TestInfo,
} from '@playwright/test';
import type {
  TestCase,
  TestResult,
  TestStep,
} from '@playwright/test/reporter';
import {
  type CdpSessionLike,
  ChromiumSessionDevelopmentTools,
  createCdpSessionClient,
  createRecordingClient,
  playwrightTargetType,
} from '../browsers/chromium/session-client.js';
import {
  PerformanceReporter,
} from '../engines/reporter.js';
import {
  registerRequestSource,
} from '../browsers/chromium/observers/request-timing.js';
import {
  type Options,
  type PresenterWriter,
  type ResultAccumulator,
} from '../types/index.js';
import {
  resolveConditions,
} from '../helpers/conditions.js';
import {
  RequestRecorder,
} from './request-recorder.js';

/**
 * Step that is currently running
 */
type RunningStep = {
  titlePath: string[];
  startTime: Date;
};

/**
 * Measures a single test inside its worker on the CDP sessions of its pages.
 * The measurements are the same chunks the reporter writes in port mode.
 */
export class PerformanceCollector {
  /**
   * Chunks in order of measurement
   */
  private readonly chunks: ResultAccumulator[] = [];

  /**
   * Worker local reporter that runs the observers and creates the chunks
   */
  private readonly reporter: PerformanceReporter;

  /**
   * Browser client on the CDP sessions of the pages
   */
  private readonly developmentTools: ChromiumSessionDevelopmentTools;

  /**
   * Running steps, the innermost last
   */
  private readonly steps: RunningStep[] = [];

  /**
   * Pages whose CDP session is being opened
   */
  private readonly pendingPages = new Set<Promise<void>>();

  private pageCounter = 0;

  /**
   * Requests of the pages and the API request context of the test
   */
  private readonly requestRecorder = new RequestRecorder();

  constructor(options: Options, private readonly testInfo: TestInfo) {
    this.developmentTools = new ChromiumSessionDevelopmentTools(resolveConditions(options.browsers.chromium?.conditions));

    const collector: PresenterWriter = {
      write: async content => {
        // The reporter reuses objects across chunks, e.g. while sampling
        this.chunks.push(structuredClone(content));
        return true;
      },
      close: async () => true,
      delete: async () => true,
    };

    this.reporter = new PerformanceReporter({
      ...options,
      mode: 'port',
      debuggingPort: undefined,
      // Budgets are evaluated by the reporter of the test runner
      budgets: undefined,
      presenters: [collector],
    });
    this.reporter.useBrowserClient(this.developmentTools);

    // Virtual target for observers of what Playwright records, so they also measure tests without a page
    const recordingClient = createRecordingClient();
    registerRequestSource(recordingClient, this.requestRecorder);
    this.developmentTools.addTarget({id: 'playwright', type: playwrightTargetType, url: ''} as CDP.Target, recordingClient);
  }

  /**
   * Measure every current and future page of the context
   *
   * @param context browser context of the test
   */
  public observeContext(context: BrowserContext): void {
    this.requestRecorder.observeContext(context);
    for (const page of context.pages()) {
      this.trackPage(context, page);
    }

    context.on('page', page => {
      this.trackPage(context, page);
    });
  }

  /**
   * API request context that records its requests
   *
   * @param request API request context of the test
   */
  public wrapApiRequest(request: APIRequestContext): APIRequestContext {
    return this.requestRecorder.wrapApiRequest(request);
  }

  /**
   * Start of the test
   */
  public async testBegin(): Promise<void> {
    await this.waitForPages();
    await this.reporter.onTestBegin(this.buildTestCase(), this.buildTestResult());
  }

  /**
   * Start of a step, nested in the running steps
   *
   * @param title title of the step
   */
  public async stepBegin(title: string): Promise<void> {
    const step: RunningStep = {titlePath: [...(this.steps.at(-1)?.titlePath ?? []), title], startTime: new Date()};
    this.steps.push(step);
    await this.waitForPages();
    await this.reporter.onStepBegin(this.buildTestCase(), this.buildTestResult(), this.buildTestStep(step));
  }

  /**
   * End of the innermost running step
   */
  public async stepEnd(): Promise<void> {
    const step = this.steps.pop();
    if (!step) {
      return;
    }

    await this.reporter.onStepEnd(this.buildTestCase(), this.buildTestResult(), this.buildTestStep(step));
  }

  /**
   * End of the test
   *
   * @returns all measurements of the test
   */
  public async testEnd(): Promise<ResultAccumulator[]> {
    await this.reporter.onTestEnd(this.buildTestCase(), this.buildTestResult());
    return this.chunks;
  }

  /**
   * Open a CDP session for a page and measure it from now on
   *
   * @param context browser context of the page
   * @param page page to measure
   */
  private trackPage(context: BrowserContext, page: Page): void {
    this.pageCounter++;
    const targetId = `page-${this.pageCounter}`;
    const pending = (async () => {
      try {
        const client = createCdpSessionClient(await context.newCDPSession(page) as unknown as CdpSessionLike);
        // Throttle before the page is measured for the first time
        await this.developmentTools.throttlePage(client, page.url());
        this.developmentTools.addTarget({id: targetId, type: 'page', url: page.url()} as CDP.Target, client);
        page.on('framenavigated', frame => {
          if (frame === page.mainFrame()) {
            this.developmentTools.updateTarget(targetId, {url: frame.url()});
          }
        });
        page.on('close', async () => {
          await this.developmentTools.destroy(targetId);
        });
      } catch {
        // Page closed before the session was opened
      }
    })();

    this.pendingPages.add(pending);
  }

  /**
   * Wait until the sessions of all known pages are opened
   */
  private async waitForPages(): Promise<void> {
    const pending = [...this.pendingPages];
    await Promise.all(pending);
    for (const page of pending) {
      this.pendingPages.delete(page);
    }
  }

  /**
   * Test as the reporter of the test runner sees it, so names match the port mode
   */
  private buildTestCase(): TestCase {
    const titlePath = ['', this.testInfo.project.name, ...this.testInfo.titlePath];
    return {
      id: this.testInfo.testId,
      titlePath: () => titlePath,
      parent: {project: () => undefined},
    } as unknown as TestCase;
  }

  /**
   * The worker measures a single test at a time, so it's always the first worker of its reporter
   */
  private buildTestResult(): TestResult {
    return {parallelIndex: 0, attachments: []} as unknown as TestResult;
  }

  /**
   * Step as the reporter of the test runner sees it
   *
   * @param step running step
   */
  private buildTestStep(step: RunningStep): TestStep {
    return {
      category: 'test.step',
      title: step.titlePath.at(-1),
      titlePath: () => step.titlePath,
      startTime: step.startTime,
    } as unknown as TestStep;
  }
}
