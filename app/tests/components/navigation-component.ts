import { Page, Locator } from '@playwright/test';

export class NavigationComponent {
  readonly navContainer: Locator;

  constructor(readonly page: Page) {
    this.navContainer = page.locator('nav, header, [role="navigation"]');
  }

  async navigateTo(linkText: string): Promise<void> {
    await this.page.getByRole('link', { name: new RegExp(linkText, 'i') }).click();
  }

  async isVisible(): Promise<boolean> {
    return this.navContainer.isVisible();
  }
}
