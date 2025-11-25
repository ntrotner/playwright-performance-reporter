import { Page, Locator } from '@playwright/test';

export class NavigationComponent {
  readonly navContainer: Locator;

  constructor(readonly page: Page) {
    // Prioritize the nav element, then fall back to header or ARIA navigation
    this.navContainer = page.locator('nav').first();
  }

  async navigateTo(linkText: string): Promise<void> {
    await this.page.getByRole('link', { name: new RegExp(linkText, 'i') }).click();
  }

  async isVisible(): Promise<boolean> {
    return this.navContainer.isVisible();
  }
}
