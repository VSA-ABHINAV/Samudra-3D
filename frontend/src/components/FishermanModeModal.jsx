import React, { useState, useEffect } from 'react';
import { fetchThermalFronts } from '../services/api';
import { isFiniteNumber, extractResolutionLabel } from '../utils/scientificPresentation.js';

const FISHING_HARBORS = [
  { id: 'veraval', name: 'Veraval Fishing Harbor', state: 'Gujarat', lat: 20.90, lon: 70.37, depth_m: 14 },
  { id: 'kochi', name: 'Kochi Bight & Harbor', state: 'Kerala', lat: 9.96, lon: 76.24, depth_m: 18 },
  { id: 'wadge', name: 'Wadge Bank Fishery Grounds', state: 'Tamil Nadu / Kerala', lat: 7.80, lon: 77.30, depth_m: 35 },
  { id: 'chennai', name: 'Chennai Kasimedu Harbor', state: 'Tamil Nadu', lat: 13.12, lon: 80.30, depth_m: 12 },
  { id: 'vizag', name: 'Visakhapatnam Fishing Harbor', state: 'Andhra Pradesh', lat: 17.69, lon: 83.30, depth_m: 16 },
  { id: 'paradip', name: 'Paradip Port & Fishery Base', state: 'Odisha', lat: 20.26, lon: 86.67, depth_m: 15 }
];

export default function FishermanModeModal({
  isOpen,
  onClose,
  onSelectHarbor,
  probeData,
  timeIndex = 0,
  activeDataset = null,
  coverageBounds = null,
  isTransitioningDataset = false,
  isDatasetReady = true
}) {
  const [selectedHarbor, setSelectedHarbor] = useState(FISHING_HARBORS[0]);
  const [activeTab, setActiveTab] = useState('harbors'); // 'harbors' | 'fronts'
  const [thermalFronts, setThermalFronts] = useState([]);
  const [loadingFronts, setLoadingFronts] = useState(false);
  const [errorFronts, setErrorFronts] = useState(null);
  const [frontsBadge, setFrontsBadge] = useState('[REAL • COPERNICUS]');
  const frontsRequestIdRef = React.useRef(0);

  const bounds = coverageBounds || activeDataset?.coverage_bounds || null;

  const loadFronts = React.useCallback(async () => {
    if (isTransitioningDataset || !isDatasetReady) {
      setThermalFronts([]);
      setErrorFronts('Thermal front advisory unavailable while dataset is syncing or unready.');
      setLoadingFronts(false);
      return;
    }
    if (!bounds || !activeDataset) {
      setThermalFronts([]);
      setErrorFronts('Active dataset coverage bounds unavailable.');
      setLoadingFronts(false);
      return;
    }
    const reqId = ++frontsRequestIdRef.current;
    setLoadingFronts(true);
    setErrorFronts(null);
    try {
      const data = await fetchThermalFronts({
        lat_min: bounds.lat_min,
        lat_max: bounds.lat_max,
        lon_min: bounds.lon_min,
        lon_max: bounds.lon_max,
        time_idx: timeIndex
      });
      if (frontsRequestIdRef.current === reqId) {
        setThermalFronts(data.fronts || []);
        if (data.provenance_badge) setFrontsBadge(data.provenance_badge);
        setLoadingFronts(false);
      }
    } catch (err) {
      if (frontsRequestIdRef.current === reqId) {
        setErrorFronts(err.message || 'Failed to fetch thermal fronts');
        setThermalFronts([]);
        setLoadingFronts(false);
      }
    }
  }, [timeIndex, activeDataset, bounds, isTransitioningDataset, isDatasetReady]);

  useEffect(() => {
    if (isOpen && activeTab === 'fronts') {
      loadFronts();
    }
    return () => {
      frontsRequestIdRef.current = frontsRequestIdRef.current + 1;
    };
  }, [isOpen, activeTab, loadFronts]);

  const handleClose = () => {
    frontsRequestIdRef.current++;
    if (onClose) onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 overflow-y-auto" data-testid="fisherman-mode-modal">
      <div className="relative w-full max-w-3xl bg-slate-900 border border-slate-700 rounded-xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden text-slate-100">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/60">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
              <span className="text-xl">🐟</span>
            </div>
            <div>
              <h2 className="text-lg font-bold text-white tracking-wide flex items-center gap-2">
                Fisherman Operational Intelligence & Model PFZ Proxies
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950 border border-emerald-800 text-emerald-300">Model-Derived Heuristics</span>
              </h2>
              <p className="text-xs text-slate-400">Thermal front gradients, coastal upwelling, and nearest fishing landing centers.</p>
            </div>
          </div>
          <button onClick={handleClose} aria-label="Close modal" data-testid="fisherman-modal-close-btn" className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>

        {/* Tab Selector */}
        <div className="flex border-b border-slate-800 bg-slate-950/40 px-6 pt-2 gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('harbors')}
            className={`px-4 py-2 text-xs font-semibold rounded-t-lg transition border-b-2 flex items-center gap-2 ${
              activeTab === 'harbors'
                ? 'border-emerald-500 text-emerald-400 bg-slate-900/90'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <span>⚓ Major Fishing Harbors ({FISHING_HARBORS.length})</span>
          </button>
          <button
            type="button"
            onClick={() => { setActiveTab('fronts'); loadFronts(); }}
            className={`px-4 py-2 text-xs font-semibold rounded-t-lg transition border-b-2 flex items-center gap-2 ${
              activeTab === 'fronts'
                ? 'border-emerald-500 text-emerald-400 bg-slate-900/90'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <span>🌊 Active Model Thermal Fronts (|∇T| ≥ 0.02°C/km)</span>
            <span className="text-[10px] font-mono px-1.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800">
              {thermalFronts.length > 0 ? thermalFronts.length : 'Model'}
            </span>
          </button>
        </div>

        {/* Safety & Scientific Basis Notice */}
        <div className="mx-6 mt-4 p-3 bg-amber-950/50 border border-amber-800/60 rounded-lg text-amber-200 text-xs flex items-start gap-2.5">
          <svg className="w-4 h-4 shrink-0 text-amber-400 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
          <div className="leading-relaxed">
            <div><strong className="font-semibold text-white">Navigational & Resolution Notice:</strong> Numerical model resolution is {extractResolutionLabel(activeDataset)}. Coastal navigation inside harbors and near-shore shoals requires official nautical charts, port radar, and local INCOIS broadcast advisories.</div>
            <div className="mt-1 text-slate-300"><strong className="text-emerald-300">Scientific Basis:</strong> PFZ indicators shown here are physical proxies computed from active model horizontal temperature gradients (|∇T| ≥ 0.015°C/km) and mixed layer upwelling. These are physical model proxies and not official MoES/INCOIS bulletins; no fish biomass or catch quantities are fabricated.</div>
          </div>
        </div>

        {/* Body Content */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1 text-xs">
          
          {/* Active Sector / Probed Conditions */}
          {probeData && (
            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
              <h3 className="font-semibold text-slate-200 uppercase tracking-wider text-[11px] flex items-center justify-between">
                <span>Currently Probed Water Column (At {probeData.lat}°N, {probeData.lon}°E)</span>
                <span className="text-sky-400 font-mono">Depth: 0m to {probeData.depths ? probeData.depths[probeData.depths.length - 1] : 92}m</span>
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center pt-1">
                <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                  <div className="text-[10px] text-slate-400">Sea Surface Temp</div>
                  <div className="text-base font-bold text-sky-400">{isFiniteNumber(probeData.sst) ? `${probeData.sst.toFixed(1)}°C` : 'Unavailable'}</div>
                </div>
                <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                  <div className="text-[10px] text-slate-400">Mixed Layer (MLD)</div>
                  <div className="text-base font-bold text-emerald-400">{isFiniteNumber(probeData.mld) ? `${probeData.mld.toFixed(1)} m` : 'Unavailable'}</div>
                  <div className="text-[9px] text-slate-400">Upwelling boundary</div>
                </div>
                <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                  <div className="text-[10px] text-slate-400">Surface Current Speed</div>
                  <div className="text-base font-bold text-amber-400">{isFiniteNumber(probeData.surface_current_speed) ? `${probeData.surface_current_speed.toFixed(2)} m/s` : 'Unavailable'}</div>
                  <div className="text-[9px] text-slate-400">Drift velocity</div>
                </div>
                <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                  <div className="text-[10px] text-slate-400">Thermocline (D20)</div>
                  <div className="text-base font-bold text-purple-400">{isFiniteNumber(probeData.d20) ? `${probeData.d20.toFixed(1)} m` : 'Unavailable'}</div>
                  <div className="text-[9px] text-slate-400">Nutrient barrier</div>
                </div>
              </div>
            </div>
          )}

          {/* Tab 1: Major Indian Fishing Harbors & PFZ Sectors */}
          {activeTab === 'harbors' && (
            <div className="space-y-3">
              <h3 className="font-semibold text-slate-300 uppercase tracking-wider text-[11px]">
                Major Coastal Fishing Harbors & Reference Centers
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {FISHING_HARBORS.map((h) => {
                  const isSelected = selectedHarbor.id === h.id;
                  return (
                    <div
                      key={h.id}
                      onClick={() => setSelectedHarbor(h)}
                      className={`p-3.5 rounded-xl border transition cursor-pointer flex flex-col justify-between ${
                        isSelected
                          ? 'bg-slate-800/90 border-emerald-500 ring-1 ring-emerald-500/50'
                          : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-white text-sm">{h.name}</span>
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                            Reference Harbor
                          </span>
                        </div>
                        <div className="text-slate-400 text-[11px]">
                          {h.state} • Coordinates: <span className="font-mono text-slate-300">{h.lat}°N, {h.lon}°E</span>
                        </div>
                        <div className="text-[11px] text-slate-400 pt-1">
                          Conditions: <span className="text-slate-300 italic">Unavailable (Reference location · use probe to inspect)</span>
                        </div>
                      </div>

                      <div className="mt-3 pt-2 border-t border-slate-800/60 flex items-center justify-between">
                        <span className="text-[10px] text-slate-400">Harbor Depth: ~{h.depth_m}m</span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (onSelectHarbor) onSelectHarbor(h);
                            onClose();
                          }}
                          className="px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-[11px] transition"
                        >
                          Focus Sector & Probe
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Tab 2: Detected Thermal Fronts */}
          {activeTab === 'fronts' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-slate-300 uppercase tracking-wider text-[11px] flex items-center gap-2">
                    <span>High-Resolution Thermal Front Gradient Vectors (|∇T|)</span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800">
                      {frontsBadge}
                    </span>
                  </h3>
                  <p className="text-[11px] text-slate-400">Derived from horizontal temperature tensor derivatives (∂T/∂x, ∂T/∂y) across active model grid.</p>
                </div>
                <button
                  type="button"
                  onClick={loadFronts}
                  disabled={loadingFronts}
                  className="px-2.5 py-1 text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-200 rounded border border-slate-700"
                >
                  {loadingFronts ? 'Evaluating...' : '↻ Recalculate'}
                </button>
              </div>

              {errorFronts && (
                <div className="p-3 rounded-lg bg-rose-950/60 border border-rose-800 text-rose-200">
                  {errorFronts}
                </div>
              )}

              {loadingFronts ? (
                <div className="p-8 text-center text-slate-400">Evaluating 2D spatial temperature gradient field across Indian Ocean domain...</div>
              ) : thermalFronts.length === 0 ? (
                <div className="p-8 text-center text-slate-400 bg-slate-950/60 rounded-xl border border-slate-800">
                  {errorFronts ? 'Thermal front evaluation failed.' : 'No thermal fronts detected above gradient threshold for active domain.'}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-80 overflow-y-auto pr-1">
                  {thermalFronts.slice(0, 30).map((f, i) => (
                    <div key={i} className="p-2.5 rounded-lg bg-slate-950/80 border border-slate-800 flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-1.5 font-mono text-slate-200">
                          <strong>{f.lat}°N, {f.lon}°E</strong>
                          <span className={`text-[9px] px-1.5 py-0.2 rounded font-bold ${
                            f.front_intensity === 'HIGH' ? 'bg-rose-950 text-rose-300 border border-rose-800' : 'bg-amber-950 text-amber-300 border border-amber-800'
                          }`}>
                            {f.front_intensity}
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-400 mt-0.5">
                          Gradient: <strong className="text-amber-300 font-mono">{f.gradient_deg_c_per_km} °C/km</strong> • SST: {f.sst_celsius}°C
                        </div>
                        <div className="text-[10px] text-emerald-400 mt-0.5">
                          PFZ Heuristic Score: <strong>{(f.pfz_probability * 100).toFixed(0)}%</strong>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          if (onSelectHarbor) onSelectHarbor({ lat: f.lat, lon: f.lon, name: `Thermal Front (${f.lat}°N, ${f.lon}°E)` });
                          onClose();
                        }}
                        className="px-2.5 py-1 bg-sky-700 hover:bg-sky-600 text-white rounded text-[10px] font-semibold transition shrink-0 ml-2"
                      >
                        Probe
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Advisory Guidelines */}
          <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 space-y-2">
            <h4 className="font-semibold text-slate-200 text-xs">How SAMUDRA-3D Identifies Potential Fishing Zones (PFZ):</h4>
            <ul className="list-disc list-inside space-y-1 text-slate-400 text-[11px] leading-relaxed">
              <li><strong className="text-slate-300">Thermal Fronts (|∇T| ≥ 0.02°C/km):</strong> Boundaries between warm coastal waters and colder offshore upwelling concentrate phytoplankton, attracting pelagic shoals (sardines, mackerel, tuna).</li>
              <li><strong className="text-slate-300">Shallow Mixed Layer Depth (MLD &lt; 20m):</strong> Indicates strong vertical upwelling pumping nitrate and phosphate nutrients to the euphotic zone.</li>
              <li><strong className="text-slate-300">Current Divergence Zones:</strong> Current velocity shears create nutrient traps and eddies identifiable on our 3D vector slice.</li>
            </ul>
          </div>

        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-slate-800 bg-slate-950/80 text-xs text-slate-400">
          <span>Operational Context: SAMUDRA-3D Model-Derived Heuristics · Not an official MoES/INCOIS broadcast</span>
          <button onClick={onClose} className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition font-medium">
            Close
          </button>
        </div>

      </div>
    </div>
  );
}
