import { Page, Locator } from '@playwright/test';

export class ButtonComponent {
  constructor(readonly page: Page) {}

  async clickButton(buttonText: string): Promise<void> {
    await this.page.getByRole('button', { name: new RegExp(buttonText, 'i') }).click();
  }

  getButton(buttonText: string): Locator {
    return this.page.getByRole('button', { name: new RegExp(buttonText, 'i') });
  }

  async isButtonVisible(buttonText: string): Promise<boolean> {
    return this.page.getByRole('button', { name: new RegExp(buttonText, 'i') }).isVisible();
  }
}
