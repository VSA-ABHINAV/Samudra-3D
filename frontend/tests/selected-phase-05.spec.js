import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const evidenceDir = path.resolve('..', 'docs', 'evidence', 'selected-phase-05');
mkdirSync(evidenceDir, { recursive: true });

const DATASET_WITH_CURRENTS = {
  dataset_id: 'incois_roms_synthetic',
  name: 'Indian Ocean ROMS (Synthetic Sample)',
  provider: 'MoES / INCOIS',
  format: 'NetCDF-4',
  temporal_resolution: 'Daily',
  spatial_resolution: '0.5 degree (~55 km)',
  coverage_bounds: { lat_min: 0.25, lat_max: 24.75, lon_min: 65.25, lon_max: 94.75 },
  depth_range: [0.0, 1000.0],
  source_mode: 'SYNTHETIC',
  status: 'READY'
};

const METADATA_WITH_CURRENTS = {
  dataset_id: 'incois_roms_synthetic',
  name: 'Indian Ocean ROMS (Synthetic Sample)',
  depth_levels_m: [0.0, 10.0, 50.0, 100.0],
  time_timestamps: ['2026-09-10T00:00:00Z', '2026-09-10T03:00:00Z'],
  variables: {
    temperature: { name: 'Sea Water Temperature', units: '°C' },
    salinity: { name: 'Sea Water Salinity', units: 'PSU' },
    currents: { name: 'Ocean Currents Velocity', units: 'm/s' }
  }
};

const DATASET_NO_CURRENTS = {
  dataset_id: 'incois_roms_nio_daily_0.05deg',
  name: 'INCOIS High-Res Regional ROMS NIO',
  provider: 'MoES / INCOIS',
  format: 'NetCDF-4',
  temporal_resolution: 'Daily',
  spatial_resolution: '0.05 degree (~5 km)',
  coverage_bounds: { lat_min: 5.0, lat_max: 22.0, lon_min: 60.0, lon_max: 95.0 },
  depth_range: [0.0, 500.0],
  source_mode: 'REAL_LOCAL',
  status: 'READY'
};

const METADATA_NO_CURRENTS = {
  dataset_id: 'incois_roms_nio_daily_0.05deg',
  name: 'INCOIS High-Res Regional ROMS NIO',
  depth_levels_m: [0.0, 10.0, 50.0],
  time_timestamps: ['2026-09-10T00:00:00Z'],
  variables: {
    temperature: { name: 'Potential Temperature', units: '°C' },
    salinity: { name: 'Practical Salinity', units: 'PSU' }
  }
};

const ARGO_FLOATS = [
  { id: 'ARGO-001', lat: 12.0, lon: 82.0, platform_type: 'argo', temperature: [28.5], depths: [0], salinity: [35.1] },
  { id: 'ARGO-002', lat: 15.0, lon: 78.0, platform_type: 'argo', temperature: [27.8], depths: [0], salinity: [34.9] }
];

const GLIDER_TRANSECTS = [
  { id: 'GLIDER-SG001', name: 'Seaglider Bay of Bengal mission', waypoints: [{ lat: 12.0, lon: 82.0 }], mission_name: 'BoB-2026' }
];

async function setupStandardRoutes(page, { activeDataset = DATASET_WITH_CURRENTS, metadata = METADATA_WITH_CURRENTS } = {}) {
  return Promise.all([
    page.route('**/api/datasets', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          active_dataset_id: activeDataset.dataset_id,
          datasets: [activeDataset]
        })
      });
    }),
    page.route('**/api/datasets/select*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'ok',
          active_dataset_id: activeDataset.dataset_id,
          active_dataset: activeDataset
        })
      });
    }),
    page.route('**/api/metadata', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(metadata)
      });
    }),
    page.route('**/api/ocean-data*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          dataset_id: activeDataset.dataset_id,
          variable: 'temperature',
          requested_depth: 0,
          selected_depth: 0.0,
          timestamp: '2026-09-10T00:00:00Z',
          lats: [10, 11],
          lons: [75, 76],
          values: [[28.5, 28.6], [28.4, 28.5]]
        })
      });
    }),
    page.route('**/api/insitu/argo*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(ARGO_FLOATS)
      });
    }),
    page.route('**/api/insitu/gliders*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(GLIDER_TRANSECTS)
      });
    }),
    page.route('**/api/insitu/**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    }),
    page.route('**/api/datasets/manifests*', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    })
  ]);
}

async function waitForDatasetReady(page) {
  await expect(page.getByRole('heading', { name: 'Indian Ocean workspace' })).toBeVisible({ timeout: 15000 });
  await expect(page.locator('[data-testid="current-time-badge"]')).toBeVisible({ timeout: 10000 });
}

test.describe('Selected Phase 05: Independent Map Layer Controls', () => {

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test('TC-P05-01: Selecting currents scalar variable does NOT silently enable streamlines', async ({ page }) => {
    await setupStandardRoutes(page);
    await page.goto('/');
    await waitForDatasetReady(page);

    // Verify streamlines badge is NOT visible initially
    await expect(page.locator('[data-testid="hud-streamlines-badge"]')).not.toBeVisible();

    // Verify streamlines toggle button is OFF initially
    const streamlinesBtn = page.locator('[data-testid="bottombar-streamlines-btn"]');
    await expect(streamlinesBtn).toBeVisible();
    await expect(streamlinesBtn).toHaveAttribute('aria-pressed', 'false');

    // Select currents variable via bottom bar
    const currentsVarBtn = page.locator('button[role="tab"]').filter({ hasText: 'CURRENTS' });
    await expect(currentsVarBtn).toBeVisible({ timeout: 5000 });
    await currentsVarBtn.click();

    // Streamlines badge must still be absent — selecting scalar variable does NOT enable streamlines
    await page.waitForTimeout(500);
    await expect(page.locator('[data-testid="hud-streamlines-badge"]')).not.toBeVisible();

    // Streamlines toggle button must still be OFF
    await expect(streamlinesBtn).toHaveAttribute('aria-pressed', 'false');

    await page.screenshot({ path: path.join(evidenceDir, 'TC-P05-01-currents-var-no-streamlines.png') });
  });

  test('TC-P05-02: Streamlines toggle turns vectors on and off independently of scalar variable', async ({ page }) => {
    await setupStandardRoutes(page);
    await page.goto('/');
    await waitForDatasetReady(page);

    const streamlinesBtn = page.locator('[data-testid="bottombar-streamlines-btn"]');
    await expect(streamlinesBtn).toBeVisible();

    // Initially off
    await expect(streamlinesBtn).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('[data-testid="hud-streamlines-badge"]')).not.toBeVisible();

    // Turn streamlines ON
    await streamlinesBtn.click();
    await expect(streamlinesBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-testid="hud-streamlines-badge"]')).toBeVisible({ timeout: 3000 });

    // Turn streamlines OFF — badge must disappear even while dataset is still active
    await streamlinesBtn.click();
    await expect(streamlinesBtn).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('[data-testid="hud-streamlines-badge"]')).not.toBeVisible();

    await page.screenshot({ path: path.join(evidenceDir, 'TC-P05-02-streamlines-toggle-independent.png') });
  });

  test('TC-P05-03: Opening observation fleet drawer does NOT change Argo or glider marker visibility', async ({ page }) => {
    await setupStandardRoutes(page);
    await page.goto('/');
    await waitForDatasetReady(page);

    // Argo and glider HUD badges must be absent initially
    await expect(page.locator('[data-testid="hud-argo-badge"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="hud-glider-badge"]')).not.toBeVisible();

    const obsBtn = page.locator('[data-testid="bottombar-observations-btn"]');
    await expect(obsBtn).toBeVisible();
    await expect(obsBtn).toHaveAttribute('aria-pressed', 'false');

    // Open fleet drawer
    await obsBtn.click();
    await expect(obsBtn).toHaveAttribute('aria-pressed', 'true');

    // Markers must STILL be absent — opening the drawer does not enable marker layers
    await page.waitForTimeout(400);
    await expect(page.locator('[data-testid="hud-argo-badge"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="hud-glider-badge"]')).not.toBeVisible();

    // Close fleet drawer
    await obsBtn.click();
    await expect(obsBtn).toHaveAttribute('aria-pressed', 'false');

    // Markers still absent after close
    await expect(page.locator('[data-testid="hud-argo-badge"]')).not.toBeVisible();

    await page.screenshot({ path: path.join(evidenceDir, 'TC-P05-03-drawer-no-marker-change.png') });
  });

  test('TC-P05-04: Visible ARGO and GLIDERS buttons toggle marker overlays with HUD synchronization', async ({ page }) => {
    await setupStandardRoutes(page);
    await page.goto('/');
    await waitForDatasetReady(page);

    const argoBtn = page.locator('[data-testid="bottombar-argo-btn"]');
    const glidersBtn = page.locator('[data-testid="bottombar-gliders-btn"]');

    // Both buttons MUST be visible and discoverable in the UI (no conditional skips)
    await expect(argoBtn).toBeVisible();
    await expect(glidersBtn).toBeVisible();

    // Initially unpressed
    await expect(argoBtn).toHaveAttribute('aria-pressed', 'false');
    await expect(glidersBtn).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('[data-testid="hud-argo-badge"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="hud-glider-badge"]')).not.toBeVisible();

    // Turn Argo ON
    await argoBtn.click();
    await expect(argoBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-testid="hud-argo-badge"]')).toBeVisible({ timeout: 5000 });
    await expect(glidersBtn).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('[data-testid="hud-glider-badge"]')).not.toBeVisible();

    // Turn Gliders ON
    await glidersBtn.click();
    await expect(glidersBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-testid="hud-glider-badge"]')).toBeVisible({ timeout: 5000 });
    await expect(argoBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-testid="hud-argo-badge"]')).toBeVisible();

    // Turn Argo OFF -> Gliders remain ON
    await argoBtn.click();
    await expect(argoBtn).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('[data-testid="hud-argo-badge"]')).not.toBeVisible();
    await expect(glidersBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-testid="hud-glider-badge"]')).toBeVisible();

    // Turn Gliders OFF
    await glidersBtn.click();
    await expect(glidersBtn).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('[data-testid="hud-glider-badge"]')).not.toBeVisible();

    await page.screenshot({ path: path.join(evidenceDir, 'TC-P05-04-argo-glider-toggle.png') });
  });

  test('TC-P05-05: Switching to dataset without currents disables streamlines button and clears vectors', async ({ page }) => {
    let currentMetadata = METADATA_WITH_CURRENTS;
    let currentActiveId = DATASET_WITH_CURRENTS.dataset_id;

    await page.route('**/api/datasets', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          active_dataset_id: currentActiveId,
          datasets: [DATASET_WITH_CURRENTS, DATASET_NO_CURRENTS]
        })
      });
    });
    await page.route('**/api/datasets/select*', async (route) => {
      const body = await route.request().postData();
      const dsId = body?.match(/"dataset_id":"([^"]+)"/)?.[1];
      const isNoCurrents = dsId === DATASET_NO_CURRENTS.dataset_id;
      currentActiveId = isNoCurrents ? DATASET_NO_CURRENTS.dataset_id : DATASET_WITH_CURRENTS.dataset_id;
      currentMetadata = isNoCurrents ? METADATA_NO_CURRENTS : METADATA_WITH_CURRENTS;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'ok',
          active_dataset_id: currentActiveId,
          active_dataset: isNoCurrents ? DATASET_NO_CURRENTS : DATASET_WITH_CURRENTS
        })
      });
    });
    await page.route('**/api/metadata', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(currentMetadata)
      });
    });
    await page.route('**/api/ocean-data*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          dataset_id: currentActiveId,
          variable: 'temperature',
          lats: [10, 11],
          lons: [75, 76],
          values: [[28.5, 28.6], [28.4, 28.5]]
        })
      });
    });
    await page.route('**/api/insitu/**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });
    await page.route('**/api/datasets/manifests*', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });

    await page.goto('/');
    await waitForDatasetReady(page);

    // Enable streamlines on the currents-supporting dataset
    const streamlinesBtn = page.locator('[data-testid="bottombar-streamlines-btn"]');
    await streamlinesBtn.click();
    await expect(streamlinesBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-testid="hud-streamlines-badge"]')).toBeVisible({ timeout: 3000 });

    // Switch to no-currents dataset
    const navDataBtn = page.locator('[data-testid="nav-data-btn"]');
    await navDataBtn.click();

    const headerDsBtn = page.locator('[data-testid="header-datasets-btn"]');
    await headerDsBtn.click();

    const dsModal = page.locator('[data-testid="dataset-manager-modal"]');
    await expect(dsModal).toBeVisible({ timeout: 5000 });

    const activateBtn = dsModal.locator(`[data-testid="activate-dataset-${DATASET_NO_CURRENTS.dataset_id}"]`);
    await activateBtn.click();

    // After switch, wait for dataset ready
    await page.waitForTimeout(1500);

    // Streamlines must now be cleared
    await expect(page.locator('[data-testid="hud-streamlines-badge"]')).not.toBeVisible({ timeout: 5000 });
    // Streamlines button must be disabled and unpressed
    await expect(streamlinesBtn).toBeDisabled();
    await expect(streamlinesBtn).toHaveAttribute('aria-pressed', 'false');

    // Attempting to click disabled streamlines button does nothing
    await streamlinesBtn.click({ force: true }).catch(() => {});
    await expect(page.locator('[data-testid="hud-streamlines-badge"]')).not.toBeVisible();

    await page.screenshot({ path: path.join(evidenceDir, 'TC-P05-05-disabled-streamlines.png') });
  });

  test('TC-P05-06: Failed metadata fetch leaves controls blocked; retry recovery restores them', async ({ page }) => {
    let metaCallCount = 0;
    await page.route('**/api/datasets', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          active_dataset_id: DATASET_WITH_CURRENTS.dataset_id,
          datasets: [DATASET_WITH_CURRENTS]
        })
      });
    });
    await page.route('**/api/datasets/select*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'ok',
          active_dataset_id: DATASET_WITH_CURRENTS.dataset_id,
          active_dataset: DATASET_WITH_CURRENTS
        })
      });
    });
    await page.route('**/api/metadata', async (route) => {
      metaCallCount++;
      if (metaCallCount === 1) {
        await route.fulfill({ status: 500, body: 'Internal Server Error' });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(METADATA_WITH_CURRENTS)
        });
      }
    });
    await page.route('**/api/ocean-data*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          dataset_id: DATASET_WITH_CURRENTS.dataset_id,
          variable: 'temperature',
          lats: [10, 11],
          lons: [75, 76],
          values: [[28.5, 28.6], [28.4, 28.5]]
        })
      });
    });
    await page.route('**/api/insitu/**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });
    await page.route('**/api/datasets/manifests*', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Indian Ocean workspace' })).toBeVisible({ timeout: 15000 });

    const errorBanner = page.locator('[data-testid="dataset-transition-error-banner"]');
    await expect(errorBanner).toBeVisible({ timeout: 10000 });

    // Streamlines button should be disabled when metadata failed
    const streamlinesBtn = page.locator('[data-testid="bottombar-streamlines-btn"]');
    await expect(streamlinesBtn).toBeDisabled();

    // Retry recovery
    const retryBtn = errorBanner.locator('button');
    await retryBtn.click();

    await expect(errorBanner).not.toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="current-time-badge"]')).toBeVisible({ timeout: 10000 });
    await expect(streamlinesBtn).not.toBeDisabled();

    await page.screenshot({ path: path.join(evidenceDir, 'TC-P05-06-retry-recovery.png') });
  });

  test('TC-P05-07: Argo-only, glider-only, both, and off states are fully user-driven and preserved across drawer operations', async ({ page }) => {
    await setupStandardRoutes(page);
    await page.goto('/');
    await waitForDatasetReady(page);

    const argoBtn = page.locator('[data-testid="bottombar-argo-btn"]');
    const glidersBtn = page.locator('[data-testid="bottombar-gliders-btn"]');
    const drawerBtn = page.locator('[data-testid="bottombar-observations-btn"]');

    // 1. Enable Argo-only
    await argoBtn.click();
    await expect(page.locator('[data-testid="hud-argo-badge"]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid="hud-glider-badge"]')).not.toBeVisible();

    // Open and close drawer -> Argo remains visible, glider remains absent
    await drawerBtn.click();
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid="hud-argo-badge"]')).toBeVisible();
    await expect(page.locator('[data-testid="hud-glider-badge"]')).not.toBeVisible();
    await drawerBtn.click();

    // 2. Enable both
    await glidersBtn.click();
    await expect(page.locator('[data-testid="hud-argo-badge"]')).toBeVisible();
    await expect(page.locator('[data-testid="hud-glider-badge"]')).toBeVisible({ timeout: 5000 });

    // 3. Disable Argo -> Glider-only
    await argoBtn.click();
    await expect(page.locator('[data-testid="hud-argo-badge"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="hud-glider-badge"]')).toBeVisible();

    // 4. Disable all -> Both off
    await glidersBtn.click();
    await expect(page.locator('[data-testid="hud-argo-badge"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="hud-glider-badge"]')).not.toBeVisible();

    await page.screenshot({ path: path.join(evidenceDir, 'TC-P05-07-all-combinations.png') });
  });

});
