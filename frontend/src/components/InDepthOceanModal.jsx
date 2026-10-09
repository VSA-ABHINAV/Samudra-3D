import React, { useState, useEffect } from 'react';
import { fetchInDepthOceanAnalysis } from '../services/api';

const SOUNDING_PRESETS = [
  { name: 'Bay of Bengal Deep Basin', lat: 15.0, lon: 85.0, desc: 'Central BoB - Strong River Stratification' },
  { name: 'Northern Arabian Sea', lat: 19.5, lon: 66.0, desc: 'High Salinity & Evaporation Zone' },
  { name: 'Wadge Bank Fishery Shelf', lat: 7.8, lon: 77.3, desc: 'Southern India - Upwelling & High Biology' },
  { name: 'Andaman Sea Basin', lat: 11.5, lon: 93.0, desc: 'Marginal Basin with Internal Waves' },
  { name: 'Equatorial Jet Current', lat: 0.0, lon: 80.5, desc: 'Wyrtki Jet - High Momentum Advection' }
];

export default function InDepthOceanModal({
  isOpen,
  onClose,
  initialCoords,
  currentActiveDatasetId = null,
  timeIndex = 0,
  isTransitioningDataset = false,
  isDatasetReady = true
}) {
  const [coords, setCoords] = useState(initialCoords || { lat: 15.0, lon: 85.0 });
  const [activeTab, setActiveTab] = useState('acoustics'); // 'acoustics' | 'stratification' | 'water_masses' | 'heatwave' | 'hierarchy'
  const [analysisData, setAnalysisData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const analysisRequestIdRef = React.useRef(0);

  // Sync coords when initialCoords changes upon opening
  useEffect(() => {
    if (isOpen && initialCoords) {
      setCoords((prev) => {
        if (prev.lat !== initialCoords.lat || prev.lon !== initialCoords.lon) {
          return initialCoords;
        }
        return prev;
      });
    }
  }, [isOpen, initialCoords]);

  // Run analysis when coords, timeIndex, or activeDataset changes
  useEffect(() => {
    if (!isOpen) return;

    if (isTransitioningDataset || !isDatasetReady) {
      setLoading(false);
      setError('Ocean physics analysis unavailable while dataset is syncing or unready.');
      setAnalysisData(null);
      return;
    }

    const reqId = ++analysisRequestIdRef.current;
    setLoading(true);
    setError(null);

    fetchInDepthOceanAnalysis({
      lat: coords.lat,
      lon: coords.lon,
      time_idx: timeIndex
    })
      .then((data) => {
        if (analysisRequestIdRef.current === reqId) {
          setAnalysisData(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (analysisRequestIdRef.current === reqId) {
          setError(err.message || 'Failed to evaluate in-depth ocean analysis');
          setLoading(false);
        }
      });

    return () => {
      // Invalidate pending request on unmount or dependency change
      analysisRequestIdRef.current = reqId + 1;
    };
  }, [isOpen, coords.lat, coords.lon, timeIndex, currentActiveDatasetId, isTransitioningDataset, isDatasetReady]);

  const handleSelectPreset = (preset) => {
    setCoords({ lat: preset.lat, lon: preset.lon });
  };

  const handleClose = () => {
    analysisRequestIdRef.current++;
    if (onClose) onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 overflow-y-auto" data-testid="in-depth-ocean-modal">
      <div className="relative w-full max-w-5xl bg-slate-900 border border-slate-700 rounded-xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden text-slate-100">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/70">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-indigo-500/10 border border-indigo-500/30 text-indigo-400">
              <span className="text-xl">🌊</span>
            </div>
            <div>
              <h2 data-testid="indepth-modal-title" className="text-lg font-bold text-white tracking-wide flex items-center gap-2">
                In-Depth Ocean Physics & Acoustic Stratification
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-950 border border-indigo-800 text-indigo-300">
                  EOS-80 • Mackenzie 1981 • N² Stability
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Multi-depth physical analysis: Sound velocity profiles (SVP), SOFAR channel waveguide, density stratification, and water mass fingerprinting.
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            aria-label="Close modal"
            data-testid="indepth-modal-close-btn"
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
            title="Close modal (Esc)"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>

        {/* Station Presets & Custom Coordinates Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3 bg-slate-950/50 border-b border-slate-800 text-xs">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-slate-400 font-semibold mr-1">Deep Sounding Stations:</span>
            {SOUNDING_PRESETS.map((p) => (
              <button
                key={p.name}
                type="button"
                onClick={() => handleSelectPreset(p)}
                className={`px-2.5 py-1 rounded text-[11px] font-medium transition border ${
                  coords.lat === p.lat && coords.lon === p.lon
                    ? 'bg-indigo-600 text-white border-indigo-400'
                    : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
                }`}
              >
                📍 {p.name}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 font-mono text-slate-300">
            <span>Location:</span>
            <strong className="text-indigo-400">{coords.lat.toFixed(2)}°N, {coords.lon.toFixed(2)}°E</strong>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-slate-800 bg-slate-950/40 px-6 pt-2 gap-2 overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveTab('acoustics')}
            className={`px-4 py-2.5 text-xs font-semibold rounded-t-lg transition border-b-2 flex items-center gap-2 whitespace-nowrap ${
              activeTab === 'acoustics'
                ? 'border-indigo-500 text-indigo-400 bg-slate-900/90'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <span>🔊 Acoustics & SOFAR Axis</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('stratification')}
            className={`px-4 py-2.5 text-xs font-semibold rounded-t-lg transition border-b-2 flex items-center gap-2 whitespace-nowrap ${
              activeTab === 'stratification'
                ? 'border-indigo-500 text-indigo-400 bg-slate-900/90'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <span>⚖️ Density & Buoyancy (N²)</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('water_masses')}
            className={`px-4 py-2.5 text-xs font-semibold rounded-t-lg transition border-b-2 flex items-center gap-2 whitespace-nowrap ${
              activeTab === 'water_masses'
                ? 'border-indigo-500 text-indigo-400 bg-slate-900/90'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <span>🧪 Water Mass Classification</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('heatwave')}
            className={`px-4 py-2.5 text-xs font-semibold rounded-t-lg transition border-b-2 flex items-center gap-2 whitespace-nowrap ${
              activeTab === 'heatwave'
                ? 'border-indigo-500 text-indigo-400 bg-slate-900/90'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <span>🌡️ Marine Heatwave Penetration</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('hierarchy')}
            className={`px-4 py-2.5 text-xs font-semibold rounded-t-lg transition border-b-2 flex items-center gap-2 whitespace-nowrap ${
              activeTab === 'hierarchy'
                ? 'border-indigo-500 text-indigo-400 bg-slate-900/90'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <span>🔍 Multi-Scale Precision Zoom</span>
            <span className="text-[10px] font-mono px-1.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-800">4 Tiers</span>
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-5 text-xs">
          {error && (
            <div className="p-3 rounded-lg bg-rose-950/60 border border-rose-800 text-rose-200">
              {error}
            </div>
          )}

          {loading ? (
            <div className="p-16 text-center text-slate-400 flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-3 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
              <span>Computing full ocean physical column (EOS-80, sound speed, buoyancy frequency, water mass fingerprint)...</span>
            </div>
          ) : analysisData ? (
            <>
              {/* Tab 1: Acoustics & SOFAR */}
              {activeTab === 'acoustics' && (
                <div className="space-y-4">
                  <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="font-bold text-sm text-white flex items-center gap-2">
                        <span>Mackenzie (1981) Sound Velocity Profile & Underwater Acoustic Ducting</span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-800">
                          {analysisData.acoustics?.acoustic_duct_type || 'Unavailable'}
                        </span>
                      </h3>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center pt-1">
                      <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                        <div className="text-[10px] text-slate-400">Surface Sound Velocity</div>
                        <div className="text-base font-bold text-amber-400 font-mono">
                          {analysisData.acoustics?.surface_sound_speed_mps !== null && analysisData.acoustics?.surface_sound_speed_mps !== undefined
                            ? `${analysisData.acoustics.surface_sound_speed_mps} m/s`
                            : 'Unavailable'}
                        </div>
                        <div className="text-[9px] text-slate-500">Surface duct speed</div>
                      </div>
                      <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                        <div className="text-[10px] text-slate-400">SOFAR Channel Axis Depth</div>
                        <div className="text-base font-bold text-cyan-400 font-mono">
                          {analysisData.acoustics?.sofar_channel_axis_depth_m !== null && analysisData.acoustics?.sofar_channel_axis_depth_m !== undefined
                            ? `${analysisData.acoustics.sofar_channel_axis_depth_m} m`
                            : 'Unavailable'}
                        </div>
                        <div className="text-[9px] text-slate-500">Acoustic waveguide minimum</div>
                      </div>
                      <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                        <div className="text-[10px] text-slate-400">Minimum Sound Speed</div>
                        <div className="text-base font-bold text-emerald-400 font-mono">
                          {analysisData.acoustics?.sofar_minimum_sound_speed_mps !== null && analysisData.acoustics?.sofar_minimum_sound_speed_mps !== undefined
                            ? `${analysisData.acoustics.sofar_minimum_sound_speed_mps} m/s`
                            : 'Unavailable'}
                        </div>
                        <div className="text-[9px] text-slate-500">Refraction axis velocity</div>
                      </div>
                      <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                        <div className="text-[10px] text-slate-400">Velocity Gradient (dc/dz)</div>
                        <div className="text-base font-bold text-purple-400 font-mono">
                          {analysisData.acoustics?.sound_speed_gradient_mps_per_100m !== null && analysisData.acoustics?.sound_speed_gradient_mps_per_100m !== undefined
                            ? `${analysisData.acoustics.sound_speed_gradient_mps_per_100m} m/s / 100m`
                            : 'Unavailable'}
                        </div>
                        <div className="text-[9px] text-slate-500">Refractive bending power</div>
                      </div>
                    </div>
                  </div>

                  {analysisData.acoustics?.explanation && (
                    <div className="p-3 rounded-lg bg-amber-950/40 border border-amber-800 text-amber-200 text-xs flex items-center gap-2">
                      <span>⚠️</span>
                      <span>{analysisData.acoustics.explanation}</span>
                    </div>
                  )}

                  {/* Scientific Explanation Box */}
                  <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 space-y-2 leading-relaxed text-slate-300">
                    <h4 className="font-bold text-xs text-white">Why SOFAR Channel Sounding Matters:</h4>
                    <p>
                      In tropical oceans, sound speed decreases rapidly from the warm sea surface through the thermocline due to falling temperature (+4.59 m/s per °C drop). Below the thermocline, increasing hydrostatic pressure (+1.63 m/s per 100m depth) reverses the gradient, creating a <strong>sound speed minimum</strong> at the SOFAR Channel Axis (~{analysisData.acoustics?.sofar_channel_axis_depth_m !== null && analysisData.acoustics?.sofar_channel_axis_depth_m !== undefined ? `${analysisData.acoustics.sofar_channel_axis_depth_m}m` : 'Unavailable'}).
                    </p>
                    <p className="text-[11px] text-slate-400">
                      Sound waves entering this channel cannot escape: they continuously refract back toward the axis through Snell's Law, allowing low-frequency sonar, submarine acoustic pulses, and baleen whale communication to propagate thousands of kilometers across the Indian Ocean basin with minimal attenuation.
                    </p>
                  </div>
                </div>
              )}

              {/* Tab 2: Stratification & Buoyancy */}
              {activeTab === 'stratification' && (
                <div className="space-y-4">
                  <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="font-bold text-sm text-white flex items-center gap-2">
                        <span>UNESCO EOS-80 Potential Density & Brunt-Väisälä Frequency (N²)</span>
                        <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
                          analysisData.stratification?.stability_status === 'UNAVAILABLE'
                            ? 'bg-slate-800 text-slate-300 border-slate-700'
                            : analysisData.stratification?.stability_status === 'CONVECTIVELY_UNSTABLE'
                            ? 'bg-rose-950 text-rose-300 border-rose-800'
                            : 'bg-emerald-950 text-emerald-300 border-emerald-800'
                        }`}>
                          {analysisData.stratification?.stability_status || 'UNAVAILABLE'}
                        </span>
                      </h3>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center pt-1">
                      <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                        <div className="text-[10px] text-slate-400">Surface Density (σθ)</div>
                        <div className="text-base font-bold text-sky-400 font-mono">
                          {analysisData.stratification?.surface_density_sigma !== null && analysisData.stratification?.surface_density_sigma !== undefined
                            ? `${analysisData.stratification.surface_density_sigma} kg/m³`
                            : 'Unavailable'}
                        </div>
                      </div>
                      <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                        <div className="text-[10px] text-slate-400">Pycnocline Core Depth</div>
                        <div className="text-base font-bold text-emerald-400 font-mono">
                          {analysisData.stratification?.pycnocline_depth_m !== null && analysisData.stratification?.pycnocline_depth_m !== undefined
                            ? `${analysisData.stratification.pycnocline_depth_m} m`
                            : 'Unavailable'}
                        </div>
                        <div className="text-[9px] text-slate-500">Max density gradient</div>
                      </div>
                      <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                        <div className="text-[10px] text-slate-400">Max Density Gradient</div>
                        <div className="text-base font-bold text-amber-400 font-mono">
                          {analysisData.stratification?.maximum_density_gradient_kg_m4 !== null && analysisData.stratification?.maximum_density_gradient_kg_m4 !== undefined
                            ? `${analysisData.stratification.maximum_density_gradient_kg_m4} kg/m⁴`
                            : 'Unavailable'}
                        </div>
                        <div className="text-[9px] text-slate-500">Stratification barrier</div>
                      </div>
                      <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                        <div className="text-[10px] text-slate-400">Deep Density (σθ)</div>
                        <div className="text-base font-bold text-indigo-400 font-mono">
                          {analysisData.stratification?.bottom_density_sigma !== null && analysisData.stratification?.bottom_density_sigma !== undefined
                            ? `${analysisData.stratification.bottom_density_sigma} kg/m³`
                            : 'Unavailable'}
                        </div>
                      </div>
                    </div>
                  </div>

                  {analysisData.stratification?.explanation && (
                    <div className="p-3 rounded-lg bg-amber-950/40 border border-amber-800 text-amber-200 text-xs flex items-center gap-2">
                      <span>⚠️</span>
                      <span>{analysisData.stratification.explanation}</span>
                    </div>
                  )}

                  <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 space-y-2 text-slate-300">
                    <h4 className="font-bold text-xs text-white">Dynamic Stratification & Internal Gravity Waves:</h4>
                    <p>
                      The Brunt-Väisälä buoyancy frequency squared (N² = (g / ρ₀) · (dσ/dz)) measures the restoring force acting on a displaced water parcel. A strong pycnocline barrier at <strong>{analysisData.stratification?.pycnocline_depth_m !== null && analysisData.stratification?.pycnocline_depth_m !== undefined ? `${analysisData.stratification.pycnocline_depth_m}m` : 'unavailable depth'}</strong> prevents vertical turbulence, trapping river runoff and heat in the mixed layer and acting as the propagation waveguide for large internal solitary waves common in the Andaman Sea.
                    </p>
                  </div>
                </div>
              )}

              {/* Tab 3: Water Masses */}
              {activeTab === 'water_masses' && (
                <div className="space-y-4">
                  {analysisData.water_masses?.dominant_water_mass ? (
                    <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="text-[10px] text-slate-400 uppercase tracking-wider font-mono">Dominant Water Mass Identified</span>
                          <h3 className="font-bold text-base text-white mt-0.5 flex items-center gap-2">
                            <span className="w-3 h-3 rounded-full" style={{ backgroundColor: analysisData.water_masses.dominant_water_mass.color }}></span>
                            {analysisData.water_masses.dominant_water_mass.name} ({analysisData.water_masses.dominant_water_mass.code})
                          </h3>
                          <p className="text-xs text-slate-300 mt-1">{analysisData.water_masses.dominant_water_mass.description}</p>
                        </div>
                        <span className="text-xs font-mono px-2.5 py-1 rounded bg-slate-800 text-slate-300 border border-slate-700 shrink-0">
                          Origin: {analysisData.water_masses.dominant_water_mass.origin}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
                      <span className="text-[10px] text-slate-400 uppercase tracking-wider font-mono">Dominant Water Mass Identified</span>
                      <h3 className="font-bold text-base text-slate-300 mt-0.5">No Dominant Water Mass Identified</h3>
                      <p className="text-xs text-slate-400">
                        {analysisData.water_masses?.explanation || 'Insufficient valid temperature/salinity measurements to classify water masses.'}
                      </p>
                    </div>
                  )}

                  {/* Vertical Water Column Stack */}
                  <div className="space-y-2">
                    <h4 className="font-bold text-xs text-slate-300 uppercase tracking-wider">Vertical Water Column Stratification:</h4>
                    <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                      {analysisData.water_masses?.vertical_profile?.map((lvl, idx) => (
                        <div
                          key={idx}
                          className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-between"
                        >
                          <div className="flex items-center gap-3">
                            <span className="font-mono text-cyan-400 font-bold w-12 text-right">{lvl.depth.toFixed(1)}m</span>
                            <span
                              className="w-2.5 h-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: lvl.water_mass ? lvl.water_mass.color : '#64748b' }}
                              title={lvl.water_mass ? lvl.water_mass.name : 'Unclassified'}
                            ></span>
                            <span className={lvl.water_mass ? 'font-semibold text-slate-200' : 'font-semibold text-slate-400'}>
                              {lvl.water_mass ? lvl.water_mass.name : 'Unclassified (missing T/S)'}
                            </span>
                          </div>
                          <div className="font-mono text-slate-400 flex items-center gap-4 text-[11px]">
                            <span>T: <strong className="text-amber-300">{lvl.temperature !== null && lvl.temperature !== undefined ? `${lvl.temperature}°C` : 'Unavailable'}</strong></span>
                            <span>S: <strong className="text-cyan-300">{lvl.salinity !== null && lvl.salinity !== undefined ? `${lvl.salinity} PSU` : 'Unavailable'}</strong></span>
                            <span>c: <strong className="text-emerald-300">{lvl.sound_speed !== null && lvl.sound_speed !== undefined ? `${lvl.sound_speed} m/s` : 'Unavailable'}</strong></span>
                            <span>σθ: <strong className="text-purple-300">{lvl.density_sigma !== null && lvl.density_sigma !== undefined ? lvl.density_sigma : 'Unavailable'}</strong></span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Tab 4: Marine Heatwave */}
              {activeTab === 'heatwave' && (
                <div className="space-y-4">
                  <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="font-bold text-sm text-white">Hobday et al. (2016) Marine Heatwave (MHW) Subsurface Penetration</h3>
                      <span className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold border ${
                        analysisData.marine_heatwave?.status === 'UNAVAILABLE'
                          ? 'bg-slate-800 text-slate-300 border-slate-700'
                          : analysisData.marine_heatwave?.status?.includes('EXTREME') || analysisData.marine_heatwave?.status?.includes('SEVERE')
                          ? 'bg-rose-950 text-rose-300 border-rose-700'
                          : analysisData.marine_heatwave?.status?.includes('STRONG') || analysisData.marine_heatwave?.status?.includes('MODERATE')
                          ? 'bg-amber-950 text-amber-300 border-amber-700'
                          : 'bg-emerald-950 text-emerald-300 border-emerald-800'
                      }`}>
                        {analysisData.marine_heatwave?.status || 'UNAVAILABLE'}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-center pt-1">
                      <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                        <div className="text-[10px] text-slate-400">Surface Thermal Anomaly</div>
                        <div className="text-base font-bold text-amber-400 font-mono">
                          {analysisData.marine_heatwave?.surface_anomaly_celsius !== null && analysisData.marine_heatwave?.surface_anomaly_celsius !== undefined
                            ? `+${analysisData.marine_heatwave.surface_anomaly_celsius}°C`
                            : 'Unavailable'}
                        </div>
                        <div className="text-[9px] text-slate-500">Above seasonal climatology</div>
                      </div>
                      <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                        <div className="text-[10px] text-slate-400">Subsurface Penetration Depth</div>
                        <div className="text-base font-bold text-rose-400 font-mono">
                          {analysisData.marine_heatwave?.subsurface_penetration_depth_m !== null && analysisData.marine_heatwave?.subsurface_penetration_depth_m !== undefined
                            ? `${analysisData.marine_heatwave.subsurface_penetration_depth_m} m`
                            : 'Unavailable'}
                        </div>
                        <div className="text-[9px] text-slate-500">Thermal stress depth horizon</div>
                      </div>
                      <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                        <div className="text-[10px] text-slate-400">Cyclone Heat Potential (TCHP)</div>
                        <div className="text-base font-bold text-sky-400 font-mono">
                          {analysisData.tchp !== null && analysisData.tchp !== undefined ? `${analysisData.tchp} kJ/cm²` : 'Unavailable'}
                        </div>
                        <div className="text-[9px] text-slate-500">{analysisData.tchp_category || 'Upper ocean heat'}</div>
                      </div>
                    </div>
                  </div>

                  {analysisData.marine_heatwave?.explanation && (
                    <div className="p-3 rounded-lg bg-amber-950/40 border border-amber-800 text-amber-200 text-xs flex items-center gap-2">
                      <span>⚠️</span>
                      <span>{analysisData.marine_heatwave.explanation}</span>
                    </div>
                  )}

                  <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 text-slate-300 space-y-2">
                    <h4 className="font-bold text-xs text-white">Ecological Significance of Depth Penetration:</h4>
                    <p>
                      Surface satellites only observe the skin layer (~1mm). In-depth profiling reveals whether thermal anomalies penetrate deep into the euphotic zone ({analysisData.marine_heatwave?.subsurface_penetration_depth_m !== null && analysisData.marine_heatwave?.subsurface_penetration_depth_m !== undefined ? `${analysisData.marine_heatwave.subsurface_penetration_depth_m}m` : 'depth horizon unavailable'}). Deep-penetrating heatwaves deplete dissolved oxygen and trigger severe coral reef bleaching across Lakshadweep and the Andaman & Nicobar islands.
                    </p>
                  </div>
                </div>
              )}

              {/* Tab 5: Multi-Scale Precision Hierarchy */}
              {activeTab === 'hierarchy' && (
                <div className="space-y-4">
                  <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                    <h3 className="font-bold text-sm text-white">Why Ocean Analysis Requires Multi-Scale Precision Zoom</h3>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      Just like maps zoom from Country &rarr; State &rarr; City &rarr; Street &rarr; Exact Address, ocean intelligence operates across 4 physical scale regimes:
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-white text-xs">Tier 1: Global / Macro Basin</span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300">~55 km Grid</span>
                      </div>
                      <p className="text-[11px] text-slate-400">Covers Indian Ocean basin (20°E to 120°E). Simulates planetary Kelvin waves, Indian Ocean Dipole (IOD), and equatorial jets.</p>
                    </div>

                    <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-white text-xs">Tier 2: Regional Sub-Basin</span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-sky-950 text-sky-300 border border-sky-800">~8.3 km (GLORYS)</span>
                      </div>
                      <p className="text-[11px] text-slate-400">Arabian Sea, Bay of Bengal, and Andaman Sea. Resolves mesoscale eddies, thermal front vectors, and boundary currents.</p>
                    </div>

                    <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-white text-xs">Tier 3: Coastal Maritime Shelf</span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800">~1 – 2 km Shelf</span>
                      </div>
                      <p className="text-[11px] text-slate-400">Wadge Bank, Gulf of Khambhat, and Palk Strait. Simulates coastal upwelling, river mouth plumes, and Potential Fishing Zones (PFZ).</p>
                    </div>

                    <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-white text-xs">Tier 4: Harbor / Pier Sounding</span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-purple-950 text-purple-300 border border-purple-800">~100m Precision</span>
                      </div>
                      <p className="text-[11px] text-slate-400">Veraval, Kochi, Chennai, Vizag, Paradip. Station probes and collocated in-situ buoy CTD measurements at specific landing coordinates.</p>
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : null}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-800 bg-slate-950/60 flex items-center justify-between text-xs text-slate-400">
          <span>Authority: UNESCO Intergovernmental Oceanographic Commission (IOC) & MoES / INCOIS</span>
          <button
            type="button"
            onClick={handleClose}
            className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg transition font-medium"
          >
            Close
          </button>
        </div>

      </div>
    </div>
  );
}
