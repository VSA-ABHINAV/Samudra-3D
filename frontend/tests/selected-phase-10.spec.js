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
    timestamp: '2026-09-10T00:00:00Z',
    max_depth: 500.0,
    num_levels: 11,
    surface_temp: 28.9,
    surface_salinity: 32.1,
    air_temperature: 29.2,
    surface_pressure_hpa: 1008.4,
    wind_speed_ms: 6.8,
    wind_direction_deg: 215.0,
    significant_wave_height_m: 1.4,
    qc_summary: {
      good: 11,
      probably_good: 0,
      bad: 0,
      missing: 0,
      total: 11,
      pass_rate_pct: 100.0
    },
    source_mode: 'REAL_LOCAL',
    provenance_badge: '[REAL • INCOIS]',
    provider: 'INCOIS'
  },
  {
    id: 'INCOIS_BUOY_AD01',
    platform_type: 'buoy',
    name: 'INCOIS OMNI Buoy AD01 (Central Arabian Sea)',
    wmo_id: '23001',
    lat: 14.00,
    lon: 69.00,
    timestamp: '2026-09-10T00:00:00Z',
    max_depth: 500.0,
    num_levels: 11,
    surface_temp: 28.2,
    surface_salinity: 36.2,
    air_temperature: 28.4,
    surface_pressure_hpa: 1011.5,
    wind_speed_ms: 8.4,
    wind_direction_deg: 245.0,
    significant_wave_height_m: 2.1,
    qc_summary: {
      good: 11,
      probably_good: 0,
      bad: 0,
      missing: 0,
      total: 11,
      pass_rate_pct: 100.0
    },
    source_mode: 'REAL_LOCAL',
    provenance_badge: '[REAL • INCOIS]',
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
  timestamp: '2026-09-10T00:00:00Z',
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
  qc_flags: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  qc_summary: {
    good: 11,
    probably_good: 0,
    bad: 0,
    missing: 0,
    total: 11,
    pass_rate_pct: 100.0
  },
  metadata: {
    source: 'INCOIS Moored Buoy Network (OMNI)',
    institution: 'Indian National Centre for Ocean Information Services',
    source_mode: 'REAL_LOCAL',
    provenance_badge: '[REAL • INCOIS]'
  },
  source_mode: 'REAL_LOCAL',
  provenance_badge: '[REAL • INCOIS]',
  provider: 'INCOIS'
};

async function setupStandardMocks(page) {
  await page.route('**/api/health', async (route) => {
    await route.fulfill({ json: { status: 'healthy', active_dataset: 'incois_roms_synthetic' } });
  });

  await page.route('**/api/datasets', async (route) => {
    await route.fulfill({
      json: {
        active_dataset_id: 'incois_roms_synthetic',
        available_datasets: [DATASET_SYNTHETIC]
      }
    });
  });

  await page.route('**/api/metadata', async (route) => {
    await route.fulfill({ json: METADATA_SYNTHETIC });
  });

  await page.route('**/api/insitu/status', async (route) => {
    await route.fulfill({
      json: {
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
      }
    });
  });

  await page.route('**/api/insitu/argo*', async (route) => {
    await route.fulfill({ json: [] });
  });

  await page.route('**/api/insitu/gliders*', async (route) => {
    await route.fulfill({ json: [] });
  });

  await page.route('**/api/insitu/buoys/INCOIS_BUOY_BD08', async (route) => {
    await route.fulfill({ json: MOCK_BUOY_DETAIL_BD08 });
  });

  await page.route('**/api/insitu/buoys*', async (route) => {
    await route.fulfill({ json: MOCK_BUOYS });
  });

  await page.route('**/api/collocation/profile/*', async (route) => {
    await route.fulfill({
      json: {
        profile_id: 'INCOIS_BUOY_BD08',
        dataset_id: 'incois_roms_synthetic',
        source_mode: 'REAL_LOCAL',
        temperature_levels: [
          { depth: 0.5, observed_value: 28.9, model_value: 28.7, delta: -0.2, valid: true },
          { depth: 50.0, observed_value: 24.5, model_value: 24.1, delta: -0.4, valid: true }
        ]
      }
    });
  });

  await page.route('**/api/ocean-data*', async (route) => {
    await route.fulfill({
      json: {
        variable: 'temperature',
        values: [[28.5]],
        lat_grid: [18.0],
        lon_grid: [89.0],
        min_val: 28.0,
        max_val: 29.0
      }
    });
  });
}

test.describe('Selected Phase 10 — Buoy Observations', () => {
  test('01. Observation Drawer displays BUOY filter without unsupported tag and lists moored buoy stations', async ({ page }) => {
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

    // Verify badges and meteorological chips
    const bd08Card = drawer.locator('.platform-item-card').filter({ hasText: 'BD08' });
    await expect(bd08Card).toContainText('[REAL • INCOIS]');
    await expect(bd08Card).toContainText('Air: 29.2°C');
    await expect(bd08Card).toContainText('Wind: 6.8 m/s');
    await expect(bd08Card).toContainText('1008.4 hPa');
    await expect(bd08Card).toContainText('Wave: 1.4m');

    await page.screenshot({ path: path.join(evidenceDir, '01_buoy_drawer_station_list.png') });
  });

  test('02. Opening Profile Modal for Moored Buoy shows vertical thermistor CTD series & meteorological metadata', async ({ page }) => {
    await setupStandardMocks(page);
    await page.goto('/');

    // Open observation drawer and select BUOY filter
    await page.getByRole('button', { name: /FLEET|OBSERVATION/i }).first().click();
    await page.getByTestId('filter-buoy').click();

    // Click OPEN PROFILE on BD08 card
    const bd08Card = page.locator('.platform-item-card').filter({ hasText: 'BD08' });
    await bd08Card.getByRole('button', { name: /OPEN PROFILE/i }).click();

    // Verify Profile Modal
    const modal = page.getByTestId('profile-modal-container');
    await expect(modal).toBeVisible();
    await expect(modal.getByText('MOORED BUOY')).toBeVisible();
    await expect(modal.getByTestId('profile-title')).toContainText('INCOIS OMNI Buoy BD08');
    await expect(modal.getByText('[REAL • INCOIS]')).toBeVisible();

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
