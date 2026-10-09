import { test, expect } from '@playwright/test';

test.describe('Public Homepage & Unified Navigation Suite', () => {
  test('renders public homepage with institutional branding, provenance disclosures, and all workflow cards', async ({ page }) => {
    await page.goto('/home');

    // 1. Verify Public Homepage container is visible
    const homepage = page.locator('[data-testid="public-homepage"]');
    await expect(homepage).toBeVisible();

    // 2. Verify MoES / INCOIS Institutional Branding
    await expect(homepage).toContainText('SAMUDRA-3D');
    await expect(homepage).toContainText('Ministry of Earth Sciences (MoES)');
    await expect(homepage).toContainText('INCOIS Ocean Information Services');

    // 3. Verify Confirmed Workflow Cards Grid
    const cardsGrid = page.locator('[data-testid="workflow-cards-grid"]');
    await expect(cardsGrid).toBeVisible();

    await expect(page.locator('[data-testid="workflow-card-explore"]')).toBeVisible();
    await expect(page.locator('[data-testid="workflow-card-observations"]')).toBeVisible();
    await expect(page.locator('[data-testid="workflow-card-analysis"]')).toBeVisible();
    await expect(page.locator('[data-testid="workflow-card-physics"]')).toBeVisible();
    await expect(page.locator('[data-testid="workflow-card-data"]')).toBeVisible();
    await expect(page.locator('[data-testid="workflow-card-operations"]')).toBeVisible();

    // 4. Verify Scientific Truthfulness Disclosure
    await expect(homepage).toContainText('Data Provenance & Scientific Truthfulness Declaration');
    await expect(homepage).toContainText('Offline Integration Gap');
  });

  test('opens data sources & specifications modal from homepage button', async ({ page }) => {
    await page.goto('/home');

    const specsBtn = page.locator('[data-testid="hero-specs-btn"]');
    await expect(specsBtn).toBeVisible();
    await specsBtn.click();

    const sourcesModal = page.locator('[data-testid="data-sources-modal"]');
    await expect(sourcesModal).toBeVisible();
    await expect(sourcesModal).toContainText('Dataset directory');

    // Close modal
    const closeBtn = sourcesModal.locator('button:has-text("Close"), button:has-text("✕"), [aria-label="Close dataset directory"]').first();
    await closeBtn.click();
    await expect(sourcesModal).not.toBeVisible();
  });

  test('navigates from homepage to login page', async ({ page }) => {
    await page.goto('/home');

    await page.evaluate(() => {
      window.sessionStorage.setItem('samudra_signed_out', 'true');
      window.localStorage.setItem('samudra_signed_out', 'true');
      window.localStorage.removeItem('samudra_auth_token');
    });
    await page.reload();

    const loginBtn = page.locator('[data-testid="homepage-login-btn"]');
    await expect(loginBtn).toBeVisible();
    await loginBtn.click();

    await expect(page).toHaveURL(/.*\/login/);
    const loginCard = page.locator('[data-testid="login-page"]');
    await expect(loginCard).toBeVisible();

    // Clean up flags
    await page.evaluate(() => {
      try {
        window.sessionStorage.removeItem('samudra_signed_out');
        window.localStorage.removeItem('samudra_signed_out');
      } catch {}
    });
  });

  test('navigates from homepage to /app and enforces auth gate when unauthenticated', async ({ page }) => {
    await page.goto('/home');

    await page.evaluate(() => {
      window.sessionStorage.setItem('samudra_signed_out', 'true');
      window.localStorage.setItem('samudra_signed_out', 'true');
      window.localStorage.removeItem('samudra_auth_token');
    });
    await page.reload();

    const launchBtn = page.locator('[data-testid="homepage-launch-btn"]');
    await expect(launchBtn).toBeVisible();
    await launchBtn.click();

    await expect(page).toHaveURL(/.*\/app/);
    const authGate = page.locator('[data-testid="auth-gate"]');
    await expect(authGate).toBeVisible();

    // Clean up flags
    await page.evaluate(() => {
      try {
        window.sessionStorage.removeItem('samudra_signed_out');
        window.localStorage.removeItem('samudra_signed_out');
      } catch {}
    });
  });

  test('authenticated user can launch workstation and return to homepage overview via brand logo', async ({ page }) => {
    // Navigate to /app with auto-seeded officer session
    await page.goto('/app');

    const brand = page.locator('.brand');
    await expect(brand).toBeVisible();
    await expect(page.locator('#workspace')).toBeVisible({ timeout: 8000 });

    // Click brand logo to return to portal overview /home
    await brand.click();
    await expect(page).toHaveURL(/.*\/home/);

    const homepage = page.locator('[data-testid="public-homepage"]');
    await expect(homepage).toBeVisible();

    // Return to workstation via launch button
    const launchBtn = page.locator('[data-testid="homepage-launch-btn"]');
    await launchBtn.click();
    await expect(page).toHaveURL(/.*\/app/);
    await expect(page.locator('#workspace')).toBeVisible();
  });

  test('clicking Explore workflow card opens workstation in 3D exploration mode', async ({ page }) => {
    await page.goto('/home');
    const exploreBtn = page.locator('[data-testid="workflow-btn-explore"]');
    await expect(exploreBtn).toBeVisible();
    await exploreBtn.click();

    await expect(page).toHaveURL(/.*\/app\?workflow=explore/);
    await expect(page.locator('#workspace')).toBeVisible({ timeout: 8000 });
  });

  test('clicking Observations workflow card opens workstation and observation fleet drawer', async ({ page }) => {
    await page.goto('/home');
    const observationsBtn = page.locator('[data-testid="workflow-btn-observations"]');
    await expect(observationsBtn).toBeVisible();
    await observationsBtn.click();

    await expect(page).toHaveURL(/.*\/app\?workflow=observations/);
    await expect(page.locator('#workspace')).toBeVisible({ timeout: 8000 });
    const drawer = page.locator('[data-testid="observation-drawer"]');
    await expect(drawer).toBeVisible({ timeout: 8000 });
    await expect(drawer).toContainText('OBSERVATION FLEET');
  });

  test('clicking Analysis workflow card opens workstation and model comparison suite modal', async ({ page }) => {
    await page.goto('/home');
    const analysisBtn = page.locator('[data-testid="workflow-btn-analysis"]');
    await expect(analysisBtn).toBeVisible();
    await analysisBtn.click();

    await expect(page).toHaveURL(/.*\/app\?workflow=analysis/);
    await expect(page.locator('#workspace')).toBeVisible({ timeout: 8000 });
    const modal = page.locator('[data-testid="model-comparison-modal"]');
    await expect(modal).toBeVisible({ timeout: 8000 });
    await expect(modal).toContainText('Model Prediction vs In-Situ Observation Comparison');
  });

  test('clicking Physics workflow card opens workstation and deep ocean physics modal', async ({ page }) => {
    await page.goto('/home');
    const physicsBtn = page.locator('[data-testid="workflow-btn-physics"]');
    await expect(physicsBtn).toBeVisible();
    await physicsBtn.click();

    await expect(page).toHaveURL(/.*\/app\?workflow=physics/);
    await expect(page.locator('#workspace')).toBeVisible({ timeout: 8000 });
    const modal = page.locator('[data-testid="in-depth-ocean-modal"]');
    await expect(modal).toBeVisible({ timeout: 8000 });
    await expect(modal).toContainText('In-Depth Ocean Physics');
  });

  test('clicking Data workflow card opens workstation and dataset manager modal', async ({ page }) => {
    await page.goto('/home');
    const dataBtn = page.locator('[data-testid="workflow-btn-data"]');
    await expect(dataBtn).toBeVisible();
    await dataBtn.click();

    await expect(page).toHaveURL(/.*\/app\?workflow=data/);
    await expect(page.locator('#workspace')).toBeVisible({ timeout: 8000 });
    const modal = page.locator('[data-testid="dataset-manager-modal"]');
    await expect(modal).toBeVisible({ timeout: 8000 });
    await expect(modal).toContainText('Dataset Management & Provenance Architecture');
  });

  test('clicking Operations workflow card opens workstation and fisherman operations modal', async ({ page }) => {
    await page.goto('/home');
    const operationsBtn = page.locator('[data-testid="workflow-btn-operations"]');
    await expect(operationsBtn).toBeVisible();
    await operationsBtn.click();

    await expect(page).toHaveURL(/.*\/app\?workflow=operations/);
    await expect(page.locator('#workspace')).toBeVisible({ timeout: 8000 });
    const modal = page.locator('[data-testid="fisherman-mode-modal"]');
    await expect(modal).toBeVisible({ timeout: 8000 });
    await expect(modal).toContainText('Fisherman Operational Intelligence');
  });
});
