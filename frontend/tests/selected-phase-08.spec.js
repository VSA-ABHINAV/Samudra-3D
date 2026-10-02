import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const evidenceDir = path.resolve('..', 'docs', 'evidence', 'selected-phase-08');
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

const MOCK_ARGO_BOB = {
  id: 'ARGO_2902145',
  platform_type: 'argo',
  name: 'Argo Float 2902145 (Bay of Bengal)',
  lat: 12.48,
  lon: 82.03,
  timestamp: '2026-09-10T12:00:00Z',
  depths: [0.0, 10.0, 25.0, 50.0, 75.0, 100.0, 150.0, 200.0, 300.0, 500.0, 750.0, 1000.0, 1500.0, 2000.0],
  temperature: [29.1, 28.9, 27.8, 24.2, 21.1, 18.5, 15.2, 13.1, 10.4, 7.2, 5.1, 4.2, 3.1, 2.4],
  salinity: [33.2, 33.4, 33.8, 34.4, 34.8, 35.0, 35.1, 35.2, 35.1, 35.0, 34.9, 34.8, 34.8, 34.7],
  qc_flags: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  metadata: {
    wmo_id: '2902145',
    data_centre: 'INCOIS-DAC',
    cycle_number: 84,
    direction: 'ascending',
    synthetic: true
  },
  source_mode: 'SYNTHETIC'
};

const MOCK_ARGO_AS = {
  id: 'ARGO_2902198',
  platform_type: 'argo',
  name: 'Argo Float 2902198 (Arabian Sea)',
  lat: 16.52,
  lon: 71.85,
  timestamp: '2026-09-10T12:00:00Z',
  depths: [0.0, 10.0, 25.0, 50.0, 75.0, 100.0, 150.0, 200.0, 300.0, 500.0, 750.0, 1000.0, 1500.0, 2000.0],
  temperature: [28.2, 28.0, 26.5, 23.1, 19.8, 17.2, 14.5, 12.8, 9.8, 6.9, 4.8, 4.0, 3.0, 2.3],
  salinity: [36.1, 36.2, 36.3, 36.4, 36.2, 35.9, 35.6, 35.4, 35.2, 35.1, 35.0, 34.9, 34.8, 34.8],
  qc_flags: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  metadata: {
    wmo_id: '2902198',
    data_centre: 'INCOIS-DAC',
    cycle_number: 62,
    direction: 'ascending',
    synthetic: true
  },
  source_mode: 'SYNTHETIC'
};

const MOCK_ARGO_REAL = {
  id: 'ARGO_2902210_REAL',
  platform_type: 'argo',
  name: 'Argo Float 2902210 (South Indian Ocean - INCOIS Reference Sample)',
  wmo_id: '2902210',
  lat: 11.25,
  lon: 88.5,
  timestamp: '2026-09-10T06:30:00Z',
  depths: [4.96, 9.92, 19.84, 49.6, 74.4, 99.2, 148.8, 198.4, 297.6, 496.0, 744.0, 992.0, 1488.0, 1984.0],
  temperature: [28.42, 28.38, 27.95, 25.12, 22.4, 20.35, 16.8, 14.1, 11.25, 8.1, 5.85, 4.4, 3.2, 2.15],
  salinity: [34.78, 34.8, 34.92, 35.15, 35.28, 35.3, 35.18, 35.02, 34.85, 34.72, 34.75, 34.8, 34.74, 34.71],
  qc_flags: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  metadata: {
    wmo_id: '2902210',
    data_centre: 'INCOIS-DAC',
    cycle_number: 118,
    direction: 'ascending',
    float_type: 'APEX',
    source_mode: 'REAL_LOCAL',
    synthetic: false,
    attribution: 'Indian National Centre for Ocean Information Services (INCOIS) / Argo International Program'
  },
  source_mode: 'REAL_LOCAL'
};

async function setupStandardRoutes(page, { activeDataset = DATASET_SYNTHETIC, metadata = METADATA_SYNTHETIC } = {}) {
  const probeRequests = [];
  const argoRequests = [];

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
    page.route('**/api/ocean/probe*', async (route) => {
      const url = new URL(route.request().url());
      const lat = parseFloat(url.searchParams.get('lat'));
      const lon = parseFloat(url.searchParams.get('lon'));
      probeRequests.push({ lat, lon, time_idx: url.searchParams.get('time_idx') });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          lat,
          lon,
          timestamp: '2026-09-10T00:00:00Z',
          time_idx: 0,
          depths: [0, 10, 50, 100, 200, 500],
          temperature: [28.5, 28.2, 24.5, 18.5, 12.5, 6.5],
          salinity: [34.5, 34.6, 35.0, 35.2, 35.1, 35.0]
        })
      });
    }),
    page.route('**/api/insitu/argo**', async (route) => {
      const url = new URL(route.request().url());
      const pathname = url.pathname.replace(/\/+$/, '');
      if (pathname === '/api/insitu/argo') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([MOCK_ARGO_BOB, MOCK_ARGO_AS])
        });
        return;
      }

      const pathParts = pathname.split('/');
      const rawId = decodeURIComponent(pathParts[pathParts.length - 1]);
      argoRequests.push(rawId);

      const upperId = rawId.toUpperCase();
      if (upperId === 'ARGO_2902145' || upperId === '2902145') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(MOCK_ARGO_BOB)
        });
      } else if (upperId === 'ARGO_2902198' || upperId === '2902198') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(MOCK_ARGO_AS)
        });
      } else if (upperId === 'ARGO_2902210_REAL' || upperId === '2902210' || upperId === 'ARGO_2902210') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(MOCK_ARGO_REAL)
        });
      } else {
        await route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({ detail: `Float profile '${rawId}' not found` })
        });
      }
    }),
    page.route('**/api/insitu/gliders*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([])
      });
    }),
    page.route('**/api/insitu/sensors*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([])
      });
    })
  ]);

  return { probeRequests, argoRequests };
}

async function waitForDatasetReady(page) {
  await expect(page.getByRole('heading', { name: 'Indian Ocean workspace' })).toBeVisible({ timeout: 15000 });
  await expect(page.locator('[data-testid="current-time-badge"]')).toBeVisible({ timeout: 10000 });
}

test.describe('Selected Phase 08: Argo Observation-ID Search & Platform Selection', () => {

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test('TC-P08-01: WMO ID and prefix/case normalization resolves actual platform', async ({ page }) => {
    const { argoRequests } = await setupStandardRoutes(page);
    await page.goto('/');
    await waitForDatasetReady(page);

    const searchInput = page.locator('[data-testid="global-search-input"]');
    await expect(searchInput).toBeVisible();

    // 1. Search with pure 7-digit numeric WMO ID
    await searchInput.fill('2902145');
    const argoResult = page.locator('[data-testid="argo-search-result"]');
    await expect(argoResult).toBeVisible({ timeout: 5000 });
    await expect(argoResult).toContainText('Argo Float 2902145 (Bay of Bengal)');
    await expect(argoResult).toContainText('12.48°N, 82.03°E');
    await expect(argoResult).toContainText('Platform ID: ARGO_2902145');

    // 2. Search with lowercase argo_ prefix
    await searchInput.fill('argo_2902145');
    await expect(argoResult).toBeVisible();
    await expect(argoResult).toContainText('Argo Float 2902145 (Bay of Bengal)');

    // 3. Search with space "argo 2902198"
    await searchInput.fill('argo 2902198');
    await expect(argoResult).toBeVisible();
    await expect(argoResult).toContainText('Argo Float 2902198 (Arabian Sea)');
    await expect(argoResult).toContainText('16.52°N, 71.85°E');

    // 4. Search with real sample WMO ID "2902210"
    await searchInput.fill('2902210');
    await expect(argoResult).toBeVisible();
    await expect(argoResult).toContainText('Argo Float 2902210');
    await expect(argoResult).toContainText('11.25°N, 88.50°E');

    // Verify requests were made
    expect(argoRequests.length).toBeGreaterThanOrEqual(4);
  });

  test('TC-P08-02: Selecting Argo search result selects profile, enables marker layer, and probes coordinates', async ({ page }) => {
    const { probeRequests } = await setupStandardRoutes(page);
    await page.goto('/');
    await waitForDatasetReady(page);

    const searchInput = page.locator('[data-testid="global-search-input"]');
    await searchInput.fill('ARGO_2902145');

    const argoResult = page.locator('[data-testid="argo-search-result"]');
    await expect(argoResult).toBeVisible();

    // Take evidence screenshot of successful search result in dropdown
    await page.screenshot({
      path: path.join(evidenceDir, 'phase08-argo-search-result-dropdown.png')
    });

    // Select the search result
    await argoResult.click();

    // 1. Search dropdown closes and input clears
    await expect(page.locator('[data-testid="search-results-dropdown"]')).not.toBeVisible();
    await expect(searchInput).toHaveValue('');

    // 2. Argo marker layer is automatically enabled on bottom bar
    const argoBtn = page.locator('[data-testid="bottombar-argo-btn"]');
    await expect(argoBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(argoBtn).toHaveClass(/active/);

    // 3. Float profile is loaded into inspection / drawer state
    const openDrawerBtn = page.locator('[data-testid="open-observation-drawer-btn"]');
    await openDrawerBtn.click();
    const drawer = page.locator('[aria-label="In-Situ Observation Fleet Drawer"]');
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText('ARGO_2902145');
    await expect(drawer).toContainText('12.48');

    // 4. Coordinates probe request was sent for float lat/lon (12.48, 82.03)
    const matchingProbe = probeRequests.find((p) => Math.abs(p.lat - 12.48) < 0.01 && Math.abs(p.lon - 82.03) < 0.01);
    expect(matchingProbe).toBeDefined();

    // Take evidence screenshot of selected profile and observation drawer
    await page.screenshot({
      path: path.join(evidenceDir, 'phase08-argo-selected-platform-focus.png')
    });
  });

  test('TC-P08-03: 404 / unknown ID displays error state and recovers upon new valid query', async ({ page }) => {
    await setupStandardRoutes(page);
    await page.goto('/');
    await waitForDatasetReady(page);

    const searchInput = page.locator('[data-testid="global-search-input"]');
    await searchInput.fill('9999999');

    // Expect not-found message to appear
    const notFoundMsg = page.locator('[data-testid="argo-search-not-found"]');
    await expect(notFoundMsg).toBeVisible({ timeout: 5000 });
    await expect(notFoundMsg).toContainText('No Argo platform found for ID "9999999"');

    // Take evidence screenshot of not-found error state
    await page.screenshot({
      path: path.join(evidenceDir, 'phase08-argo-not-found-error.png')
    });

    // Recover by editing query to a valid float
    await searchInput.fill('2902145');
    await expect(notFoundMsg).not.toBeVisible();
    const argoResult = page.locator('[data-testid="argo-search-result"]');
    await expect(argoResult).toBeVisible();
    await expect(argoResult).toContainText('Argo Float 2902145');
  });

  test('TC-P08-04: Stale query invalidation prevents held prior lookup from overwriting newer query', async ({ page }) => {
    let delayFirst = true;

    await Promise.all([
      page.route('**/api/datasets', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ active_dataset_id: DATASET_SYNTHETIC.dataset_id, datasets: [DATASET_SYNTHETIC] })
        });
      }),
      page.route('**/api/metadata', async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(METADATA_SYNTHETIC) });
      }),
      page.route('**/api/ocean-data*', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            dataset_id: DATASET_SYNTHETIC.dataset_id,
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
      page.route('**/api/ocean/probe*', async (route) => {
        const url = new URL(route.request().url());
        const lat = parseFloat(url.searchParams.get('lat'));
        const lon = parseFloat(url.searchParams.get('lon'));
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            lat,
            lon,
            timestamp: '2026-09-10T00:00:00Z',
            time_idx: 0,
            depths: [0, 10, 50],
            temperature: [28.5, 28.2, 24.5],
            salinity: [34.5, 34.6, 35.0]
          })
        });
      }),
      page.route('**/api/insitu/argo/*', async (route) => {
        const url = new URL(route.request().url());
        const pathParts = url.pathname.split('/');
        const rawId = decodeURIComponent(pathParts[pathParts.length - 1]).toUpperCase();

        if (rawId.includes('2902145') && delayFirst) {
          // Delay first request by 400ms to simulate slow response
          await new Promise((r) => setTimeout(r, 400));
          await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_ARGO_BOB) });
        } else if (rawId.includes('2902198')) {
          await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_ARGO_AS) });
        } else {
          await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ detail: 'not found' }) });
        }
      }),
      page.route('**/api/insitu/argo', async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([MOCK_ARGO_BOB, MOCK_ARGO_AS]) });
      }),
      page.route('**/api/insitu/gliders*', async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      }),
      page.route('**/api/insitu/sensors*', async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      })
    ]);

    await page.goto('/');
    await waitForDatasetReady(page);

    const searchInput = page.locator('[data-testid="global-search-input"]');

    // Type 2902145 (which is delayed)
    await searchInput.fill('2902145');

    // Rapidly switch query to 2902198 (which resolves quickly)
    await searchInput.fill('2902198');

    const argoResult = page.locator('[data-testid="argo-search-result"]');
    await expect(argoResult).toBeVisible({ timeout: 5000 });
    await expect(argoResult).toContainText('Argo Float 2902198 (Arabian Sea)');

    // Wait 500ms to ensure the delayed response from 2902145 has arrived
    await page.waitForTimeout(500);

    // Verify the result was NOT overwritten with 2902145
    await expect(argoResult).toContainText('Argo Float 2902198 (Arabian Sea)');
    await expect(argoResult).not.toContainText('2902145');
  });

  test('TC-P08-05: Coordinate and place-name search regressions remain intact', async ({ page }) => {
    const { probeRequests } = await setupStandardRoutes(page);
    await page.goto('/');
    await waitForDatasetReady(page);

    const searchInput = page.locator('[data-testid="global-search-input"]');

    // 1. Coordinate search
    await searchInput.fill('13.25, 80.31');
    const coordItem = page.locator('[data-testid="search-result-item"]').first();
    await expect(coordItem).toBeVisible();
    await expect(coordItem).toContainText('Coordinate: 13.250°N, 80.310°E');

    await coordItem.click();
    await expect(page.locator('[data-testid="search-results-dropdown"]')).not.toBeVisible();
    const coordProbe = probeRequests.find((p) => Math.abs(p.lat - 13.25) < 0.01 && Math.abs(p.lon - 80.31) < 0.01);
    expect(coordProbe).toBeDefined();

    // 2. Place name search
    await searchInput.fill('Bay of Bengal');
    const placeItem = page.locator('[data-testid="search-result-item"]').first();
    await expect(placeItem).toBeVisible();
    await expect(placeItem).toContainText('Bay of Bengal');

    await placeItem.click();
    await expect(page.locator('[data-testid="search-results-dropdown"]')).not.toBeVisible();

    // 3. Short non-WMO query does not trigger Argo search
    await searchInput.fill('ab');
    await expect(page.locator('[data-testid="argo-search-loading"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="argo-search-result"]')).not.toBeVisible();
  });

  test('TC-P08-06: Keyboard Enter selects Argo result and Escape dismisses suggestions', async ({ page }) => {
    await setupStandardRoutes(page);
    await page.goto('/');
    await waitForDatasetReady(page);

    const searchInput = page.locator('[data-testid="global-search-input"]');

    // 1. Enter key selection
    await searchInput.fill('ARGO_2902145');
    const argoResult = page.locator('[data-testid="argo-search-result"]');
    await expect(argoResult).toBeVisible();

    await searchInput.press('Enter');
    await expect(page.locator('[data-testid="search-results-dropdown"]')).not.toBeVisible();
    await expect(searchInput).toHaveValue('');

    // Argo layer is enabled on bottom bar
    const argoBtn = page.locator('[data-testid="bottombar-argo-btn"]');
    await expect(argoBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(argoBtn).toHaveClass(/active/);

    // 2. Escape key closes dropdown
    await searchInput.fill('Bay of Bengal');
    await expect(page.locator('[data-testid="search-results-dropdown"]')).toBeVisible();

    await searchInput.press('Escape');
    await expect(page.locator('[data-testid="search-results-dropdown"]')).not.toBeVisible();
  });
});
