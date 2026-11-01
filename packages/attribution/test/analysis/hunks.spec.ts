import {
  findChangedFile,
  findHunk,
} from '../../src/analysis/hunks.js';
import type {
  ChangedFile,
} from '../../src/types.js';

const changedFiles: ChangedFile[] = [
  {file: 'example/seeded-regressions/app/server.mjs', addedRanges: [{start: 10, end: 12}, {start: 40, end: 40}]},
  {file: 'packages/a/src/index.js', addedRanges: [{start: 1, end: 3}]},
  {file: 'packages/b/src/index.js', addedRanges: [{start: 1, end: 3}]},
  {file: 'README.md', addedRanges: [{start: 5, end: 6}]},
  {file: 'src/page.ts', addedRanges: [{start: 1, end: 100}]},
];

describe('changed hunks', () => {
  it.each([
    ['a script served from the repository', 'http://localhost:4321/app/server.mjs?v=1#top', 'example/seeded-regressions/app/server.mjs'],
    ['a file url', 'file:///home/ci/repo/example/seeded-regressions/app/server.mjs', 'example/seeded-regressions/app/server.mjs'],
    ['a relative path with dot segments', './example/seeded-regressions/app/../app/server.mjs', 'example/seeded-regressions/app/server.mjs'],
    ['an encoded url', 'http://localhost/packages/a/src%2Findex.js', 'packages/a/src/index.js'],
    ['the exact path of a root file', 'README.md', 'README.md'],
  ])('maps %s to its changed file', (_, url, file) => {
    expect(findChangedFile(changedFiles, url)?.file).toBe(file);
  });

  it.each([
    ['a single trailing segment', 'http://localhost/server.mjs'],
    ['an ambiguous suffix', 'http://localhost/src/index.js'],
    ['a transpiled source, whose served lines are not the lines of the repository', 'http://localhost:5173/src/page.ts'],
    ['an unknown file', 'http://localhost/app/other.mjs'],
    ['an empty url', ''],
    ['a script without a file', 'native array.js'],
  ])('never guesses a file for %s', (_, url) => {
    expect(findChangedFile(changedFiles, url)).toBeUndefined();
  });

  it('finds the hunk a 1-based line lies in, inclusive at both ends', () => {
    const file = changedFiles[0];

    expect([9, 10, 12, 13, 40, 41].map(line => findHunk(file, line))).toEqual([
      undefined, {start: 10, end: 12}, {start: 10, end: 12}, undefined, {start: 40, end: 40}, undefined,
    ]);
  });
});
