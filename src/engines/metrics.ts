import {ChromiumDevelopmentTools} from '../browsers/chromium/index.js';
import {type BrowserClient} from '../browsers/client.js';
import {FirefoxDevelopmentTools} from '../browsers/firefox/index.js';
import {WebkitDevelopmentTools} from '../browsers/webkit/index.js';
import {
  type OnStartMeasure, type OnStopMeasure, type Metric, type Metrics, type SupportedBrowsers,
} from '../types/index.js';

export class MetricsEngine {
  /**
   * Client reference to the browser
   */
  private browser: BrowserClient | undefined;

  /**
   * Starts client
   *
   * @param browser which client to setup
   */
  public setupBrowser(browser: SupportedBrowsers | string) {
    switch (browser) {
      case 'chromium': {
        this.browser = new ChromiumDevelopmentTools();
        return true;
      }

      case 'firefox': {
        this.browser = new FirefoxDevelopmentTools();
        return true;
      }

      case 'webkit': {
        this.browser = new WebkitDevelopmentTools();
        return true;
      }

      default: {
        this.browser = undefined;
        return false;
      }
    }
  }

  /**
   * Shutdown client
   */
  public destroy() {
    this.browser?.destroy();
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
  public async getMetric(metric: Metrics): Promise<Metric | undefined> {
    const newMetric = await this.browser?.getMetric(metric);

    if (newMetric) {
      return newMetric[0];
    }

    return undefined;
  }

  /**
   * Dispatches custom metric fetch from browser and return metric
   *
   * @param customMetric user defined fetch function
   */
  public async runCustomMetric(customMetric: OnStartMeasure | OnStopMeasure): Promise<Metric | undefined> {
    if (this.browser) {
      return customMetric(this.browser);
    }

    return undefined;
  }
}
