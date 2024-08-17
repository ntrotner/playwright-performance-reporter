# playwright-performance-reporter

> Metrics from the dev tools to measure performance

## Install

```bash
npm install playwright-performance-reporter
```

## Usage

```ts
export default defineConfig({
  ...
  reporter: [
    [
      'playwright-performance-reporter',
      {
        browsers: {
          chromium: {
            onTest: {
              metrics: ['usedJsHeapSize', 'totalJsHeapSize', 'jsHeapSizeLimit'],
              customMetrics: {
                customJsHeap: {
                  onStart: (client) => client.use('...'),
                  onStop: (client) => client.use('...')
                }
              }
            },
            onTestStep: {
              metrics: ['usedJsHeapSize', 'totalJsHeapSize', 'jsHeapSizeLimit']
            }
          },
        },
      }
    ]
  ],
 ...
});
```
