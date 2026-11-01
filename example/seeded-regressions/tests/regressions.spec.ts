import {test, expect} from '@playwright/test';

// main and the `seeded-regressions` branch share these specs, only the handlers in app/server.mjs differ,
// so every test and step is compared against its own baseline.
for (const {name, path, step} of [
  {name: 'leak', path: '/leak', step: 'Build reports'},
  {name: 'heavy render', path: '/heavy-render', step: 'Render rows'},
  {name: 'unindexed query', path: '/unindexed-query', step: 'Look up orders'},
]) {
  test(name, async ({page}) => {
    await page.goto(path);
    await expect(page.getByTestId('result')).toHaveText('0 runs');

    // Playwright doesn't await the reporter, so give the heap snapshot and the trace of the step time to start and stop
    await test.step(step, async () => {
      await page.waitForTimeout(1000);
      for (let run = 1; run <= 5; run++) {
        await page.getByRole('button', {name: 'Run'}).click();
        await expect(page.getByTestId('result')).toHaveText(`${run} runs`);
      }
    });
    await page.waitForTimeout(3000);
  });
}
