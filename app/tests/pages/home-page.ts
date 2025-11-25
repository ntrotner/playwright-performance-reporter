import { Page } from '@playwright/test';
import { config } from '../config';

export class HomePage {
  constructor(readonly page: Page) {}

  async navigate(): Promise<void> {
    await this.page.goto(config.baseURL);
  }

  async clickCreateAccount(): Promise<void> {
    await this.page.getByRole('link', { name: /create account|sign up|register/i }).click();
  }
}
