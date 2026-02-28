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

    // Serialize chart data for JavaScript consumption
    const chartDataJson = JSON.stringify(this.chartData.map(d => ({
      name: d.name,
      timestamp: d.timestamp,
      labels: d.labels,
      values: d.values,
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
  </style>
</head>
<body>
  <h1>Performance Report</h1>

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
    let chart = null;

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
    });

    // Update when metric selection changes
    metricSelect.addEventListener('change', function() {
      createChart(testSelect.value, this.value);
    });
  </script>
</body>
</html>`;
  }
}
