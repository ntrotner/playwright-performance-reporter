import {test, expect} from './fixtures';

for (const tab of ['repositories', 'projects', 'stars']) {
  test(`Open the ${tab} tab`, async ({page}) => {
    await test.step('Open profile', async () => {
      await page.goto('https://github.com/ntrotner');
      await expect(page).toHaveTitle(/ntrotner/i);
    });

    await test.step(`Open ${tab}`, async () => {
      await page.goto(`https://github.com/ntrotner?tab=${tab}`);
      await expect(page).toHaveURL(new RegExp(`tab=${tab}`));
    });
  });
}
