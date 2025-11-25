import { Page } from '@playwright/test';

export class CreateAppPage {
  constructor(readonly page: Page) {}

  async fillAppForm(appName?: string): Promise<void> {
    const name = appName ?? `test-app-${Date.now()}`;
    await this.page.getByRole('textbox', { name: /app name|name/i }).fill(name);
  }

  async submitForm(): Promise<void> {
    await this.page.getByRole('button', { name: /create|submit|save/i }).click();
  }
}
