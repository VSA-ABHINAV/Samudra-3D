import { test, expect } from '@playwright/test';

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const DATASET_A = {
  dataset_id: 'cmems_mod_glo_phy_my_0.083deg_P1D-m',
  name: 'Copernicus GLORYS12V1 Global Reanalysis',
  provider: 'Copernicus Marine Service',
  format: 'NetCDF-4',
  temporal_resolution: 'Daily',
  spatial_resolution: '0.083 degree (~8.3 km)',
  coverage_bounds: { lat_min: 0.0, lat_max: 25.0, lon_min: 50.0, lon_max: 100.0 },
  depth_range: [0.49, 92.3],
  source_mode: 'REAL_LOCAL',
  status: 'READY'
};

const METADATA_A = {
  dataset_id: 'cmems_mod_glo_phy_my_0.083deg_P1D-m',
  name: 'Copernicus GLORYS12V1 Global Reanalysis',
  depth_levels_m: [0.494, 5.0, 10.0, 20.0, 50.0, 92.3],
  time_timestamps: ['2025-01-01T00:00:00Z', '2025-01-02T00:00:00Z', '2025-01-03T00:00:00Z'],
  variables: {
    temperature: { name: 'Sea Water Potential Temperature', units: '°C' },
    salinity: { name: 'Sea Water Salinity', units: 'PSU' },
    currents: { name: 'Ocean Currents Velocity', units: 'm/s' }
  }
};

const DATASET_B = {
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

const METADATA_B = {
  dataset_id: 'incois_roms_nio_daily_0.05deg',
  name: 'INCOIS High-Res Regional ROMS NIO',
  depth_levels_m: [0.0, 10.0, 25.0, 75.0, 150.0, 300.0, 500.0],
  time_timestamps: ['2025-01-10T00:00:00Z', '2025-01-11T00:00:00Z'],
  variables: {
    temperature: { name: 'Potential Temperature', units: '°C' },
    salinity: { name: 'Practical Salinity', units: 'PSU' }
  }
};

test.describe('Core Phase 02: Scientific Readiness Lifecycle and Identity Verification', () => {

  test('TC-ID-01: Metadata for a different dataset must block scientific readiness', async ({ page }) => {
    const activeId = 'cmems_mod_glo_phy_my_0.083deg_P1D-m';
    await page.route('**/api/datasets', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        active_dataset_id: activeId,
        datasets: [{
          dataset_id: activeId,
          name: 'Dataset A',
          source_mode: 'REAL_LOCAL',
          coverage_bounds: { lat_min: 0, lat_max: 25, lon_min: 50, lon_max: 100 }
        }]
      })
    }));
    await page.route('**/api/metadata', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        dataset_id: 'different-dataset-B',
        depth_levels_m: [5, 50],
        time_timestamps: ['2025-01-10T00:00:00Z'],
        variables: { temperature: { name: 'temperature', units: '°C' } },
        lat_bounds: [0, 25],
        lon_bounds: [50, 100]
      })
    }));
    await page.route('**/api/ocean-data*', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        dataset_id: 'different-dataset-B',
        variable: 'temperature',
        time_idx: 0,
        timestamp: '2025-01-10T00:00:00Z',
        requested_depth: 5,
        selected_depth: 5,
        lats: [10, 11],
        lons: [75, 76],
        values: [[20, 20], [20, 20]],
        shape: [2, 2]
      })
    }));

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Indian Ocean workspace' })).toBeVisible();
    await expect(page.getByTestId('dataset-transition-error-banner')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Next Forecast Step' })).toBeDisabled();
    await expect(page.getByTestId('current-time-badge')).toContainText('DATASET ERROR');
  });

  test('TC-ID-02: Metadata with missing or empty dataset identity must block scientific readiness', async ({ page }) => {
    const activeId = 'cmems_mod_glo_phy_my_0.083deg_P1D-m';
    await page.route('**/api/datasets', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        active_dataset_id: activeId,
        datasets: [{
          dataset_id: activeId,
          name: 'Dataset A',
          source_mode: 'REAL_LOCAL',
          coverage_bounds: { lat_min: 0, lat_max: 25, lon_min: 50, lon_max: 100 }
        }]
      })
    }));
    await page.route('**/api/metadata', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        // Missing dataset_id completely
        depth_levels_m: [5, 50],
        time_timestamps: ['2025-01-10T00:00:00Z'],
        variables: { temperature: { name: 'temperature', units: '°C' } },
        lat_bounds: [0, 25],
        lon_bounds: [50, 100]
      })
    }));

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Indian Ocean workspace' })).toBeVisible();
    await expect(page.getByTestId('dataset-transition-error-banner')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Next Forecast Step' })).toBeDisabled();
    await expect(page.getByTestId('current-time-badge')).toContainText('DATASET ERROR');
  });

  test('TC-ID-03: Controlled startup gate suppresses scientific data requests until confirmed metadata arrives', async ({ page }) => {
    const metadataGate = createDeferred();
    let oceanDataRequestStarted = false;
    let probeRequestStarted = false;
    let volumeRequestStarted = false;

    await page.route('**/api/datasets', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        active_dataset_id: DATASET_A.dataset_id,
        datasets: [DATASET_A]
      })
    }));

    await page.route('**/api/metadata', async (route) => {
      await metadataGate.promise;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(METADATA_A)
      });
    });

    await page.route('**/api/ocean-data*', async (route) => {
      oceanDataRequestStarted = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          dataset_id: DATASET_A.dataset_id,
          variable: 'temperature',
          requested_depth: 0,
          selected_depth: 0.494,
          timestamp: '2025-01-01T00:00:00Z',
          lats: [10, 11],
          lons: [75, 76],
          values: [[28.5, 28.6], [28.4, 28.5]]
        })
      });
    });

    await page.route('**/api/ocean/probe*', async (route) => {
      probeRequestStarted = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ lat: 10, lon: 75, temperature: [28.5] })
      });
    });

    await page.route('**/api/ocean/volume*', async (route) => {
      volumeRequestStarted = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ dataset_id: DATASET_A.dataset_id, variable: 'temperature', depths: [0] })
      });
    });

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Indian Ocean workspace' })).toBeVisible();

    // While metadata is held at startup:
    // 1. Controls are disabled and timestamp badge shows SYNCING DATASET...
    await expect(page.getByRole('button', { name: 'Next Forecast Step' })).toBeDisabled();
    await expect(page.getByTestId('current-time-badge')).toContainText('SYNCING DATASET...');

    // 2. Scientific data fetching is completely suppressed
    expect(oceanDataRequestStarted).toBe(false);
    expect(probeRequestStarted).toBe(false);
    expect(volumeRequestStarted).toBe(false);

    // Release startup metadata gate
    metadataGate.resolve();

    // 3. System recovers cleanly with populated metadata and enabled controls
    await expect(page.getByTestId('current-time-badge')).toContainText('2025-01-01');
    await expect(page.getByRole('button', { name: 'Next Forecast Step' })).toBeEnabled();
    await expect(async () => {
      expect(oceanDataRequestStarted).toBe(true);
    }).toPass();
  });

  test('TC-ID-04: Failed metadata on switch leaves controls blocked and suppressed until retry recovery', async ({ page }) => {
    let selectCalled = false;
    let hasFailedOnce = false;
    let metadataSucceeded = false;
    const scientificRequestsAfterFailure = [];

    await page.route('**/api/datasets', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        active_dataset_id: selectCalled ? DATASET_B.dataset_id : DATASET_A.dataset_id,
        datasets: [DATASET_A, DATASET_B]
      })
    }));

    await page.route('**/api/datasets/select', (route) => {
      selectCalled = true;
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'success', active_dataset: DATASET_B })
      });
    });

    await page.route('**/api/metadata', (route) => {
      if (selectCalled && !hasFailedOnce) {
        hasFailedOnce = true;
        route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ detail: 'NetCDF metadata extraction failed' })
        });
        return;
      }
      if (selectCalled) {
        metadataSucceeded = true;
      }
      const meta = selectCalled ? METADATA_B : METADATA_A;
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(meta)
      });
    });

    await page.route('**/api/ocean/thermal-fronts*', (route) => {
      if (hasFailedOnce && !metadataSucceeded) {
        scientificRequestsAfterFailure.push('thermal-fronts');
      }
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ fronts: [] })
      });
    });

    await page.route('**/api/ocean-data*', (route) => {
      const isB = selectCalled && metadataSucceeded;
      if (hasFailedOnce && !metadataSucceeded) {
        scientificRequestsAfterFailure.push('ocean-data');
      }
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          dataset_id: isB ? DATASET_B.dataset_id : DATASET_A.dataset_id,
          variable: 'temperature',
          requested_depth: 0,
          selected_depth: isB ? 0.0 : 0.494,
          timestamp: isB ? '2025-01-10T00:00:00Z' : '2025-01-01T00:00:00Z',
          min_val: isB ? 24.2 : 28.5,
          max_val: isB ? 24.2 : 28.5,
          units: 'degC',
          lats: [10, 11],
          lons: [75, 76],
          values: [[isB ? 24.2 : 28.5, isB ? 24.2 : 28.5], [isB ? 24.2 : 28.5, isB ? 24.2 : 28.5]]
        })
      });
    });

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Indian Ocean workspace' })).toBeVisible();
    await expect(page.getByTestId('current-time-badge')).toContainText('2025-01-01');
    await expect(page.getByTestId('hud-layer-badge')).toContainText('28.5');
    await expect(page.getByTestId('color-bar-legend')).toContainText('28.5 °C');

    // Switch to Dataset B in modal
    await page.getByRole('button', { name: 'DATA ▾' }).click();
    await page.getByRole('button', { name: /Dataset Registry & Downloads/i }).click();
    await page.getByRole('button', { name: 'Activate Dataset' }).click();

    // Close dataset manager modal to view workspace
    await page.getByRole('button', { name: 'Close modal' }).click();

    // 1. Verify error banner is visible, controls remain blocked, and scalar HUD/legend are cleared
    await expect(page.getByTestId('dataset-transition-error-banner')).toBeVisible();
    await expect(page.getByTestId('current-time-badge')).toContainText('DATASET ERROR');
    await expect(page.getByRole('button', { name: 'Next Forecast Step' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Previous Forecast Step' })).toBeDisabled();
    await expect(page.locator('.legend-placeholder')).toBeVisible();
    await expect(page.getByTestId('color-bar-legend')).not.toBeVisible();
    await expect(page.getByTestId('hud-layer-badge')).not.toBeVisible();

    // 2. Open Fisherman Mode during failure state and verify explicit unavailable notice
    await page.getByRole('button', { name: 'OPERATIONS ▾' }).click();
    await page.getByRole('button', { name: /Fisherman View/i }).click();
    await expect(page.getByText('Fisherman Operational Intelligence')).toBeVisible();

    // Switch to Thermal Fronts tab in Fisherman modal
    await page.getByRole('button', { name: /Thermal Fronts/i }).click();
    await expect(page.getByText(/Thermal front advisory unavailable while dataset is syncing or unready/i)).toBeVisible();

    // Close Fisherman Modal
    await page.getByTestId('fisherman-modal-close-btn').click();

    // Assert that no new scientific work was dispatched while unready
    expect(scientificRequestsAfterFailure).toEqual([]);

    // 3. Click Retry Metadata to recover
    await page.getByRole('button', { name: 'Retry Metadata' }).click();

    // 4. Verify successful recovery with confirmed B metadata and distinct B scientific results
    await expect(page.getByTestId('current-time-badge')).toContainText('2025-01-10');
    await expect(page.getByRole('button', { name: 'Next Forecast Step' })).toBeEnabled();
    const depthBar = page.getByRole('complementary', { name: 'Ocean Depth Selector' });
    await expect(depthBar.getByText('500 m (MAX)')).toBeVisible();

    // Await and assert distinct B scientific results consumed by the UI
    await expect(page.getByTestId('hud-layer-badge')).toBeVisible();
    await expect(page.getByTestId('hud-layer-badge')).toContainText('24.2 to 24.2 °C');
    await expect(page.getByTestId('color-bar-legend')).toBeVisible();
    await expect(page.getByTestId('color-bar-legend')).toContainText('24.2 °C');
    await expect(page.getByTestId('hud-depth-badge')).toContainText('0m requested');
    await expect(page.getByTestId('hud-depth-badge')).toContainText('Surface level');
    await expect(page.getByTestId('hud-time-badge')).toContainText('2025-01-10');
  });

  test('TC-ID-05: Held switch metadata and late older scientific response cannot overwrite invalidation state', async ({ page }) => {
    let switchStarted = false;
    let oldRequestStarted = false;
    let oldResponseCompleted = false;

    const oldRequestEnteredGate = createDeferred();
    const delayedOceanDataGate = createDeferred();
    const switchMetadataGate = createDeferred();
    const switchMetadataEnteredGate = createDeferred();

    await page.route('**/api/datasets', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        active_dataset_id: switchStarted ? DATASET_B.dataset_id : DATASET_A.dataset_id,
        datasets: [DATASET_A, DATASET_B]
      })
    }));

    await page.route('**/api/datasets/select', (route) => {
      switchStarted = true;
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'success', active_dataset: DATASET_B })
      });
    });

    await page.route('**/api/metadata', async (route) => {
      if (switchStarted) {
        switchMetadataEnteredGate.resolve();
        await switchMetadataGate.promise;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(METADATA_B)
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(METADATA_A)
      });
    });

    await page.route('**/api/ocean-data*', async (route) => {
      if (!switchStarted) {
        oldRequestStarted = true;
        oldRequestEnteredGate.resolve();
        // Hold the old response
        await delayedOceanDataGate.promise;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            dataset_id: DATASET_A.dataset_id,
            variable: 'temperature',
            requested_depth: 0,
            selected_depth: 0.494,
            timestamp: '2025-01-01T00:00:00Z',
            min_val: 28.5,
            max_val: 28.5,
            units: 'degC',
            lats: [10, 11],
            lons: [75, 76],
            values: [[28.5, 28.5], [28.5, 28.5]]
          })
        });
        oldResponseCompleted = true;
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          dataset_id: DATASET_B.dataset_id,
          variable: 'temperature',
          requested_depth: 0,
          selected_depth: 0.0,
          timestamp: '2025-01-10T00:00:00Z',
          min_val: 24.2,
          max_val: 24.2,
          units: 'degC',
          lats: [10, 11],
          lons: [75, 76],
          values: [[24.2, 24.2], [24.2, 24.2]]
        })
      });
    });

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Indian Ocean workspace' })).toBeVisible();

    // 1. Explicitly wait for the old ocean-data request to enter the route
    await oldRequestEnteredGate.promise;
    expect(oldRequestStarted).toBe(true);

    // 2. Initiate switch to Dataset B while old request is still pending
    await page.getByRole('button', { name: 'DATA ▾' }).click();
    await page.getByRole('button', { name: /Dataset Registry & Downloads/i }).click();
    await page.getByRole('button', { name: 'Activate Dataset' }).click();
    await page.getByRole('button', { name: 'Close modal' }).click();

    // Wait until B's metadata request enters its route
    await switchMetadataEnteredGate.promise;

    // Workspace must be transitioning / unready
    await expect(page.getByTestId('current-time-badge')).toContainText('SYNCING DATASET...');
    await expect(page.getByRole('button', { name: 'Next Forecast Step' })).toBeDisabled();

    // 3. Release the delayed old Dataset A ocean-data response
    delayedOceanDataGate.resolve();
    await expect.poll(() => oldResponseCompleted).toBe(true);

    // 4. Assert that the late Dataset A response DOES NOT clear SYNCING DATASET... or publish old scalar results
    await expect(page.getByTestId('current-time-badge')).toContainText('SYNCING DATASET...');
    await expect(page.getByRole('button', { name: 'Next Forecast Step' })).toBeDisabled();
    await expect(page.locator('.legend-placeholder')).toBeVisible();
    await expect(page.getByTestId('color-bar-legend')).not.toBeVisible();
    await expect(page.getByTestId('hud-layer-badge')).not.toBeVisible();
    await expect(page.getByTestId('hud-depth-badge')).not.toBeVisible();
    await expect(page.getByTestId('hud-time-badge')).not.toBeVisible();

    // 5. Release switch metadata gate to complete transition to B
    switchMetadataGate.resolve();

    // 6. Assert clean resolution to Dataset B with distinct B metadata and actual consumed scientific values (24.2)
    await expect(page.getByTestId('current-time-badge')).toContainText('2025-01-10');
    await expect(page.getByRole('button', { name: 'Next Forecast Step' })).toBeEnabled();
    const depthBar = page.getByRole('complementary', { name: 'Ocean Depth Selector' });
    await expect(depthBar.getByText('500 m (MAX)')).toBeVisible();

    // Await and assert distinct B scientific results consumed by the UI
    await expect(page.getByTestId('hud-layer-badge')).toBeVisible();
    await expect(page.getByTestId('hud-layer-badge')).toContainText('24.2 to 24.2 °C');
    await expect(page.getByTestId('color-bar-legend')).toBeVisible();
    await expect(page.getByTestId('color-bar-legend')).toContainText('24.2 °C');
    await expect(page.getByTestId('hud-depth-badge')).toContainText('0m requested');
    await expect(page.getByTestId('hud-depth-badge')).toContainText('Surface level');
    await expect(page.getByTestId('hud-time-badge')).toContainText('2025-01-10');
  });

  test('TC-ID-06: Sequential UI dataset switches execute in order and reflect final confirmed identity', async ({ page }) => {
    const backendSelectionLog = [];
    let backendActive = DATASET_A;

    await page.route('**/api/datasets', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        active_dataset_id: backendActive.dataset_id,
        datasets: [DATASET_A, DATASET_B]
      })
    }));

    await page.route('**/api/datasets/select', async (route) => {
      const payload = JSON.parse(route.request().postData() || '{}');
      backendSelectionLog.push(payload.dataset_id);
      if (payload.dataset_id === DATASET_B.dataset_id) {
        backendActive = DATASET_B;
      } else {
        backendActive = DATASET_A;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'success', active_dataset: backendActive })
      });
    });

    await page.route('**/api/metadata', (route) => {
      const meta = backendActive.dataset_id === DATASET_B.dataset_id ? METADATA_B : METADATA_A;
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(meta)
      });
    });

    await page.route('**/api/ocean-data*', (route) => {
      const isB = backendActive.dataset_id === DATASET_B.dataset_id;
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          dataset_id: backendActive.dataset_id,
          variable: 'temperature',
          requested_depth: 0,
          selected_depth: isB ? 0.0 : 0.494,
          timestamp: isB ? '2025-01-10T00:00:00Z' : '2025-01-01T00:00:00Z',
          lats: [10, 11],
          lons: [75, 76],
          values: [[isB ? 24.2 : 28.5, isB ? 24.2 : 28.5], [isB ? 24.2 : 28.5, isB ? 24.2 : 28.5]]
        })
      });
    });

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Indian Ocean workspace' })).toBeVisible();
    await expect(page.getByTestId('current-time-badge')).toContainText('2025-01-01');

    // Open Dataset Manager Modal
    await page.getByRole('button', { name: 'DATA ▾' }).click();
    await page.getByRole('button', { name: /Dataset Registry & Downloads/i }).click();

    // Switch to Dataset B
    const activateBtn = page.getByRole('button', { name: 'Activate Dataset' }).first();
    await activateBtn.click();
    await expect(page.getByTestId('current-time-badge')).toContainText('2025-01-10');

    // Switch back to Dataset A
    const activateBtnA = page.getByRole('button', { name: 'Activate Dataset' }).first();
    await expect(activateBtnA).toBeVisible({ timeout: 10000 });
    await expect(activateBtnA).toBeEnabled();
    await activateBtnA.click();
    await expect(page.getByTestId('current-time-badge')).toContainText('2025-01-01');

    // Verify backend mutations occurred in strict sequential order
    await expect.poll(() => backendSelectionLog).toEqual([DATASET_B.dataset_id, DATASET_A.dataset_id]);
  });

});
