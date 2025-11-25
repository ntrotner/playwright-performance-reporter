import { Page } from '@playwright/test';
import { config } from '../config';

export class CreateAccountPage {
  constructor(readonly page: Page) {}

  async fillRegistrationForm(): Promise<void> {
    const email: string = config.credentials.generateRandomEmail();
    const password: string = config.credentials.generateRandomPassword();

    await this.page.getByRole('textbox', { name: /email/i }).fill(email);
    await this.page.getByRole('textbox', { name: /password/i }).first().fill(password);
    
    const confirmPassword = this.page.getByRole('textbox', { name: /confirm password/i });
    if (await confirmPassword.isVisible()) {
      await confirmPassword.fill(password);
    }
  }

  async submitForm(): Promise<void> {
    await this.page.getByRole('button', { name: /create|submit|sign up|register/i }).click();
  }
}
