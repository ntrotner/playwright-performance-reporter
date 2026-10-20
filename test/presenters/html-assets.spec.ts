import {
  chartJsCdnUrl,
  chartJsScriptTag,
  reportContentSecurityPolicy,
} from '../../src/presenters/html-assets.js';

describe('HTML assets', () => {
  it('should inline the installed Chart.js bundle', () => {
    const tag = chartJsScriptTag(true);

    expect(tag.startsWith('<script>')).toBe(true);
    expect(tag).toContain('Chart.js v4');
    expect(tag.slice(8, -9)).not.toContain('</script');
  });

  it('should load the pinned version from the CDN on request', () => {
    expect(chartJsScriptTag(false)).toMatch(/^<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/chart\.js@4\.\d+\.\d+\/dist\/chart\.umd\.min\.js"><\/script>$/);
    expect(chartJsCdnUrl('4.5.1')).toBe('https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js');
  });

  it('should only allow the CDN if Chart.js is not inlined', () => {
    expect(reportContentSecurityPolicy(true)).toContain('script-src \'unsafe-inline\';');
    expect(reportContentSecurityPolicy(false)).toContain('script-src \'unsafe-inline\' https://cdn.jsdelivr.net;');
  });
});
