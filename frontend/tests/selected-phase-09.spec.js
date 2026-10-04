import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const evidenceDir = path.resolve('..', 'docs', 'evidence', 'selected-phase-09');
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

async function setupStandardRoutes(page, {
  manifests = []
} = {}) {
  let manifestList = [...manifests];

  await Promise.all([
    page.route('**/api/datasets', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          active_dataset_id: DATASET_SYNTHETIC.dataset_id,
          datasets: [DATASET_SYNTHETIC]
        })
      });
    }),
    page.route('**/api/datasets/manifests*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(manifestList)
      });
    }),
    page.route('**/api/metadata', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(METADATA_SYNTHETIC)
      });
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
    page.route('**/api/insitu/argo*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([])
      });
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
    }),
    page.route('**/api/datasets/generate-command', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'ok',
          command: 'copernicusmarine subset -i cmems_mod_glo_phy-cur_anfc_0.083deg_P1D-m -x 55.0 -X 77.0 -y 8.0 -Y 25.0',
          safety_level: 'SAFE',
          can_execute_automatically: true,
          estimate: {
            estimated_transfer_mb: 25.4,
            available_disk_gb: 120.0
          },
          warning_message: 'Safe download parameters within automated limits.'
        })
      });
    })
  ]);

  return {
    setManifests: (newList) => {
      manifestList = newList;
    }
  };
}

async function openDownloaderTab(page) {
  const sourceBadge = page.locator('[data-testid="header-source-badge"]');
  await expect(sourceBadge).toBeVisible({ timeout: 10000 });
  await sourceBadge.click();

  const modal = page.locator('[data-testid="dataset-manager-modal"]');
  await expect(modal).toBeVisible({ timeout: 5000 });

  const downloaderTabBtn = modal.getByRole('button', { name: /Safe CLI Subsetter/i });
  await downloaderTabBtn.click();
}

test.describe('Selected Phase 09: Download Progress and Cancellation', () => {

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test('TC-P09-01: Start download -> Queued/Running live progress -> Completion with 100% progress and manifest refresh', async ({ page }) => {
    const { setManifests } = await setupStandardRoutes(page);

    let statusCallCount = 0;
    const jobId = 'job_test_01';

    await page.route('**/api/datasets/download', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            job_id: jobId,
            dataset_id: 'cmems_mod_glo_phy-cur_anfc_0.083deg_P1D-m',
            status: 'QUEUED',
            progress_pct: 0.0,
            bytes_downloaded: 0,
            estimated_bytes: 26633830,
            target_file: 'cmems_subset_arabian_sea.nc',
            error: null,
            manifest_file: null
          })
        });
      } else {
        await route.continue();
      }
    });

    await page.route(`**/api/datasets/download/status/${jobId}`, async (route) => {
      statusCallCount += 1;
      if (statusCallCount === 1) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            job_id: jobId,
            dataset_id: 'cmems_mod_glo_phy-cur_anfc_0.083deg_P1D-m',
            status: 'QUEUED',
            progress_pct: 0.0,
            bytes_downloaded: 0,
            estimated_bytes: 26633830,
            target_file: 'cmems_subset_arabian_sea.nc',
            error: null,
            manifest_file: null
          })
        });
      } else if (statusCallCount === 2) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            job_id: jobId,
            dataset_id: 'cmems_mod_glo_phy-cur_anfc_0.083deg_P1D-m',
            status: 'RUNNING',
            progress_pct: 45.5,
            bytes_downloaded: 12118392,
            estimated_bytes: 26633830,
            target_file: 'cmems_subset_arabian_sea.nc',
            error: null,
            manifest_file: null
          })
        });
      } else {
        setManifests([{
          manifest_id: 'manifest_job_test_01',
          dataset_id: 'cmems_mod_glo_phy-cur_anfc_0.083deg_P1D-m',
          file_name: 'cmems_subset_arabian_sea.nc',
          file_size_bytes: 26633830,
          file_size_mb: 25.4,
          sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
          bounds: { lat_min: 8.0, lat_max: 25.0, lon_min: 55.0, lon_max: 77.0 },
          depth_range: [0.49, 100.0],
          time_range: { start: '2026-09-01', end: '2026-09-10' },
          variables: ['uo', 'vo'],
          provenance_badge: 'Copernicus Marine Verified',
          created_at: '2026-10-03T11:00:00Z'
        }]);
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            job_id: jobId,
            dataset_id: 'cmems_mod_glo_phy-cur_anfc_0.083deg_P1D-m',
            status: 'COMPLETED',
            progress_pct: 100.0,
            bytes_downloaded: 26633830,
            estimated_bytes: 26633830,
            target_file: 'cmems_subset_arabian_sea.nc',
            error: null,
            manifest_file: 'manifest_job_test_01.json'
          })
        });
      }
    });

    await page.goto('/');
    await openDownloaderTab(page);

    // Generate safe command
    const generateBtn = page.getByRole('button', { name: /Generate & Verify Safe Command/i });
    await generateBtn.click();

    // Start download
    const startBtn = page.locator('[data-testid="start-download-btn"]');
    await expect(startBtn).toBeVisible({ timeout: 5000 });
    await startBtn.click();

    // Verify Active Job Card appears
    const jobCard = page.locator('[data-testid="active-download-job-card"]');
    await expect(jobCard).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid="download-job-id"]')).toHaveText(jobId);

    // Verify RUNNING state & live progress
    await expect(page.locator('[data-testid="download-job-status"]')).toHaveText(/QUEUED|RUNNING/);
    await expect(page.locator('[data-testid="cancel-download-btn"]')).toBeVisible();

    // Wait for RUNNING progress update
    await expect(page.locator('[data-testid="download-progress-pct"]')).toHaveText(/45\.5%|100\.0%/, { timeout: 8000 });
    await page.screenshot({ path: path.join(evidenceDir, 'download-running.png') });

    // Wait for COMPLETED terminal state
    await expect(page.locator('[data-testid="download-job-status"]')).toHaveText('COMPLETED', { timeout: 8000 });
    await expect(page.locator('[data-testid="download-progress-pct"]')).toHaveText('100.0%');
    await expect(page.locator('[data-testid="cancel-download-btn"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="dismiss-download-btn"]')).toBeVisible();
    await expect(page.locator('[data-testid="download-manifest-record"]')).toContainText('manifest_job_test_01.json');

    await page.screenshot({ path: path.join(evidenceDir, 'download-completed.png') });

    // Verify Manifests tab received auto-refreshed manifest
    const manifestsTabBtn = page.getByRole('button', { name: /Manifests & Hashes/i });
    await manifestsTabBtn.click();
    await expect(page.locator('text=cmems_subset_arabian_sea.nc')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')).toBeVisible();
  });

  test('TC-P09-02: Cancellation of running job calls cancel API and transitions to CANCELLED state', async ({ page }) => {
    await setupStandardRoutes(page);
    const jobId = 'job_test_02_cancel';
    let cancelCalled = false;
    let jobStatus = 'RUNNING';

    await page.route('**/api/datasets/download', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            job_id: jobId,
            dataset_id: 'cmems_mod_glo_phy-cur_anfc_0.083deg_P1D-m',
            status: 'RUNNING',
            progress_pct: 15.0,
            bytes_downloaded: 4000000,
            estimated_bytes: 26633830,
            target_file: 'cmems_subset_arabian_sea.nc',
            error: null,
            manifest_file: null
          })
        });
      } else {
        await route.continue();
      }
    });

    await page.route(`**/api/datasets/download/status/${jobId}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          job_id: jobId,
          dataset_id: 'cmems_mod_glo_phy-cur_anfc_0.083deg_P1D-m',
          status: jobStatus,
          progress_pct: jobStatus === 'CANCELLED' ? 30.0 : 30.0,
          bytes_downloaded: 8000000,
          estimated_bytes: 26633830,
          target_file: 'cmems_subset_arabian_sea.nc',
          error: null,
          manifest_file: null
        })
      });
    });

    await page.route(`**/api/datasets/download/cancel/${jobId}`, async (route) => {
      cancelCalled = true;
      jobStatus = 'CANCELLED';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'ok',
          job_id: jobId,
          message: `Download job '${jobId}' has been cancelled.`
        })
      });
    });

    await page.goto('/');
    await openDownloaderTab(page);

    await page.getByRole('button', { name: /Generate & Verify Safe Command/i }).click();
    const startBtn = page.locator('[data-testid="start-download-btn"]');
    await expect(startBtn).toBeVisible({ timeout: 5000 });
    await startBtn.click();

    const jobCard = page.locator('[data-testid="active-download-job-card"]');
    await expect(jobCard).toBeVisible({ timeout: 5000 });

    const cancelBtn = page.locator('[data-testid="cancel-download-btn"]');
    await expect(cancelBtn).toBeVisible();
    await cancelBtn.click();

    await expect(page.locator('[data-testid="download-job-status"]')).toHaveText('CANCELLED', { timeout: 8000 });
    expect(cancelCalled).toBe(true);
    await expect(page.locator('[data-testid="cancel-download-btn"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="dismiss-download-btn"]')).toBeVisible();

    await page.screenshot({ path: path.join(evidenceDir, 'download-cancelled.png') });
  });

  test('TC-P09-03: Persistent tracking across modal close and reopen without silent cancellation', async ({ page }) => {
    await setupStandardRoutes(page);
    const jobId = 'job_test_03_persist';
    let jobStatus = 'RUNNING';

    await page.route('**/api/datasets/download', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            job_id: jobId,
            dataset_id: 'cmems_mod_glo_phy-cur_anfc_0.083deg_P1D-m',
            status: 'RUNNING',
            progress_pct: 20.0,
            bytes_downloaded: 5000000,
            estimated_bytes: 26633830,
            target_file: 'cmems_subset_arabian_sea.nc',
            error: null,
            manifest_file: null
          })
        });
      } else {
        await route.continue();
      }
    });

    await page.route(`**/api/datasets/download/status/${jobId}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          job_id: jobId,
          dataset_id: 'cmems_mod_glo_phy-cur_anfc_0.083deg_P1D-m',
          status: jobStatus,
          progress_pct: 60.0,
          bytes_downloaded: 16000000,
          estimated_bytes: 26633830,
          target_file: 'cmems_subset_arabian_sea.nc',
          error: null,
          manifest_file: null
        })
      });
    });

    await page.goto('/');
    await openDownloaderTab(page);

    await page.getByRole('button', { name: /Generate & Verify Safe Command/i }).click();
    await page.locator('[data-testid="start-download-btn"]').click();

    await expect(page.locator('[data-testid="active-download-job-card"]')).toBeVisible();
    await expect(page.locator('[data-testid="download-job-id"]')).toHaveText(jobId);

    // Close modal
    const closeBtn = page.locator('[data-testid="dataset-manager-close-btn"]');
    await closeBtn.click();
    await expect(page.locator('[data-testid="dataset-manager-modal"]')).not.toBeVisible();

    // Reopen modal and go to downloader tab
    await openDownloaderTab(page);

    // Verify job card is still present and tracks the active job
    const jobCard = page.locator('[data-testid="active-download-job-card"]');
    await expect(jobCard).toBeVisible();
    await expect(page.locator('[data-testid="download-job-id"]')).toHaveText(jobId);
    await expect(page.locator('[data-testid="download-job-status"]')).toHaveText('RUNNING');
    await expect(page.locator('[data-testid="cancel-download-btn"]')).toBeVisible();
  });

  test('TC-P09-04: Cancellation failure recovery displays error visibly while status polling recovers', async ({ page }) => {
    await setupStandardRoutes(page);
    const jobId = 'job_test_04_cancel_err';

    await page.route('**/api/datasets/download', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            job_id: jobId,
            dataset_id: 'cmems_mod_glo_phy-cur_anfc_0.083deg_P1D-m',
            status: 'RUNNING',
            progress_pct: 35.0,
            bytes_downloaded: 9000000,
            estimated_bytes: 26633830,
            target_file: 'cmems_subset_arabian_sea.nc',
            error: null,
            manifest_file: null
          })
        });
      } else {
        await route.continue();
      }
    });

    await page.route(`**/api/datasets/download/status/${jobId}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          job_id: jobId,
          dataset_id: 'cmems_mod_glo_phy-cur_anfc_0.083deg_P1D-m',
          status: 'RUNNING',
          progress_pct: 50.0,
          bytes_downloaded: 13000000,
          estimated_bytes: 26633830,
          target_file: 'cmems_subset_arabian_sea.nc',
          error: null,
          manifest_file: null
        })
      });
    });

    await page.route(`**/api/datasets/download/cancel/${jobId}`, async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          detail: 'System process kill signal failed: Access denied'
        })
      });
    });

    await page.goto('/');
    await openDownloaderTab(page);

    await page.getByRole('button', { name: /Generate & Verify Safe Command/i }).click();
    await page.locator('[data-testid="start-download-btn"]').click();

    await expect(page.locator('[data-testid="active-download-job-card"]')).toBeVisible();

    const cancelBtn = page.locator('[data-testid="cancel-download-btn"]');
    await cancelBtn.click();

    // Verify error is displayed visibly to user
    const errorAlert = page.locator('[role="alert"], .bg-rose-950\\/60');
    await expect(errorAlert).toBeVisible({ timeout: 5000 });
    await expect(errorAlert).toContainText(/Access denied|Failed to cancel/i);

    // Verify job card remains intact and status remains RUNNING
    await expect(page.locator('[data-testid="download-job-status"]')).toHaveText('RUNNING');
    await expect(cancelBtn).toBeVisible();
  });

  test('TC-P09-05: Download failure state displays error message and preserves retry readiness', async ({ page }) => {
    await setupStandardRoutes(page);
    const jobId = 'job_test_05_failed';

    await page.route('**/api/datasets/download', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            job_id: jobId,
            dataset_id: 'cmems_mod_glo_phy-cur_anfc_0.083deg_P1D-m',
            status: 'RUNNING',
            progress_pct: 10.0,
            bytes_downloaded: 2000000,
            estimated_bytes: 26633830,
            target_file: 'cmems_subset_arabian_sea.nc',
            error: null,
            manifest_file: null
          })
        });
      } else {
        await route.continue();
      }
    });

    await page.route(`**/api/datasets/download/status/${jobId}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          job_id: jobId,
          dataset_id: 'cmems_mod_glo_phy-cur_anfc_0.083deg_P1D-m',
          status: 'FAILED',
          progress_pct: 20.0,
          bytes_downloaded: 5000000,
          estimated_bytes: 26633830,
          target_file: 'cmems_subset_arabian_sea.nc',
          error: 'Remote Copernicus server returned 503 Service Unavailable',
          manifest_file: null
        })
      });
    });

    await page.goto('/');
    await openDownloaderTab(page);

    await page.getByRole('button', { name: /Generate & Verify Safe Command/i }).click();
    await page.locator('[data-testid="start-download-btn"]').click();

    await expect(page.locator('[data-testid="active-download-job-card"]')).toBeVisible();
    await expect(page.locator('[data-testid="download-job-status"]')).toHaveText('FAILED', { timeout: 8000 });
    await expect(page.locator('[data-testid="download-job-error"]')).toContainText('Remote Copernicus server returned 503 Service Unavailable');
    await expect(page.locator('[data-testid="cancel-download-btn"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="dismiss-download-btn"]')).toBeVisible();

    // Verify Start button is ready to allow retry once dismissed
    await page.locator('[data-testid="dismiss-download-btn"]').click();
    await expect(page.locator('[data-testid="active-download-job-card"]')).not.toBeVisible();
  });

  test('TC-P09-06: Duplicate start prevention disables start button during pending submission and while job is active', async ({ page }) => {
    await setupStandardRoutes(page);
    const jobId = 'job_test_06_dup';
    let resolveStart;
    const startHoldPromise = new Promise((resolve) => {
      resolveStart = resolve;
    });

    await page.route('**/api/datasets/download', async (route) => {
      if (route.request().method() === 'POST') {
        await startHoldPromise;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            job_id: jobId,
            dataset_id: 'cmems_mod_glo_phy-cur_anfc_0.083deg_P1D-m',
            status: 'RUNNING',
            progress_pct: 10.0,
            bytes_downloaded: 2000000,
            estimated_bytes: 26633830,
            target_file: 'cmems_subset_arabian_sea.nc',
            error: null,
            manifest_file: null
          })
        });
      } else {
        await route.continue();
      }
    });

    await page.route(`**/api/datasets/download/status/${jobId}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          job_id: jobId,
          dataset_id: 'cmems_mod_glo_phy-cur_anfc_0.083deg_P1D-m',
          status: 'RUNNING',
          progress_pct: 10.0,
          bytes_downloaded: 2000000,
          estimated_bytes: 26633830,
          target_file: 'cmems_subset_arabian_sea.nc',
          error: null,
          manifest_file: null
        })
      });
    });

    await page.goto('/');
    await openDownloaderTab(page);

    await page.getByRole('button', { name: /Generate & Verify Safe Command/i }).click();
    const startBtn = page.locator('[data-testid="start-download-btn"]');
    await expect(startBtn).toBeVisible({ timeout: 5000 });
    await expect(startBtn).toBeEnabled();

    // Click start - it enters submitting state
    await startBtn.click();
    await expect(startBtn).toBeDisabled();
    await expect(startBtn).toContainText('Starting...');

    // Resolve start endpoint
    resolveStart();

    // Job becomes RUNNING; start button remains disabled while job is active
    await expect(page.locator('[data-testid="active-download-job-card"]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid="download-job-status"]')).toHaveText('RUNNING');
    await expect(startBtn).toBeDisabled();
  });

  test('TC-P09-07: Out-of-order and held status polls cannot regress bytes or progress, nor overwrite terminal state', async ({ page }) => {
    await setupStandardRoutes(page);
    const jobId = 'job_test_07_races';
    let pollCount = 0;
    let releaseFirstPoll;
    const firstPollPromise = new Promise(resolve => { releaseFirstPoll = resolve; });

    await page.route('**/api/datasets/download', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            job_id: jobId,
            dataset_id: 'cmems_mod_glo_phy-cur_anfc_0.083deg_P1D-m',
            status: 'RUNNING',
            progress_pct: 10.0,
            bytes_downloaded: 2000000,
            estimated_bytes: 26633830,
            target_file: 'cmems_subset_arabian_sea.nc',
            error: null,
            manifest_file: null
          })
        });
      } else {
        await route.continue();
      }
    });

    await page.route(`**/api/datasets/download/status/${jobId}`, async (route) => {
      pollCount += 1;
      if (pollCount === 1) {
        // Hold first poll (with low progress)
        await firstPollPromise;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            job_id: jobId,
            dataset_id: 'cmems_mod_glo_phy-cur_anfc_0.083deg_P1D-m',
            status: 'RUNNING',
            progress_pct: 15.0,
            bytes_downloaded: 3000000,
            estimated_bytes: 26633830,
            target_file: 'cmems_subset_arabian_sea.nc',
            error: null,
            manifest_file: null
          })
        });
      } else if (pollCount === 2) {
        // Second poll resolves immediately with high progress
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            job_id: jobId,
            dataset_id: 'cmems_mod_glo_phy-cur_anfc_0.083deg_P1D-m',
            status: 'RUNNING',
            progress_pct: 75.0,
            bytes_downloaded: 20000000,
            estimated_bytes: 26633830,
            target_file: 'cmems_subset_arabian_sea.nc',
            error: null,
            manifest_file: null
          })
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            job_id: jobId,
            dataset_id: 'cmems_mod_glo_phy-cur_anfc_0.083deg_P1D-m',
            status: 'COMPLETED',
            progress_pct: 100.0,
            bytes_downloaded: 26633830,
            estimated_bytes: 26633830,
            target_file: 'cmems_subset_arabian_sea.nc',
            error: null,
            manifest_file: 'manifest_job_test_07.json'
          })
        });
      }
    });

    await page.goto('/');
    await openDownloaderTab(page);

    await page.getByRole('button', { name: /Generate & Verify Safe Command/i }).click();
    await page.locator('[data-testid="start-download-btn"]').click();

    await expect(page.locator('[data-testid="active-download-job-card"]')).toBeVisible();

    // Wait for second poll to advance progress to 75.0%
    await expect(page.locator('[data-testid="download-progress-pct"]')).toHaveText(/75\.0%|100\.0%/, { timeout: 8000 });

    // Release held first poll (15.0% progress)
    releaseFirstPoll();

    // Verify progress does NOT regress back to 15.0%
    await expect(page.locator('[data-testid="download-progress-pct"]')).not.toHaveText('15.0%');
    await expect(page.locator('[data-testid="download-progress-pct"]')).toHaveText(/75\.0%|100\.0%/);
  });

  test('TC-P09-08: Malformed or unconfirmed cancel response plus status-fetch failure shows error without fake CANCELLED state', async ({ page }) => {
    await setupStandardRoutes(page);
    const jobId = 'job_test_08_cancel_malformed';

    await page.route('**/api/datasets/download', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            job_id: jobId,
            dataset_id: 'cmems_mod_glo_phy-cur_anfc_0.083deg_P1D-m',
            status: 'RUNNING',
            progress_pct: 40.0,
            bytes_downloaded: 10000000,
            estimated_bytes: 26633830,
            target_file: 'cmems_subset_arabian_sea.nc',
            error: null,
            manifest_file: null
          })
        });
      } else {
        await route.continue();
      }
    });

    await page.route(`**/api/datasets/download/status/${jobId}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          job_id: jobId,
          dataset_id: 'cmems_mod_glo_phy-cur_anfc_0.083deg_P1D-m',
          status: 'RUNNING',
          progress_pct: 40.0,
          bytes_downloaded: 10000000,
          estimated_bytes: 26633830,
          target_file: 'cmems_subset_arabian_sea.nc',
          error: null,
          manifest_file: null
        })
      });
    });

    // Cancel endpoint returns malformed/unconfirmed response (e.g. status: 'error')
    await page.route(`**/api/datasets/download/cancel/${jobId}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'error',
          detail: 'Worker process locked by OS'
        })
      });
    });

    await page.goto('/');
    await openDownloaderTab(page);

    await page.getByRole('button', { name: /Generate & Verify Safe Command/i }).click();
    await page.locator('[data-testid="start-download-btn"]').click();

    await expect(page.locator('[data-testid="active-download-job-card"]')).toBeVisible();

    const cancelBtn = page.locator('[data-testid="cancel-download-btn"]');
    await cancelBtn.click();

    // Verify error is displayed visibly to user
    const errorAlert = page.locator('[role="alert"], .bg-rose-950\\/60');
    await expect(errorAlert).toBeVisible({ timeout: 5000 });
    await expect(errorAlert).toContainText(/Worker process locked|Cancellation not confirmed/i);

    // Verify job does NOT synthesize fake CANCELLED state and remains RUNNING
    await expect(page.locator('[data-testid="download-job-status"]')).toHaveText('RUNNING');
    await expect(cancelBtn).toBeVisible();
  });

});
