import {
  JsonChunkPresenter,
} from './json-chunk-presenter/index.js';
import {
  ChartPresenter,
} from './chart-presenter/index.js';
import {
  TimelineDataPresenter,
} from './timeline-data-presenter/index.js';

export const nativePresenters = {
  jsonChunkPresenter: JsonChunkPresenter,
  chartPresenter: ChartPresenter,
  timelineDataPresenter: TimelineDataPresenter,
} as const;
