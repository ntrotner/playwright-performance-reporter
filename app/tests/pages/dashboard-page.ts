import { Page, expect } from '@playwright/test';

export class DashboardPage {
  constructor(readonly page: Page) {}

  async verifyOnDashboard(): Promise<void> {
    await expect(this.page).toHaveURL(/dashboard/i);
  }

  async clickCreateApp(): Promise<void> {
    await this.page.getByRole('button', { name: /create app|new app|add app/i }).click();
  }

  async clickCreateBranch(): Promise<void> {
    await this.page.getByRole('button', { name: /create branch|new branch|add branch/i }).click();
  }
}
