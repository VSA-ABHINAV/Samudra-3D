import React from 'react';

/**
 * HomePage - Public Institutional Portal for SAMUDRA-3D
 * Ministry of Earth Sciences (MoES) / INCOIS Operational Ocean Information System
 *
 * Provides a clear public entry point introducing:
 * - 3D Ocean Exploration (Globe & Regional Volume)
 * - In-Situ Observation Fleet (Argo, Gliders, Buoys, CTD Profiles)
 * - Model vs Observation Collocation & Residual Analysis
 * - Deep Ocean Physics, Acoustics & Stratification
 * - NetCDF4 Data Management & Subset Downloader
 * - Operational Views (Fisherman View & Cyclone Conditions)
 * - AI Ocean Assistant (Ask SAMUDRA)
 *
 * Transparently communicates system capabilities, historical model provenance,
 * and offline integration boundaries.
 */
export default function HomePage({
  currentUser = null,
  activeDataset: _activeDataset = null,
  onNavigate = null,
  onOpenSources = null,
  theme = 'dark',
  onToggleTheme = null
}) {
  const isAuthenticated = Boolean(currentUser);

  const handleLaunchApp = () => {
    if (onNavigate) {
      onNavigate('/app');
    } else if (typeof window !== 'undefined') {
      window.location.pathname = '/app';
    }
  };

  const handleLaunchWorkflow = (workflowKey) => {
    const target = `/app?workflow=${encodeURIComponent(workflowKey)}`;
    if (onNavigate) {
      onNavigate(target);
    } else if (typeof window !== 'undefined') {
      window.location.href = target;
    }
  };

  const handleGoLogin = () => {
    if (onNavigate) {
      onNavigate('/login');
    } else if (typeof window !== 'undefined') {
      window.location.pathname = '/login';
    }
  };

  const handleGoAdmin = () => {
    if (onNavigate) {
      onNavigate('/admin');
    } else if (typeof window !== 'undefined') {
      window.location.pathname = '/admin';
    }
  };

  return (
    <div
      className="public-homepage-root min-h-screen flex flex-col"
      data-testid="public-homepage"
      style={{
        backgroundColor: 'var(--bg, #070e1b)',
        color: 'var(--text, #f8fafc)',
        fontFamily: 'Inter, system-ui, -apple-system, sans-serif'
      }}
    >
      {/* 1. Public Top Navigation Bar */}
      <header className="public-nav-header sticky top-0 z-50 border-b px-4 sm:px-8 py-3.5 backdrop-blur-md transition"
        style={{
          backgroundColor: 'rgba(13, 23, 38, 0.88)',
          borderColor: 'var(--border, #1e2f47)'
        }}
      >
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          {/* Brand Identity */}
          <div className="flex items-center gap-3">
            <span className="text-2xl font-mono text-sky-400 font-bold leading-none" aria-hidden="true">≈</span>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-base sm:text-lg tracking-wider text-white">
                  SAMUDRA<span className="text-sky-400">-3D</span>
                </span>
                <span className="text-[10px] font-mono uppercase bg-sky-950/80 text-sky-300 px-2 py-0.5 rounded border border-sky-800/60 font-semibold">
                  MoES / INCOIS
                </span>
              </div>
              <p className="text-[11px] text-slate-400 m-0 hidden sm:block">
                Operational Ocean Intelligence & Digital Twin System
              </p>
            </div>
          </div>

          {/* Quick Action Links & User Controls */}
          <div className="flex items-center gap-2 sm:gap-4">
            {onToggleTheme && (
              <button
                type="button"
                onClick={onToggleTheme}
                className="px-2.5 py-1.5 rounded-lg border text-xs font-medium text-slate-300 hover:text-white transition flex items-center gap-1"
                style={{ backgroundColor: 'var(--panel, #0d1726)', borderColor: 'var(--border, #1e2f47)' }}
                aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                data-testid="homepage-theme-toggle"
              >
                <span>{theme === 'dark' ? '☀️' : '🌙'}</span>
              </button>
            )}

            <button
              type="button"
              onClick={onOpenSources}
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800/60 transition hidden md:inline-flex items-center gap-1.5"
              data-testid="homepage-sources-btn"
            >
              <span>📜</span>
              <span>Data Specs</span>
            </button>

            {isAuthenticated ? (
              <div className="flex items-center gap-2">
                {currentUser?.role === 'ADMIN' && (
                  <button
                    type="button"
                    onClick={handleGoAdmin}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold text-sky-300 bg-sky-950/80 border border-sky-700/60 hover:bg-sky-900 transition"
                    data-testid="homepage-admin-btn"
                  >
                    Admin Portal
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleLaunchApp}
                  className="px-4 py-1.5 rounded-lg text-xs font-bold text-white bg-sky-600 hover:bg-sky-500 transition shadow-md flex items-center gap-1.5"
                  data-testid="homepage-launch-btn"
                >
                  <span>Workstation</span>
                  <span aria-hidden="true">→</span>
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleGoLogin}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-200 hover:text-white hover:bg-slate-800 transition border border-slate-700"
                  data-testid="homepage-login-btn"
                >
                  Officer Login
                </button>
                <button
                  type="button"
                  onClick={handleLaunchApp}
                  className="px-4 py-1.5 rounded-lg text-xs font-bold text-white bg-sky-600 hover:bg-sky-500 transition shadow-md flex items-center gap-1.5"
                  data-testid="homepage-launch-btn"
                >
                  <span>Launch Workstation</span>
                  <span aria-hidden="true">→</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* 2. Hero Section */}
      <section className="hero-section relative py-12 sm:py-20 px-4 sm:px-8 border-b"
        style={{
          borderColor: 'var(--border, #1e2f47)',
          background: 'radial-gradient(circle at 50% 20%, rgba(2, 132, 199, 0.15) 0%, rgba(7, 14, 27, 0) 70%)'
        }}
      >
        <div className="max-w-5xl mx-auto text-center space-y-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-mono font-semibold bg-sky-950/80 border border-sky-600/40 text-sky-300">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" aria-hidden="true" />
            <span>Configured Catalog: Copernicus GLORYS12V1 (Unverified Locally) | Verified Local Test Data: Synthetic ROMS</span>
          </div>

          <h1 className="text-3xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-white leading-tight">
            Indian Ocean 3D Intelligence & <span className="text-transparent bg-clip-text bg-gradient-to-r from-sky-400 to-teal-300">Operational Analysis</span>
          </h1>

          <p className="text-sm sm:text-base lg:text-lg text-slate-300 max-w-3xl mx-auto leading-relaxed">
            A specialized oceanographic decision-support platform engineered for the Ministry of Earth Sciences (MoES) and INCOIS. Explore multi-depth numerical ocean models, validate simulations against Argo and glider profiles, compute derived physical acoustics, and export CF-1.8 NetCDF4 subsets.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-4 pt-4">
            <button
              type="button"
              onClick={handleLaunchApp}
              className="px-6 py-3 rounded-xl text-sm font-bold text-white bg-sky-600 hover:bg-sky-500 transition shadow-xl flex items-center gap-2 cursor-pointer"
              data-testid="hero-launch-workstation-btn"
            >
              <span>Launch 3D Ocean Workstation</span>
              <span className="text-base" aria-hidden="true">🌊</span>
            </button>
            <button
              type="button"
              onClick={onOpenSources}
              className="px-5 py-3 rounded-xl text-sm font-semibold text-slate-200 bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 transition flex items-center gap-2 cursor-pointer"
              data-testid="hero-specs-btn"
            >
              <span>Data Sources & Provenance</span>
              <span aria-hidden="true">📜</span>
            </button>
          </div>
        </div>
      </section>

      {/* 3. Core Operational Workflows Showcase */}
      <section className="workflows-section py-12 sm:py-16 px-4 sm:px-8 max-w-7xl mx-auto w-full flex-1">
        <div className="text-center mb-10 space-y-2">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
            Confirmed Oceanographic Workflows
          </h2>
          <p className="text-xs sm:text-sm text-slate-400 max-w-2xl mx-auto">
            Explore the complete suite of analytical modules implemented and verified in the SAMUDRA-3D workstation.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6" data-testid="workflow-cards-grid">
          {/* Card 1: 3D Ocean Exploration */}
          <div
            className="workflow-card rounded-xl border p-5 flex flex-col justify-between transition hover:border-sky-500/60 shadow-lg"
            style={{ backgroundColor: 'var(--panel, #0d1726)', borderColor: 'var(--border, #1e2f47)' }}
            data-testid="workflow-card-explore"
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-2xl" aria-hidden="true">🌍</span>
                <span className="text-[10px] font-mono uppercase bg-sky-950 text-sky-300 px-2 py-0.5 rounded border border-sky-800">
                  Explore
                </span>
              </div>
              <h3 className="text-base font-bold text-white">3D Earth & Volume Exploration</h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                Seamless Three.js global sphere and regional 3D voxel block rendering. Dynamic depth slicing from surface to 92m, continuous time animation, and scalar overlays for Potential Temperature, Practical Salinity, and Velocity Currents.
              </p>
            </div>
            <div className="pt-4 border-t border-slate-800/80 mt-4 flex items-center justify-between text-[11px] text-sky-400 font-medium">
              <span>Globe & Block View Modes</span>
              <button
                type="button"
                onClick={() => handleLaunchWorkflow('explore')}
                data-testid="workflow-btn-explore"
                className="hover:underline flex items-center gap-1 font-semibold"
              >
                Open Explorer →
              </button>
            </div>
          </div>

          {/* Card 2: In-Situ Observation Fleet */}
          <div
            className="workflow-card rounded-xl border p-5 flex flex-col justify-between transition hover:border-sky-500/60 shadow-lg"
            style={{ backgroundColor: 'var(--panel, #0d1726)', borderColor: 'var(--border, #1e2f47)' }}
            data-testid="workflow-card-observations"
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-2xl" aria-hidden="true">🛰️</span>
                <span className="text-[10px] font-mono uppercase bg-emerald-950 text-emerald-300 px-2 py-0.5 rounded border border-emerald-800">
                  Fleet
                </span>
              </div>
              <h3 className="text-base font-bold text-white">In-Situ Observation Fleet</h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                Access spatial distributions of autonomous Argo profiling floats, underwater glider transects, and moored buoy stations across the Arabian Sea and Bay of Bengal. Inspect high-resolution vertical CTD profiles, T-S diagrams, and quality control flags.
              </p>
            </div>
            <div className="pt-4 border-t border-slate-800/80 mt-4 flex items-center justify-between text-[11px] text-emerald-400 font-medium">
              <span>Argo, Gliders & Buoys</span>
              <button
                type="button"
                onClick={() => handleLaunchWorkflow('observations')}
                data-testid="workflow-btn-observations"
                className="hover:underline flex items-center gap-1 font-semibold"
              >
                View Fleet →
              </button>
            </div>
          </div>

          {/* Card 3: Model vs Observation Analysis */}
          <div
            className="workflow-card rounded-xl border p-5 flex flex-col justify-between transition hover:border-sky-500/60 shadow-lg"
            style={{ backgroundColor: 'var(--panel, #0d1726)', borderColor: 'var(--border, #1e2f47)' }}
            data-testid="workflow-card-analysis"
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-2xl" aria-hidden="true">⚖️</span>
                <span className="text-[10px] font-mono uppercase bg-amber-950 text-amber-300 px-2 py-0.5 rounded border border-amber-800">
                  Collocation
                </span>
              </div>
              <h3 className="text-base font-bold text-white">Model vs Observation Analysis</h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                Rigorous trilinear interpolation matching model cells to physical observation coordinates. Computes signed Bias (Model − Obs), MAE, RMSE, Pearson R correlation, depth residuals, and 3D spatial anomaly fields.
              </p>
            </div>
            <div className="pt-4 border-t border-slate-800/80 mt-4 flex items-center justify-between text-[11px] text-amber-400 font-medium">
              <span>Trilinear Collocation Engine</span>
              <button
                type="button"
                onClick={() => handleLaunchWorkflow('analysis')}
                data-testid="workflow-btn-analysis"
                className="hover:underline flex items-center gap-1 font-semibold"
              >
                Run Comparison →
              </button>
            </div>
          </div>

          {/* Card 4: Deep Ocean Physics & Acoustics */}
          <div
            className="workflow-card rounded-xl border p-5 flex flex-col justify-between transition hover:border-sky-500/60 shadow-lg"
            style={{ backgroundColor: 'var(--panel, #0d1726)', borderColor: 'var(--border, #1e2f47)' }}
            data-testid="workflow-card-physics"
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-2xl" aria-hidden="true">🔬</span>
                <span className="text-[10px] font-mono uppercase bg-purple-950 text-purple-300 px-2 py-0.5 rounded border border-purple-800">
                  Physics
                </span>
              </div>
              <h3 className="text-base font-bold text-white">Deep Ocean Physics & Acoustics</h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                Calculates Mackenzie formula sound speed profiles, acoustic axis estimation, EOS-80 density stratification, Mixed Layer Depth (MLD), 20°C and 26°C isothermal depths (D20/D26), and Tropical Cyclone Heat Potential (TCHP).
              </p>
            </div>
            <div className="pt-4 border-t border-slate-800/80 mt-4 flex items-center justify-between text-[11px] text-purple-400 font-medium">
              <span>EOS-80 & Mackenzie Formula</span>
              <button
                type="button"
                onClick={() => handleLaunchWorkflow('physics')}
                data-testid="workflow-btn-physics"
                className="hover:underline flex items-center gap-1 font-semibold"
              >
                Inspect Physics →
              </button>
            </div>
          </div>

          {/* Card 5: NetCDF4 Data Management & Downloader */}
          <div
            className="workflow-card rounded-xl border p-5 flex flex-col justify-between transition hover:border-sky-500/60 shadow-lg"
            style={{ backgroundColor: 'var(--panel, #0d1726)', borderColor: 'var(--border, #1e2f47)' }}
            data-testid="workflow-card-data"
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-2xl" aria-hidden="true">📁</span>
                <span className="text-[10px] font-mono uppercase bg-blue-950 text-blue-300 px-2 py-0.5 rounded border border-blue-800">
                  Data
                </span>
              </div>
              <h3 className="text-base font-bold text-white">Dataset Registry & Downloader</h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                Manage registered CF-1.8 NetCDF4 models, compute bounding-box RAM and disk transfer size estimates, launch subsetting jobs with real-time progress polling, and inspect immutable SHA-256 provenance manifests.
              </p>
            </div>
            <div className="pt-4 border-t border-slate-800/80 mt-4 flex items-center justify-between text-[11px] text-blue-400 font-medium">
              <span>CF-1.8 Subsetting & Manifests</span>
              <button
                type="button"
                onClick={() => handleLaunchWorkflow('data')}
                data-testid="workflow-btn-data"
                className="hover:underline flex items-center gap-1 font-semibold"
              >
                Open Manager →
              </button>
            </div>
          </div>

          {/* Card 6: Operations & Scientific AI Assistant */}
          <div
            className="workflow-card rounded-xl border p-5 flex flex-col justify-between transition hover:border-sky-500/60 shadow-lg"
            style={{ backgroundColor: 'var(--panel, #0d1726)', borderColor: 'var(--border, #1e2f47)' }}
            data-testid="workflow-card-operations"
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-2xl" aria-hidden="true">✦</span>
                <span className="text-[10px] font-mono uppercase bg-teal-950 text-teal-300 px-2 py-0.5 rounded border border-teal-800">
                  Operations & AI
                </span>
              </div>
              <h3 className="text-base font-bold text-white">Operational Views & AI Assistant</h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                Specialized Fisherman View with coastal harbor presets and model-derived SST thermal front detection. Cyclone condition monitoring with column heat content metrics. Natural language queries via the Ask SAMUDRA assistant.
              </p>
            </div>
            <div className="pt-4 border-t border-slate-800/80 mt-4 flex items-center justify-between text-[11px] text-teal-400 font-medium">
              <span>Thermal Fronts & Ask SAMUDRA</span>
              <button
                type="button"
                onClick={() => handleLaunchWorkflow('operations')}
                data-testid="workflow-btn-operations"
                className="hover:underline flex items-center gap-1 font-semibold"
              >
                Open Operations →
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* 4. Scientific Truthfulness & Provenance Disclosure */}
      <section className="provenance-disclosure-section py-8 px-4 sm:px-8 border-t"
        style={{
          backgroundColor: 'rgba(10, 16, 28, 0.7)',
          borderColor: 'var(--border, #1e2f47)'
        }}
      >
        <div className="max-w-5xl mx-auto rounded-xl border p-6 text-xs text-slate-300 space-y-3"
          style={{ backgroundColor: 'var(--panel, #0d1726)', borderColor: 'var(--border, #1e2f47)' }}
        >
          <div className="flex items-center gap-2 text-sky-400 font-bold text-sm">
            <span aria-hidden="true">ℹ️</span>
            <span>Data Provenance & Scientific Truthfulness Declaration</span>
          </div>
          <p className="leading-relaxed">
            SAMUDRA-3D includes preconfigured CF-1.8 NetCDF4 catalog specifications for Copernicus GLORYS12V1 reanalysis (0–25°N, 50–100°E; local file availability has not been verified in this environment) alongside verified local synthetic ROMS arrays. Subsetting queries select precomputed numerical arrays and do not generate live forecasts or execute live external ingestion (Offline Integration Gap).
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 text-[11px] font-mono text-slate-400">
            <div className="flex items-center gap-2">
              <span className="text-amber-400">⚡</span>
              <span>Live External Ingestion: Offline Integration Gap (Retained Local Data)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sky-400">📊</span>
              <span>Thermal Fronts: Numerical Model SST Gradient Proxy</span>
            </div>
          </div>
        </div>
      </section>

      {/* 5. Institutional Footer */}
      <footer className="public-footer py-6 px-4 sm:px-8 border-t text-center text-xs text-slate-400"
        style={{
          backgroundColor: '#050a14',
          borderColor: 'var(--border, #1e2f47)'
        }}
      >
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-200">Ministry of Earth Sciences (MoES)</span>
            <span>·</span>
            <span>INCOIS Ocean Information Services</span>
          </div>
          <div className="flex items-center gap-4 text-[11px]">
            <button
              type="button"
              onClick={onOpenSources}
              className="hover:text-sky-400 transition underline cursor-pointer"
            >
              Data Sources & Specifications
            </button>
            <button
              type="button"
              onClick={handleGoLogin}
              className="hover:text-sky-400 transition underline cursor-pointer"
            >
              Institutional Login
            </button>
            <button
              type="button"
              onClick={handleLaunchApp}
              className="hover:text-sky-400 transition underline cursor-pointer font-semibold text-sky-400"
            >
              Workstation
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
