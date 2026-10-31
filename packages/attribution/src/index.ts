// Entry point for the Playwright config: only the presenter, which needs nothing but node builtins.
// The analysis, the agent and the CLI are in `playwright-performance-attribution/analysis`.
export {
  AttributionPresenter,
  type AttributionPresenterOptions,
} from './presenter/attribution-presenter.js';
export * from './types.js';
