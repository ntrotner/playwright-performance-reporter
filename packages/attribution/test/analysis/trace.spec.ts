import fs from 'node:fs';
import path from 'node:path';
import {
  traceSelfTime,
} from '../../src/analysis/trace.js';
import {
  temporaryDirectory,
} from '../helpers.js';
import {
  type ProfiledFunction,
  writeTrace,
} from '../fixtures/trace.js';

const app = 'http://localhost:4321/app/server.mjs';
const functions: ProfiledFunction[] = [
  {
    functionName: 'heavyRender', url: app, lineNumber: 46, samples: [[55, 30], [52, 5]],
  },
  {
    functionName: 'unindexedQuery', url: `${app}?token=secret`, lineNumber: 64, samples: [[66, 12]],
  },
  // Same self time as `b`, which comes first by its url
  {
    functionName: 'tie', url: 'http://localhost:4321/b.js', lineNumber: 0, samples: [[1, 2]],
  },
  {
    functionName: 'tie', url: 'http://localhost:4321/a.js', lineNumber: 0, samples: [[1, 2]],
  },
  {
    functionName: '', url: '', lineNumber: 0, samples: [[1, 7]],
  },
];

describe('trace self time', () => {
  const dir = temporaryDirectory('attribution-trace-');

  it('sums the self time per function and line of a gzip trace, most first, with deterministic ties', async () => {
    const file = path.join(dir, 'trace.json.gz');
    writeTrace(file, functions);

    const result = await traceSelfTime(file);

    expect(result.totalSelfTime).toBe(58);
    expect(result.functions).toEqual([
      {
        functionName: 'heavyRender', url: app, line: 47, column: 3, selfTime: 35, lines: [{line: 55, selfTime: 30}, {line: 52, selfTime: 5}],
      },
      {
        functionName: 'unindexedQuery', url: app, line: 65, column: 3, selfTime: 12, lines: [{line: 66, selfTime: 12}],
      },
      {
        functionName: 'tie', url: 'http://localhost:4321/a.js', line: 1, column: 3, selfTime: 2, lines: [{line: 1, selfTime: 2}],
      },
      {
        functionName: 'tie', url: 'http://localhost:4321/b.js', line: 1, column: 3, selfTime: 2, lines: [{line: 1, selfTime: 2}],
      },
    ]);
  });

  it('reads a plain json trace, and falls back to the line of the function without line ticks', async () => {
    const file = path.join(dir, 'trace.json');
    writeTrace(file, functions.slice(0, 1), {gzip: false, withLines: false});

    const result = await traceSelfTime(file);

    expect(result.functions[0]).toMatchObject({functionName: 'heavyRender', selfTime: 35, lines: [{line: 47, selfTime: 35}]});
  });

  it('keeps the top functions only', async () => {
    const file = path.join(dir, 'many.json.gz');
    writeTrace(file, Array.from({length: 30}, (_, index) => ({
      functionName: `fn${index}`, url: app, lineNumber: index, samples: [[index + 1, index + 1]],
    })));

    const result = await traceSelfTime(file);

    expect(result.functions).toHaveLength(25);
    expect(result.functions[0].functionName).toBe('fn29');
  });

  it('rejects a file that is no trace', async () => {
    const file = path.join(dir, 'not-a-trace.json');
    fs.writeFileSync(file, '{"nodes": []}');

    await expect(traceSelfTime(file)).rejects.toThrow('not a Chrome trace');
  });
});
