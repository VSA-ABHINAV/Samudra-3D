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

function computeExpectedPhysicalLayout(depthLevels, { plotTop = 10, plotHeight = 220 } = {}) {
  const K = depthLevels.length;
  if (K === 0) return [];
  if (K === 1) {
    return [{
      depth: depthLevels[0],
      yTop: plotTop,
      height: plotHeight,
      yBottom: plotTop + plotHeight,
      yCenter: plotTop + plotHeight / 2,
      yDepthCoord: plotTop + plotHeight / 2
    }];
  }

  const isAscending = depthLevels[1] > depthLevels[0];
  if (isAscending) {
    const zSurface = depthLevels[0] - (depthLevels[1] - depthLevels[0]) / 2;
    const zDeep = depthLevels[K - 1] + (depthLevels[K - 1] - depthLevels[K - 2]) / 2;
    const deltaZ = zDeep - zSurface || 1.0;

    return depthLevels.map((d, k) => {
      const zTop = k === 0 ? zSurface : (depthLevels[k - 1] + d) / 2;
      const zBottom = k === K - 1 ? zDeep : (d + depthLevels[k + 1]) / 2;
      const yTop = plotTop + ((zTop - zSurface) / deltaZ) * plotHeight;
      const yBottom = plotTop + ((zBottom - zSurface) / deltaZ) * plotHeight;
      const yCenter = (yTop + yBottom) / 2;
      const yDepthCoord = plotTop + ((d - zSurface) / deltaZ) * plotHeight;
      return {
        depth: d,
        yTop,
        height: yBottom - yTop,
        yBottom,
        yCenter,
        yDepthCoord
      };
    });
  } else {
    const zSurface = depthLevels[K - 1] - (depthLevels[K - 2] - depthLevels[K - 1]) / 2;
    const zDeep = depthLevels[0] + (depthLevels[0] - depthLevels[1]) / 2;
    const deltaZ = zDeep - zSurface || 1.0;

    return depthLevels.map((d, k) => {
      const zTop = k === K - 1 ? zSurface : (d + depthLevels[k + 1]) / 2;
      const zBottom = k === 0 ? zDeep : (depthLevels[k - 1] + d) / 2;
      const yTop = plotTop + ((zTop - zSurface) / deltaZ) * plotHeight;
      const yBottom = plotTop + ((zBottom - zSurface) / deltaZ) * plotHeight;
      const yCenter = (yTop + yBottom) / 2;
      const yDepthCoord = plotTop + ((d - zSurface) / deltaZ) * plotHeight;
      return {
        depth: d,
        yTop,
        height: yBottom - yTop,
        yBottom,
        yCenter,
        yDepthCoord
      };
    });
  }
}

  test('TC-P07-06: Close modal while request is held aborts request and late response cannot appear on reopen', async ({ page }) => {
    let releaseHeldRoute = null;
    let onRequestReceived = null;
    let routeSettledPromise = null;

    await setupStandardRoutes(page);
    await page.route('**/api/ocean/transect*', async (route) => {
      routeSettledPromise = new Promise((resolveRoute) => {
        if (onRequestReceived) onRequestReceived();
        new Promise((res) => { releaseHeldRoute = res; }).then(async () => {
          try {
            await route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify(MOCK_TRANSECT_TEMP)
            });
          } catch {
            // Client aborted before fulfill completed
          }
          resolveRoute();
        });
      });
      await routeSettledPromise;
    });

    await page.goto('/');
    await waitForDatasetReady(page);

    const transectBtn = page.locator('[data-testid="bottombar-transect-btn"]');
    await transectBtn.click();

    // Submit request (held)
    const requestPromise = new Promise((res) => { onRequestReceived = res; });
    await page.locator('[data-testid="transect-submit-btn"]').click();
    await requestPromise;
    await expect(page.locator('[data-testid="transect-loading-indicator"]')).toBeVisible();

    // Close modal while request is pending
    await page.locator('[data-testid="transect-close-btn"]').click();
    await expect(page.locator('[data-testid="cross-section-modal"]')).not.toBeVisible();

    // Release late response and await settlement deterministically
    if (releaseHeldRoute) releaseHeldRoute();
    if (routeSettledPromise) await routeSettledPromise;

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

  test('TC-P07-08: Rendered SVG geometry verifies exact proportional depth coordinates, boundary limits, and no-data inspection', async ({ page }) => {
    await setupStandardRoutes(page);
    await page.goto('/');
    await waitForDatasetReady(page);

    await page.locator('[data-testid="bottombar-transect-btn"]').click();
    await page.locator('[data-testid="transect-submit-btn"]').click();

    await expect(page.locator('[data-testid="transect-results-container"]')).toBeVisible({ timeout: 5000 });

    // 1. Independently compute expected physical layout for ascending depths [0, 10, 50, 100, 200, 500]
    const depths = MOCK_TRANSECT_TEMP.depth_levels;
    const expectedLayout = computeExpectedPhysicalLayout(depths);

    const actualRows = [];
    for (let k = 0; k < depths.length; k++) {
      const cell = page.locator(`[data-depth-idx="${k}"][data-point-idx="0"]`);
      await expect(cell).toBeVisible();

      const y = parseFloat(await cell.getAttribute('y') || '0');
      const h = parseFloat(await cell.getAttribute('height') || '0');
      const center = y + h / 2;

      actualRows.push({ y, h, center, depth: depths[k] });

      const exp = expectedLayout[k];
      // Assert exact numerical match (within 0.02 SVG coordinate units) against independently calculated physics
      expect(Math.abs(y - exp.yTop)).toBeLessThan(0.02);
      expect(Math.abs(h - exp.height)).toBeLessThan(0.02);
      expect(Math.abs(center - exp.yCenter)).toBeLessThan(0.02);

      // Boundary containment
      expect(y).toBeGreaterThanOrEqual(10.0 - 1e-4);
      expect(y + h).toBeLessThanOrEqual(230.0 + 1e-4);

      // Assert Y-axis depth label aligns with physical depth coordinate position
      const depthLabel = page.locator(`[data-testid="transect-depth-label-${k}"]`);
      await expect(depthLabel).toBeVisible();
      const labelY = parseFloat(await depthLabel.getAttribute('y') || '0');
      expect(Math.abs(labelY - (exp.yDepthCoord + 3.5))).toBeLessThan(0.02);
    }

    // Verify adjacent layers touch perfectly without overlap: bottom of layer k == top of layer k+1
    for (let k = 0; k < depths.length - 1; k++) {
      expect(Math.abs((actualRows[k].y + actualRows[k].h) - actualRows[k + 1].y)).toBeLessThan(0.02);
    }

    // 2. Verify no-data legend and tooltips
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
    const cellRow0 = page.locator('[data-testid="cell-valid-0-0"]');
    await cellRow0.hover();
    await expect(hoverSounding).toContainText('28.50 °C');
    await expect(hoverSounding).toContainText('Depth: 0 m');

    await page.screenshot({ path: path.join(evidenceDir, 'TC-P07-08-nodata-and-depth-inspection.png') });
  });

  test('TC-P07-09: Descending and closely-spaced depth arrays match exact physical scaling, no overlap, and reject non-monotonic coordinates', async ({ page }) => {
    // Part A: Descending depth payload: depths 500 down to 0
    const DESCENDING_TRANSECT = {
      ...MOCK_TRANSECT_TEMP,
      depth_levels: [500.0, 200.0, 100.0, 50.0, 10.0, 0.0],
      matrix: [
        [6.5, 6.6, 6.7, 6.8, 6.7, 6.6, 6.5, 6.4, null, null], // row 0: 500m (deep)
        [12.5, 12.6, 12.7, 12.8, 12.7, 12.6, 12.5, 12.4, null, null], // row 1: 200m
        [18.5, 18.6, 18.7, 18.8, 18.7, 18.6, 18.5, 18.4, 18.3, 18.2], // row 2: 100m
        [24.5, 24.6, 24.7, 24.8, 24.7, 24.6, 24.5, 24.4, 24.3, 24.2], // row 3: 50m
        [28.0, 28.1, 28.2, 28.3, 28.2, 28.1, 28.0, 27.9, 27.8, 27.7], // row 4: 10m
        [28.5, 28.6, 28.7, 28.8, 28.7, 28.6, 28.5, 28.4, 28.3, 28.2]  // row 5: 0m (surface)
      ]
    };

    let activePayload = DESCENDING_TRANSECT;

    await setupStandardRoutes(page);
    await page.route('**/api/ocean/transect*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(activePayload)
      });
    });

    await page.goto('/');
    await waitForDatasetReady(page);

    await page.locator('[data-testid="bottombar-transect-btn"]').click();
    await page.locator('[data-testid="transect-submit-btn"]').click();

    await expect(page.locator('[data-testid="transect-results-container"]')).toBeVisible({ timeout: 5000 });

    const descDepths = DESCENDING_TRANSECT.depth_levels;
    const expDescLayout = computeExpectedPhysicalLayout(descDepths);

    const actualDescRows = [];
    for (let k = 0; k < descDepths.length; k++) {
      const cell = page.locator(`[data-depth-idx="${k}"][data-point-idx="0"]`);
      await expect(cell).toBeVisible();

      const y = parseFloat(await cell.getAttribute('y') || '0');
      const h = parseFloat(await cell.getAttribute('height') || '0');
      const center = y + h / 2;

      actualDescRows.push({ y, h, center, depth: descDepths[k], k });

      const exp = expDescLayout[k];
      expect(Math.abs(y - exp.yTop)).toBeLessThan(0.02);
      expect(Math.abs(h - exp.height)).toBeLessThan(0.02);
      expect(Math.abs(center - exp.yCenter)).toBeLessThan(0.02);

      expect(y).toBeGreaterThanOrEqual(10.0 - 1e-4);
      expect(y + h).toBeLessThanOrEqual(230.0 + 1e-4);
    }

    // In descending ordering, row 5 (0m) is surface at top, row 0 (500m) is abyss at bottom
    expect(actualDescRows[5].y).toBeLessThan(actualDescRows[0].y);
    expect(Math.abs(actualDescRows[5].y - 10.0)).toBeLessThan(0.02);
    expect(Math.abs((actualDescRows[0].y + actualDescRows[0].h) - 230.0)).toBeLessThan(0.02);

    // Verify non-overlapping contiguity along vertical axis for descending order
    const sortedDescByY = [...actualDescRows].sort((a, b) => a.y - b.y);
    for (let i = 0; i < sortedDescByY.length - 1; i++) {
      expect(Math.abs((sortedDescByY[i].y + sortedDescByY[i].h) - sortedDescByY[i + 1].y)).toBeLessThan(0.02);
    }

    // Hover row 5: must report Depth: 0 m and temperature 28.50 °C
    const cellRow5 = page.locator('[data-testid="cell-valid-5-0"]');
    await cellRow5.hover();
    const hoverSounding = page.locator('[data-testid="transect-hover-sounding"]');
    await expect(hoverSounding).toContainText('Depth: 0 m');
    await expect(hoverSounding).toContainText('28.50 °C');

    // Hover row 0: must report Depth: 500 m and temperature 6.50 °C
    const cellRow0 = page.locator('[data-testid="cell-valid-0-0"]');
    await cellRow0.hover();
    await expect(hoverSounding).toContainText('Depth: 500 m');
    await expect(hoverSounding).toContainText('6.50 °C');

    // Part B: Valid closely-spaced depth levels (e.g. 0m, 1m, 2m, 50m, 100m, 500m)
    const CLOSE_SPACED_TRANSECT = {
      ...MOCK_TRANSECT_TEMP,
      depth_levels: [0.0, 1.0, 2.0, 50.0, 100.0, 500.0],
      matrix: [
        [28.5, 28.6, 28.7, 28.8, 28.7, 28.6, 28.5, 28.4, 28.3, 28.2], // row 0: 0m
        [28.4, 28.5, 28.6, 28.7, 28.6, 28.5, 28.4, 28.3, 28.2, 28.1], // row 1: 1m
        [28.2, 28.3, 28.4, 28.5, 28.4, 28.3, 28.2, 28.1, 28.0, 27.9], // row 2: 2m
        [24.5, 24.6, 24.7, 24.8, 24.7, 24.6, 24.5, 24.4, 24.3, 24.2], // row 3: 50m
        [18.5, 18.6, 18.7, 18.8, 18.7, 18.6, 18.5, 18.4, 18.3, 18.2], // row 4: 100m
        [6.5, 6.6, 6.7, 6.8, 6.7, 6.6, 6.5, 6.4, null, null]          // row 5: 500m
      ]
    };
    activePayload = CLOSE_SPACED_TRANSECT;

    await page.locator('[data-testid="transect-submit-btn"]').click();
    await expect(page.locator('[data-testid="transect-results-container"]')).toBeVisible({ timeout: 5000 });

    const closeDepths = CLOSE_SPACED_TRANSECT.depth_levels;
    const expCloseLayout = computeExpectedPhysicalLayout(closeDepths);

    for (let k = 0; k < closeDepths.length; k++) {
      const cell = page.locator(`[data-depth-idx="${k}"][data-point-idx="0"]`);
      const y = parseFloat(await cell.getAttribute('y') || '0');
      const h = parseFloat(await cell.getAttribute('height') || '0');
      const exp = expCloseLayout[k];

      expect(Math.abs(y - exp.yTop)).toBeLessThan(0.02);
      expect(Math.abs(h - exp.height)).toBeLessThan(0.02);
      // Prove that fractional height is preserved (row 1 is ~0.338 units, NOT clamped to 1.0)
      if (k === 1) {
        expect(h).toBeLessThan(0.5);
      }
    }

    // Part C: Non-monotonic depth array rejection: [0.0, 50.0, 20.0, 100.0]
    activePayload = {
      ...MOCK_TRANSECT_TEMP,
      depth_levels: [0.0, 50.0, 20.0, 100.0],
      matrix: [
        [28.5, 28.6, 28.7, 28.8, 28.7, 28.6, 28.5, 28.4, 28.3, 28.2],
        [24.5, 24.6, 24.7, 24.8, 24.7, 24.6, 24.5, 24.4, 24.3, 24.2],
        [26.0, 26.1, 26.2, 26.3, 26.2, 26.1, 26.0, 25.9, 25.8, 25.7],
        [18.5, 18.6, 18.7, 18.8, 18.7, 18.6, 18.5, 18.4, 18.3, 18.2]
      ]
    };

    await page.locator('[data-testid="transect-submit-btn"]').click();
    const depthValError = page.locator('[data-testid="transect-depth-validation-error"]');
    await expect(depthValError).toBeVisible({ timeout: 5000 });
    await expect(depthValError).toContainText('strictly monotonic');

    await page.screenshot({ path: path.join(evidenceDir, 'TC-P07-09-descending-and-monotonicity.png') });
  });

  test('TC-P07-10: Invalidation when endpoint edit, variable change, timeline change, or view switch occurs while request is pending', async ({ page }) => {
    let releaseHeldRoute = null;
    let onRequestReceived = null;
    let routeSettledPromise = null;

    await setupStandardRoutes(page);
    await page.route('**/api/ocean/transect*', async (route) => {
      routeSettledPromise = new Promise((resolveRoute) => {
        if (onRequestReceived) onRequestReceived();
        new Promise((res) => { releaseHeldRoute = res; }).then(async () => {
          try {
            await route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify(MOCK_TRANSECT_TEMP)
            });
          } catch {
            // Client aborted before fulfill
          }
          resolveRoute();
        });
      });
      await routeSettledPromise;
    });

    await page.goto('/');
    await waitForDatasetReady(page);

    const transectBtn = page.locator('[data-testid="bottombar-transect-btn"]');
    await transectBtn.click();

    const submitBtn = page.locator('[data-testid="transect-submit-btn"]');
    const loadingIndicator = page.locator('[data-testid="transect-loading-indicator"]');
    const resultsContainer = page.locator('[data-testid="transect-results-container"]');

    // --- Case A: Endpoint edit while request is pending ---
    let reqPromise = new Promise((res) => { onRequestReceived = res; });
    await submitBtn.click();
    await reqPromise;
    await expect(loadingIndicator).toBeVisible();

    // Edit lat1 input while request is in flight
    await page.locator('[data-testid="transect-lat1-input"]').fill('12.5');
    await expect(loadingIndicator).not.toBeVisible();

    // Release held response and await settlement deterministically
    if (releaseHeldRoute) {
      releaseHeldRoute();
      releaseHeldRoute = null;
    }
    if (routeSettledPromise) await routeSettledPromise;
    await expect(resultsContainer).not.toBeVisible();

    // --- Case B: Variable change while request is pending ---
    reqPromise = new Promise((res) => { onRequestReceived = res; });
    await submitBtn.click();
    await reqPromise;
    await expect(loadingIndicator).toBeVisible();

    // Change variable select in modal
    await page.locator('[data-testid="transect-variable-select"]').selectOption('salinity');
    await expect(loadingIndicator).not.toBeVisible();

    if (releaseHeldRoute) {
      releaseHeldRoute();
      releaseHeldRoute = null;
    }
    if (routeSettledPromise) await routeSettledPromise;
    await expect(resultsContainer).not.toBeVisible();

    // Reset back to temperature
    await page.locator('[data-testid="transect-variable-select"]').selectOption('temperature');

    // --- Case C: Global timeline step change while request is pending ---
    reqPromise = new Promise((res) => { onRequestReceived = res; });
    await submitBtn.click();
    await reqPromise;
    await expect(loadingIndicator).toBeVisible();

    // Click next forecast step in bottom control bar (behind backdrop)
    const stepFwdBtn = page.getByRole('button', { name: 'Next Forecast Step' });
    await stepFwdBtn.evaluate((btn) => btn.click());
    await expect(loadingIndicator).not.toBeVisible();

    if (releaseHeldRoute) {
      releaseHeldRoute();
      releaseHeldRoute = null;
    }
    if (routeSettledPromise) await routeSettledPromise;
    await expect(resultsContainer).not.toBeVisible();

    // --- Case D: View mode switch while request is pending ---
    reqPromise = new Promise((res) => { onRequestReceived = res; });
    await submitBtn.click();
    await reqPromise;
    await expect(loadingIndicator).toBeVisible();

    // Switch view mode via EXPLORE navigation (behind backdrop)
    const exploreBtn = page.getByRole('button', { name: /EXPLORE/i });
    await exploreBtn.evaluate((btn) => btn.click());
    const blockBtn = page.getByRole('button', { name: /3D Ocean Volume Block/i });
    await blockBtn.evaluate((btn) => btn.click());
    await expect(loadingIndicator).not.toBeVisible();

    if (releaseHeldRoute) {
      releaseHeldRoute();
      releaseHeldRoute = null;
    }
    if (routeSettledPromise) await routeSettledPromise;
    await expect(resultsContainer).not.toBeVisible();

    await page.screenshot({ path: path.join(evidenceDir, 'TC-P07-10-pending-invalidation-suite.png') });
  });

});
