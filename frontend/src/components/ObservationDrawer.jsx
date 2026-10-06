import React, { useState, useMemo } from 'react';

/**
 * ObservationDrawer - Dockable / Slide-out Scientific In-Situ Observation Fleet Drawer
 * Replaces permanent sidebar clutter with clean, contextual filtering and selection.
 * Adheres to .
 */
export default function ObservationDrawer({
  isOpen,
  onClose,
  argoFloats = [],
  gliderTransects = [],
  buoyStations = [],
  buoys = [],
  selectedPlatform = null,
  onSelectPlatform,
  onOpenProfile,
  onOpenComparison,
  onFocusCoordinates
}) {
  const [activeFilter, setActiveFilter] = useState('ALL'); // ALL, ARGO, GLIDER, BUOY
  const [searchQuery, setSearchQuery] = useState('');

  // Combine and normalize platforms for the drawer
  const combinedPlatforms = useMemo(() => {
    const list = [];

    // Argo Floats
    for (const f of argoFloats) {
      list.push({
        id: f.id || `ARGO_${f.wmo_id}`,
        type: 'argo',
        typeLabel: 'Argo Float',
        badge: f.source_mode === 'SYNTHETIC' ? 'SYNTHETIC • DEV' : 'REAL • ARGO',
        badgeClass: f.source_mode === 'SYNTHETIC' ? 'badge-synthetic' : 'badge-argo',
        name: `Argo ${f.wmo_id || f.id}`,
        wmoId: f.wmo_id || f.id,
        lat: f.lat,
        lon: f.lon,
        timestamp: f.timestamp || '2025-01-04T06:00:00Z',
        cycle: f.cycle_number || 1,
        depthRange: f.depths ? `0 – ${Math.max(...f.depths).toFixed(0)}m` : '0 – 2000m',
        qcStatus: f.qc_status || 'PASSED',
        raw: { ...f, platform_type: f.platform_type || 'argo' }
      });
    }

    // Gliders
    for (const g of gliderTransects) {
      const waypoints = g.waypoints || [];
      const firstPt = waypoints[0] || {};
      list.push({
        id: g.id || g.mission_name,
        type: 'glider',
        typeLabel: 'Underwater Glider',
        badge: g.source_mode === 'SYNTHETIC' ? 'SYNTHETIC • DEV' : 'REAL • GLIDER',
        badgeClass: g.source_mode === 'SYNTHETIC' ? 'badge-synthetic' : 'badge-glider',
        name: g.mission_name || g.id,
        wmoId: g.id,
        lat: g.lat || firstPt.lat || 12.0,
        lon: g.lon || firstPt.lon || 85.0,
        timestamp: g.start_time || '2025-01-04T00:00:00Z',
        cycle: waypoints.length ? `${waypoints.length} dives` : 'Sawtooth',
        depthRange: '0 – 1000m',
        qcStatus: 'PASSED',
        raw: { ...g, platform_type: g.platform_type || 'glider' }
      });
    }

    // Moored Buoys
    const activeBuoyList = buoyStations.length > 0 ? buoyStations : buoys;
    for (const b of activeBuoyList) {
      list.push({
        id: b.id,
        type: 'buoy',
        typeLabel: 'Moored Buoy',
        badge: b.provenance_badge || '[REAL • INCOIS]',
        badgeClass: 'badge-buoy',
        name: b.name || `INCOIS Buoy ${b.wmo_id || b.id}`,
        wmoId: b.wmo_id || b.id,
        lat: b.lat,
        lon: b.lon,
        timestamp: b.timestamp || '2025-01-04T00:00:00Z',
        cycle: b.air_temperature !== undefined && b.air_temperature !== null ? `${b.air_temperature}°C Air` : 'Stationary',
        depthRange: b.depths?.length ? `0 – ${Math.max(...b.depths).toFixed(0)}m` : (b.max_depth ? `0 – ${b.max_depth.toFixed(0)}m` : '0 – 500m'),
        qcStatus: b.qc_summary?.pass_rate_pct ? `${b.qc_summary.pass_rate_pct}%` : 'PASSED',
        raw: { ...b, platform_type: 'buoy' }
      });
    }

    return list;
  }, [argoFloats, gliderTransects, buoyStations, buoys]);

  const filteredPlatforms = useMemo(() => {
    return combinedPlatforms.filter((p) => {
      if (activeFilter === 'ARGO' && p.type !== 'argo') return false;
      if (activeFilter === 'GLIDER' && p.type !== 'glider') return false;
      if (activeFilter === 'BUOY' && p.type !== 'buoy') return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          p.name.toLowerCase().includes(q) ||
          p.wmoId.toLowerCase().includes(q) ||
          p.id.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [combinedPlatforms, activeFilter, searchQuery]);

  if (!isOpen) return null;

  return (
    <aside className="observation-drawer glassmorphic-panel" aria-label="In-Situ Observation Fleet Drawer" data-testid="observation-drawer">
      <div className="drawer-header flex items-center justify-between p-4 border-b border-slate-700/60">
        <div>
          <div className="flex items-center gap-2">
            <span className="platform-indicator-dot bg-sky-400" aria-hidden="true" />
            <h2 className="text-sm font-mono font-bold tracking-wider text-white uppercase">
              OBSERVATION FLEET
            </h2>
          </div>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Active autonomous ocean robots & in-situ platforms ({filteredPlatforms.length})
          </p>
        </div>
        <button
          type="button"
          className="icon-close-btn"
          onClick={onClose}
          aria-label="Close Observation Drawer"
        >
          &times;
        </button>
      </div>

      <div className="p-3 border-b border-slate-800/80 space-y-2">
        <input
          type="search"
          placeholder="Filter by WMO ID, platform or mission..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full text-xs px-3 py-1.5 rounded bg-slate-900/80 border border-slate-700/80 text-white placeholder-slate-500 focus:outline-none focus:border-sky-500"
        />

        <div className="flex items-center gap-1.5">
          {['ALL', 'ARGO', 'GLIDER', 'BUOY'].map((f) => {
            return (
              <button
                key={f}
                type="button"
                className={`filter-chip-btn ${activeFilter === f ? 'active' : ''}`}
                onClick={() => setActiveFilter(f)}
                data-testid={`filter-${f.toLowerCase()}`}
              >
                {f}
              </button>
            );
          })}
        </div>
      </div>

      <div className="drawer-content overflow-y-auto max-h-[calc(100vh-280px)] p-3 space-y-2.5">
        {filteredPlatforms.length === 0 ? (
          <div className="empty-state text-center py-8 text-xs text-slate-400">
            No observation platforms match the active filter.
          </div>
        ) : (
          filteredPlatforms.map((p) => {
            const isSelected = selectedPlatform?.id === p.id;
            return (
              <div
                key={p.id}
                className={`platform-item-card ${isSelected ? 'selected' : ''}`}
                onClick={() => onSelectPlatform && onSelectPlatform(p.raw)}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded font-bold uppercase ${p.badgeClass}`}>
                      {p.badge}
                    </span>
                    <h3 className="font-mono text-xs font-bold text-white mt-1">
                      {p.name}
                    </h3>
                  </div>
                  <span className="text-[10px] font-mono text-slate-400">
                    QC: {p.qcStatus}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-1 text-[11px] font-mono text-slate-300 mt-2 bg-slate-900/50 p-2 rounded">
                  <div>
                    <span className="text-slate-500">Lat/Lon:</span> {p.lat.toFixed(2)}°, {p.lon.toFixed(2)}°
                  </div>
                  <div>
                    <span className="text-slate-500">Depth:</span> {p.depthRange}
                  </div>
                  <div>
                    <span className="text-slate-500">Cycle:</span> {p.cycle}
                  </div>
                  <div>
                    <span className="text-slate-500">Time:</span> {p.timestamp.slice(0, 10)}
                  </div>
                </div>

                {((p.raw?.wind_speed_ms !== undefined && p.raw?.wind_speed_ms !== null) ||
                  (p.raw?.air_temperature !== undefined && p.raw?.air_temperature !== null) ||
                  (p.raw?.surface_pressure_hpa !== undefined && p.raw?.surface_pressure_hpa !== null) ||
                  (p.raw?.significant_wave_height_m !== undefined && p.raw?.significant_wave_height_m !== null)) && (
                  <div className="flex flex-wrap gap-1 mt-1.5 text-[10px] font-mono">
                    {p.raw?.air_temperature !== undefined && p.raw?.air_temperature !== null && (
                      <span className="px-1.5 py-0.5 rounded bg-sky-950/70 border border-sky-600/30 text-sky-300">
                        Air: {p.raw.air_temperature}°C
                      </span>
                    )}
                    {p.raw?.wind_speed_ms !== undefined && p.raw?.wind_speed_ms !== null && (
                      <span className="px-1.5 py-0.5 rounded bg-teal-950/70 border border-teal-600/30 text-teal-300">
                        Wind: {p.raw.wind_speed_ms} m/s
                      </span>
                    )}
                    {p.raw?.surface_pressure_hpa !== undefined && p.raw?.surface_pressure_hpa !== null && (
                      <span className="px-1.5 py-0.5 rounded bg-slate-800/80 border border-slate-700/50 text-slate-300">
                        {p.raw.surface_pressure_hpa} hPa
                      </span>
                    )}
                    {p.raw?.significant_wave_height_m !== undefined && p.raw?.significant_wave_height_m !== null && (
                      <span className="px-1.5 py-0.5 rounded bg-indigo-950/70 border border-indigo-600/30 text-indigo-300">
                        Wave: {p.raw.significant_wave_height_m}m
                      </span>
                    )}
                  </div>
                )}

                <div className="card-actions flex items-center gap-2 mt-2 pt-2 border-t border-slate-800/80">
                  <button
                    type="button"
                    className="action-btn-secondary text-[10px] py-1 px-2 flex-1"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenProfile && onOpenProfile(p.raw);
                    }}
                  >
                    OPEN PROFILE
                  </button>
                  <button
                    type="button"
                    className="action-btn-primary text-[10px] py-1 px-2 flex-1"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenComparison && onOpenComparison(p.raw);
                    }}
                  >
                    COMPARE MODEL
                  </button>
                  <button
                    type="button"
                    className="action-btn-secondary text-[10px] py-1 px-2"
                    title="Focus on Globe"
                    onClick={(e) => {
                      e.stopPropagation();
                      onFocusCoordinates && onFocusCoordinates(p.lat, p.lon);
                    }}
                  >
                    FOCUS
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}
