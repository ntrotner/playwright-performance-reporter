// Writes a heap snapshot to the path in argv[2] after leaking records into a module-level cache.
// With argv[3] 'closure' every record is kept by a closure in the cache, with 'property' by the property of an object
// in the module scope, otherwise by the cache itself.
import process from 'node:process';
import v8 from 'node:v8';

export class LeakedRecord {
  constructor(index) {
    this.payload = Array.from({length: 16}, (_, position) => index + position);
    this.token = `secret-heap-token-${index}`;
  }
}

const cache = [];
const store = {items: []};
export function leak(count, mode) {
  for (let index = 0; index < count; index++) {
    const record = new LeakedRecord(index);
    if (mode === 'closure') {
      cache.push(() => record.payload[0]);
    } else if (mode === 'property') {
      store.items.push(record);
    } else {
      cache.push(record);
    }
  }
}

leak(2000, process.argv[3]);
v8.writeHeapSnapshot(process.argv[2]);
