# playwright-performance-reporter
[![Release](https://github.com/ntrotner/playwright-performance-reporter/actions/workflows/release.yml/badge.svg)](https://github.com/ntrotner/playwright-performance-reporter/actions/workflows/release.yml)
[![codecov](https://codecov.io/github/ntrotner/playwright-performance-reporter/graph/badge.svg?token=3UGRT92UT9)](https://codecov.io/github/ntrotner/playwright-performance-reporter)
[![version](https://img.shields.io/npm/v/playwright-performance-reporter.svg?style=flat-square)](https://www.npmjs.com/package/playwright-performance-reporter)

> Collect performance metrics from the browser dev tools during playwright test execution

> [!CAUTION]
> This library is work in progress. The measurement is limited to Chromium.
> On the long run the goal is to
> - Support Firefox and Webkit
> - Useful amount of metrics to choose from
> - Insightful visualization of the results

## Install

```bash
npm install playwright-performance-reporter --save-dev
```
or
```bash
yarn add playwright-performance-reporter --dev
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
Please see the subsections for more details about browser specific cases and advanced configurations.


```ts
import type { CDP, Options, Metric } from 'playwright-performance-reporter';

const PlaywrightPerformanceReporterOptions: Options = {
  outputDir: '/your/path/to/dir',
  outputFile: `${Date.now()}.json`,
  browsers: {
    chromium: {
      onTestStep: {
        metrics: ['allPerformanceMetrics'],
      }
    }
  }
}

export default defineConfig({
  ...
  reporter: [
    ['playwright-performance-reporter', PlaywrightPerformanceReporterOptions]
  ],
 ...
});
```

### Chromium

Following metrics are supported out of the box:
- usedJsHeapSize
- totalJsHeapSize
- allPerformanceMetrics

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

## Advanced Configurations

### Sampling
Relying solely on the start and stop metric in a long running step leads to inaccuracies and
requires a large set of runs to have a meaningful amount of metrics.
By registering a metric to be collected every `samplingTimeoutInMilliseconds` the sampling output will
be written to `samplingMetrics`, similar to `startMetrics` or `startMetrics`.
Make sure to use the unique name of the metric to register the sampling.

```ts
const PlaywrightPerformanceReporterOptions: Options = {
  ...
  browsers: {
    chromium: {
      onTestStep: {
        metrics: ['usedJsHeapSize', 'totalJsHeapSize'],
        customMetrics: {
          someMetric: {
            ...
          }
        },
        sampleMetrics: {
          totalJsHeapSize: {
            samplingTimeoutInMilliseconds: 1000
          },
          someMetric: {
            samplingTimeoutInMilliseconds: 5000
          }
        }
      }
    }
  }
}
```

### Custom Metric Observer
If you want to extend it with custom metrics, an entry exists for `customMetrics`, where the callback will get
the accumulator and CDP client. Please see the example below how to use it, or checkout the [allPerformanceMetrics](src/browsers/chromium/observers/all-performance-metrics.ts) implementation.

For ease of implementation, the passed object can implement the interface `MetricObserver`.
By using custom metrics it's possible to make observers stateful and e.g. make the next output dependent on the previous one.

```ts
import type { MetricObserver, Options } from 'playwright-performance-reporter';

class NewMetric implements MetricObserver {
  ...
}

const PlaywrightPerformanceReporterOptions: Options = {
  outputDir: '/your/path/to/dir',
  outputFile: 'output.json',
  browsers: {
    chromium: {
      onTestStep: {
        customMetrics: {
          newMetric: new NewMetric()
        }
      }
    }
  }
}
```

## Output

The top level is hooked into `test()`.


```json
{
  ...
  "4dde6239d9ac8c9468f3-82e3094b06379c51b729": {
    "TEST_CASE_PARENT": {
      "name": " > chromium > scenarios/profile.spec.ts > Profile",
      ...
    }
    ...
  }
  ...
}
```

The content consists of steps of the test suite.
Please keep in mind that the metric request is async and is not awaited by
Playwright. This means that the browser API might still in the process of collecting the metrics,
even though Playwright instructed the browser to continue to the next step. This could lead to wrong output.
To check if the output is invalid, the values `startMeasurementOffset` and `endMeasurementOffset` are provided, which measure
the time delta in milliseconds between the request until the browser provides all metrics.

See [example/output.json](example/output.json) for detailed reporter output.
