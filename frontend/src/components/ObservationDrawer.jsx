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

    return list;
  }, [argoFloats, gliderTransects]);

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
            const isBuoy = f === 'BUOY';
            return (
              <button
                key={f}
                type="button"
                className={`filter-chip-btn ${activeFilter === f ? 'active' : ''} ${isBuoy ? 'buoy-filter-btn' : ''}`}
                onClick={() => setActiveFilter(f)}
                title={isBuoy ? 'Moored Buoy telemetry (unsupported in active API contract)' : undefined}
                data-testid={`filter-${f.toLowerCase()}`}
              >
                {f}
                {isBuoy && <span className="ml-1 text-[9px] text-amber-400/90 font-normal">(UNSUPPORTED)</span>}
              </button>
            );
          })}
        </div>
      </div>

      <div className="drawer-content overflow-y-auto max-h-[calc(100vh-280px)] p-3 space-y-2.5">
        {activeFilter === 'BUOY' ? (
          <div className="unsupported-buoy-notice p-4 my-2 bg-amber-950/40 border border-amber-600/50 rounded text-center">
            <span className="text-xl mb-1 block" aria-hidden="true">⚓</span>
            <h4 className="font-mono text-xs font-bold text-amber-300 uppercase tracking-wide">
              Moored Buoy Telemetry Unsupported
            </h4>
            <p className="text-[11px] text-slate-300 mt-2 leading-relaxed">
              No moored buoy list, detail, or vertical profile contract exists in the active in-situ API service.
              Autonomous fleet monitoring is currently operational for Argo floats and underwater gliders.
            </p>
            <button
              type="button"
              className="action-btn-secondary text-[11px] mt-3 px-3 py-1 bg-slate-800 hover:bg-slate-700 text-sky-300"
              onClick={() => setActiveFilter('ALL')}
            >
              Reset Filter to All Platforms
            </button>
          </div>
        ) : filteredPlatforms.length === 0 ? (
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
