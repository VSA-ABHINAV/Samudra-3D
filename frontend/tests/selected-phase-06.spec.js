import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const evidenceDir = path.resolve('..', 'docs', 'evidence', 'selected-phase-06');
mkdirSync(evidenceDir, { recursive: true });

const DATASET_SYNTHETIC = {
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

const METADATA_SYNTHETIC = {
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

const MOCK_ANOMALY_REAL = {
  variable: 'temperature',
  unit: 'degC',
  threshold: 0.5,
  depth_min: 0.0,
  depth_max: 4000.0,
  dataset_id: 'incois_roms_synthetic',
  source_mode: 'REAL_LOCAL',
  points: [
    {
      platform_id: 'ARGO-REAL-01',
      platform_type: 'argo',
      lat: 12.0,
      lon: 82.0,
      depth: 10.0,
      variable: 'temperature',
      delta: 0.85,
      observed_value: 27.5,
      model_value: 28.35,
      qc_flag: 1,
      is_alert: true
    }
  ],
  coverage_bins: [
    { lat_center: 12.25, lon_center: 82.25, count: 1, mean_delta: 0.85, has_data: true }
  ],
  alert_count: 1,
  total_valid_pairs: 1,
  platform_count: 1,
  bias: 0.85,
  mae: 0.85,
  rmse: 0.85,
  support_radius_km: 55.0,
  latency_ms: 10.0
};

const MOCK_ANOMALY_SYNTHETIC = {
  variable: 'temperature',
  unit: 'degC',
  threshold: 0.5,
  depth_min: 0.0,
  depth_max: 4000.0,
  dataset_id: 'incois_roms_synthetic',
  source_mode: 'SYNTHETIC',
  points: [
    {
      platform_id: 'ARGO-SYN-01',
      platform_type: 'argo',
      lat: 15.0,
      lon: 78.0,
      depth: 10.0,
      variable: 'temperature',
      delta: -1.20,
      observed_value: 29.0,
      model_value: 27.8,
      qc_flag: 1,
      is_alert: true
    },
    {
      platform_id: 'ARGO-SYN-02',
      platform_type: 'argo',
      lat: 16.0,
      lon: 79.0,
      depth: 10.0,
      variable: 'temperature',
      delta: -0.60,
      observed_value: 28.6,
      model_value: 28.0,
      qc_flag: 1,
      is_alert: true
    }
  ],
  coverage_bins: [
    { lat_center: 15.25, lon_center: 78.25, count: 2, mean_delta: -0.90, has_data: true }
  ],
  alert_count: 2,
  total_valid_pairs: 2,
  platform_count: 2,
  bias: -0.90,
  mae: 0.90,
  rmse: 0.95,
  support_radius_km: 55.0,
  latency_ms: 11.0
};

const MOCK_ANOMALY_SAL = {
  variable: 'salinity',
  unit: 'PSU',
  threshold: 0.1,
  depth_min: 0.0,
  depth_max: 4000.0,
  dataset_id: 'incois_roms_synthetic',
  source_mode: 'REAL_LOCAL',
  points: [
    {
      platform_id: 'ARGO-REAL-01',
      platform_type: 'argo',
      lat: 12.0,
      lon: 82.0,
      depth: 10.0,
      variable: 'salinity',
      delta: -0.15,
      observed_value: 35.1,
      model_value: 34.95,
      qc_flag: 1,
      is_alert: true
    }
  ],
  coverage_bins: [
    { lat_center: 12.25, lon_center: 82.25, count: 1, mean_delta: -0.15, has_data: true }
  ],
  alert_count: 1,
  total_valid_pairs: 1,
  platform_count: 1,
  bias: -0.15,
  mae: 0.15,
  rmse: 0.15,
  support_radius_km: 55.0,
  latency_ms: 9.0
};

async function setupStandardRoutes(page, { activeDataset = DATASET_SYNTHETIC, metadata = METADATA_SYNTHETIC } = {}) {
  let lastAnomalyQuery = null;

  await Promise.all([
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
    page.route('**/api/anomaly/field*', async (route) => {
      const url = new URL(route.request().url());
      const varParam = url.searchParams.get('variable') || 'temperature';
      const srcParam = url.searchParams.get('source_mode') || 'REAL_LOCAL';
      lastAnomalyQuery = {
        variable: varParam,
        threshold: url.searchParams.get('threshold'),
        source_mode: srcParam
      };

      if (varParam === 'salinity') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_ANOMALY_SAL) });
      } else if (srcParam === 'SYNTHETIC') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_ANOMALY_SYNTHETIC) });
      } else {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_ANOMALY_REAL) });
      }
    }),
    page.route('**/api/insitu/argo*', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    }),
    page.route('**/api/insitu/gliders*', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    }),
    page.route('**/api/insitu/**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    }),
    page.route('**/api/datasets/manifests*', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    })
  ]);

  return { getLastAnomalyQuery: () => lastAnomalyQuery };
}

async function waitForDatasetReady(page) {
  await expect(page.getByRole('heading', { name: 'Indian Ocean workspace' })).toBeVisible({ timeout: 15000 });
  await expect(page.locator('[data-testid="current-time-badge"]')).toBeVisible({ timeout: 10000 });
}

test.describe('Selected Phase 06: Anomaly Controls & Source Separation', () => {

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test('TC-P06-01: Toggling ANOMALIES enables/disables anomaly field and controls strip', async ({ page }) => {
    await setupStandardRoutes(page);
    await page.goto('/');
    await waitForDatasetReady(page);

    const anomaliesBtn = page.locator('[data-testid="bottombar-anomalies-btn"]');
    await expect(anomaliesBtn).toBeVisible();
    await expect(anomaliesBtn).toHaveAttribute('aria-pressed', 'false');

    // Controls strip hidden initially
    await expect(page.locator('[data-testid="anomaly-controls-panel"]')).not.toBeVisible();

    // Turn ANOMALIES on
    await anomaliesBtn.click();
    await expect(anomaliesBtn).toHaveAttribute('aria-pressed', 'true');

    // Controls strip should be visible
    const controlsPanel = page.locator('[data-testid="anomaly-controls-panel"]');
    await expect(controlsPanel).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid="source-mode-select"]')).toBeVisible();
    await expect(page.locator('[data-testid="anomaly-variable-select"]')).toBeVisible();
    await expect(page.locator('[data-testid="anomaly-threshold-slider"]')).toBeVisible();
    await expect(page.locator('[data-testid="anomaly-coverage-badge"]')).toContainText('1 pairs');

    // Turn ANOMALIES off
    await anomaliesBtn.click();
    await expect(anomaliesBtn).toHaveAttribute('aria-pressed', 'false');
    await expect(controlsPanel).not.toBeVisible();

    await page.screenshot({ path: path.join(evidenceDir, 'TC-P06-01-anomaly-toggle.png') });
  });

  test('TC-P06-02: User switches source mode across REAL_LOCAL, SYNTHETIC, and ALL with instant metric updates', async ({ page }) => {
    const { getLastAnomalyQuery } = await setupStandardRoutes(page);
    await page.goto('/');
    await waitForDatasetReady(page);

    const anomaliesBtn = page.locator('[data-testid="bottombar-anomalies-btn"]');
    await anomaliesBtn.click();

    const sourceSelect = page.locator('[data-testid="source-mode-select"]');
    await expect(sourceSelect).toBeVisible();
    await expect(sourceSelect).toHaveValue('REAL_LOCAL');

    // Real mode coverage: 1 pair
    const coverageBadge = page.locator('[data-testid="anomaly-coverage-badge"]');
    await expect(coverageBadge).toContainText('1 pairs (1 platforms)');
    await expect(page.locator('[data-testid="anomaly-source-badge"]')).toContainText('REAL_LOCAL');

    // Switch to SYNTHETIC via UI
    await sourceSelect.selectOption('SYNTHETIC');

    // Verify query and coverage update to 2 pairs (2 platforms) from synthetic fixture
    await expect.poll(() => getLastAnomalyQuery()?.source_mode).toBe('SYNTHETIC');
    await expect(coverageBadge).toContainText('2 pairs (2 platforms)', { timeout: 5000 });
    await expect(page.locator('[data-testid="anomaly-source-badge"]')).toContainText('SYNTHETIC');

    // Switch to ALL
    await sourceSelect.selectOption('ALL');
    await expect.poll(() => getLastAnomalyQuery()?.source_mode).toBe('ALL');
    await expect(page.locator('[data-testid="anomaly-source-badge"]')).toContainText('ALL');

    await page.screenshot({ path: path.join(evidenceDir, 'TC-P06-02-source-mode-switch.png') });
  });

  test('TC-P06-03: Variable switch resets threshold to respective defaults and updates slider bounds', async ({ page }) => {
    const { getLastAnomalyQuery } = await setupStandardRoutes(page);
    await page.goto('/');
    await waitForDatasetReady(page);

    const anomaliesBtn = page.locator('[data-testid="bottombar-anomalies-btn"]');
    await anomaliesBtn.click();

    const varSelect = page.locator('[data-testid="anomaly-variable-select"]');
    const thresholdSlider = page.locator('[data-testid="anomaly-threshold-slider"]');
    const thresholdVal = page.locator('[data-testid="anomaly-threshold-value"]');

    // Temperature default threshold: 0.5 °C
    await expect(varSelect).toHaveValue('temperature');
    await expect(thresholdVal).toContainText('0.5 °C');
    await expect(thresholdSlider).toHaveAttribute('min', '0.1');
    await expect(thresholdSlider).toHaveAttribute('max', '3.0');

    // Switch to salinity -> threshold becomes 0.10 PSU
    await varSelect.selectOption('salinity');
    await expect.poll(() => getLastAnomalyQuery()?.variable).toBe('salinity');
    await expect(thresholdVal).toContainText('0.10 PSU');
    await expect(thresholdSlider).toHaveAttribute('min', '0.02');
    await expect(thresholdSlider).toHaveAttribute('max', '1.0');

    // Switch back to temperature -> threshold restores to 0.5 °C
    await varSelect.selectOption('temperature');
    await expect.poll(() => getLastAnomalyQuery()?.variable).toBe('temperature');
    await expect(thresholdVal).toContainText('0.5 °C');

    await page.screenshot({ path: path.join(evidenceDir, 'TC-P06-03-variable-threshold-bounds.png') });
  });

  test('TC-P06-04: Out-of-order and held responses do not overwrite newer user selection', async ({ page }) => {
    let heldRealResolve = null;

    await setupStandardRoutes(page);
    await page.route('**/api/anomaly/field*', async (route) => {
      const url = new URL(route.request().url());
      const srcParam = url.searchParams.get('source_mode');

      if (srcParam === 'REAL_LOCAL') {
        // Hold the REAL_LOCAL response
        await new Promise((resolve) => {
          heldRealResolve = resolve;
        });
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_ANOMALY_REAL) });
      } else {
        // Respond immediately for SYNTHETIC
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_ANOMALY_SYNTHETIC) });
      }
    });

    await page.goto('/');
    await waitForDatasetReady(page);

    const anomaliesBtn = page.locator('[data-testid="bottombar-anomalies-btn"]');
    await anomaliesBtn.click();

    // While REAL_LOCAL is held, loading indicator should be visible
    await expect(page.locator('[data-testid="anomaly-loading-indicator"]')).toBeVisible({ timeout: 5000 });

    // User switches to SYNTHETIC before REAL_LOCAL returns
    const sourceSelect = page.locator('[data-testid="source-mode-select"]');
    await sourceSelect.selectOption('SYNTHETIC');

    // Synthetic response arrives and renders 2 pairs
    await expect(page.locator('[data-testid="anomaly-coverage-badge"]')).toContainText('2 pairs (2 platforms)', { timeout: 5000 });
    await expect(page.locator('[data-testid="anomaly-source-badge"]')).toContainText('SYNTHETIC');

    // Now release the late REAL_LOCAL response
    if (heldRealResolve) heldRealResolve();
    await page.waitForTimeout(500);

    // Stale late response must NOT overwrite active SYNTHETIC selection
    await expect(page.locator('[data-testid="anomaly-coverage-badge"]')).toContainText('2 pairs (2 platforms)');
    await expect(page.locator('[data-testid="anomaly-source-badge"]')).toContainText('SYNTHETIC');

    await page.screenshot({ path: path.join(evidenceDir, 'TC-P06-04-out-of-order-safety.png') });
  });

  test('TC-P06-05: Anomaly error panel renders retry action and recovers cleanly', async ({ page }) => {
    let callCount = 0;
    await setupStandardRoutes(page);
    await page.route('**/api/anomaly/field*', async (route) => {
      callCount++;
      if (callCount === 1) {
        await route.fulfill({ status: 500, body: 'Internal Server Error' });
      } else {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_ANOMALY_REAL) });
      }
    });

    await page.goto('/');
    await waitForDatasetReady(page);

    const anomaliesBtn = page.locator('[data-testid="bottombar-anomalies-btn"]');
    await anomaliesBtn.click();

    // Error panel should appear
    const errorPanel = page.locator('[data-testid="anomaly-error-panel"]');
    await expect(errorPanel).toBeVisible({ timeout: 5000 });

    // Click retry
    const retryBtn = page.locator('[data-testid="anomaly-retry-btn"]');
    await expect(retryBtn).toBeVisible();
    await retryBtn.click();

    // Recovers cleanly
    await expect(errorPanel).not.toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid="anomaly-coverage-badge"]')).toContainText('1 pairs (1 platforms)');

    await page.screenshot({ path: path.join(evidenceDir, 'TC-P06-05-error-retry.png') });
  });

  test('TC-P06-06: Mismatched provenance (wrong/missing threshold, wrong/missing dataset ID, wrong source, wrong variable) is rejected', async ({ page }) => {
    let currentPayload = {
      ...MOCK_ANOMALY_REAL,
      source_mode: 'ALL' // 1. Mismatched source mode returned for REAL_LOCAL request
    };

    await setupStandardRoutes(page);
    await page.route('**/api/anomaly/field*', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(currentPayload) });
    });

    await page.goto('/');
    await waitForDatasetReady(page);

    const anomaliesBtn = page.locator('[data-testid="bottombar-anomalies-btn"]');
    await anomaliesBtn.click();

    const errorPanel = page.locator('[data-testid="anomaly-error-panel"]');
    const coverageBadge = page.locator('[data-testid="anomaly-coverage-badge"]');
    const retryBtn = page.locator('[data-testid="anomaly-retry-btn"]');

    // 1. Wrong source mode
    await expect(errorPanel).toBeVisible({ timeout: 5000 });
    await expect(coverageBadge).not.toBeVisible();

    // 2. Wrong threshold (1.5 instead of 0.5)
    currentPayload = {
      ...MOCK_ANOMALY_REAL,
      source_mode: 'REAL_LOCAL',
      threshold: 1.5
    };
    await retryBtn.click();
    await expect(errorPanel).toBeVisible({ timeout: 5000 });
    await expect(coverageBadge).not.toBeVisible();

    // 3. Missing threshold
    currentPayload = {
      ...MOCK_ANOMALY_REAL,
      source_mode: 'REAL_LOCAL'
    };
    delete currentPayload.threshold;
    await retryBtn.click();
    await expect(errorPanel).toBeVisible({ timeout: 5000 });
    await expect(coverageBadge).not.toBeVisible();

    // 4. Wrong dataset ID
    currentPayload = {
      ...MOCK_ANOMALY_REAL,
      source_mode: 'REAL_LOCAL',
      threshold: 0.5,
      dataset_id: 'old_unrelated_dataset'
    };
    await retryBtn.click();
    await expect(errorPanel).toBeVisible({ timeout: 5000 });
    await expect(coverageBadge).not.toBeVisible();

    // 5. Missing / empty dataset ID
    currentPayload = {
      ...MOCK_ANOMALY_REAL,
      source_mode: 'REAL_LOCAL',
      threshold: 0.5,
      dataset_id: ''
    };
    await retryBtn.click();
    await expect(errorPanel).toBeVisible({ timeout: 5000 });
    await expect(coverageBadge).not.toBeVisible();

    // 6. Wrong variable ('salinity' when 'temperature' requested)
    currentPayload = {
      ...MOCK_ANOMALY_REAL,
      variable: 'salinity',
      source_mode: 'REAL_LOCAL',
      threshold: 0.5,
      dataset_id: 'incois_roms_synthetic'
    };
    await retryBtn.click();
    await expect(errorPanel).toBeVisible({ timeout: 5000 });
    await expect(coverageBadge).not.toBeVisible();

    // 7. Full exact matching payload recovers cleanly
    currentPayload = {
      ...MOCK_ANOMALY_REAL,
      variable: 'temperature',
      dataset_id: 'incois_roms_synthetic',
      source_mode: 'REAL_LOCAL',
      threshold: 0.5
    };
    await retryBtn.click();
    await expect(errorPanel).not.toBeVisible({ timeout: 5000 });
    await expect(coverageBadge).toContainText('1 pairs (1 platforms)');

    await page.screenshot({ path: path.join(evidenceDir, 'TC-P06-06-provenance-rejection.png') });
  });

  test('TC-P06-07: Turning anomaly layer off invalidates pending requests and late response cannot publish', async ({ page }) => {
    let heldResolve = null;

    await setupStandardRoutes(page);
    await page.route('**/api/anomaly/field*', async (route) => {
      await new Promise((resolve) => {
        heldResolve = resolve;
      });
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_ANOMALY_REAL) });
    });

    await page.goto('/');
    await waitForDatasetReady(page);

    const anomaliesBtn = page.locator('[data-testid="bottombar-anomalies-btn"]');
    await anomaliesBtn.click(); // Turn on -> starts pending request

    // While request is pending, turn layer OFF
    await anomaliesBtn.click();
    await expect(anomaliesBtn).toHaveAttribute('aria-pressed', 'false');

    // Release late response
    if (heldResolve) heldResolve();
    await page.waitForTimeout(500);

    // Controls panel should remain hidden and no anomaly coverage should publish
    await expect(page.locator('[data-testid="anomaly-controls-panel"]')).not.toBeVisible();

    await page.screenshot({ path: path.join(evidenceDir, 'TC-P06-07-layer-off-invalidation.png') });
  });

});
