import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const evidenceDir = path.resolve('..', 'docs', 'evidence', 'selected-phase-10');
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

const MOCK_BUOYS = [
  {
    id: 'INCOIS_BUOY_BD08',
    platform_type: 'buoy',
    name: 'INCOIS OMNI Buoy BD08 (Northern Bay of Bengal)',
    wmo_id: '23008',
    lat: 18.15,
    lon: 89.67,
    timestamp: null,
    max_depth: 500.0,
    num_levels: 11,
    surface_temp: 28.9,
    surface_salinity: 32.1,
    air_temperature: 29.2,
    surface_pressure_hpa: 1008.4,
    wind_speed_ms: 6.8,
    wind_direction_deg: 215.0,
    significant_wave_height_m: 1.4,
    qc_summary: null,
    source_mode: 'BUNDLED_REFERENCE',
    provenance_badge: '[REFERENCE • BUNDLED]',
    provenance_note: 'Bundled reference sample · illustrative, not live',
    provider: 'INCOIS'
  },
  {
    id: 'INCOIS_BUOY_AD01',
    platform_type: 'buoy',
    name: 'INCOIS OMNI Buoy AD01 (Central Arabian Sea)',
    wmo_id: '23001',
    lat: 14.00,
    lon: 69.00,
    timestamp: null,
    max_depth: 500.0,
    num_levels: 11,
    surface_temp: 28.2,
    surface_salinity: 36.2,
    air_temperature: 28.4,
    surface_pressure_hpa: 1011.5,
    wind_speed_ms: 8.4,
    wind_direction_deg: 245.0,
    significant_wave_height_m: 2.1,
    qc_summary: null,
    source_mode: 'BUNDLED_REFERENCE',
    provenance_badge: '[REFERENCE • BUNDLED]',
    provenance_note: 'Bundled reference sample · illustrative, not live',
    provider: 'INCOIS'
  },
  {
    id: 'INCOIS_BUOY_LOCAL_FILE_01',
    platform_type: 'buoy',
    name: 'INCOIS Local Moored Buoy BD12 (Field Observed)',
    wmo_id: '23012',
    lat: 15.50,
    lon: 88.20,
    timestamp: '2026-09-15T06:00:00Z',
    max_depth: 500.0,
    num_levels: 3,
    surface_temp: 28.5,
    surface_salinity: 33.2,
    air_temperature: 28.9,
    surface_pressure_hpa: 1009.1,
    wind_speed_ms: 5.2,
    wind_direction_deg: 180.0,
    significant_wave_height_m: 1.1,
    qc_summary: {
      good: 3,
      probably_good: 0,
      bad: 0,
      missing: 0,
      total: 3,
      pass_rate_pct: 100.0
    },
    source_mode: 'REAL_LOCAL',
    provenance_badge: '[REAL • LOCAL_FILE]',
    provenance_note: 'Parsed from local file local_bd12.nc',
    provider: 'INCOIS'
  }
];

const MOCK_BUOY_DETAIL_BD08 = {
  id: 'INCOIS_BUOY_BD08',
  platform_type: 'buoy',
  name: 'INCOIS OMNI Buoy BD08 (Northern Bay of Bengal)',
  wmo_id: '23008',
  lat: 18.15,
  lon: 89.67,
  timestamp: null,
  max_depth: 500.0,
  num_levels: 11,
  surface_temp: 28.9,
  surface_salinity: 32.1,
  air_temperature: 29.2,
  surface_pressure_hpa: 1008.4,
  wind_speed_ms: 6.8,
  wind_direction_deg: 215.0,
  significant_wave_height_m: 1.4,
  depths: [0.5, 5.0, 10.0, 15.0, 20.0, 30.0, 50.0, 75.0, 100.0, 200.0, 500.0],
  temperature: [28.9, 28.8, 28.75, 28.5, 28.1, 27.2, 24.5, 21.3, 18.2, 13.5, 8.9],
  salinity: [32.1, 32.2, 32.5, 33.1, 33.8, 34.2, 34.7, 34.9, 35.0, 35.1, 35.0],
  qc_flags: null,
  qc_summary: null,
  metadata: {
    source: 'INCOIS Moored Buoy Network (Reference Catalog)',
    institution: 'Indian National Centre for Ocean Information Services',
    source_mode: 'BUNDLED_REFERENCE',
    provenance_badge: '[REFERENCE • BUNDLED]',
    provenance_note: 'Bundled reference sample · illustrative, not live'
  },
  source_mode: 'BUNDLED_REFERENCE',
  provenance_badge: '[REFERENCE • BUNDLED]',
  provenance_note: 'Bundled reference sample · illustrative, not live',
  provider: 'INCOIS'
};

async function setupStandardMocks(page) {
  await page.route('**/api/health', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'healthy', active_dataset: 'incois_roms_synthetic' })
    });
  });

  await page.route('**/api/datasets', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        active_dataset_id: 'incois_roms_synthetic',
        available_datasets: [DATASET_SYNTHETIC]
      })
    });
  });

  await page.route('**/api/metadata', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(METADATA_SYNTHETIC)
    });
  });

  await page.route('**/api/insitu/status', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'operational',
        total_profiles: 10,
        argo_count: 3,
        glider_count: 2,
        buoy_count: 5,
        synthetic_count: 4,
        real_sample_count: 6,
        erddap_live_feed: 'OFFLINE_INTEGRATION_GAP',
        data_centre: 'INCOIS-DAC',
        timestamp: '2026-09-10T00:00:00Z'
      })
    });
  });

  await page.route('**/api/insitu/argo*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([])
    });
  });

  await page.route('**/api/insitu/gliders*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([])
    });
  });

  await page.route('**/api/insitu/buoys**', async (route) => {
    const url = route.request().url();
    if (url.includes('/INCOIS_BUOY_BD08') || url.endsWith('/23008')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_BUOY_DETAIL_BD08)
      });
    } else {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_BUOYS)
      });
    }
  });

  await page.route('**/api/insitu/sensors*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([])
    });
  });

  await page.route('**/api/collocation/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        profile_id: 'INCOIS_BUOY_BD08',
        dataset_id: 'incois_roms_synthetic',
        source_mode: 'BUNDLED_REFERENCE',
        temperature_levels: [
          { depth: 0.5, observed_value: 28.9, model_value: 28.7, delta: -0.2, valid: true },
          { depth: 50.0, observed_value: 24.5, model_value: 24.1, delta: -0.4, valid: true }
        ]
      })
    });
  });

  await page.route('**/api/ocean-data*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        variable: 'temperature',
        values: [[28.5]],
        lat_grid: [18.0],
        lon_grid: [89.0],
        min_val: 28.0,
        max_val: 29.0
      })
    });
  });
}

test.describe('Selected Phase 10 — Buoy Observations', () => {
  test('01. Observation Drawer displays BUOY filter, distinguishes bundled reference vs local file provenance, and shows honest unavailable states', async ({ page }) => {
    await setupStandardMocks(page);
    await page.goto('/');

    // Open observation drawer from header
    const fleetBtn = page.getByRole('button', { name: /FLEET|OBSERVATION/i }).first();
    await fleetBtn.click();

    // Verify observation drawer is visible
    const drawer = page.getByTestId('observation-drawer');
    await expect(drawer).toBeVisible();

    // Click BUOY filter
    const buoyFilterBtn = page.getByTestId('filter-buoy');
    await expect(buoyFilterBtn).toBeVisible();
    await expect(buoyFilterBtn).toHaveText('BUOY');
    await buoyFilterBtn.click();

    // Check buoy cards rendered
    await expect(drawer.getByText('INCOIS OMNI Buoy BD08 (Northern Bay of Bengal)')).toBeVisible();
    await expect(drawer.getByText('INCOIS OMNI Buoy AD01 (Central Arabian Sea)')).toBeVisible();
    await expect(drawer.getByText('INCOIS Local Moored Buoy BD12 (Field Observed)')).toBeVisible();

    // Verify bundled reference card displays [REFERENCE • BUNDLED], honest Unavailable time, and QC: Not reported
    const bd08Card = drawer.locator('.platform-item-card').filter({ hasText: 'BD08' });
    await expect(bd08Card).toContainText('[REFERENCE • BUNDLED]');
    await expect(bd08Card).toContainText('QC: Not reported');
    await expect(bd08Card).toContainText('Time: Unavailable');
    await expect(bd08Card).toContainText('Air: 29.2°C');
    await expect(bd08Card).toContainText('Wind: 6.8 m/s');
    await expect(bd08Card).toContainText('1008.4 hPa');
    await expect(bd08Card).toContainText('Wave: 1.4m');

    // Verify genuine local file card displays [REAL • LOCAL_FILE] and real time
    const localCard = drawer.locator('.platform-item-card').filter({ hasText: 'BD12' });
    await expect(localCard).toContainText('[REAL • LOCAL_FILE]');
    await expect(localCard).toContainText('QC: 100%');
    await expect(localCard).toContainText('Time: 2026-09-15');

    await page.screenshot({ path: path.join(evidenceDir, '01_buoy_drawer_station_list.png') });
  });

  test('02. Opening Profile Modal for Bundled Reference Buoy shows reference badge, provenance note, and honest unavailable QC/timestamp', async ({ page }) => {
    await setupStandardMocks(page);
    await page.goto('/');

    // Open observation drawer and select BUOY filter
    const fleetBtn = page.getByRole('button', { name: /FLEET|OBSERVATION/i }).first();
    await fleetBtn.click();
    const drawer = page.getByTestId('observation-drawer');
    await expect(drawer).toBeVisible();

    const buoyFilterBtn = page.getByTestId('filter-buoy');
    await buoyFilterBtn.click();

    // Click OPEN PROFILE on BD08 card
    const bd08Card = drawer.locator('.platform-item-card').filter({ hasText: 'BD08' });
    await expect(bd08Card).toBeVisible();
    await bd08Card.getByRole('button', { name: /OPEN PROFILE/i }).click();

    // Verify Profile Modal
    const modal = page.getByTestId('profile-modal-container');
    await expect(modal).toBeVisible();
    await expect(modal.getByText('MOORED BUOY')).toBeVisible();
    await expect(modal.getByTestId('profile-title')).toContainText('INCOIS OMNI Buoy BD08');
    await expect(modal.getByText('[REFERENCE • BUNDLED]')).toBeVisible();

    // Verify provenance note
    const provNote = modal.getByTestId('provenance-note');
    await expect(provNote).toBeVisible();
    await expect(provNote).toContainText('Bundled reference sample · illustrative, not live');

    // Verify honest QC badge
    const qcBadge = modal.getByTestId('qc-badge');
    await expect(qcBadge).toBeVisible();
    await expect(qcBadge).toContainText('QC: Not reported');

    // Verify Meteorological parameters summary grid
    await expect(modal.getByText('29.2°C')).toBeVisible();
    await expect(modal.getByText('1008.4 hPa')).toBeVisible();
    await expect(modal.getByText('6.8 m/s (215°)')).toBeVisible();
    await expect(modal.getByText('1.4m')).toBeVisible();

    // Verify chart viewport renders
    await expect(modal.getByTestId('chart-viewport')).toBeVisible();

    await page.screenshot({ path: path.join(evidenceDir, '02_buoy_profile_modal_inspection.png') });
  });

  test('03. Comparing Moored Buoy with numerical model launches Model Comparison modal', async ({ page }) => {
    await setupStandardMocks(page);
    await page.goto('/');

    // Open observation drawer and select BUOY filter
    await page.getByRole('button', { name: /FLEET|OBSERVATION/i }).first().click();
    await page.getByTestId('filter-buoy').click();

    // Click COMPARE MODEL on BD08 card
    const bd08Card = page.locator('.platform-item-card').filter({ hasText: 'BD08' });
    await bd08Card.getByRole('button', { name: /COMPARE MODEL/i }).click();

    // Verify Comparison modal opens
    const compModal = page.locator('.modal-glassmorphic, .model-comparison-modal, [data-testid="model-comparison-modal"]').first();
    await expect(compModal).toBeVisible();

    await page.screenshot({ path: path.join(evidenceDir, '03_buoy_model_comparison_modal.png') });
  });

  test('04. Search filter in Observation Drawer filters buoys or shows empty state', async ({ page }) => {
    await setupStandardMocks(page);
    await page.goto('/');

    await page.getByRole('button', { name: /FLEET|OBSERVATION/i }).first().click();
    await page.getByTestId('filter-buoy').click();

    // Search for non-existent station
    const searchInput = page.getByPlaceholder(/Filter by WMO ID/i);
    await searchInput.fill('NONEXISTENT_STATION_999');

    // Verify empty state
    await expect(page.getByText('No observation platforms match the active filter.')).toBeVisible();

    // Clear search
    await searchInput.fill('BD08');
    await expect(page.getByText('INCOIS OMNI Buoy BD08 (Northern Bay of Bengal)')).toBeVisible();
    await expect(page.getByText('INCOIS OMNI Buoy AD01')).not.toBeVisible();

    await page.screenshot({ path: path.join(evidenceDir, '04_buoy_drawer_search_and_empty.png') });
  });
});
