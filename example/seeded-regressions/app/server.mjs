// App of the seeded regressions. The pages load this very file as a module from /app/server.mjs, so the handlers
// below run in the browser, and the lines in a trace or a heap snapshot are the lines of this file.
// `node seeded-regressions/app/server.mjs` serves it on port 4321, or on PORT.
//
// On main every handler is efficient. The `seeded-regressions` branch degrades the three handlers, which is the
// only difference between the two states, so every changed hunk is in this file.

/**
 * Record of a report, built on every click on "Run"
 */
export class LeakedRecord {
  constructor(index) {
    this.index = index;
    this.payload = Array.from({length: 64}, (_, position) => index + position);
  }
}

/**
 * Orders the queries look up, with unique ids
 *
 * @param {number} count amount of orders
 */
export function createOrders(count) {
  return Array.from({length: count}, (_, index) => ({id: index, total: index % 97}));
}

/**
 * Build the records of a report and sum them up
 *
 * @param {number} iterations amount of records
 */
export function leak(iterations) {
  let total = 0;
  for (let index = 0; index < iterations; index++) {
    const record = new LeakedRecord(index);
    total += record.payload.length;
  }

  return total;
}

/**
 * Render a list of rows into the root element
 *
 * @param {HTMLElement} root container of the list
 * @param {number} rows amount of rows
 */
export function heavyRender(root, rows) {
  root.replaceChildren();
  const list = document.createElement('ul');
  for (let index = 0; index < rows; index++) {
    const item = document.createElement('li');
    item.textContent = `Row ${index}`;
    list.append(item);
  }

  root.append(list);
  return list.childElementCount;
}

/**
 * Totals of the orders with the given ids
 *
 * @param {Array<{id: number; total: number}>} orders all orders
 * @param {number[]} ids ids to look up
 */
export function unindexedQuery(orders, ids) {
  const byId = new Map(orders.map(order => [order.id, order]));
  return ids.map(id => byId.get(id)?.total ?? 0);
}

/**
 * Html page that runs one handler per click on its button
 *
 * @param {string} title title of the page
 * @param {string} script module script, which imports the handlers
 */
function page(title, script) {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${title}</title></head>
<body>
<h1>${title}</h1>
<button type="button">Run</button>
<output data-testid="result">0 runs</output>
<div id="root"></div>
<script type="module">
${script}
</script>
</body>
</html>`;
}

const pages = {
  '/leak': page('Leak', `import {leak} from '/app/server.mjs';
let runs = 0;
document.querySelector('button').addEventListener('click', () => {
  leak(5000);
  document.querySelector('output').textContent = \`\${++runs} runs\`;
});`),
  '/heavy-render': page('Heavy render', `import {heavyRender} from '/app/server.mjs';
let runs = 0;
document.querySelector('button').addEventListener('click', () => {
  heavyRender(document.querySelector('#root'), 300);
  document.querySelector('output').textContent = \`\${++runs} runs\`;
});`),
  '/unindexed-query': page('Unindexed query', `import {createOrders, unindexedQuery} from '/app/server.mjs';
const orders = createOrders(20000);
const ids = Array.from({length: 4000}, (_, index) => (index * 7919) % 20000);
let runs = 0;
document.querySelector('button').addEventListener('click', () => {
  unindexedQuery(orders, ids);
  document.querySelector('output').textContent = \`\${++runs} runs\`;
});`),
};

if (typeof window === 'undefined') {
  const {createServer} = await import('node:http');
  const {readFile} = await import('node:fs/promises');
  const source = await readFile(new URL(import.meta.url), 'utf8');
  const port = Number(globalThis.process.env.PORT ?? 4321);

  createServer((request, response) => {
    const {pathname} = new URL(request.url ?? '/', 'http://localhost');
    if (pathname === '/app/server.mjs') {
      response.writeHead(200, {'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store'});
      response.end(source);
      return;
    }

    const html = pages[pathname];
    response.writeHead(html ? 200 : 404, {'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store'});
    response.end(html ?? 'Not found');
  }).listen(port, () => {
    console.log(`Seeded regressions app on http://localhost:${port}`);
  });
}
