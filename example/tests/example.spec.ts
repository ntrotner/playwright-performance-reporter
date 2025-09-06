import { test, expect } from '@playwright/test';

test('Navigate GitHub profile tabs', async ({ page }) => {
  await test.step('Open profile', async () => {
    await page.goto('https://github.com/ntrotner');
    await expect(page).toHaveTitle(/ntrotner/i);
    await expect(page).toHaveURL(/github\.com\/ntrotner\/?$/);
  });

  await test.step('Go to Repositories tab', async () => {
    await new Promise(resolve => setTimeout(resolve, 5000));
    await page.getByRole('link', { name: 'Repositories' }).click();
    await expect(page).toHaveURL(/tab=repositories/);
  });

  await new Promise(resolve => setTimeout(resolve, 5000));

  await test.step('Go to Stars tab', async () => {
    await page.getByRole('link', { name: 'Stars' }).click();
    await expect(page).toHaveURL(/tab=stars/);
  });

  await test.step('Go to Packages tab (if available)', async () => {
    const packagesLink = page.getByRole('link', { name: 'Packages' });
    if (await packagesLink.isVisible()) {
      await packagesLink.click();
      await expect(page).toHaveURL(/tab=packages/);
    }
  });

  await new Promise(resolve => setTimeout(resolve, 5000));

  await test.step('Return to Overview', async () => {
    const overviewLink = page.getByRole('link', { name: 'Overview' });
    if (await overviewLink.isVisible()) {
      await overviewLink.click();
    } else {
      await page.goto('https://github.com/ntrotner');
    }
    await expect(page).toHaveURL(/github\.com\/ntrotner(\/)?(\?.*)?$/);
  });
});
