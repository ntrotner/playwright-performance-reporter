import { test, expect } from '@playwright/test';
import { 
  HomePage, 
  CreateAccountPage, 
  DashboardPage, 
  CreateAppPage, 
  CreateBranchPage, 
  HealthStatePage 
} from './pages';
import { config } from './config';

test('Flow 2: Home page to Create account to Dashboard to Create app to Create branch to Create health state', async ({ page }) => {
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

  // Create app
  await dashboardPage.clickCreateApp();
  const createAppPage = new CreateAppPage(page);
  await createAppPage.fillAppForm();
  await createAppPage.submitForm();

  // Create branch
  await dashboardPage.clickCreateBranch();
  const createBranchPage = new CreateBranchPage(page);
  await createBranchPage.fillBranchForm();
  await createBranchPage.submitForm();

  // Create some health state
  const healthStatePage = new HealthStatePage(page);
  await healthStatePage.navigateToHealthState();
  await healthStatePage.createHealthState();
  await healthStatePage.submitForm();
});
