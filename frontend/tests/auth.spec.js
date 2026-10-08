import { test, expect } from '@playwright/test';
import path from 'node:path';
import { mkdirSync } from 'node:fs';

const evidenceDir = path.resolve('test-results', 'screenshots');
mkdirSync(evidenceDir, { recursive: true });

test.describe('MoES/INCOIS Operational Authentication & RBAC Administration Suite', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/auth/login', async (route) => {
      const postData = route.request().postDataJSON() || {};
      if (postData.username === 'admin' && postData.password === 'Samudra#Admin2026!') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            access_token: 'valid-admin-auth-token',
            token_type: 'bearer',
            user: {
              username: 'admin',
              display_name: 'Lead Oceanographer',
              role: 'ADMIN',
              organization: 'INCOIS',
              badge_color: '#0284c7'
            }
          })
        });
      } else {
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ detail: 'Invalid credentials or account is disabled.' })
        });
      }
    });

    await page.route('**/api/auth/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          authenticated: true,
          user: {
            username: 'admin',
            display_name: 'Lead Oceanographer',
            role: 'ADMIN',
            organization: 'INCOIS',
            badge_color: '#0284c7'
          }
        })
      });
    });

    await page.route('**/api/auth/logout', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true })
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
  });

  test('verifies official institutional branding and header controls', async ({ page }) => {
    await page.goto('/app');

    // 1. Verify Platform Label uses official operational title
    const brand = page.locator('.brand');
    await expect(brand).toBeVisible();
    await expect(brand).toContainText('SAMUDRA-3D');

    // 2. Verify Official Footer Branding (zero SIH/hackathon tagline)
    const footer = page.locator('.workspace-footer');
    await expect(footer).toBeVisible();
    await expect(footer).toContainText('Ministry of Earth Sciences (MoES)');
    await expect(footer).toContainText('INCOIS Ocean Information Services');
    await expect(footer).not.toContainText('SIH26067');
    await expect(footer).not.toContainText('Nexus Nova');
  });

  test('executes complete institutional login, RBAC admin access, and sign-out lifecycle', async ({ page }) => {
    // 1. Navigate to /login
    await page.goto('/login');

    const loginCard = page.locator('[data-testid="login-page"]');
    await expect(loginCard).toBeVisible();
    await expect(loginCard).toContainText('Operational Ocean Information System');

    // 2. Attempt invalid password
    await page.fill('[data-testid="login-username-input"]', 'admin');
    await page.fill('[data-testid="login-password-input"]', 'WrongPassword123!');
    await page.click('[data-testid="login-submit-btn"]');

    const errorMsg = page.locator('[data-testid="login-error-msg"]');
    await expect(errorMsg).toBeVisible({ timeout: 5000 });
    await expect(errorMsg).toContainText('Authentication Error');

    // 3. Login with valid administrator credentials
    await page.fill('[data-testid="login-username-input"]', 'admin');
    await page.fill('[data-testid="login-password-input"]', 'Samudra#Admin2026!');
    await page.click('[data-testid="login-submit-btn"]');

    // 4. Should redirect to /app with authenticated officer badge
    await expect(page).toHaveURL(/.*\/app/, { timeout: 8000 });
    const officerBadge = page.locator('[data-testid="open-login-btn"]');
    await expect(officerBadge).toBeVisible();
    await expect(officerBadge).toContainText('ADMIN');

    // 5. Admin Portal button should be visible in header for ADMIN role
    const adminBtn = page.locator('[data-testid="header-admin-portal-btn"]');
    await expect(adminBtn).toBeVisible();

    // 6. Navigate to Admin Portal
    await adminBtn.click();
    await expect(page).toHaveURL(/.*\/admin/, { timeout: 5000 });

    const adminPortal = page.locator('[data-testid="admin-portal"]');
    await expect(adminPortal).toBeVisible();
    await expect(adminPortal).toContainText('SAMUDRA-3D');
    await expect(adminPortal).toContainText('ADMINISTRATION');

    // 7. Verify Admin Portal tabs
    const overviewTab = page.locator('[data-testid="admin-tab-overview"]');
    const usersTab = page.locator('[data-testid="admin-tab-users"]');
    const sensorsTab = page.locator('[data-testid="admin-tab-sensors"]');
    const auditTab = page.locator('[data-testid="admin-tab-audit_logs"]');

    await expect(overviewTab).toBeVisible();
    await expect(usersTab).toBeVisible();
    await expect(sensorsTab).toBeVisible();
    await expect(auditTab).toBeVisible();

    // Switch to users tab and verify user table
    await usersTab.click();
    const usersPanel = page.locator('[data-testid="tab-panel-users"]');
    await expect(usersPanel).toBeVisible();
    await expect(usersPanel).toContainText('Authorized Personnel Registry');

    // 8. Sign out from admin portal and verify access denial
    const signoutBtn = page.locator('[data-testid="admin-signout-btn"]');
    await signoutBtn.click();

    // After signout, visiting /admin should display Authentication Required
    await page.goto('/admin');
    await expect(page.locator('.admin-denied-container')).toBeVisible();
    await expect(page.locator('.admin-denied-container')).toContainText('Authentication Required');

    // Clean up so other specs start with clean session
    await page.evaluate(() => {
      try {
        window.sessionStorage.removeItem('samudra_signed_out');
        window.localStorage.removeItem('samudra_signed_out');
      } catch {}
    });
  });

  test('enforces strict authentication gate on /app: unauthenticated users cannot access 3D workspace or data until logged in', async ({ page }) => {
    await page.goto('/app');

    // Simulate unauthenticated visitor by setting signed out flag and clearing token
    await page.evaluate(() => {
      window.sessionStorage.setItem('samudra_signed_out', 'true');
      window.localStorage.setItem('samudra_signed_out', 'true');
      window.localStorage.removeItem('samudra_auth_token');
    });
    await page.reload();

    // 1. Verify AuthGate is displayed with zero header or footer
    const authGate = page.locator('[data-testid="auth-gate"]');
    await expect(authGate).toBeVisible();
    await expect(authGate).toContainText('SAMUDRA-3D');
    await expect(page.locator('header')).toHaveCount(0);
    await expect(page.locator('footer.workspace-footer')).toHaveCount(0);
    await expect(page.locator('[data-testid="auth-theme-toggle-btn"]')).toBeVisible();

    // Capture clean dark mode login screenshot without header/footer
    await page.screenshot({ path: path.join(evidenceDir, '01-auth-gate-dark.png') });

    // Toggle to light mode on login gate, verify and capture clean light mode login screenshot
    await page.click('[data-testid="auth-theme-toggle-btn"]');
    await expect(page.locator('header')).toHaveCount(0);
    await expect(page.locator('footer.workspace-footer')).toHaveCount(0);
    await page.screenshot({ path: path.join(evidenceDir, '02-auth-gate-light.png') });

    // Toggle back to dark
    await page.click('[data-testid="auth-theme-toggle-btn"]');

    // 2. Verify 3D ocean canvas and workspace are completely blocked/unmounted
    const canvas = page.locator('canvas');
    await expect(canvas).toHaveCount(0);
    const workspaceHeading = page.locator('#workspace');
    await expect(workspaceHeading).toHaveCount(0);

    // 3. Verify inputs start completely blank (not auto-loaded)
    const usernameInput = page.locator('[data-testid="auth-username-input"]');
    const passwordInput = page.locator('[data-testid="auth-password-input"]');
    await expect(usernameInput).toHaveValue('');
    await expect(passwordInput).toHaveValue('');

    // 4. Enter credentials and click Login
    await usernameInput.fill('admin');
    await passwordInput.fill('Samudra#Admin2026!');
    await page.click('[data-testid="auth-submit-btn"]');

    // 5. Workspace and 3D globe are now unlocked and visible
    await expect(page.locator('#workspace')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('canvas')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('[data-testid="open-login-btn"]')).toContainText('ADMIN');

    // Clean up flags so subsequent tests start with clean state
    await page.evaluate(() => {
      try {
        window.sessionStorage.removeItem('samudra_signed_out');
        window.localStorage.removeItem('samudra_signed_out');
      } catch {}
    });
  });
});
