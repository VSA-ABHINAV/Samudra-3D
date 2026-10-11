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

import * as THREE from 'three';
import {
  createArgoMarker,
  updateMarkerSelectionVisuals,
  disposeArgoMarkers
} from '../src/utils/argoProfiles.js';

test.describe('Argo Marker 3D Mesh Architecture & Anti-Sprite Regression', () => {
  const sampleFloat = {
    id: 'ARGO_2902145',
    wmo_id: '2902145',
    platform_type: 'argo',
    lat: 12.48,
    lon: 82.03,
    timestamp: '2025-01-04T06:00:00Z',
    qc_summary: { good: 7, bad: 0, pass_rate_pct: 100.0 }
  };

  test('createArgoMarker constructs bounded 3D mesh geometries and strictly zero screen-space Sprites', () => {
    const marker = createArgoMarker(sampleFloat, false);
    expect(marker).toBeInstanceOf(THREE.Group);

    let spriteCount = 0;
    let meshCount = 0;
    marker.traverse((child) => {
      if (child.isSprite || child instanceof THREE.Sprite) spriteCount++;
      if (child.isMesh || child instanceof THREE.Mesh) meshCount++;
    });

    expect(spriteCount).toBe(0);
    expect(meshCount).toBeGreaterThanOrEqual(4);

    const beacon = marker.getObjectByName('beacon');
    expect(beacon).toBeDefined();
    expect(beacon.geometry).toBeInstanceOf(THREE.SphereGeometry);
    expect(beacon.geometry.parameters.radius).toBe(1.2);

    const ring = marker.getObjectByName('selection-ring');
    expect(ring).toBeDefined();
    expect(ring.geometry).toBeInstanceOf(THREE.RingGeometry);

    const glow = marker.getObjectByName('glow');
    expect(glow).toBeDefined();
    expect(glow.geometry).toBeInstanceOf(THREE.SphereGeometry);
  });

  test('updateMarkerSelectionVisuals maintains 3D mesh architecture on selection without introducing Sprites', () => {
    const marker = createArgoMarker(sampleFloat, false);
    const container = new THREE.Group();
    container.add(marker);

    updateMarkerSelectionVisuals(container, 'ARGO_2902145');

    let spriteCount = 0;
    marker.traverse((child) => {
      if (child.isSprite || child instanceof THREE.Sprite) spriteCount++;
    });
    expect(spriteCount).toBe(0);

    const beacon = marker.getObjectByName('beacon');
    const ring = marker.getObjectByName('selection-ring');
    expect(beacon.scale.x).toBe(1.35);
    expect(ring.visible).toBe(true);

    disposeArgoMarkers(container);
    expect(container.children.length).toBe(0);
  });
});

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

    await page.route('**/api/collocation/profile/*', (route) =>
      route.fulfill({
        json: {
          profile_id: 'ARGO_2902145',
          lat: 12.48,
          lon: 82.03,
          time: '2025-01-04T06:00:00Z',
          depths: [0.5, 10, 50, 100, 500, 1000, 2000],
          observed_temperature: [29.1, 28.8, 28.2, 26.5, 12.0, 7.5, 3.2],
          model_temperature: [28.9, 28.7, 28.0, 26.1, 11.8, 7.4, 3.1],
          observed_salinity: [34.5, 34.6, 34.8, 35.1, 35.0, 34.9, 34.8],
          model_salinity: [34.4, 34.5, 34.7, 35.0, 34.9, 34.8, 34.7],
          metrics_temperature: { bias: -0.15, mae: 0.18, rmse: 0.22, pearson: 0.998, health: 'EXCELLENT' },
          metrics_salinity: { bias: -0.08, mae: 0.09, rmse: 0.11, pearson: 0.995, health: 'EXCELLENT' },
          spatial_distance_km: 1.2
        }
      })
    );

    await page.route('**/api/collocation/glider/*', (route) =>
      route.fulfill({
        json: {
          glider_id: 'GLIDER_REAL_INCOIS_SG02',
          mission_name: 'Arabian Sea Deep Glider',
          waypoints_count: 3,
          metrics_temperature: { bias: -0.21, mae: 0.25, rmse: 0.31, pearson: 0.992, health: 'GOOD' },
          metrics_salinity: { bias: -0.10, mae: 0.12, rmse: 0.15, pearson: 0.988, health: 'GOOD' },
          spatial_distance_km: 2.5
        }
      })
    );

    await page.route('**/api/collocation/health*', (route) =>
      route.fulfill({
        json: { status: 'HEALTHY', domain_verified: true, latency_ms: 12.4 }
      })
    );
  });

  test('1920x1080: Populated Argo and Glider layers render 3D spherical markers without viewport occlusions', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));

    // Helper to evaluate rendered composited screenshot frame pixels
    const sampleScreenshotFrame = async (screenshotBuffer) => {
      return await page.evaluate(async (dataUrl) => {
        const img = new window.Image();
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
          img.src = dataUrl;
        });
        const scratch = document.createElement('canvas');
        scratch.width = img.width;
        scratch.height = img.height;
        const ctx = scratch.getContext('2d');
        ctx.drawImage(img, 0, 0);

        const getPixel = (x, y) => {
          const p = ctx.getImageData(x, y, 1, 1).data;
          return {
            r: p[0],
            g: p[1],
            b: p[2],
            a: p[3],
            brightness: (p[0] + p[1] + p[2]) / 3
          };
        };

        const tl = getPixel(40, 40);
        const tr = getPixel(img.width - 450, 40);
        const center = getPixel(Math.floor(img.width * 0.45), Math.floor(img.height * 0.45));
        return { width: img.width, height: img.height, tl, tr, center };
      }, `data:image/png;base64,${screenshotBuffer.toString('base64')}`);
    };

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

    // 4. ACTIVE-STATE RENDERING ASSERTION (Both observation layers ON + Drawer OPEN)
    await page.waitForTimeout(600);
    const screenshot1 = await page.screenshot({ path: path.join(evidenceDir, '01-argo-gliders-active-drawer-open.png') });
    const activeFrame = await sampleScreenshotFrame(screenshot1);

    expect(activeFrame.width).toBe(1920);
    expect(activeFrame.height).toBe(1080);
    // Prove frame is actively rendered (center globe/ocean data has non-zero brightness)
    expect(activeFrame.center.brightness).toBeGreaterThan(20);
    // Prove space background corners remain dark (no screen-spanning NDC sprite quads)
    expect(activeFrame.tl.brightness).toBeLessThan(50);
    expect(activeFrame.tr.brightness).toBeLessThan(50);

    // 5. Close Observation Drawer while markers remain active
    const closeBtn = drawer.locator('.icon-close-btn');
    await closeBtn.click();
    await expect(drawer).toHaveCount(0);
    await expect(obsBtn).toHaveAttribute('aria-pressed', 'false');
    await expect(argoBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(glidersBtn).toHaveAttribute('aria-pressed', 'true');

    // Active-state check with drawer closed (clean full globe view)
    await page.waitForTimeout(600);
    const screenshot2 = await page.screenshot({ path: path.join(evidenceDir, '02-both-layers-active-drawer-closed.png') });
    const closedDrawerFrame = await sampleScreenshotFrame(screenshot2);
    expect(closedDrawerFrame.center.brightness).toBeGreaterThan(20);
    expect(closedDrawerFrame.tl.brightness).toBeLessThan(50);
    expect(closedDrawerFrame.tr.brightness).toBeLessThan(50);

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
    // ACTIVE-STATE SELECTED FLOAT ASSERTION: Selection halo active on globe
    const screenshot5 = await page.screenshot({ path: path.join(evidenceDir, '05-selected-float-with-halo-drawer-open.png') });
    const selectedFloatFrame = await sampleScreenshotFrame(screenshot5);
    expect(selectedFloatFrame.center.brightness).toBeGreaterThan(20);
    expect(selectedFloatFrame.tl.brightness).toBeLessThan(50);
    expect(selectedFloatFrame.tr.brightness).toBeLessThan(50);

    // 9. Test both-off state
    await argoBtn.click();
    await expect(argoBtn).toHaveAttribute('aria-pressed', 'false');
    await expect(glidersBtn).toHaveAttribute('aria-pressed', 'false');

    await page.waitForTimeout(500);
    const screenshot6 = await page.screenshot({ path: path.join(evidenceDir, '06-both-off-drawer-open.png') });
    const bothOffFrame = await sampleScreenshotFrame(screenshot6);
    expect(bothOffFrame.center.brightness).toBeGreaterThan(20);
    expect(bothOffFrame.tl.brightness).toBeLessThan(50);
    expect(bothOffFrame.tr.brightness).toBeLessThan(50);

    expect(errors).toEqual([]);
  });

  test('1920x1080: Observation Fleet -> Select Platform -> Compare Model workflow renders clean 3D globe without viewport rectangle artifacts', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));

    const sampleScreenshotFrame = async (screenshotBuffer) => {
      return await page.evaluate(async (dataUrl) => {
        const img = new window.Image();
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
          img.src = dataUrl;
        });
        const scratch = document.createElement('canvas');
        scratch.width = img.width;
        scratch.height = img.height;
        const ctx = scratch.getContext('2d');
        ctx.drawImage(img, 0, 0);

        const getPixel = (x, y) => {
          const p = ctx.getImageData(x, y, 1, 1).data;
          return {
            r: p[0],
            g: p[1],
            b: p[2],
            a: p[3],
            brightness: (p[0] + p[1] + p[2]) / 3
          };
        };

        const tl = getPixel(40, 40);
        const tr = getPixel(img.width - 450, 40);
        const bl = getPixel(40, img.height - 120);
        const br = getPixel(img.width - 450, img.height - 120);
        const center = getPixel(Math.floor(img.width * 0.45), Math.floor(img.height * 0.45));
        return { width: img.width, height: img.height, tl, tr, bl, br, center };
      }, `data:image/png;base64,${screenshotBuffer.toString('base64')}`);
    };

    // 1. Set 1920x1080 desktop viewport and navigate to /app with observations workflow
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/app?workflow=observations');

    await expect(page.locator('#workspace')).toBeVisible({ timeout: 15000 });
    const drawer = page.locator('[data-testid="observation-drawer"]');
    await expect(drawer).toBeVisible({ timeout: 10000 });

    // 2. Toggle ARGO and GLIDERS layers ON
    const argoBtn = page.locator('[data-testid="bottombar-argo-btn"]');
    const glidersBtn = page.locator('[data-testid="bottombar-gliders-btn"]');
    await expect(argoBtn).toBeVisible();
    await expect(glidersBtn).toBeVisible();

    if ((await argoBtn.getAttribute('aria-pressed')) !== 'true') {
      await argoBtn.click();
    }
    if ((await glidersBtn.getAttribute('aria-pressed')) !== 'true') {
      await glidersBtn.click();
    }
    await expect(argoBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(glidersBtn).toHaveAttribute('aria-pressed', 'true');

    // 3. Select Argo platform from drawer
    const firstArgoCard = drawer.locator('.platform-item-card').first();
    await expect(firstArgoCard).toBeVisible();
    await firstArgoCard.click();

    // 4. Click Compare Model button on selected Argo card
    const compareBtn = firstArgoCard.locator('[data-testid="platform-compare-btn"]');
    await expect(compareBtn).toBeVisible();
    await compareBtn.click();

    // 5. Verify Model Comparison Suite modal opens while layers remain active
    const comparisonModal = page.locator('[data-testid="model-comparison-modal"]');
    await expect(comparisonModal).toBeVisible({ timeout: 8000 });

    await page.waitForTimeout(600);
    const screenshotArgo = await page.screenshot({
      path: path.join(evidenceDir, '07-observation-compare-model-argo-active.png')
    });
    const argoFrame = await sampleScreenshotFrame(screenshotArgo);

    expect(argoFrame.width).toBe(1920);
    expect(argoFrame.height).toBe(1080);
    // Space background corners remain dark (no viewport-covering quad/rectangle)
    expect(argoFrame.tl.brightness).toBeLessThan(50);
    expect(argoFrame.tr.brightness).toBeLessThan(50);
    expect(argoFrame.bl.brightness).toBeLessThan(50);

    // 6. Close comparison modal
    const closeModalBtn = page.locator('[data-testid="close-comparison-modal-btn"]');
    await closeModalBtn.click();
    await expect(comparisonModal).not.toBeVisible();

    // 7. Filter drawer to Gliders and select Glider platform
    await drawer.locator('[data-testid="filter-glider"]').click();
    const firstGliderCard = drawer.locator('.platform-item-card').first();
    await expect(firstGliderCard).toBeVisible();
    await firstGliderCard.click();

    // 8. Click Compare Model on Glider card
    const gliderCompareBtn = firstGliderCard.locator('[data-testid="platform-compare-btn"]');
    await expect(gliderCompareBtn).toBeVisible();
    await gliderCompareBtn.click();

    await expect(comparisonModal).toBeVisible({ timeout: 8000 });
    await page.waitForTimeout(600);

    const screenshotGlider = await page.screenshot({
      path: path.join(evidenceDir, '08-observation-compare-model-glider-active.png')
    });
    const gliderFrame = await sampleScreenshotFrame(screenshotGlider);

    expect(gliderFrame.tl.brightness).toBeLessThan(50);
    expect(gliderFrame.tr.brightness).toBeLessThan(50);

    // Close modal
    await closeModalBtn.click();
    await expect(comparisonModal).not.toBeVisible();

    expect(errors).toEqual([]);
  });
});
