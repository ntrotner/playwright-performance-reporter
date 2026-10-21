import {
  JsonChunkPresenter,
} from './json-chunk-presenter/index.js';
import {
  JsonAggregatePresenter,
} from './json-aggregate-presenter/index.js';
import {
  ChartPresenter,
} from './chart-presenter/index.js';
import {
  TimelineDataPresenter,
} from './timeline-data-presenter/index.js';
import {
  ComparisonPresenter,
} from './comparison-presenter/index.js';
import {
  StatisticsPresenter,
} from './statistics-presenter/index.js';
import {
  MarkdownSummaryPresenter,
} from './markdown-summary-presenter/index.js';
import {
  WaterfallPresenter,
} from './waterfall-presenter/index.js';

export const nativePresenters = {
  jsonChunkPresenter: JsonChunkPresenter,
  jsonAggregatePresenter: JsonAggregatePresenter,
  chartPresenter: ChartPresenter,
  timelineDataPresenter: TimelineDataPresenter,
  comparisonPresenter: ComparisonPresenter,
  statisticsPresenter: StatisticsPresenter,
  markdownSummaryPresenter: MarkdownSummaryPresenter,
  waterfallPresenter: WaterfallPresenter,
} as const;

export type * from './comparison-presenter/types.js';
export type * from './statistics-presenter/types.js';
export type * from './markdown-summary-presenter/types.js';
export type * from './waterfall-presenter/types.js';
export type * from './json-aggregate-presenter/types.js';
