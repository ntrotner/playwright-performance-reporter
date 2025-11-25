import { Page, Locator } from '@playwright/test';

export class FormComponent {
  readonly formContainer: Locator;

  constructor(readonly page: Page, formSelector?: string) {
    this.formContainer = formSelector 
      ? page.locator(formSelector) 
      : page.locator('form');
  }

  async fillField(fieldName: string, value: string): Promise<void> {
    await this.formContainer.getByRole('textbox', { name: new RegExp(fieldName, 'i') }).fill(value);
  }

  async clickSubmit(): Promise<void> {
    await this.formContainer.getByRole('button', { name: /submit|save|create/i }).click();
  }

  async isVisible(): Promise<boolean> {
    return this.formContainer.isVisible();
  }
}
