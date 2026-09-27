import type CDP from 'chrome-remote-interface';
import type Protocol from 'devtools-protocol/types/protocol';
import {
  type ChromiumMetricObserver,
  type Metric,
} from '../../../types/index.js';

export class WebVitalsObserver implements ChromiumMetricObserver {
  public readonly name = 'webVitals';
  public readonly plugins = [];

  /**
   * @inheritdoc
   */
  async onStart(accumulator: Metric, developmentTools: CDP.Client): Promise<void> {
    await this.common(accumulator, developmentTools);
  }

  /**
   * @inheritdoc
   */
  async onSampling(accumulator: Metric, developmentTools: CDP.Client): Promise<void> {
    await this.common(accumulator, developmentTools);
  }

  /**
   * @inheritdoc
   */
  async onStop(accumulator: Metric, developmentTools: CDP.Client): Promise<void> {
    await this.common(accumulator, developmentTools);
  }

  /**
   * Evaluate the Web Vitals in the page and write them into the accumulator
   */
  private async common(accumulator: Metric, client: CDP.Client) {
    return new Promise(resolve => {
      client.send('Runtime.evaluate', {expression: this.getWebVitalsExpression(), returnByValue: true}, (error, cdpResponse) => {
        const result = (cdpResponse as Protocol.Runtime.EvaluateResponse | undefined)?.result;
        if (error || result?.type !== 'object' || result.value === undefined) {
          resolve(false);
          return;
        }

        Object.assign(accumulator, result.value as Record<string, unknown>);
        resolve(true);
      });
    });
  }

  /**
   * Installs a persistent PerformanceObserver and reads the accumulated Web Vitals.
   *
   * Note: LCP, CLS and event entries are only recorded when observed, so the observer must
   * be registered with `buffered: true` and kept alive across evaluations.
   */
  private getWebVitalsExpression() {
    return `
  (() => {
    const KEY = '__performanceReporterWebVitals';
    const buf = window[KEY] ?? {lcp: [], cls: [], fcp: [], inp: []};
    window[KEY] = buf;

    if (!buf.installed) {
      buf.installed = true;
      const continuous = new Set([
        'pointermove', 'pointerover', 'pointerout', 'pointerenter', 'pointerleave', 'pointercancel',
        'mousemove', 'mouseover', 'mouseout', 'mouseenter', 'mouseleave',
        'scroll', 'wheel', 'drag', 'dragstart', 'dragend', 'dragenter', 'dragleave', 'dragover', 'drop',
      ]);
      const observer = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          if (entry.entryType === 'largest-contentful-paint') buf.lcp.push(entry.startTime);
          if (entry.entryType === 'layout-shift' && !entry.hadRecentInput) buf.cls.push(entry.value);
          if (entry.entryType === 'paint' && entry.name === 'first-contentful-paint') buf.fcp.push(entry.startTime);
          if (entry.entryType === 'event' && !continuous.has(entry.name)) buf.inp.push(Math.max(entry.duration, entry.processingEnd - entry.startTime));
        }
      });

      try {
        observer.observe({type: 'largest-contentful-paint', buffered: true});
        observer.observe({type: 'layout-shift', buffered: true});
        observer.observe({type: 'paint', buffered: true});
        observer.observe({type: 'event', buffered: true, durationThreshold: 16});
      } catch {}
    }

    const last = values => values.length > 0 ? values[values.length - 1] : 0;
    const max = values => values.length > 0 ? Math.max(...values) : 0;
    const sum = values => values.reduce((total, value) => total + value, 0);

    return {
      largestContentfulPaint: last(buf.lcp),
      firstContentfulPaint: last(buf.fcp),
      cumulativeLayoutShift: sum(buf.cls),
      interactionToNextPaint: max(buf.inp),
    };
  })()
`;
  }
}
