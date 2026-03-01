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
- **`lib/`**: Compiled JavaScript and type definitions (generated after `npm run build`).
- **`package.json`**: Defines dependencies, build scripts, and metadata.
- **`README.md`**: The main user-facing documentation.

## Core Features & Configuration

- **Metric Observers**: Collectors for specific performance metrics (e.g., `usedJsHeapSize`, `totalJsHeapSize`, `allPerformanceMetrics`).
- **Sampling**: Ability to collect metrics at regular intervals during long-running test steps.
- **Custom Presenters**: Flexible output formats. The library comes with `jsonChunkPresenter` and `chartPresenter` out of the box.
- **CDP Integration**: Leverages the Chrome DevTools Protocol to gather low-level performance data.

## Running the Simulation (`example/` folder)

The `example` folder is a crucial part of this repository as it provides a real-world scenario of how to use the library.

### Key Components of the Example

- **`example/playwright.config.ts`**: This file demonstrates how to configure the reporter within a Playwright setup. It includes:
  - Registration of the reporter using the `reporter` property.
  - Configuration of multiple presenters (JSON and HTML).
  - Definition of metric observers for different test hooks (`onTest`, `onTestStep`) and periodic sampling.
  - Browser launch options to enable remote debugging (`--remote-debugging-port=9222`), which is required for CDP metrics.

- **`example/tests/example.spec.ts`**: A sample test suite that demonstrates how metrics are collected during actual test steps.

### How to Run the Simulation

To see the reporter in action and verify its integration, you can run the following command from the project root:

```bash
cd example
npm run test
```

**What this command does:**
1. Navigates to the parent directory to install dependencies and build the library (`npm install && npm run build`).
2. Navigates back to the `example` directory.
3. Executes Playwright tests (`playwright test`).

After running the tests, you will find the generated performance reports in the `example/` directory:
- `example-json-writer.json`: The raw performance data in JSON format.
- `example-chart-presenter.html`: A visual representation of the performance metrics in an HTML chart.

This simulation is the best way to understand how configuration abilities in `playwright.config.ts` affect the output and to verify that the reporter is correctly integrated into a Playwright workflow.
