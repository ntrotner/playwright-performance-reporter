import {ChromiumDevelopmentTools} from '../browsers/chromium/index.js';
import {type BrowserClient} from '../browsers/client.js';
import {FirefoxDevelopmentTools} from '../browsers/firefox/index.js';
import {WebkitDevelopmentTools} from '../browsers/webkit/index.js';
import {
  type OnStartMeasure, type OnStopMeasure, type Metric, type Metrics, type SupportedBrowsers,
  type HookOrder,
} from '../types/index.js';

export class MetricsEngine {
  /**
   * Client reference to the browser
   */
  private browser: BrowserClient | undefined;

  /**
   * Options for connection to the browser
   */
  private browserOptions: Record<string, any> = {};

  /**
   * Starts client
   *
   * @param browser which client to setup
   */
  public async setupBrowser(browser: SupportedBrowsers | string | undefined, options: Record<string, any>) {
    this.browserOptions = options;

    switch (browser) {
      case 'chromium': {
        this.browser = new ChromiumDevelopmentTools(this.browserOptions);
        break;
      }

      case 'firefox': {
        this.browser = new FirefoxDevelopmentTools(this.browserOptions);
        break;
      }

      case 'webkit': {
        this.browser = new WebkitDevelopmentTools(this.browserOptions);
        break;
      }

      default: {
        this.browser = undefined;
        return false;
      }
    }

    await this.browser?.connect();
    return true;
  }

  /**
   * Shutdown client
   */
  public destroy() {
    this.browser?.destroy();
    this.browser = undefined;
  }

  /**
   * Get current running client
   */
  public getBrowser(): SupportedBrowsers | undefined {
    return this.browser?.getBrowserName();
  }

  /**
   * Dispatches metric fetch from browser and return metric
   *
   * @param metric which metric to measure
   */
  public async getMetric(metric: Metrics, hookOrder: HookOrder): Promise<Metric | undefined> {
    try {
      const newMetric = await this.browser?.getMetric(metric, hookOrder);

      if (newMetric) {
        return newMetric[0];
      }
    } catch {}

    return undefined;
  }

  /**
   * Dispatches custom metric fetch from browser and return metric
   *
   * @param customMetric user defined fetch function
   */
  public async runCustomMetric(customMetric: OnStartMeasure | OnStopMeasure): Promise<Metric | undefined> {
    try {
      const newMetric = await this.browser?.runCustomObserver(customMetric);

      if (newMetric) {
        return newMetric[0];
      }
    } catch {}

    return undefined;
  }
}
