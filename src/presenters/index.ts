import {
  JsonChunkPresenter,
} from './json-chunk-presenter/index.js';
import {
  ChartPresenter,
} from './chart-presenter/index.js';

export const nativePresenters = {
  jsonChunkPresenter: JsonChunkPresenter,
  chartPresenter: ChartPresenter,
} as const;
