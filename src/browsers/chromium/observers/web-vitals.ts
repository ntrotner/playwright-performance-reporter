import type CDP from 'chrome-remote-interface';
import type Protocol from 'devtools-protocol/types/protocol';
import {
  type ChromiumMetricObserver,
  type Metric,
} from '../../../types/index.js';

/**
 * Options for the WebVitalsObserver
 */
export type WebVitalsObserverOptions = {
  /**
   * Emit what caused the Web Vitals, e.g. the element of the largest contentful paint. Defaults to false.
   */
  attribution?: boolean;
};

/**
 * Attribution keys of the Web Vitals, emitted with the `attribution` option.
 * Selectors are short descriptions of an element, e.g. `img#hero.banner`, and empty if the element is unknown.
 */
export type WebVitalsAttributionMetrics = {
  /**
   * Selector of the element of the largest contentful paint
   */
  lcpElement: string;

  /**
   * Url of the image of the largest contentful paint, empty for text
   */
  lcpUrl: string;

  /**
   * Milliseconds between the load and the render of the largest contentful paint image
   */
  lcpRenderDelay: number;

  /**
   * Area of the largest contentful paint in pixels
   */
  lcpSize: number;

  /**
   * Selector of the element that moved in the largest layout shift
   */
  clsLargestShiftSource: string;
  clsLargestShiftValue: number;

  /**
   * Selector of the target of the slowest interaction
   */
  inpTarget: string;

  /**
   * Event of the slowest interaction, e.g. `click`
   */
  inpEventType: string;

  /**
   * Milliseconds from the input until its handlers ran
   */
  inpInputDelay: number;

  /**
   * Milliseconds the handlers of the input ran
   */
  inpProcessingDuration: number;

  /**
   * Milliseconds from the end of the handlers until the next paint
   */
  inpPresentationDelay: number;
};

export class WebVitalsObserver implements ChromiumMetricObserver {
  public readonly name = 'webVitals';
  public readonly plugins = [];

  constructor(private readonly options: WebVitalsObserverOptions = {}) {}

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
      client.send('Runtime.evaluate', {expression: this.getWebVitalsExpression(this.options.attribution ?? false), returnByValue: true}, (error, cdpResponse) => {
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
   * be registered with `buffered: true` and kept alive across evaluations. Entries that were
   * not delivered to the callback yet are taken with `takeRecords()`, so a read right after the
   * install, e.g. of a new document, contains the buffered entries.
   * The attributing entries are always recorded, as elements can be removed before the next read.
   *
   * @param attribution whether to return the attribution
   */
  private getWebVitalsExpression(attribution: boolean) {
    return `
  ((attribution) => {
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
      // Short selector of an element, e.g. img#hero.banner, as the element itself can't be returned
      const describe = node => {
        const element = node && node.nodeType !== 1 ? node.parentElement : node;
        if (!element || !element.tagName) return '';
        const id = element.id ? '#' + element.id : '';
        const classes = element.classList && element.classList.length > 0 ? '.' + [...element.classList].slice(0, 2).join('.') : '';
        return (element.tagName.toLowerCase() + id + classes).slice(0, 100);
      };
      buf.record = entries => {
        for (const entry of entries) {
          if (entry.entryType === 'largest-contentful-paint') {
            buf.lcp.push(entry.startTime);
            buf.lcpAttribution = {
              element: describe(entry.element),
              url: entry.url ?? '',
              renderDelay: entry.renderTime > 0 && entry.loadTime > 0 ? Math.max(0, entry.renderTime - entry.loadTime) : 0,
              size: entry.size ?? 0,
            };
          }

          if (entry.entryType === 'layout-shift' && !entry.hadRecentInput) {
            buf.cls.push(entry.value);
            if (!buf.clsAttribution || entry.value > buf.clsAttribution.value) {
              const source = (entry.sources ?? []).find(source => source.node) ?? {};
              buf.clsAttribution = {value: entry.value, source: describe(source.node)};
            }
          }

          if (entry.entryType === 'paint' && entry.name === 'first-contentful-paint') buf.fcp.push(entry.startTime);
          if (entry.entryType === 'event' && !continuous.has(entry.name)) {
            const value = Math.max(entry.duration, entry.processingEnd - entry.startTime);
            buf.inp.push(value);
            if (!buf.inpAttribution || value > buf.inpAttribution.value) {
              buf.inpAttribution = {
                value,
                target: describe(entry.target),
                eventType: entry.name,
                inputDelay: Math.max(0, entry.processingStart - entry.startTime),
                processingDuration: Math.max(0, entry.processingEnd - entry.processingStart),
                presentationDelay: Math.max(0, entry.startTime + entry.duration - entry.processingEnd),
              };
            }
          }
        }
      };
      buf.observer = new PerformanceObserver(list => buf.record(list.getEntries()));

      try {
        buf.observer.observe({type: 'largest-contentful-paint', buffered: true});
        buf.observer.observe({type: 'layout-shift', buffered: true});
        buf.observer.observe({type: 'paint', buffered: true});
        buf.observer.observe({type: 'event', buffered: true, durationThreshold: 16});
      } catch {}
    }

    // Entries are delivered to the callback asynchronously, e.g. the buffered ones right after the install
    try {
      buf.record(buf.observer.takeRecords());
    } catch {}

    const last = values => values.length > 0 ? values[values.length - 1] : undefined;
    const max = values => values.length > 0 ? Math.max(...values) : 0;
    const sum = values => values.reduce((total, value) => total + value, 0);

    // A paint that wasn't recorded yet is left out instead of reported as 0, e.g. WebKit can record it after the load event
    const vitals = {
      largestContentfulPaint: last(buf.lcp),
      firstContentfulPaint: last(buf.fcp),
      cumulativeLayoutShift: sum(buf.cls),
      interactionToNextPaint: max(buf.inp),
    };
    const reported = Object.fromEntries(Object.entries(vitals).filter(([, value]) => value !== undefined));
    if (!attribution) return reported;

    const lcp = buf.lcpAttribution;
    const cls = buf.clsAttribution;
    const inp = buf.inpAttribution;
    return Object.assign(reported,
      lcp ? {lcpElement: lcp.element, lcpUrl: lcp.url, lcpRenderDelay: lcp.renderDelay, lcpSize: lcp.size} : {},
      cls ? {clsLargestShiftSource: cls.source, clsLargestShiftValue: cls.value} : {},
      inp ? {
        inpTarget: inp.target,
        inpEventType: inp.eventType,
        inpInputDelay: inp.inputDelay,
        inpProcessingDuration: inp.processingDuration,
        inpPresentationDelay: inp.presentationDelay,
      } : {},
    );
  })(${String(attribution)})
`;
  }
}
