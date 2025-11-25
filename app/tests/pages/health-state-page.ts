import { Page } from '@playwright/test';

export class HealthStatePage {
  constructor(readonly page: Page) {}

  async navigateToHealthState(): Promise<void> {
    await this.page.getByRole('link', { name: /health|health state/i }).click();
  }

  async createHealthState(stateName?: string): Promise<void> {
    const name = stateName ?? `health-state-${Date.now()}`;
    
    await this.page.getByRole('button', { name: /create|add|new/i }).click();
    
    const nameField = this.page.getByRole('textbox', { name: /name|state name/i });
    if (await nameField.isVisible()) {
      await nameField.fill(name);
    }
  }

  async submitForm(): Promise<void> {
    await this.page.getByRole('button', { name: /save|submit|create/i }).click();
  }
}
