import React, { useState, useRef, useEffect } from 'react';
import { PRECISION_OCEAN_PLACES } from '../utils/graticules.js';
import { getDatasetProvenance } from '../utils/scientificPresentation.js';
import { fetchArgoFloatById } from '../services/api.js';

/**
 * Normalizes and extracts Argo WMO identifier candidates.
 * Strictly matches 5-7 digit numeric WMO IDs with optional 'ARGO', '_', '-', or space prefix (case-insensitive).
 * Rejects arbitrary strings (e.g., 'ARGO_TEST_QC_OUTLIER', 'GLIDER_01', '1234', '12345678').
 */
export function parseArgoQuery(query) {
  if (!query || typeof query !== 'string') return null;
  const trimmed = query.trim();
  if (!trimmed) return null;

  const match = trimmed.match(/^(?:argo[_\s-]?)?(\d{5,7})$/i);
  if (!match) return null;

  const digits = match[1];
  return {
    raw: trimmed,
    digits,
    lookupId: `ARGO_${digits}`,
    fallbackId: digits,
    displayId: `ARGO_${digits}`,
    isArgoPattern: true
  };
}

/**
 * Validates that an API response is an authentic, well-formed Argo float detail record.
 * Must have platform_type === 'argo', valid non-empty string ID, and finite lat/lon within bounds.
 */
export function isValidArgoDetail(detail) {
  if (!detail || typeof detail !== 'object') return false;
  if (detail.platform_type !== 'argo') return false;
  if (typeof detail.id !== 'string' || !detail.id.trim()) return false;
  if (typeof detail.lat !== 'number' || !Number.isFinite(detail.lat) || detail.lat < -90 || detail.lat > 90) return false;
  if (typeof detail.lon !== 'number' || !Number.isFinite(detail.lon) || detail.lon < -180 || detail.lon > 180) return false;
  return true;
}

/**
 * Header - Professional Scientific Workstation Top Bar
 * Adheres to INCOIS design language.
 * 
 * Top-left: SAMUDRA-3D / Ocean Intelligence Platform
 * Center: Global Search Box + Clean Primary Navigation (EXPLORE, OBSERVATIONS, ANALYSIS, DATA, OPERATIONS)
 * Right: User Session, Institutional Clearance, and Administration
 */
export default function Header({
  currentUser = null,
  activeDataset = null,
  viewMode: _viewMode = 'globe',
  onViewModeChange = null,
  onOpenAssistant = null,
  onOpenSources = null,
  onOpenDatasetsModal = null,
  onOpenObservationDrawer = null,
  onOpenComparison = null,
  onOpenFishermanModal = null,
  onOpenCycloneModal = null,
  onOpenInDepthAnalysis = null,
  onSelectRegion = null,
  onSelectArgoPlatform = null,
  onNavigate = null,
  onLogout = null
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeMenu, setActiveMenu] = useState(null); // 'EXPLORE' | 'OBSERVATIONS' | 'ANALYSIS' | 'DATA' | 'OPERATIONS' | 'USER' | null
  const [searchResults, setSearchResults] = useState([]);
  const [isSearchingArgo, setIsSearchingArgo] = useState(false);
  const [argoSearchStatus, setArgoSearchStatus] = useState(null); // { type: 'loading' | 'not_found' | 'error' | 'success', message: string } | null
  const menuRef = useRef(null);

  const searchRequestIdRef = useRef(0);
  const searchAbortControllerRef = useRef(null);

  const isAdmin = currentUser?.role === 'ADMIN';
  const provenance = getDatasetProvenance({ activeDataset });
  const isReal = provenance.sourceModeLabel === 'REAL';

  // Close menus on click outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setActiveMenu(null);
      }
    };
    window.document.addEventListener('mousedown', handleClickOutside);
    return () => window.document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Cleanup in-flight search requests on unmount
  useEffect(() => {
    return () => {
      if (searchAbortControllerRef.current) {
        searchAbortControllerRef.current.abort();
      }
    };
  }, []);

  // Global Search Handler (supports place name, lat/lon coords, and WMO ID)
  const handleSearchChange = (e) => {
    const val = e.target.value;
    setSearchQuery(val);

    // Cancel any previous in-flight Argo lookup request
    if (searchAbortControllerRef.current) {
      searchAbortControllerRef.current.abort();
      searchAbortControllerRef.current = null;
    }
    const currentReqId = ++searchRequestIdRef.current;

    if (!val.trim()) {
      setSearchResults([]);
      setIsSearchingArgo(false);
      setArgoSearchStatus(null);
      return;
    }

    const q = val.toLowerCase().trim();

    // 1. Check if coordinate query (e.g. "13.25, 80.31" or "13.25 80.31")
    const coordMatch = q.match(/^([-+]?\d*\.?\d+)[,\s]+([-+]?\d*\.?\d+)$/);
    const staticResults = [];

    if (coordMatch) {
      const lat = parseFloat(coordMatch[1]);
      const lon = parseFloat(coordMatch[2]);
      if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
        staticResults.push({
          id: `coord-${lat}-${lon}`,
          name: `Coordinate: ${lat.toFixed(3)}°N, ${lon.toFixed(3)}°E`,
          lat,
          lon,
          dist: 110,
          type: 'coordinate'
        });
      }
    }

    // 2. Check places from graticules
    for (const p of PRECISION_OCEAN_PLACES) {
      if (p.name.toLowerCase().includes(q) || (p.tag && p.tag.toLowerCase().includes(q))) {
        staticResults.push({
          id: p.id,
          name: `${p.name} [${p.tag || 'Sector'}]`,
          lat: p.lat,
          lon: p.lon,
          dist: p.peakDist || 140,
          type: 'place'
        });
      }
    }

    // 3. Check if query matches supported Argo WMO ID format (5-7 digits)
    const argoCandidate = parseArgoQuery(val);

    if (!argoCandidate) {
      setIsSearchingArgo(false);
      setArgoSearchStatus(null);
      setSearchResults(staticResults.slice(0, 6));
      return;
    }

    // Candidate matches Argo ID pattern: show immediate static results while fetching platform detail
    setIsSearchingArgo(true);
    setArgoSearchStatus({ type: 'loading', message: `Searching Argo platform ${argoCandidate.displayId}...` });
    setSearchResults(staticResults.slice(0, 6));

    const controller = new AbortController();
    searchAbortControllerRef.current = controller;

    fetchArgoFloatById(argoCandidate.lookupId, controller.signal)
      .then((detail) => {
        if (searchRequestIdRef.current !== currentReqId) return;
        if (isValidArgoDetail(detail)) {
          const argoItem = {
            id: detail.id.trim(),
            name: (typeof detail.name === 'string' && detail.name.trim()) ? detail.name.trim() : `Argo Float ${detail.wmo_id || detail.id}`,
            wmo_id: detail.wmo_id || detail.metadata?.wmo_id,
            lat: detail.lat,
            lon: detail.lon,
            dist: 120,
            type: 'argo',
            floatDetail: detail
          };
          setSearchResults([argoItem, ...staticResults].slice(0, 6));
          setIsSearchingArgo(false);
          setArgoSearchStatus({ type: 'success', message: `Found Argo platform ${detail.id}` });
        } else {
          // If normalized ID lookup failed validation, attempt fallback ID if available
          if (argoCandidate.fallbackId && argoCandidate.fallbackId !== argoCandidate.lookupId) {
            fetchArgoFloatById(argoCandidate.fallbackId, controller.signal)
              .then((fbDetail) => {
                if (searchRequestIdRef.current !== currentReqId) return;
                if (isValidArgoDetail(fbDetail)) {
                  const argoItem = {
                    id: fbDetail.id.trim(),
                    name: (typeof fbDetail.name === 'string' && fbDetail.name.trim()) ? fbDetail.name.trim() : `Argo Float ${fbDetail.wmo_id || fbDetail.id}`,
                    wmo_id: fbDetail.wmo_id || fbDetail.metadata?.wmo_id,
                    lat: fbDetail.lat,
                    lon: fbDetail.lon,
                    dist: 120,
                    type: 'argo',
                    floatDetail: fbDetail
                  };
                  setSearchResults([argoItem, ...staticResults].slice(0, 6));
                  setIsSearchingArgo(false);
                  setArgoSearchStatus({ type: 'success', message: `Found Argo platform ${fbDetail.id}` });
                  return;
                }
                setIsSearchingArgo(false);
                setArgoSearchStatus({ type: 'not_found', message: `No Argo platform found for ID "${val.trim()}"` });
              })
              .catch((fbErr) => {
                if (fbErr.name === 'AbortError') return;
                if (searchRequestIdRef.current !== currentReqId) return;
                setIsSearchingArgo(false);
                setArgoSearchStatus({ type: 'not_found', message: `No Argo platform found for ID "${val.trim()}"` });
              });
            return;
          }
          setIsSearchingArgo(false);
          setArgoSearchStatus({ type: 'not_found', message: `No Argo platform found for ID "${val.trim()}"` });
        }
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        if (searchRequestIdRef.current !== currentReqId) return;

        // If normalized lookup failed and fallback ID exists, attempt fallback
        if (argoCandidate.fallbackId && argoCandidate.fallbackId !== argoCandidate.lookupId) {
          fetchArgoFloatById(argoCandidate.fallbackId, controller.signal)
            .then((fbDetail) => {
              if (searchRequestIdRef.current !== currentReqId) return;
              if (isValidArgoDetail(fbDetail)) {
                const argoItem = {
                  id: fbDetail.id.trim(),
                  name: (typeof fbDetail.name === 'string' && fbDetail.name.trim()) ? fbDetail.name.trim() : `Argo Float ${fbDetail.wmo_id || fbDetail.id}`,
                  wmo_id: fbDetail.wmo_id || fbDetail.metadata?.wmo_id,
                  lat: fbDetail.lat,
                  lon: fbDetail.lon,
                  dist: 120,
                  type: 'argo',
                  floatDetail: fbDetail
                };
                setSearchResults([argoItem, ...staticResults].slice(0, 6));
                setIsSearchingArgo(false);
                setArgoSearchStatus({ type: 'success', message: `Found Argo platform ${fbDetail.id}` });
                return;
              }
              setIsSearchingArgo(false);
              setArgoSearchStatus({ type: 'not_found', message: `No Argo platform found for ID "${val.trim()}"` });
            })
            .catch((fbErr) => {
              if (fbErr.name === 'AbortError') return;
              if (searchRequestIdRef.current !== currentReqId) return;
              setIsSearchingArgo(false);
              setArgoSearchStatus({ type: 'not_found', message: `No Argo platform found for ID "${val.trim()}"` });
            });
          return;
        }

        setIsSearchingArgo(false);
        setArgoSearchStatus({ type: 'not_found', message: `No Argo platform found for ID "${val.trim()}"` });
      });
  };

  const handleSelectSearchResult = (res) => {
    if (!res) return;
    if (res.type === 'argo' && res.floatDetail) {
      if (onSelectArgoPlatform) {
        onSelectArgoPlatform(res.floatDetail);
      } else if (onSelectRegion) {
        onSelectRegion(res);
      }
    } else if (onSelectRegion) {
      onSelectRegion(res);
    }
    setSearchQuery('');
    setSearchResults([]);
    setIsSearchingArgo(false);
    setArgoSearchStatus(null);
  };

  const toggleMenu = (menuName) => {
    setActiveMenu((prev) => (prev === menuName ? null : menuName));
  };

  return (
    <header className="header scientific-header glassmorphic-panel" ref={menuRef}>
      {/* 1. Left: Brand & Institution */}
      <div className="brand flex items-center gap-3">
        <span className="brand-mark text-ocean-bright font-mono text-xl" aria-hidden="true">≈</span>
        <div>
          <div className="flex items-center gap-2">
            <span className="brand-name font-bold tracking-wider text-sm text-white">
              SAMUDRA<span className="text-ocean-bright">-3D</span>
            </span>
            <span className="badge-platform-title text-[9px] font-mono uppercase bg-slate-800 text-slate-300 px-1.5 py-0.5 rounded border border-slate-700">
              Workstation
            </span>
          </div>
          <p className="brand-subtitle text-[10px] text-slate-400 m-0 font-sans">
            MoES / INCOIS Ocean Intelligence
          </p>
        </div>
      </div>

      {/* 2. Global Search Box */}
      <div className="search-container relative max-w-xs w-full hidden md:block">
        <div className="flex items-center bg-slate-900/90 border border-slate-700/80 rounded-full px-3 py-1 text-xs text-white focus-within:border-sky-400 transition">
          <span className="text-slate-400 mr-2" aria-hidden="true">🔍</span>
          <input
            type="search"
            placeholder="Search location, lat,lon or WMO..."
            value={searchQuery}
            onChange={handleSearchChange}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                if (searchAbortControllerRef.current) {
                  searchAbortControllerRef.current.abort();
                  searchAbortControllerRef.current = null;
                }
                searchRequestIdRef.current++;
                setSearchResults([]);
                setArgoSearchStatus(null);
                setIsSearchingArgo(false);
              } else if (e.key === 'Enter') {
                if (searchResults.length > 0) {
                  e.preventDefault();
                  handleSelectSearchResult(searchResults[0]);
                }
              }
            }}
            className="bg-transparent border-none outline-none text-xs w-full text-slate-200 placeholder-slate-500"
            aria-label="Search ocean location or coordinates"
            data-testid="global-search-input"
          />
        </div>

        {(searchResults.length > 0 || isSearchingArgo || argoSearchStatus?.type === 'not_found') && (
          <div
            className="search-results-dropdown glassmorphic-panel absolute left-0 right-0 top-full mt-1.5 z-50 rounded-lg shadow-2xl p-1 max-h-60 overflow-y-auto"
            data-testid="search-results-dropdown"
          >
            {isSearchingArgo && (
              <div
                className="px-3 py-2 text-xs text-sky-400 font-mono flex items-center gap-2"
                data-testid="argo-search-loading"
                role="status"
              >
                <span className="animate-spin" aria-hidden="true">⏳</span>
                <span>{argoSearchStatus?.message || 'Searching Argo platform...'}</span>
              </div>
            )}

            {!isSearchingArgo && argoSearchStatus?.type === 'not_found' && searchResults.length === 0 && (
              <div
                className="px-3 py-2 text-xs text-amber-400/90 font-mono"
                data-testid="argo-search-not-found"
                role="status"
              >
                <span>⚠️ {argoSearchStatus.message}</span>
              </div>
            )}

            {searchResults.map((r) => {
              if (r.type === 'argo') {
                return (
                  <button
                    key={r.id}
                    type="button"
                    className="w-full text-left px-3 py-2 rounded text-xs text-slate-200 hover:bg-sky-950/80 hover:text-sky-300 font-mono flex items-center justify-between transition border-b border-slate-800/50 last:border-0"
                    onClick={() => handleSelectSearchResult(r)}
                    data-testid="argo-search-result"
                    data-platform-id={r.id}
                  >
                    <div className="flex flex-col min-w-0 pr-2">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-sky-900/80 text-sky-300 border border-sky-700/60 uppercase">
                          Argo Float
                        </span>
                        <span className="font-semibold text-white truncate">{r.name}</span>
                      </div>
                      <span className="text-[10px] text-slate-400 mt-0.5 font-mono">Platform ID: {r.id}</span>
                    </div>
                    <span className="text-[10px] text-sky-400 font-mono whitespace-nowrap">
                      {r.lat.toFixed(2)}°N, {r.lon.toFixed(2)}°E
                    </span>
                  </button>
                );
              }
              return (
                <button
                  key={r.id}
                  type="button"
                  className="w-full text-left px-3 py-1.5 rounded text-xs text-slate-200 hover:bg-sky-950/80 hover:text-sky-300 font-mono flex items-center justify-between transition"
                  onClick={() => handleSelectSearchResult(r)}
                  data-testid="search-result-item"
                >
                  <span>{r.name}</span>
                  <span className="text-[10px] text-slate-500">{r.lat.toFixed(1)}°, {r.lon.toFixed(1)}°</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* 3. Center: Primary Navigation */}
      <nav className="primary-nav flex items-center gap-1" aria-label="Main Navigation">
        {/* EXPLORE */}
        <div className="nav-item relative">
          <button
            type="button"
            className={`nav-link-btn ${activeMenu === 'EXPLORE' ? 'active' : ''}`}
            onClick={() => toggleMenu('EXPLORE')}
            aria-expanded={activeMenu === 'EXPLORE'}
          >
            EXPLORE ▾
          </button>
          {activeMenu === 'EXPLORE' && (
            <div className="nav-dropdown-menu glassmorphic-panel">
              <button
                type="button"
                className="dropdown-item"
                onClick={() => {
                  onViewModeChange?.('globe');
                  setActiveMenu(null);
                }}
              >
                <span className="icon">🌍</span>
                <div>
                  <div className="title">Global 3D Earth Globe</div>
                  <div className="desc">Photorealistic solid Earth with depth raycasting</div>
                </div>
              </button>
              <button
                type="button"
                className="dropdown-item"
                onClick={() => {
                  onViewModeChange?.('block');
                  setActiveMenu(null);
                }}
              >
                <span className="icon">📦</span>
                <div>
                  <div className="title">3D Ocean Volume Block</div>
                  <div className="desc">Regional 3D volumetric ocean voxels & ODV slices</div>
                </div>
              </button>
            </div>
          )}
        </div>

        {/* OBSERVATIONS */}
        <div className="nav-item">
          <button
            type="button"
            className="nav-link-btn"
            data-testid="open-observation-drawer-btn"
            onClick={() => {
              onOpenObservationDrawer && onOpenObservationDrawer();
              setActiveMenu(null);
            }}
          >
            OBSERVATIONS
          </button>
        </div>

        {/* ANALYSIS */}
        <div className="nav-item relative">
          <button
            type="button"
            className={`nav-link-btn ${activeMenu === 'ANALYSIS' ? 'active' : ''}`}
            data-testid="nav-analysis-btn"
            onClick={() => toggleMenu('ANALYSIS')}
            aria-expanded={activeMenu === 'ANALYSIS'}
          >
            ANALYSIS ▾
          </button>
          {activeMenu === 'ANALYSIS' && (
            <div className="nav-dropdown-menu glassmorphic-panel">
              <button
                type="button"
                className="dropdown-item"
                data-testid="header-compare-btn"
                onClick={() => {
                  onOpenComparison && onOpenComparison();
                  setActiveMenu(null);
                }}
              >
                <span className="icon">⚖️</span>
                <div>
                  <div className="title">Model vs Observation</div>
                  <div className="desc">Trilinear collocation, Bias, MAE, RMSE, Pearson R</div>
                </div>
              </button>
              <button
                type="button"
                className="dropdown-item"
                data-testid="header-physics-btn"
                onClick={() => {
                  onOpenInDepthAnalysis && onOpenInDepthAnalysis();
                  setActiveMenu(null);
                }}
              >
                <span className="icon">🔬</span>
                <div>
                  <div className="title">Deep Ocean Physics & Acoustics</div>
                  <div className="desc">EOS-80, SOFAR channel, Mackenzie sound speed</div>
                </div>
              </button>
            </div>
          )}
        </div>

        {/* DATA */}
        <div className="nav-item relative">
          <button
            type="button"
            className={`nav-link-btn ${activeMenu === 'DATA' ? 'active' : ''}`}
            data-testid="nav-data-btn"
            onClick={() => toggleMenu('DATA')}
            aria-expanded={activeMenu === 'DATA'}
          >
            DATA ▾
          </button>
          {activeMenu === 'DATA' && (
            <div className="nav-dropdown-menu glassmorphic-panel">
              <button
                type="button"
                className="dropdown-item"
                data-testid="header-datasets-btn"
                onClick={() => {
                  onOpenDatasetsModal && onOpenDatasetsModal();
                  setActiveMenu(null);
                }}
              >
                <span className="icon">📁</span>
                <div>
                  <div className="title">Dataset Registry & Downloads</div>
                  <div className="desc">Manage ocean datasets and subset volume estimator</div>
                </div>
              </button>
              <button
                type="button"
                className="dropdown-item"
                onClick={() => {
                  onOpenSources && onOpenSources();
                  setActiveMenu(null);
                }}
              >
                <span className="icon">📜</span>
                <div>
                  <div className="title">Data Sources & Provenance</div>
                  <div className="desc">View official CF-1.8 NetCDF4 specifications</div>
                </div>
              </button>
            </div>
          )}
        </div>

        {/* OPERATIONS */}
        <div className="nav-item relative">
          <button
            type="button"
            className={`nav-link-btn ${activeMenu === 'OPERATIONS' ? 'active' : ''}`}
            onClick={() => toggleMenu('OPERATIONS')}
            aria-expanded={activeMenu === 'OPERATIONS'}
          >
            OPERATIONS ▾
          </button>
          {activeMenu === 'OPERATIONS' && (
            <div className="nav-dropdown-menu glassmorphic-panel">
              <button
                type="button"
                className="dropdown-item"
                onClick={() => {
                  onOpenFishermanModal && onOpenFishermanModal();
                  setActiveMenu(null);
                }}
              >
                <span className="icon">🐟</span>
                <div>
                  <div className="title">Fisherman View</div>
                  <div className="desc">SST, currents, coastal harbors, and PFZ status</div>
                </div>
              </button>
              <button
                type="button"
                className="dropdown-item"
                onClick={() => {
                  onOpenCycloneModal && onOpenCycloneModal();
                  setActiveMenu(null);
                }}
              >
                <span className="icon">🌀</span>
                <div>
                  <div className="title">Cyclone & Marine Conditions</div>
                  <div className="desc">TCHP, D26, MLD, and column heat content metrics</div>
                </div>
              </button>
            </div>
          )}
        </div>
      </nav>

      {/* 4. Right: AI Assistant Trigger & User Session */}
      <div className="header-right flex items-center gap-3">
        {/* Source Badge */}
        <div
          role="button"
          tabIndex={0}
          onClick={onOpenDatasetsModal}
          className={`source-badge-pill ${isReal ? 'real' : 'synthetic'} hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono font-bold uppercase cursor-pointer hover:opacity-90 transition`}
          title={`Active dataset: ${activeDataset?.name || provenance.provider} (Click to manage datasets)`}
          data-testid="header-source-badge"
        >
          <span className="dot" aria-hidden="true" />
          <span>{provenance.badgeText}</span>
        </div>

        {/* AI Assistant Button */}
        <button
          type="button"
          className="ai-assistant-header-btn flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-sky-950/80 border border-sky-600/60 text-sky-300 hover:bg-sky-900 transition"
          onClick={onOpenAssistant}
          title="Ask SAMUDRA Scientific AI Assistant (Alt+A)"
        >
          <span className="sparkle" aria-hidden="true">✦</span>
          <span>Ask SAMUDRA</span>
        </button>

        {/* User Session & Menu */}
        <div className="user-menu relative">
          <button
            type="button"
            className="user-profile-btn flex items-center gap-2 p-1 rounded-full hover:bg-slate-800/80 transition"
            onClick={() => toggleMenu('USER')}
            aria-label="User account and clearance"
          >
            <span
              className="user-avatar-circle flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold text-white shadow"
              style={{ backgroundColor: currentUser?.badge_color || '#0284c7' }}
            >
              {currentUser?.avatar_initials || (currentUser?.username ? currentUser.username.slice(0, 2).toUpperCase() : 'US')}
            </span>
          </button>

          {activeMenu === 'USER' && (
            <div className="user-dropdown-menu glassmorphic-panel absolute right-0 mt-2 w-56 rounded-lg p-2 shadow-2xl z-50">
              <div className="user-info-card p-2 border-b border-slate-700/60 mb-2">
                <div className="font-bold text-xs text-white">
                  {currentUser?.full_name || currentUser?.username || 'Researcher'}
                </div>
                <div className="text-[10px] font-mono text-sky-400 mt-0.5">
                  {currentUser?.clearance_level || 'LEVEL-1 RESEARCH'}
                </div>
                <div className="text-[10px] text-slate-400">
                  Role: {currentUser?.role || 'VIEWER'}
                </div>
              </div>

              {isAdmin && (
                <button
                  type="button"
                  className="dropdown-link-btn w-full text-left px-2 py-1.5 text-xs text-slate-200 hover:bg-sky-950/60 rounded flex items-center gap-2"
                  onClick={() => {
                    onNavigate?.('/admin');
                    setActiveMenu(null);
                  }}
                >
                  <span>⚙️</span>
                  <span>Administration Portal</span>
                </button>
              )}

              <button
                type="button"
                className="dropdown-link-btn w-full text-left px-2 py-1.5 text-xs text-rose-300 hover:bg-rose-950/60 rounded flex items-center gap-2 mt-1"
                onClick={() => {
                  onLogout && onLogout();
                  setActiveMenu(null);
                }}
              >
                <span>🚪</span>
                <span>Sign Out</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
