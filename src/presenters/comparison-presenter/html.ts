import {
  metricUnit,
  webVitalThresholds,
} from './constants.js';
import {
  type ComparisonReport,
  type RunSummary,
  type WebVitalsAttribution,
} from './types.js';

/**
 * Sorting and labeling of the runs on the x-axis of the timeline chart
 */
type RunAxis = {
  sortValue: (run: RunSummary) => number;
  label: (run: RunSummary) => string;
};

/* eslint-disable @typescript-eslint/naming-convention */
const metricLabels: Record<string, string> = {
  entityDuration: 'Duration',
  cpuProfileActiveTime: 'CPU active',
  cpuProfileIdleTime: 'CPU idle',
  cpuProfileScriptTime: 'CPU script',
  cpuProfileGarbageCollectorTime: 'CPU GC',
  cpuProfileProgramTime: 'CPU program',
  TaskDuration: 'Task time',
  ScriptDuration: 'Script time',
  JSHeapUsedSize: 'JS heap used',
  JSHeapTotalSize: 'JS heap total',
  totalNetworkRequests: 'Requests',
  totalNetworkTransferSize: 'Transferred',
  largestContentfulPaint: 'LCP',
  firstContentfulPaint: 'FCP',
  cumulativeLayoutShift: 'CLS',
  interactionToNextPaint: 'INP',
};
/* eslint-enable @typescript-eslint/naming-convention */

/**
 * Data embedded into the visual report
 */
type EmbeddedData = {
  currentRunId: string | undefined;
  runs: Array<{id: string; label: string}>;
  steps: Array<{key: string; name: string; kind: string; attribution?: WebVitalsAttribution}>;
  metrics: Array<{name: string; label: string; unit: string}>;
  thresholds: Record<string, {good: number; poor: number}>;
  bandPercentile: number;
  values: Record<string, Record<string, Array<{median: number; lower: number; upper: number; observations: number} | undefined>>>;
};

/**
 * Serialize data to be safely embedded in a script tag
 *
 * @param data serializable data
 */
function serializeForScript(data: unknown): string {
  return JSON.stringify(data)
    .replaceAll('<', String.raw`\u003C`)
    .replaceAll('\u2028', String.raw`\u2028`)
    .replaceAll('\u2029', String.raw`\u2029`);
}

/**
 * Collect the value and percentiles of every metric of every entity per run
 *
 * @param runs compared runs, sorted for the x-axis
 */
function buildValueMatrix(runs: RunSummary[]): EmbeddedData['values'] {
  const values: EmbeddedData['values'] = {};
  for (const [runIndex, run] of runs.entries()) {
    for (const [entityKey, entity] of Object.entries(run.entities)) {
      values[entityKey] ||= {};
      for (const [metric, summary] of Object.entries(entity.metrics)) {
        values[entityKey][metric] ||= runs.map(() => undefined);
        values[entityKey][metric][runIndex] = {
          median: summary.median,
          lower: summary.lower,
          upper: summary.upper,
          observations: summary.observations,
        };
      }
    }
  }

  return values;
}

/**
 * Browser side logic of the report
 */
const clientScript = String.raw`
const data = JSON.parse(document.getElementById('comparisonData').textContent);
let chart = null;

function el(tag, attributes, children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes || {})) {
    if (key === 'text') { node.textContent = value; } else if (key === 'class') { node.className = value; } else { node.setAttribute(key, value); }
  }
  for (const child of children || []) { node.append(child); }
  return node;
}

function formatValue(metric, value) {
  if (value === undefined || value === null || Number.isNaN(value)) { return '–'; }
  const unit = metric.unit;
  const abs = Math.abs(value);
  if (unit === 'bytes') {
    if (abs >= 1048576) { return (value / 1048576).toFixed(2) + ' MB'; }
    if (abs >= 1024) { return (value / 1024).toFixed(1) + ' KB'; }
    return value.toFixed(0) + ' B';
  }
  if (unit === 'ms') { return abs >= 1000 ? (value / 1000).toFixed(2) + ' s' : value.toFixed(1) + ' ms'; }
  if (unit === 's') { return abs < 1 ? (value * 1000).toFixed(1) + ' ms' : value.toFixed(2) + ' s'; }
  if (unit === 'score') { return value.toFixed(3); }
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function metricByName(name) {
  return data.metrics.find(function (m) { return m.name === name; });
}

function fillSelect(select, options, labels) {
  select.replaceChildren(...options.map(function (option) {
    return el('option', {value: option.value, text: option.label});
  }));
}

function renderForensics() {
  const panel = document.getElementById('forensicsPanel');
  const metricName = document.getElementById('metricSelect').value;
  const stepKey = document.getElementById('stepSelect').value;
  const step = data.steps.find(function (s) { return s.key === stepKey; });
  const attr = step ? step.attribution : undefined;
  const lines = [];
  if (metricName === 'largestContentfulPaint' || metricName === 'firstContentfulPaint') {
    if (attr?.lcp) {
      lines.push('LCP element: ' + (attr.lcp.elementTag || 'unknown'));
      if (attr.lcp.url) { lines.push('URL: ' + attr.lcp.url); }
    }
  } else if (metricName === 'cumulativeLayoutShift') {
    if (attr?.cls) { lines.push('CLS source: ' + (attr.cls.source || 'unknown')); }
  } else if (metricName === 'interactionToNextPaint') {
    if (attr?.inp) { lines.push('INP interaction: ' + (attr.inp.interactionType || 'unknown')); }
  } else {
    panel.replaceChildren(); panel.style.display = 'none'; return;
  }

  if (lines.length === 0) { panel.replaceChildren(); panel.style.display = 'none'; return; }
  panel.style.display = 'block';
  panel.replaceChildren(...lines.map(function (line) { return el('p', {class: 'forensics-line', text: line}); }));
}

function updateMetrics() {
  const step = document.getElementById('stepSelect').value;
  const metricSelect = document.getElementById('metricSelect');
  const selected = metricSelect.value;
  const metrics = Object.keys(data.values[step] || {}).map(function (name) {
    const metric = metricByName(name);
    return {value: name, label: metric ? metric.label + ' (' + name + ')' : name};
  });
  fillSelect(metricSelect, metrics);
  metricSelect.value = metrics.some(function (m) { return m.value === selected; })
    ? selected
    : (metrics.length > 0 ? metrics[0].value : '');
  renderChart();
  renderForensics();
}

function renderSelectors() {
  const stepSelect = document.getElementById('stepSelect');
  const metricSelect = document.getElementById('metricSelect');

  fillSelect(stepSelect, data.steps.map(function (step) {
    return {value: step.key, label: step.name + (step.kind === 'test' ? ' (whole test)' : '')};
  }));

  stepSelect.addEventListener('change', updateMetrics);
  metricSelect.addEventListener('change', function () { renderChart(); renderForensics(); });

  if (data.steps.length > 0) { stepSelect.value = data.steps[0].key; }
  updateMetrics();
}

const thresholdBandsPlugin = {
  id: 'thresholdBands',
  afterDraw: function (chartInstance) {
    const metricName = document.getElementById('metricSelect').value;
    const threshold = data.thresholds[metricName];
    if (!threshold) { return; }
    const yAxis = chartInstance.scales.y;
    const xAxis = chartInstance.scales.x;
    const ctx = chartInstance.ctx;
    const goodY = yAxis.getPixelForValue(threshold.good);
    const poorY = yAxis.getPixelForValue(threshold.poor);
    const top = yAxis.getPixelForValue(yAxis.max);
    const bottom = yAxis.getPixelForValue(yAxis.min);
    ctx.save();
    ctx.fillStyle = 'rgba(22,163,74,0.08)';
    ctx.fillRect(xAxis.left, goodY, xAxis.right - xAxis.left, bottom - goodY);
    ctx.fillStyle = 'rgba(217,119,6,0.08)';
    ctx.fillRect(xAxis.left, poorY, xAxis.right - xAxis.left, goodY - poorY);
    ctx.fillStyle = 'rgba(220,38,38,0.08)';
    ctx.fillRect(xAxis.left, top, xAxis.right - xAxis.left, poorY - top);
    ctx.strokeStyle = 'rgba(22,163,74,0.5)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(xAxis.left, goodY); ctx.lineTo(xAxis.right, goodY); ctx.stroke();
    ctx.strokeStyle = 'rgba(220,38,38,0.5)';
    ctx.beginPath(); ctx.moveTo(xAxis.left, poorY); ctx.lineTo(xAxis.right, poorY); ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  },
};

function renderChart() {
  const step = document.getElementById('stepSelect').value;
  const metricName = document.getElementById('metricSelect').value;
  const metric = metricByName(metricName);
  if (!metric) { return; }

  const entries = (data.values[step] || {})[metricName] || [];
  const values = entries.map(function (e) { return e ? e.median : null; });
  const mins = entries.map(function (e) { return e ? e.lower : null; });
  const maxs = entries.map(function (e) { return e ? e.upper : null; });
  const observations = entries.map(function (e) { return e ? e.observations : 0; });
  const currentIndex = data.runs.findIndex(function (run) { return run.id === data.currentRunId; });
  const lowerLabel = 'p' + Math.round(data.bandPercentile * 100);
  const upperLabel = 'p' + Math.round((1 - data.bandPercentile) * 100);

  const datasets = [
    {
      label: lowerLabel,
      data: mins,
      borderColor: 'transparent',
      backgroundColor: 'rgba(37,99,235,0.12)',
      pointRadius: 0,
      spanGaps: true,
      fill: '+1',
    },
    {
      label: upperLabel,
      data: maxs,
      borderColor: 'transparent',
      pointRadius: 0,
      spanGaps: true,
      fill: false,
    },
    {
      label: 'median',
      data: values,
      borderColor: '#2563eb',
      borderWidth: 2,
      pointRadius: 0,
      spanGaps: true,
      fill: false,
    },
    {
      label: 'run',
      data: values,
      showLine: false,
      borderColor: '#2563eb',
      backgroundColor: '#2563eb',
      pointRadius: values.map(function (_, i) { return i === currentIndex ? 6 : (observations[i] <= 1 ? 2 : 3); }),
      pointBackgroundColor: values.map(function (_, i) { return i === currentIndex ? '#dc2626' : '#93c5fd'; }),
      pointBorderColor: values.map(function (_, i) { return i === currentIndex ? '#dc2626' : '#2563eb'; }),
    },
  ];

  if (chart) { chart.destroy(); }
  if (typeof Chart === 'undefined') { return; }
  chart = new Chart(document.getElementById('historyChart'), {
    type: 'line',
    data: {
      labels: data.runs.map(function (run, i) { return run.label + (i === currentIndex ? ' (current)' : ''); }),
      datasets,
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {mode: 'index', intersect: false},
      plugins: {
        legend: {labels: {filter: function (item) { return ['median', 'run'].includes(item.text); }}},
        title: {display: true, text: metric.label + ' across past runs (median with ' + lowerLabel + '/' + upperLabel + ' range)'},
        tooltip: {callbacks: {
          title: function (items) { return items.length > 0 ? data.runs[items[0].dataIndex].label : ''; },
          label: function (ctx) {
            const obs = observations[ctx.dataIndex];
            return ctx.dataset.label + ': ' + formatValue(metric, ctx.parsed.y) + ' (' + obs + ' samples)';
          },
        }},
      },
      scales: {
        x: {title: {display: true, text: 'Test runs (sorted)'}},
        y: {ticks: {callback: function (value) { return formatValue(metric, value); }}},
      },
    },
    plugins: [thresholdBandsPlugin],
  });
}

renderSelectors();
`;

/**
 * Generate the visual comparison report focused on test steps
 *
 * @param report machine readable report
 * @param runs compared runs, oldest first
 * @param runAxis sorting and labeling of the runs on the x-axis
 */
export function renderComparisonHtml(report: ComparisonReport, runs: RunSummary[], runAxis: RunAxis): string {
  const sortedRuns = [...runs].sort((a, b) => runAxis.sortValue(a) - runAxis.sortValue(b));

  const values = buildValueMatrix(sortedRuns);
  const metricNames = new Set<string>();
  for (const metrics of Object.values(values)) {
    for (const metric of Object.keys(metrics)) {
      metricNames.add(metric);
    }
  }

  const byName = [...metricNames].sort((a, b) => {
    if (a === 'entityDuration') {
      return -1;
    }

    if (b === 'entityDuration') {
      return 1;
    }

    return a.localeCompare(b);
  });
  const metrics = byName.map(name => ({name, label: metricLabels[name] ?? name, unit: metricUnit(name)}));

  const attributionByKey = new Map<string, WebVitalsAttribution>();
  for (const run of sortedRuns) {
    for (const [entityKey, entity] of Object.entries(run.entities)) {
      if (entity.attribution) {
        attributionByKey.set(entityKey, entity.attribution);
      }
    }
  }

  const data: EmbeddedData = {
    currentRunId: report.currentRun?.id,
    runs: sortedRuns.map(run => ({id: run.id, label: runAxis.label(run)})),
    steps: report.steps.map(step => ({
      key: step.key,
      name: step.name,
      kind: step.kind,
      attribution: attributionByKey.get(step.key),
    })),
    metrics,
    thresholds: webVitalThresholds,
    bandPercentile: report.settings.bandPercentile,
    values,
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Step Performance Comparison</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    :root {
      --bg: #f5f5f5; --panel: #ffffff; --text: #1f2937; --muted: #6b7280; --border: #e5e7eb;
    }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px; background: var(--bg); color: var(--text); }
    h1 { margin: 0 0 8px; font-size: 22px; }
    section { background: var(--panel); border-radius: 8px; padding: 20px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
    .controls { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 12px; align-items: center; }
    .controls label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--muted); font-weight: 600; }
    .controls select { min-width: 220px; padding: 6px 8px; border: 1px solid var(--border); border-radius: 6px; font-size: 13px; background: #fff; }
    .chart-box { position: relative; height: 420px; }
    .forensics-panel { background: #f9fafb; border: 1px solid var(--border); border-radius: 6px; padding: 12px; margin-bottom: 12px; }
    .forensics-panel p { margin: 2px 0; font-size: 13px; }
  </style>
</head>
<body>
  <section>
    <h1>Step Performance Comparison</h1>
  </section>

  <section>
    <div class="controls">
      <label>Test step
        <select id="stepSelect"></select>
      </label>
      <label>Metric
        <select id="metricSelect"></select>
      </label>
    </div>
    <div id="forensicsPanel" class="forensics-panel" style="display:none"></div>
    <div class="chart-box"><canvas id="historyChart"></canvas></div>
  </section>

  <script id="comparisonData" type="application/json">${serializeForScript(data)}</script>
  <script>${clientScript}</script>
</body>
</html>`;
}
