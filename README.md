# playwright-performance-reporter
[![Release](https://github.com/ntrotner/playwright-performance-reporter/actions/workflows/release.yml/badge.svg)](https://github.com/ntrotner/playwright-performance-reporter/actions/workflows/release.yml)
[![codecov](https://codecov.io/github/ntrotner/playwright-performance-reporter/graph/badge.svg?token=3UGRT92UT9)](https://codecov.io/github/ntrotner/playwright-performance-reporter)
[![version](https://img.shields.io/npm/v/playwright-performance-reporter.svg?style=flat-square)](https://www.npmjs.com/package/playwright-performance-reporter)

> Metrics from the dev tools to measure performance

> [!CAUTION]
> This library is work in progress. The measurement is limited to Chromium and to a primitive test suite.
> Complex test suites/cases were not considered, which will be supported down the line.
> On the long run the goal is to
> - Support Firefox and Webkit
> - Useful amount of metrics to choose from
> - Insightful visualization of the results

## Install

```bash
npm install -D playwright-performance-reporter
```

## Usage

Disable parallelism:
```ts
export default defineConfig({
  ...
  fullyParallel: false,
  workers: 1,
  ...
})
```


### Setup Reporter
To register the reporter, include the code blow in your playwright config.
Please see the subsections for more details about browser specific cases.

If you want to extend it with custom metrics, an entry exists for `customMetrics`, where the callback will get
the accumulator and CDP client. Please see the example below how to use it.

For ease of implementation, the passed object can implement the interface `MetricObserver`.

```ts
import type { CDP, Options, Metric } from 'playwright-performance-reporter';

const PlayWrightPerformanceReporterOptions: Options = {
  outputDir: '/your/path/to/dir',
  outputFile: 'output.json',
  browsers: {
    chromium: {
      onTestStep: {
        metrics: ['usedJsHeapSize', 'totalJsHeapSize'],
        customMetrics: {
          someMetric: {
            name: 'someMetric',
            onStart: (accumulator: Metric[], client: CDP.Client) => new Promise(resolve => {
                client.send('Performance.getMetrics', (error, response) => { accumulator.push(response); resolve(); });
            }),
            onStop: (accumulator: Metric[], client: CDP.Client) => new Promise(resolve => {
                client.send('Performance.getMetrics', (error, response) => { accumulator.push(response); resolve(); });
            })
          }
        }
      }
    }
  }
}

export default defineConfig({
  ...
  reporter: [
    ['playwright-performance-reporter', PlayWrightPerformanceReporterOptions]
  ],
 ...
});
```


### Chromium

Following metrics are supported out of the box:
- usedJsHeapSize
- totalJsHeapSize

The `MetricsEngine` relies on the [Chrome DevTool Protocol (CDP)](https://chromedevtools.github.io/devtools-protocol/),
which can be accessed through HTTP and WebSocket. To allow for a connection, make sure to expose a port for the remote debugging.
The reporter will try to extract that port during start-up.

#### Setup Browser
```ts
{
  name: 'chromium',
  use: {
      ...devices['Desktop Chrome'],
    launchOptions: {
      args: [
        '--remote-debugging-port=9222'
      ]
    }
  }
},
```

## Output

The top level is hooked into `test()`.


```json
{
  "Dashboard": {
    ...
  }
}
```

The content consists of steps of the test suite.
Please keep in mind that the metric request is async and is not awaited by
Playwright. This means that the browser API might still in the process of collecting the metrics,
even though Playwright instructed the browser to continue to the next step. This could lead to wrong output.
To check if the output is invalid, the values `startMeasurementOffset` and `endMeasurementOffset` are provided, which measure
the time delta in milliseconds between the request until the browser provides all metrics.

```json
{
  ...
  "click login": {
    "name": "click login",
    "startMetrics": [
      {
        "usedJsHeapSize": 8653828
      },
      {
        "totalJsHeapSize": 12611584
      }
    ],
    "stopMetrics": [
      {
        "usedJsHeapSize": 8863700
      },
      {
        "totalJsHeapSize": 12873728
      }
    ],
    "startMeasurement": 1724001218666,
    "endMeasurement": 1724001218914,
    "startMeasurementOffset": 4,
    "endMeasurementOffset": 3
  },
  "fill mock data": {
    "name": "fill mock data",
    "startMetrics": [
      {
        "usedJsHeapSize": 8863700
      },
      {
        "totalJsHeapSize": 12873728
      }
    ],
    "stopMetrics": [
      {
        "usedJsHeapSize": 9055816
      },
      {
        "totalJsHeapSize": 12873728
      }
    ],
    "startMeasurement": 1724001218914,
    "endMeasurement": 1724001218947,
    "startMeasurementOffset": 2,
    "endMeasurementOffset": 2
  },
 ...
}
```
