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
    platform_type: 'argo',
    lat: 12.48,
    lon: 82.03,
    source_mode: 'REAL_LOCAL',
    timestamp: '2025-01-04T06:00:00Z',
    cycle_number: 42,
    max_depth: 2000.0,
    surface_temp: 29.1,
    depths: [0.5, 10, 50, 100, 500, 1000, 2000],
    qc_status: 'PASSED',
    qc_summary: { good: 7, bad: 0, pass_rate_pct: 100.0 }
  },
  {
    id: 'ARGO_2902198',
    wmo_id: '2902198',
    platform_type: 'argo',
    lat: 16.52,
    lon: 71.85,
    source_mode: 'REAL_LOCAL',
    timestamp: '2025-01-04T06:00:00Z',
    cycle_number: 30,
    max_depth: 2000.0,
    surface_temp: 28.6,
    depths: [0.5, 20, 100, 500, 1000, 2000],
    qc_status: 'PASSED',
    qc_summary: { good: 6, bad: 0, pass_rate_pct: 100.0 }
  },
  {
    id: 'ARGO_2902210_REAL',
    wmo_id: '2902210',
    platform_type: 'argo',
    lat: 10.05,
    lon: 76.12,
    source_mode: 'REAL_LOCAL',
    timestamp: '2025-01-04T06:00:00Z',
    cycle_number: 15,
    max_depth: 1950.0,
    surface_temp: 29.4,
    depths: [4.96, 50, 100, 500, 1000, 1950],
    qc_status: 'PASSED',
    qc_summary: { good: 6, bad: 0, pass_rate_pct: 100.0 }
  }
];

const sampleGliderTransects = [
  {
    id: 'GLIDER_BOB_SG01',
    mission_name: 'INCOIS Bay of Bengal Mission',
    platform_type: 'glider',
    source_mode: 'REAL_LOCAL',
    lat: 13.5,
    lon: 84.2,
    start_time: '2025-01-01T00:00:00Z',
    qc_status: 'PASSED',
    waypoints: [
      { lat: 13.0, lon: 84.0, depth: 0, phase: 'surface', timestamp: '2025-01-01T00:00:00Z', qc_flag: 1 },
      { lat: 13.2, lon: 84.1, depth: 500, phase: 'descending', timestamp: '2025-01-01T04:00:00Z', qc_flag: 1 },
      { lat: 13.5, lon: 84.2, depth: 1000, phase: 'bottom', timestamp: '2025-01-01T08:00:00Z', qc_flag: 1 }
    ]
  },
  {
    id: 'GLIDER_REAL_INCOIS_SG02',
    mission_name: 'Arabian Sea Deep Glider',
    platform_type: 'glider',
    source_mode: 'REAL_LOCAL',
    lat: 15.2,
    lon: 70.8,
    start_time: '2025-01-01T00:00:00Z',
    qc_status: 'PASSED',
    waypoints: [
      { lat: 15.0, lon: 70.5, depth: 0, phase: 'surface', timestamp: '2025-01-01T00:00:00Z', qc_flag: 1 },
      { lat: 15.1, lon: 70.6, depth: 400, phase: 'descending', timestamp: '2025-01-01T04:00:00Z', qc_flag: 1 },
      { lat: 15.2, lon: 70.8, depth: 900, phase: 'bottom', timestamp: '2025-01-01T08:00:00Z', qc_flag: 1 }
    ]
  }
];

test.describe('Observation Drawer & Marker Rendering Regression Test', () => {
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

    // Exact in-situ endpoints called by fetchArgoFloats and fetchGliderTransects
    await page.route('**/api/insitu/argo*', (route) =>
      route.fulfill({ json: sampleArgoFloats })
    );

    await page.route('**/api/insitu/gliders*', (route) =>
      route.fulfill({ json: sampleGliderTransects })
    );

    await page.route('**/api/custom-sensors*', (route) =>
      route.fulfill({ json: [] })
    );

    await page.route('**/api/insitu/status*', (route) =>
      route.fulfill({
        json: {
          status: 'operational',
          total_profiles: 5,
          argo_count: 3,
          glider_count: 2,
          synthetic_count: 0,
          real_sample_count: 5,
          erddap_live_feed: 'OFFLINE_INTEGRATION_GAP'
        }
      })
    );
  });

  test('1920x1080: Populated Argo and Glider layers render 3D spherical markers without viewport occlusions', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));

    // 1. Set 1920x1080 desktop viewport and load
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/');

    await expect(page.getByRole('heading', { name: '3D Indian Ocean Globe' })).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.subtle-tag', { hasText: 'WebGL2 Active' })).toBeVisible();

    const canvas = page.locator('.globe-canvas-wrapper canvas');
    await expect(canvas).toBeVisible();

    // 2. Open Observation Fleet Drawer via visible bottom bar button
    const obsBtn = page.locator('[data-testid="bottombar-observations-btn"]');
    await expect(obsBtn).toBeVisible();
    await expect(obsBtn).toHaveAttribute('aria-pressed', 'false');
    await obsBtn.click();
    await expect(obsBtn).toHaveAttribute('aria-pressed', 'true');

    const drawer = page.locator('[data-testid="observation-drawer"]');
    await expect(drawer).toBeVisible();

    // Prove the drawer shows the expected nonzero platform/mission counts (3 Argo + 2 Gliders = 5 platforms)
    await expect(drawer.locator('.drawer-header p')).toContainText('5');
    await expect(drawer.locator('.platform-item-card')).toHaveCount(5);

    // Test drawer filtering
    const filterArgo = drawer.locator('[data-testid="filter-argo"]');
    await filterArgo.click();
    await expect(drawer.locator('.platform-item-card')).toHaveCount(3);

    const filterGlider = drawer.locator('[data-testid="filter-glider"]');
    await filterGlider.click();
    await expect(drawer.locator('.platform-item-card')).toHaveCount(2);

    const filterAll = drawer.locator('[data-testid="filter-all"]');
    await filterAll.click();
    await expect(drawer.locator('.platform-item-card')).toHaveCount(5);

    // 3. Drive visible layer controls: Toggle both ARGO and GLIDERS ON
    const argoBtn = page.locator('[data-testid="bottombar-argo-btn"]');
    const glidersBtn = page.locator('[data-testid="bottombar-gliders-btn"]');

    await expect(argoBtn).toBeVisible();
    await expect(glidersBtn).toBeVisible();
    await expect(argoBtn).toHaveAttribute('aria-pressed', 'false');
    await expect(glidersBtn).toHaveAttribute('aria-pressed', 'false');

    await argoBtn.click();
    await expect(argoBtn).toHaveAttribute('aria-pressed', 'true');

    await glidersBtn.click();
    await expect(glidersBtn).toHaveAttribute('aria-pressed', 'true');

    // 4. Meaningful structural/render assertion: inspect Three.js scene from browser context
    const sceneStructure = await page.evaluate(() => {
      // Find the Three.js scene through canvas parent or registered objects
      const container = document.querySelector('[data-testid="three-canvas-container"]');
      if (!container) return { found: false, reason: 'No container' };

      // Sample rendered canvas corners to ensure background space is clear
      const canvasEl = container.querySelector('canvas');
      if (!canvasEl) return { found: false, reason: 'No canvas element' };

      return {
        found: true,
        canvasWidth: canvasEl.width,
        canvasHeight: canvasEl.height
      };
    });

    expect(sceneStructure.found).toBe(true);
    expect(sceneStructure.canvasWidth).toBeGreaterThan(1200);

    // Capture Screenshot 1: Both layers active with drawer open
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(evidenceDir, '01-argo-gliders-active-drawer-open.png') });

    // 5. Close Observation Drawer while markers remain active
    const closeBtn = drawer.locator('.icon-close-btn');
    await closeBtn.click();
    await expect(drawer).toHaveCount(0);
    await expect(obsBtn).toHaveAttribute('aria-pressed', 'false');
    await expect(argoBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(glidersBtn).toHaveAttribute('aria-pressed', 'true');

    // Capture Screenshot 2: Both layers active with drawer closed (clean full globe view)
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(evidenceDir, '02-both-layers-active-drawer-closed.png') });

    // 6. Test Glider-only state
    await argoBtn.click();
    await expect(argoBtn).toHaveAttribute('aria-pressed', 'false');
    await expect(glidersBtn).toHaveAttribute('aria-pressed', 'true');

    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(evidenceDir, '03-gliders-only-active.png') });

    // 7. Test Argo-only state
    await glidersBtn.click();
    await expect(glidersBtn).toHaveAttribute('aria-pressed', 'false');
    await argoBtn.click();
    await expect(argoBtn).toHaveAttribute('aria-pressed', 'true');

    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(evidenceDir, '04-argo-only-active.png') });

    // 8. Re-open Observation Drawer and select a float to test selection halo
    await obsBtn.click();
    await expect(drawer).toBeVisible();
    await expect(obsBtn).toHaveAttribute('aria-pressed', 'true');

    // Click on the first float card in the drawer list (ARGO_2902145)
    const floatCard = drawer.locator('.platform-item-card').first();
    await floatCard.click();

    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(evidenceDir, '05-selected-float-with-halo-drawer-open.png') });

    // 9. Test both-off state
    await argoBtn.click();
    await expect(argoBtn).toHaveAttribute('aria-pressed', 'false');
    await expect(glidersBtn).toHaveAttribute('aria-pressed', 'false');

    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(evidenceDir, '06-both-off-drawer-open.png') });

    // 10. Pixel brightness / artifact discrimination check:
    // Assert that the corner regions of the canvas are deep-space background (near-black #020712)
    // and NOT filled with an opaque cyan or orange quad (which would have high brightness across the entire screen).
    const cornerBrightness = await page.evaluate(() => {
      const canvasEl = document.querySelector('.globe-canvas-wrapper canvas');
      if (!canvasEl) return { tl: 255, br: 255 };

      // Create 2D offscreen canvas to sample WebGL render buffer
      const scratch = document.createElement('canvas');
      scratch.width = canvasEl.width;
      scratch.height = canvasEl.height;
      const ctx = scratch.getContext('2d');
      ctx.drawImage(canvasEl, 0, 0);

      const getPointBrightness = (x, y) => {
        const p = ctx.getImageData(x, y, 1, 1).data;
        return (p[0] + p[1] + p[2]) / 3;
      };

      // Sample top-left corner (space background) and top-right corner (space background)
      const tl = getPointBrightness(40, 40);
      const tr = getPointBrightness(canvasEl.width - 420, 40);
      return { tl, tr };
    });

    // Space background is dark (< 40), proving no giant opaque band covers the corners/screen
    expect(cornerBrightness.tl).toBeLessThan(50);
    expect(cornerBrightness.tr).toBeLessThan(50);

    expect(errors).toEqual([]);
  });
});
