// Writes a heap snapshot to the path in argv[2] after leaking records into a module-level cache.
// With argv[3] 'closure' every record is kept by a closure in the cache, with 'keyed' by an object under a key that
// looks like page data, otherwise by the cache itself.
import process from 'node:process';
import v8 from 'node:v8';

export class LeakedRecord {
  constructor(index) {
    this.payload = Array.from({length: 16}, (_, position) => index + position);
    this.token = `secret-heap-token-${index}`;
  }
}

const cache = [];
const store = {};
export function leak(count, mode) {
  for (let index = 0; index < count; index++) {
    const record = new LeakedRecord(index);
    if (mode === 'closure') {
      cache.push(() => record.payload[0]);
    } else if (mode === 'keyed') {
      store[`session=secret-heap-key-${index}`] = record;
    } else {
      cache.push(record);
    }
  }
}

leak(2000, process.argv[3]);
v8.writeHeapSnapshot(process.argv[2]);
