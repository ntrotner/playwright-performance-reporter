# AGENTS.md

Welcome to the **playwright-performance-reporter** project! This document provides an overview of the project structure, how the library works, and how to run a full simulation.

## Overview

`playwright-performance-reporter` is a Playwright reporter designed to measure and publish performance metrics from browser dev-tools (CDP) during test execution. It allows developers to collect granular performance data such as JS heap size, garbage collection events, and other CDP-based metrics.

## Project Structure

The project is organized as follows:

- **`src/`**: Contains the core source code of the reporter.
  - **`browsers/`**: Browser-specific implementations and metric observers.
  - **`presenters/`**: Logic for presenting and writing the collected metrics (e.g., JSON, HTML charts).
  - **`types/`**: Shared TypeScript types and interfaces.
- **`test/`**: Unit tests for the library.
- **`example/`**: A complete, runnable simulation of how the reporter integrates with a Playwright project.
  - **`example/basic/`**: The example suite that `npm run test` runs.
  - **`example/seeded-regressions/`**: An on-demand suite with a tiny `node:http` app, used to evaluate the attribution package. On `main` its handlers are efficient; the degraded handlers live only on the local `seeded-regressions` branch, which is never merged.
- **`packages/attribution/`**: `playwright-performance-attribution`, a standalone package (own `package.json`, lockfile, tsconfig, jest and xo config, node >= 22) with the `attributionPresenter` hand-off and the offline `performance-attribution` CLI. It is not part of the release and the root jest run ignores it. See its README.
- **`lib/`**: Compiled JavaScript and type definitions (generated after `npm run build`).
- **`package.json`**: Defines dependencies, build scripts, and metadata.
- **`README.md`**: The main user-facing documentation.

## Core Features & Configuration

- **Metric Observers**: Collectors for specific performance metrics (e.g., `usedJsHeapSize`, `totalJsHeapSize`, `allPerformanceMetrics`).
- **Sampling**: Ability to collect metrics at regular intervals during long-running test steps.
- **Custom Presenters**: Flexible output formats. The library comes with `jsonChunkPresenter`, `jsonAggregatePresenter`, `chartPresenter`, `timelineDataPresenter` and `comparisonPresenter` out of the box.
- **CDP Integration**: Leverages the Chrome DevTools Protocol to gather low-level performance data.

## Running the Simulation (`example/` folder)

The `example` folder is a crucial part of this repository as it provides a real-world scenario of how to use the library.

### Key Components of the Example

- **`example/basic/playwright.config.ts`**: This file demonstrates how to configure the reporter within a Playwright setup. It includes:
  - Registration of the reporter using the `reporter` property.
  - Configuration of multiple presenters (JSON and HTML).
  - Definition of metric observers for different test hooks (`onTest`, `onTestStep`) and periodic sampling.
  - Browser launch options to enable remote debugging (`--remote-debugging-port=9222`), which is required for CDP metrics.

- **`example/basic/tests/example.spec.ts`**: A sample test suite that demonstrates how metrics are collected during actual test steps.

### How to Run the Simulation

To see the reporter in action and verify its integration, you can run the following command from the project root:

```bash
cd example
npm run test
```

**What this command does:**
1. Navigates to the parent directory to install dependencies and build the library (`npm install && npm run build`).
2. Navigates back to the `example` directory.
3. Executes Playwright tests (`playwright test --config basic/playwright.config.ts`).

After running the tests, you will find the generated performance reports in the `example/` directory:
- `example-json-writer.json`: The raw performance data in JSON format.
- `example-json-aggregate.json`: The same data merged into one object per test case and step.
- `example-chart-presenter.html`: A visual representation of the performance metrics in an HTML chart.
- `example-comparison.json` / `example-comparison.html`: Comparison of the latest run against previous runs stored in `performance-history/`. Run the example at least twice to get a baseline, and four times to separate noise from real changes.

This simulation is the best way to understand how configuration abilities in `playwright.config.ts` affect the output and to verify that the reporter is correctly integrated into a Playwright workflow.

### Seeded regressions and the attribution eval

`cd example && npm run test:seeded-regressions` builds the reporter and runs `example/seeded-regressions/` (a leak, a heavy render and an unindexed query page, in their efficient state on `main`). It writes the comparison and `attribution-bundle.json` into `example/seeded-regressions/report/`, and heap snapshots, traces and history next to it (all gitignored). Its config imports the presenter from `packages/attribution/src/`, so it always runs the current presenter and needs no install or build of the package. The basic suite does not use the attribution presenter, so its result and duration don't depend on it.

`cd packages/attribution && npm run eval` compares worktrees of `seeded-regressions~1` (base) and `seeded-regressions` (the degraded handlers) and checks the top-1 culprit of each seeded regression. It needs the local branch and `ANTHROPIC_API_KEY`; `npm run eval -- --scripted` checks the pipeline without a model. The branch must stay exactly a no-op base commit plus the commit that degrades `example/seeded-regressions/app/server.mjs`, on top of the commit that holds the seeded suite.
