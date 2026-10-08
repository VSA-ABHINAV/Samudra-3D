import { test, expect } from '@playwright/test';

test.describe('Selected Phase 11 — Excluded-Feature Cleanup and Truthful Telemetry', () => {
  test('TC-P11-01: Admin Portal displays accurate Catalogued Data Sources without claiming connected ERDDAP live feed', async ({ page }) => {
    // Mock authentication and admin endpoints
    await page.route('**/api/auth/login', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          access_token: 'mock-admin-token-phase11',
          token_type: 'bearer',
          user: {
            user_id: 'ADM-001',
            username: 'admin',
            display_name: 'System Administrator',
            email: 'admin@samudra.incois.gov.in',
            role: 'ADMIN',
            clearance_level: 'LEVEL-3 COMMAND',
            organization: 'IT & Ocean Data Center'
          }
        })
      });
    });

    await page.route('**/api/auth/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          authenticated: true,
          user: {
            user_id: 'ADM-001',
            username: 'admin',
            display_name: 'System Administrator',
            email: 'admin@samudra.incois.gov.in',
            role: 'ADMIN',
            clearance_level: 'LEVEL-3 COMMAND',
            organization: 'IT & Ocean Data Center'
          }
        })
      });
    });

    await page.route('**/api/admin/overview', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'Operational',
          users_count: 5,
          sensors_count: 12,
          data_sources_count: 3,
          model_loaded: true,
          model_variable_count: 5
        })
      });
    });

    await page.route('**/api/admin/users', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ users: [], total: 0 })
      });
    });

    await page.route('**/api/admin/sensors', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([])
      });
    });

    await page.route('**/api/admin/data-sources', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([])
      });
    });

    await page.route('**/api/admin/audit-logs*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([])
      });
    });

    // 1. Navigate to /login and submit
    await page.goto('/login');
    await page.fill('[data-testid="login-username-input"]', 'admin');
    await page.fill('[data-testid="login-password-input"]', 'Samudra#Admin2026!');
    await page.click('[data-testid="login-submit-btn"]');
    await expect(page).toHaveURL(/.*\/app/, { timeout: 8000 });

    // 2. Open Admin Portal
    await page.goto('/admin');
    await expect(page).toHaveURL(/.*\/admin/, { timeout: 5000 });

    const adminPortal = page.locator('[data-testid="admin-portal"]');
    await expect(adminPortal).toBeVisible();

    // 3. Overview tab: Data Sources card must say "Catalogued" (not "Connected") and mark ERDDAP offline
    const dataSourcesStat = page.locator('[data-testid="admin-data-sources-stat"]');
    await expect(dataSourcesStat).toBeVisible();
    await expect(dataSourcesStat).toContainText('Catalogued');
    await expect(dataSourcesStat).not.toContainText('Connected');

    const dataSourcesCard = dataSourcesStat.locator('..');
    await expect(dataSourcesCard).toContainText('ERDDAP Offline');
    await expect(dataSourcesCard).not.toContainText('ERDDAP Connected');

    // Clean up session flags
    await page.evaluate(() => {
      try {
        window.sessionStorage.removeItem('samudra_signed_out');
        window.localStorage.removeItem('samudra_signed_out');
      } catch {}
    });
  });
});
