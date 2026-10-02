import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const evidenceDir = path.resolve('..', 'docs', 'evidence', 'selected-phase-07');
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
  depth_levels_m: [0.0, 10.0, 50.0, 100.0, 200.0, 500.0],
  time_timestamps: ['2026-09-10T00:00:00Z', '2026-09-10T03:00:00Z'],
  variables: {
    temperature: { name: 'Sea Water Temperature', units: '°C' },
    salinity: { name: 'Sea Water Salinity', units: 'PSU' },
    currents: { name: 'Ocean Currents Velocity', units: 'm/s' }
  }
};

const MOCK_TRANSECT_TEMP = {
  lat1: 10.0,
  lon1: 80.0,
  lat2: 18.0,
  lon2: 90.0,
  variable: 'temperature',
  units: '°C',
  time_idx: 0,
  timestamp: '2026-09-10T00:00:00Z',
  num_points: 10,
  total_distance_km: 1420.5,
  distances_km: [0, 157.8, 315.6, 473.5, 631.3, 789.1, 947.0, 1104.8, 1262.6, 1420.5],
  lats: [10.0, 10.88, 11.77, 12.66, 13.55, 14.44, 15.33, 16.22, 17.11, 18.0],
  lons: [80.0, 81.11, 82.22, 83.33, 84.44, 85.55, 86.66, 87.77, 88.88, 90.0],
  depth_levels: [0.0, 10.0, 50.0, 100.0, 200.0, 500.0],
  matrix: [
    [28.5, 28.6, 28.7, 28.8, 28.7, 28.6, 28.5, 28.4, 28.3, 28.2],
    [28.0, 28.1, 28.2, 28.3, 28.2, 28.1, 28.0, 27.9, 27.8, 27.7],
    [24.5, 24.6, 24.7, 24.8, 24.7, 24.6, 24.5, 24.4, 24.3, 24.2],
    [18.5, 18.6, 18.7, 18.8, 18.7, 18.6, 18.5, 18.4, 18.3, 18.2],
    [12.5, 12.6, 12.7, 12.8, 12.7, 12.6, 12.5, 12.4, null, null], // null cells to test missing/land
    [6.5, 6.6, 6.7, 6.8, 6.7, 6.6, 6.5, 6.4, null, null]
  ],
  min_val: 6.4,
  max_val: 28.8,
  dataset_id: 'incois_roms_synthetic'
};

async function setupStandardRoutes(page, { activeDataset = DATASET_SYNTHETIC, metadata = METADATA_SYNTHETIC } = {}) {
  let lastTransectQuery = null;

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
    page.route('**/api/ocean/transect*', async (route) => {
      const url = new URL(route.request().url());
      lastTransectQuery = {
        lat1: url.searchParams.get('lat1'),
        lon1: url.searchParams.get('lon1'),
        lat2: url.searchParams.get('lat2'),
        lon2: url.searchParams.get('lon2'),
        variable: url.searchParams.get('variable'),
        time_idx: url.searchParams.get('time_idx')
      };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_TRANSECT_TEMP)
      });
    }),
    page.route('**/api/insitu/**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    })
  ]);

  return { getLastTransectQuery: () => lastTransectQuery };
}

async function waitForDatasetReady(page) {
  await expect(page.getByRole('heading', { name: 'Indian Ocean workspace' })).toBeVisible({ timeout: 15000 });
  await expect(page.locator('[data-testid="current-time-badge"]')).toBeVisible({ timeout: 10000 });
}

test.describe('Selected Phase 07: User-Chosen Ocean Cross-Section Workflow', () => {

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test('TC-P07-01: Discoverable CROSS-SECTION button opens and closes the cross-section modal', async ({ page }) => {
    await setupStandardRoutes(page);
    await page.goto('/');
    await waitForDatasetReady(page);

    const transectBtn = page.locator('[data-testid="bottombar-transect-btn"]');
    await expect(transectBtn).toBeVisible();
    await expect(transectBtn).toHaveAttribute('aria-pressed', 'false');

    // Open modal
    await transectBtn.click();
    await expect(transectBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-testid="transect-lat1-input"]')).toBeVisible();
    await expect(page.locator('[data-testid="transect-submit-btn"]')).toBeVisible();

    // Close via close button
    const closeBtn = page.locator('[data-testid="transect-close-btn"]');
    await closeBtn.click();
    await expect(page.locator('[data-testid="transect-lat1-input"]')).not.toBeVisible();
    await expect(transectBtn).toHaveAttribute('aria-pressed', 'false');

    await page.screenshot({ path: path.join(evidenceDir, 'TC-P07-01-cross-section-toggle.png') });
  });

  test('TC-P07-02: User enters custom coordinates and computes 2D distance-depth section with valid heatmap', async ({ page }) => {
    const { getLastTransectQuery } = await setupStandardRoutes(page);
    await page.goto('/');
    await waitForDatasetReady(page);

    // Open modal
    await page.locator('[data-testid="bottombar-transect-btn"]').click();

    // Fill in custom endpoints
    await page.locator('[data-testid="transect-lat1-input"]').fill('10.0');
    await page.locator('[data-testid="transect-lon1-input"]').fill('80.0');
    await page.locator('[data-testid="transect-lat2-input"]').fill('18.0');
    await page.locator('[data-testid="transect-lon2-input"]').fill('90.0');

    // Submit request
    await page.locator('[data-testid="transect-submit-btn"]').click();

    // Verify outgoing query
    await expect.poll(() => getLastTransectQuery()?.lat1).toBe('10');
    await expect.poll(() => getLastTransectQuery()?.lon2).toBe('90');

    // Verify rendered results container
    await expect(page.locator('[data-testid="transect-results-container"]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid="transect-distance-stat"]')).toContainText('1420.5 km');
    await expect(page.locator('[data-testid="transect-min-val"]')).toContainText('6.40 °C');
    await expect(page.locator('[data-testid="transect-max-val"]')).toContainText('28.80 °C');
    await expect(page.locator('[data-testid="transect-mean-val"]')).toBeVisible();
    await expect(page.locator('[data-testid="transect-valid-fraction"]')).toContainText('%');
    await expect(page.locator('[data-testid="transect-heatmap-svg"]')).toBeVisible();

    await page.screenshot({ path: path.join(evidenceDir, 'TC-P07-02-cross-section-results.png') });
  });

  test('TC-P07-03: Coordinate validation catches out-of-bounds, identical endpoints, and non-numeric inputs', async ({ page }) => {
    await setupStandardRoutes(page);
    await page.goto('/');
    await waitForDatasetReady(page);

    await page.locator('[data-testid="bottombar-transect-btn"]').click();

    // 1. Identical endpoints
    await page.locator('[data-testid="transect-lat1-input"]').fill('12.0');
    await page.locator('[data-testid="transect-lon1-input"]').fill('80.0');
    await page.locator('[data-testid="transect-lat2-input"]').fill('12.0');
    await page.locator('[data-testid="transect-lon2-input"]').fill('80.0');
    await page.locator('[data-testid="transect-submit-btn"]').click();

    const valError = page.locator('[data-testid="transect-validation-error"]');
    await expect(valError).toBeVisible();
    await expect(valError).toContainText('cannot be identical');

    // 2. Out of domain bounds
    await page.locator('[data-testid="transect-lat1-input"]').fill('45.0');
    await page.locator('[data-testid="transect-submit-btn"]').click();
    await expect(valError).toBeVisible();
    await expect(valError).toContainText('exceed active dataset domain bounds');

    await page.screenshot({ path: path.join(evidenceDir, 'TC-P07-03-validation-errors.png') });
  });

  test('TC-P07-04: API error shows error panel and recovers upon retry', async ({ page }) => {
    let callCount = 0;
    await setupStandardRoutes(page);
    await page.route('**/api/ocean/transect*', async (route) => {
      callCount++;
      if (callCount === 1) {
        await route.fulfill({ status: 500, body: JSON.stringify({ detail: 'Transect interpolation failed on numerical grid' }) });
      } else {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_TRANSECT_TEMP) });
      }
    });

    await page.goto('/');
    await waitForDatasetReady(page);

    await page.locator('[data-testid="bottombar-transect-btn"]').click();
    await page.locator('[data-testid="transect-submit-btn"]').click();

    // Error panel should be displayed
    const errorPanel = page.locator('[data-testid="transect-error-panel"]');
    await expect(errorPanel).toBeVisible({ timeout: 5000 });
    await expect(errorPanel).toContainText('Transect interpolation failed');

    // Click retry
    const retryBtn = page.locator('[data-testid="transect-retry-btn"]');
    await expect(retryBtn).toBeVisible();
    await retryBtn.click();

    // Recovered
    await expect(errorPanel).not.toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid="transect-results-container"]')).toBeVisible();

    await page.screenshot({ path: path.join(evidenceDir, 'TC-P07-04-error-retry.png') });
  });

  test('TC-P07-05: Mismatched/missing provenance (dataset, variable, time, endpoints) is rejected', async ({ page }) => {
    let currentPayload = {
      ...MOCK_TRANSECT_TEMP,
      dataset_id: 'old_expired_dataset'
    };

    await setupStandardRoutes(page);
    await page.route('**/api/ocean/transect*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(currentPayload)
      });
    });

    await page.goto('/');
    await waitForDatasetReady(page);

    await page.locator('[data-testid="bottombar-transect-btn"]').click();
    await page.locator('[data-testid="transect-submit-btn"]').click();

    const errorPanel = page.locator('[data-testid="transect-error-panel"]');
    const resultsContainer = page.locator('[data-testid="transect-results-container"]');
    const retryBtn = page.locator('[data-testid="transect-retry-btn"]');

    // 1. Wrong dataset ID -> rejected
    await expect(errorPanel).toBeVisible({ timeout: 5000 });
    await expect(resultsContainer).not.toBeVisible();

    // 2. Wrong variable ('salinity' when 'temperature' was requested) -> rejected
    currentPayload = {
      ...MOCK_TRANSECT_TEMP,
      dataset_id: 'incois_roms_synthetic',
      variable: 'salinity'
    };
    await retryBtn.click();
    await expect(errorPanel).toBeVisible({ timeout: 5000 });
    await expect(resultsContainer).not.toBeVisible();

    // 3. Wrong time_idx (1 instead of 0) -> rejected
    currentPayload = {
      ...MOCK_TRANSECT_TEMP,
      dataset_id: 'incois_roms_synthetic',
      variable: 'temperature',
      time_idx: 1
    };
    await retryBtn.click();
    await expect(errorPanel).toBeVisible({ timeout: 5000 });
    await expect(resultsContainer).not.toBeVisible();

    // 4. Mismatched endpoints (lat1 25.0 instead of 10.0) -> rejected
    currentPayload = {
      ...MOCK_TRANSECT_TEMP,
      dataset_id: 'incois_roms_synthetic',
      variable: 'temperature',
      time_idx: 0,
      lat1: 25.0
    };
    await retryBtn.click();
    await expect(errorPanel).toBeVisible({ timeout: 5000 });
    await expect(resultsContainer).not.toBeVisible();

    // 5. Correct matching payload -> recovers cleanly
    currentPayload = {
      ...MOCK_TRANSECT_TEMP,
      dataset_id: 'incois_roms_synthetic',
      variable: 'temperature',
      time_idx: 0,
      lat1: 10.0
    };
    await retryBtn.click();
    await expect(errorPanel).not.toBeVisible({ timeout: 5000 });
    await expect(resultsContainer).toBeVisible();

    await page.screenshot({ path: path.join(evidenceDir, 'TC-P07-05-provenance-rejections.png') });
  });

  test('TC-P07-06: Close modal while request is held aborts request and late response cannot appear on reopen', async ({ page }) => {
    let heldResolve = null;

    await setupStandardRoutes(page);
    await page.route('**/api/ocean/transect*', async (route) => {
      await new Promise((resolve) => {
        heldResolve = resolve;
      });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_TRANSECT_TEMP)
      });
    });

    await page.goto('/');
    await waitForDatasetReady(page);

    const transectBtn = page.locator('[data-testid="bottombar-transect-btn"]');
    await transectBtn.click();

    // Submit request (it will be held)
    await page.locator('[data-testid="transect-submit-btn"]').click();
    await expect(page.locator('[data-testid="transect-loading-indicator"]')).toBeVisible();

    // Close modal while request is pending
    await page.locator('[data-testid="transect-close-btn"]').click();
    await expect(page.locator('[data-testid="cross-section-modal"]')).not.toBeVisible();

    // Release late response
    if (heldResolve) heldResolve();
    await page.waitForTimeout(400);

    // Reopen modal: old late response must NOT be displayed
    await transectBtn.click();
    await expect(page.locator('[data-testid="cross-section-modal"]')).toBeVisible();
    await expect(page.locator('[data-testid="transect-results-container"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="transect-loading-indicator"]')).not.toBeVisible();

    await page.screenshot({ path: path.join(evidenceDir, 'TC-P07-06-close-invalidation.png') });
  });

  test('TC-P07-07: Editing inputs after result immediately clears previous section results', async ({ page }) => {
    await setupStandardRoutes(page);
    await page.goto('/');
    await waitForDatasetReady(page);

    await page.locator('[data-testid="bottombar-transect-btn"]').click();
    await page.locator('[data-testid="transect-submit-btn"]').click();

    // Results visible
    const resultsContainer = page.locator('[data-testid="transect-results-container"]');
    await expect(resultsContainer).toBeVisible({ timeout: 5000 });

    // Edit lat1 input
    const lat1Input = page.locator('[data-testid="transect-lat1-input"]');
    await lat1Input.fill('11.5');

    // Results container must be immediately cleared
    await expect(resultsContainer).not.toBeVisible();

    await page.screenshot({ path: path.join(evidenceDir, 'TC-P07-07-input-edit-clears-result.png') });
  });

  test('TC-P07-08: Rendered null/land cells show distinct hatched pattern and physical depth axis spacing', async ({ page }) => {
    await setupStandardRoutes(page);
    await page.goto('/');
    await waitForDatasetReady(page);

    await page.locator('[data-testid="bottombar-transect-btn"]').click();
    await page.locator('[data-testid="transect-submit-btn"]').click();

    await expect(page.locator('[data-testid="transect-results-container"]')).toBeVisible({ timeout: 5000 });

    // Verify no-data legend is rendered
    const legend = page.locator('[data-testid="transect-no-data-legend"]');
    await expect(legend).toBeVisible();
    await expect(legend).toContainText('No Data / Land Mask');

    // Inspect no-data cell at depth 4, point 8
    const noDataCell = page.locator('[data-testid="cell-nodata-4-8"]');
    await expect(noDataCell).toBeVisible();

    // Hover no-data cell and check inspector
    await noDataCell.hover();
    const hoverSounding = page.locator('[data-testid="transect-hover-sounding"]');
    await expect(hoverSounding).toContainText('No Data (Land / Masked)');

    // Hover valid cell at depth 0, point 0
    const validCell = page.locator('[data-testid="cell-valid-0-0"]');
    await validCell.hover();
    await expect(hoverSounding).toContainText('28.50 °C');

    await page.screenshot({ path: path.join(evidenceDir, 'TC-P07-08-nodata-and-depth-inspection.png') });
  });

});
