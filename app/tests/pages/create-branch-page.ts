import { Page } from '@playwright/test';

export class CreateBranchPage {
  constructor(readonly page: Page) {}

  async fillBranchForm(branchName?: string): Promise<void> {
    const name = branchName ?? `test-branch-${Date.now()}`;
    await this.page.getByRole('textbox', { name: /branch name|name/i }).fill(name);
  }

  async submitForm(): Promise<void> {
    await this.page.getByRole('button', { name: /create|submit|save/i }).click();
  }
}
