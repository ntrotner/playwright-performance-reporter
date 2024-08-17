export class MetricsEngineFixture {
  public setupBrowser = jest.fn();
  public destroy = jest.fn();
  public getBrowser = jest.fn();
  public getMetric = jest.fn();
  public runCustomMetric = jest.fn();
}
