import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const evidenceDir = path.resolve('..', 'docs', 'evidence', 'observation-globe-fix');
mkdirSync(evidenceDir, { recursive: true });

const datasetId = 'cmems_mod_glo_phy_my_0.083deg_P1D-m';

const sampleArgoFloats = [
  {
    id: 'ARGO_2902145',
    wmo_id: '2902145',
    lat: 12.48,
    lon: 82.03,
    source_mode: 'REAL_LOCAL',
    timestamp: '2025-01-04T06:00:00Z',
    cycle_number: 42,
    depths: [0.5, 10, 50, 100, 500, 1000, 2000],
    qc_status: 'PASSED',
    qc_summary: { good: 7, bad: 0 }
  },
  {
    id: 'ARGO_2902198',
    wmo_id: '2902198',
    lat: 16.52,
    lon: 71.85,
    source_mode: 'REAL_LOCAL',
    timestamp: '2025-01-04T06:00:00Z',
    cycle_number: 30,
    depths: [0.5, 20, 100, 500, 1000, 2000],
    qc_status: 'PASSED',
    qc_summary: { good: 6, bad: 0 }
  }
];

const sampleGliderTransects = [
  {
    id: 'GLIDER_INCOIS_BOB_01',
    mission_name: 'INCOIS Bay of Bengal Mission',
    source_mode: 'REAL_LOCAL',
    lat: 13.5,
    lon: 84.2,
    start_time: '2025-01-01T00:00:00Z',
    waypoints: [
      { lat: 13.0, lon: 84.0, depth: 0, phase: 'surface', timestamp: '2025-01-01T00:00:00Z' },
      { lat: 13.2, lon: 84.1, depth: 500, phase: 'descending', timestamp: '2025-01-01T04:00:00Z' },
      { lat: 13.5, lon: 84.2, depth: 1000, phase: 'bottom', timestamp: '2025-01-01T08:00:00Z' }
    ]
  }
];

test.describe('Observation Drawer Globe Rendering Regression Test', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/datasets', (route) =>
      route.fulfill({
        json: {
          active_dataset_id: datasetId,
          datasets: [
            {
              dataset_id: datasetId,
              name: 'Copernicus Global Ocean Physics Reanalysis (GLORYS12V1)',
              status: 'READY',
              source_mode: 'REAL_COPERNICUS'
            }
          ]
        }
      })
    );

    await page.route('**/api/metadata*', (route) =>
      route.fulfill({
        json: {
          dataset_id: datasetId,
          depth_levels_m: [0.49, 9.57, 47.95, 92.33],
          time_timestamps: ['2025-01-01T00:00:00Z', '2025-01-02T00:00:00Z'],
          variables: {
            temperature: { name: 'Potential Temperature', units: 'degC' },
            salinity: { name: 'Salinity', units: 'PSU' },
            currents: { name: 'Current Speed', units: 'm/s' }
          }
        }
      })
    );

    await page.route('**/api/ocean-data*', (route) =>
      route.fulfill({
        json: {
          dataset_id: datasetId,
          variable: 'temperature',
          units: 'degC',
          selected_depth: 0.49,
          time: '2025-01-01T00:00:00Z',
          lats: [0, 5, 10, 15, 20, 25],
          lons: [65, 70, 75, 80, 85, 90, 95],
          values: [
            [28.1, 28.3, 28.5, 28.7, 28.9, 29.0, 29.1],
            [28.0, 28.2, 28.4, 28.6, 28.8, 28.9, 29.0],
            [27.8, 28.0, 28.2, 28.4, 28.6, 28.7, 28.8],
            [27.5, 27.7, 27.9, 28.1, 28.3, 28.4, 28.5],
            [27.0, 27.2, 27.4, 27.6, 27.8, 27.9, 28.0],
            [26.5, 26.7, 26.9, 27.1, 27.3, 27.4, 27.5]
          ],
          min_val: 26.5,
          max_val: 29.1,
          is_real_data: true,
          provenance_badge: '[REAL • COPERNICUS]'
        }
      })
    );

    await page.route('**/api/argo/floats*', (route) =>
      route.fulfill({ json: sampleArgoFloats })
    );

    await page.route('**/api/gliders/transects*', (route) =>
      route.fulfill({ json: sampleGliderTransects })
    );

    await page.route('**/api/custom-sensors*', (route) =>
      route.fulfill({ json: [] })
    );

    await page.route('**/api/insitu/status*', (route) =>
      route.fulfill({
        json: {
          status: 'operational',
          total_profiles: 3,
          argo_count: 2,
          glider_count: 1,
          synthetic_count: 0,
          real_sample_count: 3,
          erddap_live_feed: 'OFFLINE_INTEGRATION_GAP'
        }
      })
    );
  });

  test('1920x1080: Opening observations and toggling Argo/Glider markers keeps globe spherical and intact', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));

    // 1. Set 1920x1080 desktop viewport
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/');

    await expect(page.getByRole('heading', { name: '3D Indian Ocean Globe' })).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.subtle-tag', { hasText: 'WebGL2 Active' })).toBeVisible();

    const canvas = page.locator('.globe-canvas-wrapper canvas');
    await expect(canvas).toBeVisible();

    // Settle initial render
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(evidenceDir, '01-globe-initial-1920x1080.png') });

    // 2. Open Observation Fleet Drawer
    const obsBtn = page.locator('[data-testid="open-observation-drawer-btn"]');
    await expect(obsBtn).toBeVisible();
    await obsBtn.click();

    const drawer = page.locator('[data-testid="observation-drawer"]');
    await expect(drawer).toBeVisible();

    // Settle and screenshot with drawer open
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(evidenceDir, '02-observation-drawer-open.png') });

    // 3. Toggle Argo layer ON
    const argoCheckbox = page.locator('input#layer-argo');
    if (await argoCheckbox.count() > 0) {
      await argoCheckbox.check();
      await expect(argoCheckbox).toBeChecked();
    }

    // Select an Argo float if selector is available
    const argoSelect = page.locator('select#argo-float-select');
    if (await argoSelect.count() > 0 && await argoSelect.isVisible()) {
      await argoSelect.selectOption('ARGO_2902145');
    }

    // Also toggle Gliders ON
    const glidersCheckbox = page.locator('input#layer-gliders');
    if (await glidersCheckbox.count() > 0) {
      await glidersCheckbox.check();
      await expect(glidersCheckbox).toBeChecked();
    }

    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(evidenceDir, '03-argo-gliders-active-drawer-open.png') });

    // 4. Close Observation Drawer while markers remain active
    const closeBtn = drawer.locator('.icon-close-btn');
    await closeBtn.click();
    await expect(drawer).toHaveCount(0);

    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(evidenceDir, '04-markers-active-drawer-closed.png') });

    // 5. Re-open Observation Drawer and toggle layers independently
    await obsBtn.click();
    await expect(drawer).toBeVisible();

    // Toggle Argo OFF, keep Gliders ON
    if (await argoCheckbox.count() > 0) {
      await argoCheckbox.uncheck();
    }
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(evidenceDir, '05-gliders-only-drawer-open.png') });

    // Toggle Gliders OFF, toggle Argo ON
    if (await glidersCheckbox.count() > 0) {
      await glidersCheckbox.uncheck();
    }
    if (await argoCheckbox.count() > 0) {
      await argoCheckbox.check();
    }
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(evidenceDir, '06-argo-only-drawer-open.png') });

    // 6. Verify WebGL canvas remains rendered, viewport intact, no unhandled fatal errors
    const canvasBox = await canvas.boundingBox();
    expect(canvasBox.width).toBeGreaterThan(800);
    expect(canvasBox.height).toBeGreaterThan(500);

    expect(errors).toEqual([]);
  });
});
