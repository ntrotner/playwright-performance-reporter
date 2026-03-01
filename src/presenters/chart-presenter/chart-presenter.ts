import path from 'node:path';
import fs from 'node:fs';
import {
  type PresenterWriter,
  type ResultAccumulator,
  type TestPerformance,
} from '../../types/index.js';
import {
  Logger,
} from '../../helpers/index.js';
import {
  type ChartDatapoint,
  type ChartPresenterOptions,
  type MetricSummary,
} from './types.js';

/**
 * Presenter that generates an HTML chart visualization using Chart.js
 */
export class ChartPresenter implements PresenterWriter {
  /**
   * Locator where to store the output
   */
  private readonly filePath: string | undefined;

  /**
   * Status whether writer is usable
   */
  private isClosed = false;

  /**
   * File writer
   */
  private readonly fileStream: fs.WriteStream | undefined;

  /**
   * Maps unique test ids to the computed name
   */
  private readonly testIdToParentNameMap = new Map<string, string>();

  /**
   * Chart data collected from writes
   */
  private readonly chartData: ChartDatapoint[] = [];

  /**
   * Initialize writer
   *
   * @param options defines target output
   */
  constructor(options: ChartPresenterOptions) {
    this.filePath = path.join(options.outputDir, options.outputFile);
    this.fileStream = fs.createWriteStream(this.filePath, {flags: 'w'});
  }

  /**
   * Finish chart and generate HTML
   */
  async close(): Promise<boolean> {
    this.isClosed = true;

    if (!this.fileStream || !this.filePath) {
      return false;
    }

    try {
      const html = this.generateHtml();
      this.fileStream.write(html);
      this.fileStream.end();

      return await new Promise(resolve => {
        this.fileStream?.once('finish', () => {
          resolve(true);
        });
      });
    } catch (error) {
      Logger.error(String(error));
      return false;
    }
  }

  /**
   * Delete created file
   */
  async delete(): Promise<boolean> {
    const closeResult = await this.close();
    if (!closeResult) {
      return false;
    }

    if (this.filePath) {
      fs.rmSync(this.filePath, {maxRetries: 5, retryDelay: 500});
      return true;
    }

    return false;
  }

  /**
   * Create new entry by filtering numeric data for the chart.
   *
   * @param content The result accumulator containing test performance data
   */
  async write(content: ResultAccumulator): Promise<boolean> {
    if (this.isClosed) {
      return false;
    }

    try {
      // Parse the ResultAccumulator and extract numeric metrics
      for (const [caseId, steps] of Object.entries(content)) {
        for (const [stepId, testPerformance] of Object.entries(steps)) {
          if (stepId === 'TEST_CASE_PARENT') {
            this.testIdToParentNameMap.set(caseId, testPerformance.name);
          }

          const datapoint = this.extractDatapoint(caseId, testPerformance);
          if (datapoint) {
            this.chartData.push(datapoint);
          }
        }
      }

      return true;
    } catch (error) {
      Logger.error(`Failed to parse chart data: ${String(error)}`);
      return false;
    }
  }

  /**
   * Extract a ChartDatapoint from TestPerformance data
   */
  private extractDatapoint(
    caseId: string,
    testPerformance: TestPerformance,
  ): ChartDatapoint | undefined {
    const labels: string[] = [];
    const values: number[] = [];

    // Extract numeric metrics from all available metric sources
    const metricSources = [
      testPerformance.startMetrics,
      testPerformance.stopMetrics,
      testPerformance.samplingMetrics,
    ];

    for (const metrics of metricSources) {
      if (!Array.isArray(metrics)) {
        continue;
      }

      for (const item of metrics) {
        if (!item?.metric) {
          continue;
        }

        for (const [metricName, metricValue] of Object.entries(item.metric)) {
          if (typeof metricValue === 'number' && !Number.isNaN(metricValue)) {
            labels.push(metricName);
            values.push(metricValue);
          }
        }
      }
    }

    // Skip if no numeric data found
    if (labels.length === 0) {
      return undefined;
    }

    return {
      labels,
      name: this.testIdToParentNameMap.get(caseId) ?? caseId,
      timestamp: testPerformance.endMeasurement,
      values,
    };
  }

  /**
   * Escape HTML special characters to prevent XSS
   */
  private escapeHtml(text: string): string {
    return text
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll('\'', '&#039;');
  }

  /**
   * Extract metric value from a datapoint by metric name
   *
   * @param datapoint The chart datapoint to extract from
   * @param metricName The name of the metric to extract
   * @returns The metric value or undefined if not found
   */
  private extractMetricValue(datapoint: ChartDatapoint, metricName: string): number | undefined {
    const index = datapoint.labels.indexOf(metricName);
    if (index === -1) {
      return undefined;
    }

    return datapoint.values[index];
  }

  /**
   * Get available metrics for a specific test name
   *
   * @param testName The test name to filter metrics for
   * @returns Array of metric names available for the test
   */
  private getAvailableMetricsForTest(testName: string): string[] {
    const availableMetrics = new Set<string>();

    for (const datapoint of this.chartData) {
      if (datapoint.name === testName) {
        for (const metric of datapoint.labels) {
          availableMetrics.add(metric);
        }
      }
    }

    return [...availableMetrics].sort();
  }

  /**
   * Compute summary statistics for a specific test
   *
   * @param testName The test name to compute summary for
   * @returns Map of metric names to their summary statistics
   */
  private computeMetricsSummary(testName: string): Map<string, MetricSummary> {
    const testDatapoints = this.chartData.filter(d => d.name === testName);

    if (testDatapoints.length === 0) {
      return new Map();
    }

    // Sort by timestamp to get latest value
    testDatapoints.sort((a, b) => a.timestamp - b.timestamp);

    const summary = new Map<string, MetricSummary>();
    const availableMetrics = this.getAvailableMetricsForTest(testName);

    for (const metric of availableMetrics) {
      const values: number[] = [];

      for (const datapoint of testDatapoints) {
        const value = this.extractMetricValue(datapoint, metric);
        if (value !== undefined) {
          values.push(value);
        }
      }

      if (values.length === 0) {
        continue;
      }

      const min = Math.min(...values);
      const max = Math.max(...values);
      const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
      const latest = values.at(-1)!;

      summary.set(metric, {
        min,
        max,
        avg,
        latest,
        count: values.length,
      });
    }

    return summary;
  }

  /**
   * Format metric value with appropriate units
   *
   * @param name The metric name
   * @param value The metric value
   * @returns Formatted string with units
   */
  private formatMetricValue(name: string, value: number): string {
    // Heap sizes in bytes - convert to KB or MB
    if (name.includes('Heap') || name.includes('Size')) {
      if (value > 1_048_576) { // > 1MB
        return `${(value / 1_048_576).toFixed(2)} MB`;
      }

      return `${(value / 1024).toFixed(2)} KB`;
    }

    // Duration metrics in milliseconds
    if (name.includes('Duration') || name.includes('Time')) {
      return `${value.toFixed(2)} ms`;
    }

    // Count metrics (Documents, Nodes)
    if (name === 'Documents' || name === 'Nodes') {
      return value.toString();
    }

    // Default: just format the number
    return value.toFixed(2);
  }

  /**
   * Generate HTML for metrics comparison section
   *
   * @param testName The test name to generate comparison for
   * @returns HTML string for the metrics comparison grid
   */
  private generateMetricsComparisonSection(testName: string): string {
    const availableMetrics = this.getAvailableMetricsForTest(testName);

    if (availableMetrics.length === 0) {
      return '';
    }

    const summary = this.computeMetricsSummary(testName);

    if (summary.size === 0) {
      return '';
    }

    const metricCards: string[] = [];

    for (const metric of availableMetrics) {
      const stats = summary.get(metric);
      if (!stats) {
        continue;
      }

      const formattedValue = this.formatMetricValue(metric, stats.latest);
      const formattedMin = this.formatMetricValue(metric, stats.min);
      const formattedMax = this.formatMetricValue(metric, stats.max);
      const formattedAvg = this.formatMetricValue(metric, stats.avg);

      metricCards.push(`
        <div class="metric-card">
          <h3>${this.escapeHtml(metric)}</h3>
          <div class="metric-value">${formattedValue}</div>
          <div class="metric-label">Latest</div>
          <div class="metric-stats">
            <div class="metric-min">Min: ${formattedMin}</div>
            <div class="metric-avg">Avg: ${formattedAvg}</div>
            <div class="metric-max">Max: ${formattedMax}</div>
          </div>
          <div class="metric-count">Data Points: ${stats.count}</div>
        </div>
      `);
    }

    return `
  <div class="metrics-comparison-section">
    <h2>Metrics Summary</h2>
    <div id="metricsComparisonGrid" class="metrics-comparison-grid">
      ${metricCards.join('\n')}
    </div>
  </div>
`;
  }

  /**
   * Extract all unique metric names from chart data
   */
  private getUniqueMetrics(): string[] {
    const metricSet = new Set<string>();
    for (const data of this.chartData) {
      for (const label of data.labels) {
        metricSet.add(label);
      }
    }

    return [...metricSet].sort();
  }

  /**
   * Get all unique test names from chart data
   */
  private getUniqueTestNames(): string[] {
    const nameSet = new Set<string>();
    for (const data of this.chartData) {
      nameSet.add(data.name);
    }

    return [...nameSet];
  }

  /**
   * Generate the HTML with Chart.js visualization
   */
  private generateHtml(): string {
    const uniqueMetrics = this.getUniqueMetrics();
    const testNames = this.getUniqueTestNames();

    // Get available comparison metrics for the first test (default selection)
    const defaultTest = testNames[0] ?? '';

    // Serialize chart data for JavaScript consumption
    const chartDataJson = JSON.stringify(this.chartData.map(d => ({
      name: d.name,
      timestamp: d.timestamp,
      labels: d.labels,
      values: d.values,
    })));

    // Serialize metrics summary for JavaScript consumption
    const metricsSummaryJson = JSON.stringify([...this.computeMetricsSummary(defaultTest).entries()].map(([key, value]) => ({
      name: key,
      ...value,
    })));

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Performance Report Chart</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      margin: 20px;
      background-color: #f5f5f5;
    }
    .control-panel {
      background: white;
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 20px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      display: flex;
      gap: 20px;
      flex-wrap: wrap;
    }
    .control-group {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .control-panel label {
      font-weight: 600;
    }
    .control-panel select {
      padding: 8px 12px;
      border-radius: 4px;
      border: 1px solid #ccc;
      font-size: 14px;
      min-width: 200px;
    }
    .chart-container {
      background: white;
      border-radius: 8px;
      padding: 20px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    h1 {
      color: #333;
      margin-bottom: 20px;
    }
    #performanceChart {
      max-height: 500px;
    }
    .metrics-comparison-section {
      background: white;
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 20px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .metrics-comparison-section h2 {
      margin: 0 0 15px 0;
      font-size: 18px;
      color: #333;
    }
    .metrics-comparison-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 15px;
    }
    .metric-card {
      background: #f8f9fa;
      border-radius: 8px;
      padding: 15px;
      border: 1px solid #e9ecef;
    }
    .metric-card h3 {
      margin: 0 0 10px 0;
      font-size: 14px;
      color: #666;
      font-weight: 600;
    }
    .metric-value {
      font-size: 24px;
      font-weight: bold;
      color: #333;
      margin-bottom: 5px;
    }
    .metric-label {
      font-size: 12px;
      color: #888;
      margin-bottom: 10px;
    }
    .metric-stats {
      border-top: 1px solid #dee2e6;
      padding-top: 10px;
      font-size: 12px;
    }
    .metric-min {
      color: #28a745;
      margin-bottom: 3px;
    }
    .metric-avg {
      color: #6c757d;
      margin-bottom: 3px;
    }
    .metric-max {
      color: #dc3545;
    }
    .metric-count {
      font-size: 11px;
      color: #adb5bd;
      margin-top: 10px;
      text-align: right;
    }
  </style>
</head>
<body>
  <h1>Performance Report</h1>

  ${this.generateMetricsComparisonSection(defaultTest)}

  <div class="control-panel">
    <div class="control-group">
      <label for="testSelect">Test:</label>
      <select id="testSelect">
        ${testNames.map(n => `<option value="${this.escapeHtml(n)}">${this.escapeHtml(n)}</option>`).join('\n        ')}
      </select>
    </div>

    <div class="control-group">
      <label for="metricSelect">Metric:</label>
      <select id="metricSelect">
        ${uniqueMetrics.map(m => `<option value="${this.escapeHtml(m)}">${this.escapeHtml(m)}</option>`).join('\n        ')}
      </select>
    </div>
  </div>

  <div class="chart-container">
    <canvas id="performanceChart" width="900" height="500"></canvas>
  </div>

  <script>
    const chartData = ${chartDataJson};
    const metricsSummaryData = ${metricsSummaryJson};
    let chart = null;

    function formatMetricValue(name, value) {
      if (name.includes('Heap') || name.includes('Size')) {
        if (value > 1048576) {
          return (value / 1048576).toFixed(2) + ' MB';
        }
        return (value / 1024).toFixed(2) + ' KB';
      }
      if (name.includes('Duration') || name.includes('Time')) {
        return value.toFixed(2) + ' ms';
      }
      if (name === 'Documents' || name === 'Nodes') {
        return value.toString();
      }
      return value.toFixed(2);
    }

    function computeMetricsSummaryForTest(testName) {
      const testPoints = chartData.filter(p => p.name === testName);
      if (testPoints.length === 0) {
        return new Map();
      }

      testPoints.sort((a, b) => a.timestamp - b.timestamp);

      const allComparisonMetrics = metricsSummaryData.map(summaryData => summaryData.name);

      const summary = new Map();

      for (const metric of allComparisonMetrics) {
        const values = [];
        for (const point of testPoints) {
          const idx = point.labels.indexOf(metric);
          if (idx !== -1) {
            values.push(point.values[idx]);
          }
        }

        if (values.length === 0) {
          continue;
        }

        const min = Math.min(...values);
        const max = Math.max(...values);
        const avg = values.reduce((s, v) => s + v, 0) / values.length;
        const latest = values[values.length - 1];

        summary.set(metric, { min, max, avg, latest, count: values.length });
      }

      return summary;
    }

    function renderMetricsComparison(metricsSummary) {
      const grid = document.getElementById('metricsComparisonGrid');
      if (!grid) {
        return;
      }

      let html = '';
      for (const [metric, stats] of metricsSummary.entries()) {
        const formattedValue = formatMetricValue(metric, stats.latest);
        const formattedMin = formatMetricValue(metric, stats.min);
        const formattedMax = formatMetricValue(metric, stats.max);
        const formattedAvg = formatMetricValue(metric, stats.avg);

        html += \`
          <div class="metric-card">
            <h3>\${metric}</h3>
            <div class="metric-value">\${formattedValue}</div>
            <div class="metric-label">Latest</div>
            <div class="metric-stats">
              <div class="metric-min">Min: \${formattedMin}</div>
              <div class="metric-avg">Avg: \${formattedAvg}</div>
              <div class="metric-max">Max: \${formattedMax}</div>
            </div>
            <div class="metric-count">Runs: \${stats.count}</div>
          </div>
        \`;
      }

      grid.innerHTML = html;
    }

    function updateMetricsComparison(testName, metricName) {
      // The metrics comparison shows all available metrics for the test,
      // but we could filter by the selected metric if needed
      const summary = computeMetricsSummaryForTest(testName);
      renderMetricsComparison(summary);
    }

    function getChartData(testName, metricName) {
      // Filter data points for the selected test that have the selected metric
      const filteredData = chartData.filter(point => {
        return point.name === testName && point.labels.includes(metricName);
      });

      if (filteredData.length === 0) {
        return { labels: [], datasets: [] };
      }

      // Sort by timestamp
      filteredData.sort((a, b) => a.timestamp - b.timestamp);

      // Extract the metric values
      const labels = filteredData.map(p => new Date(p.timestamp).toLocaleString());
      const values = filteredData.map(p => {
        const metricIndex = p.labels.indexOf(metricName);
        return metricIndex !== -1 ? p.values[metricIndex] : null;
      });

      return {
        labels: labels,
        datasets: [{
          label: metricName,
          data: values,
          backgroundColor: 'rgba(54, 162, 235, 0.6)',
          borderColor: 'rgba(54, 162, 235, 1)',
          borderWidth: 2,
          tension: 0.3,
          fill: false
        }]
      };
    }

    function createChart(testName, metricName) {
      const data = getChartData(testName, metricName);

      if (chart) {
        chart.destroy();
      }

      const ctx = document.getElementById('performanceChart').getContext('2d');
      chart = new Chart(ctx, {
        type: 'line',
        data: data,
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: {
            mode: 'index',
            intersect: false
          },
          plugins: {
            legend: {
              position: 'top'
            },
            title: {
              display: true,
              text: testName + ' - ' + metricName
            }
          },
          scales: {
            x: {
              display: true,
              title: {
                display: true,
                text: 'Timestamp'
              }
            },
            y: {
              display: true,
              title: {
                display: true,
                text: metricName
              }
            }
          }
        }
      });
    }

    const testSelect = document.getElementById('testSelect');
    const metricSelect = document.getElementById('metricSelect');

    // Initialize
    createChart(testSelect.value, metricSelect.value);

    // Update when test selection changes
    testSelect.addEventListener('change', function() {
      createChart(this.value, metricSelect.value);
      updateMetricsComparison(this.value, metricSelect.value);
    });

    // Update when metric selection changes
    metricSelect.addEventListener('change', function() {
      createChart(testSelect.value, this.value);
      updateMetricsComparison(testSelect.value, this.value);
    });

    // Initial metrics comparison render
    updateMetricsComparison(testSelect.value, metricSelect.value);
  </script>
</body>
</html>`;
  }
}
