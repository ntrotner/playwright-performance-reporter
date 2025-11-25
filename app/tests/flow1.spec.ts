import { test, expect } from '@playwright/test';
import { HomePage, CreateAccountPage, DashboardPage } from './pages';
import { config } from './config';

test('Flow 1: Home page to Create account to Dashboard', async ({ page }) => {
  // Start on home page
  const homePage = new HomePage(page);
  await homePage.navigate();
  await expect(page).toHaveURL(config.baseURL);

  // Create account
  await homePage.clickCreateAccount();
  const createAccountPage = new CreateAccountPage(page);
  await createAccountPage.fillRegistrationForm();
  await createAccountPage.submitForm();

  // Go to dashboard
  const dashboardPage = new DashboardPage(page);
  await dashboardPage.verifyOnDashboard();
});
