import React, { useState, useEffect, useId, useMemo, useRef } from 'react';
import { sampleColormap } from '../utils/colormaps.js';
import { isFiniteNumber, formatMetric } from '../utils/scientificPresentation.js';

export const TRANSECT_PRESETS = [
  { name: 'Bay of Bengal Central (10°N, 80°E → 18°N, 90°E)', lat1: 10.0, lon1: 80.0, lat2: 18.0, lon2: 90.0 },
  { name: 'Arabian Sea Shelf-to-Deep (12°N, 70°E → 16°N, 73°E)', lat1: 12.0, lon1: 70.0, lat2: 16.0, lon2: 73.0 },
  { name: 'Equatorial Indian Ocean (2°N, 68°E → 2°N, 92°E)', lat1: 2.0, lon1: 68.0, lat2: 2.0, lon2: 92.0 },
];

// Variables supported by the backend transect endpoint
const SUPPORTED_TRANSECT_VARIABLES = ['temperature', 'salinity', 'currents'];

export default function CrossSectionModal({
  isOpen,
  onClose,
  activeDataset,
  selectedVariable = 'temperature',
  availableVariables = ['temperature', 'salinity', 'currents'],
  timeIndex = 0,
  currentTimeTimestamp = '',
  transectData = null,
  isLoading = false,
  error = null,
  onRequestTransect,
  onClearTransect
}) {
  const [lat1, setLat1] = useState(10.0);
  const [lon1, setLon1] = useState(80.0);
  const [lat2, setLat2] = useState(18.0);
  const [lon2, setLon2] = useState(90.0);
  const [variable, setVariable] = useState(selectedVariable);
  const [validationError, setValidationError] = useState(null);
  const [hoveredCell, setHoveredCell] = useState(null);
  const lastSubmittedRequestRef = useRef(null);
  const titleId = useId();

  // Filter offered variables to only those supported by transect API and present in dataset
  const offeredVariables = useMemo(() => {
    return SUPPORTED_TRANSECT_VARIABLES.filter(
      (v) => !availableVariables || availableVariables.includes(v)
    );
  }, [availableVariables]);

  useEffect(() => {
    if (selectedVariable && offeredVariables.includes(selectedVariable)) {
      setVariable(selectedVariable);
    } else if (offeredVariables.length > 0 && !offeredVariables.includes(variable)) {
      setVariable(offeredVariables[0]);
    }
  }, [selectedVariable, offeredVariables, variable]);

  // Calculate statistics strictly from valid finite soundings
  const stats = useMemo(() => {
    if (!transectData?.matrix) return null;
    const matrix = transectData.matrix;
    let sum = 0;
    let count = 0;
    let totalCells = 0;
    let min = Infinity;
    let max = -Infinity;

    for (let row of matrix) {
      for (let val of row) {
        totalCells++;
        if (isFiniteNumber(val)) {
          sum += val;
          count++;
          if (val < min) min = val;
          if (val > max) max = val;
        }
      }
    }

    if (count === 0) {
      return {
        min: null,
        max: null,
        mean: null,
        validFraction: 0,
        validCount: 0,
        totalCells
      };
    }

    return {
      min,
      max,
      mean: sum / count,
      validFraction: count / totalCells,
      validCount: count,
      totalCells
    };
  }, [transectData]);

  if (!isOpen) return null;

  const coverage = activeDataset?.coverage_bounds;

  const validateCoordinates = (l1Val, ln1Val, l2Val, ln2Val) => {
    const l1 = parseFloat(l1Val);
    const ln1 = parseFloat(ln1Val);
    const l2 = parseFloat(l2Val);
    const ln2 = parseFloat(ln2Val);

    if (isNaN(l1) || isNaN(ln1) || isNaN(l2) || isNaN(ln2)) {
      return 'All coordinates must be finite numeric values.';
    }
    if (l1 < -90 || l1 > 90 || l2 < -90 || l2 > 90) {
      return 'Latitude must be between -90° and +90°.';
    }
    if (ln1 < -180 || ln1 > 180 || ln2 < -180 || ln2 > 180) {
      return 'Longitude must be between -180° and +180°.';
    }
    if (Math.abs(l1 - l2) < 0.001 && Math.abs(ln1 - ln2) < 0.001) {
      return 'Start and end coordinates cannot be identical. Choose distinct endpoints.';
    }

    if (coverage) {
      const { lat_min, lat_max, lon_min, lon_max } = coverage;
      if (
        (lat_min !== undefined && (l1 < lat_min || l2 < lat_min)) ||
        (lat_max !== undefined && (l1 > lat_max || l2 > lat_max)) ||
        (lon_min !== undefined && (ln1 < lon_min || ln2 < lon_min)) ||
        (lon_max !== undefined && (ln1 > lon_max || ln2 > lon_max))
      ) {
        return `Coordinates exceed active dataset domain bounds (Lat: ${lat_min}° to ${lat_max}°, Lon: ${lon_min}° to ${lon_max}°).`;
      }
    }

    return null;
  };

  const handleInputChange = (setter) => (e) => {
    setter(e.target.value);
    setValidationError(null);
    if (transectData || isLoading || error) {
      if (onClearTransect) onClearTransect();
    }
  };

  const handleApplyPreset = (preset) => {
    setLat1(preset.lat1);
    setLon1(preset.lon1);
    setLat2(preset.lat2);
    setLon2(preset.lon2);
    setValidationError(null);
    if (transectData || isLoading || error) {
      if (onClearTransect) onClearTransect();
    }
  };

  const handleVariableChange = (e) => {
    setVariable(e.target.value);
    setValidationError(null);
    if (transectData || isLoading || error) {
      if (onClearTransect) onClearTransect();
    }
  };

  const handleSubmit = (e) => {
    if (e) e.preventDefault();
    const err = validateCoordinates(lat1, lon1, lat2, lon2);
    if (err) {
      setValidationError(err);
      return;
    }
    setValidationError(null);
    const reqPayload = {
      lat1: parseFloat(lat1),
      lon1: parseFloat(lon1),
      lat2: parseFloat(lat2),
      lon2: parseFloat(lon2),
      variable,
      time_idx: timeIndex
    };
    lastSubmittedRequestRef.current = reqPayload;
    if (onRequestTransect) {
      onRequestTransect(reqPayload);
    }
  };

  const handleRetry = () => {
    if (lastSubmittedRequestRef.current) {
      if (onRequestTransect) {
        onRequestTransect(lastSubmittedRequestRef.current);
      }
    } else {
      handleSubmit();
    }
  };

  // Determine returned variable provenance & styling strictly from transectData
  const activeVar = transectData?.variable || variable;
  const palette = activeVar === 'salinity' ? 'haline' : (activeVar === 'currents' ? 'speed' : 'thermal');
  const unit = transectData?.units || (activeVar === 'salinity' ? 'PSU' : (activeVar === 'currents' ? 'm/s' : '°C'));

  // Normalization range for heatmap rendering
  const minVal = isFiniteNumber(stats?.min) ? stats.min : (activeVar === 'salinity' ? 32 : (activeVar === 'currents' ? 0 : 2));
  const maxVal = isFiniteNumber(stats?.max) ? stats.max : (activeVar === 'salinity' ? 38 : (activeVar === 'currents' ? 1.5 : 30));
  const valRange = maxVal - minVal || 1.0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-3 sm:p-6 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-testid="cross-section-modal"
    >
      <div className="relative w-full max-w-5xl bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden text-slate-100">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/80">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            <div>
              <h2 id={titleId} className="text-lg font-bold text-white tracking-wide flex items-center gap-2">
                Ocean Cross-Section & Vertical Profile (ODV)
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-950 border border-cyan-800 text-cyan-300" data-testid="transect-provenance-badge">
                  {activeDataset?.name || activeDataset?.dataset_id || 'Active Dataset'}
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Inspect 2D vertical depth-distance transects and subsurface water column structure along custom ocean pathways.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition"
            data-testid="transect-close-btn"
            aria-label="Close cross-section modal"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 text-xs">

          {/* Coordinate & Parameter Form */}
          <form onSubmit={handleSubmit} className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 space-y-4">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-200 uppercase tracking-wider text-[11px]">
                Define Section Pathway Coordinates
              </span>
              <div className="flex gap-2">
                {TRANSECT_PRESETS.map((preset, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleApplyPreset(preset)}
                    className="text-[10px] px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition"
                  >
                    {preset.name.split(' (')[0]}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3">
              {/* Start Point */}
              <div>
                <label className="block text-[10px] font-medium text-slate-400 mb-1">Start Latitude (°N)</label>
                <input
                  type="number"
                  step="0.01"
                  value={lat1}
                  onChange={handleInputChange(setLat1)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-slate-100 font-mono focus:border-cyan-500 focus:outline-none"
                  data-testid="transect-lat1-input"
                  required
                />
              </div>
              <div>
                <label className="block text-[10px] font-medium text-slate-400 mb-1">Start Longitude (°E)</label>
                <input
                  type="number"
                  step="0.01"
                  value={lon1}
                  onChange={handleInputChange(setLon1)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-slate-100 font-mono focus:border-cyan-500 focus:outline-none"
                  data-testid="transect-lon1-input"
                  required
                />
              </div>

              {/* End Point */}
              <div>
                <label className="block text-[10px] font-medium text-slate-400 mb-1">End Latitude (°N)</label>
                <input
                  type="number"
                  step="0.01"
                  value={lat2}
                  onChange={handleInputChange(setLat2)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-slate-100 font-mono focus:border-cyan-500 focus:outline-none"
                  data-testid="transect-lat2-input"
                  required
                />
              </div>
              <div>
                <label className="block text-[10px] font-medium text-slate-400 mb-1">End Longitude (°E)</label>
                <input
                  type="number"
                  step="0.01"
                  value={lon2}
                  onChange={handleInputChange(setLon2)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-slate-100 font-mono focus:border-cyan-500 focus:outline-none"
                  data-testid="transect-lon2-input"
                  required
                />
              </div>

              {/* Variable Select */}
              <div>
                <label className="block text-[10px] font-medium text-slate-400 mb-1">Variable</label>
                <select
                  value={variable}
                  onChange={handleVariableChange}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-slate-100 font-medium focus:border-cyan-500 focus:outline-none capitalize"
                  data-testid="transect-variable-select"
                >
                  {offeredVariables.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Validation Message */}
            {validationError && (
              <div className="p-2.5 rounded-lg bg-rose-950/60 border border-rose-800 text-rose-300 flex items-center gap-2" data-testid="transect-validation-error">
                <svg className="w-4 h-4 shrink-0 text-rose-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                <span>{validationError}</span>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center justify-between pt-1">
              <div className="text-[11px] text-slate-400">
                Time Timestamp: <span className="font-mono text-slate-200">{currentTimeTimestamp || `Step ${timeIndex}`}</span>
              </div>
              <div className="flex gap-2">
                {transectData && (
                  <button
                    type="button"
                    onClick={() => {
                      if (onClearTransect) onClearTransect();
                    }}
                    className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium transition"
                    data-testid="transect-clear-btn"
                  >
                    Clear Section
                  </button>
                )}
                <button
                  type="submit"
                  disabled={isLoading}
                  className="px-5 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-semibold flex items-center gap-2 transition disabled:opacity-50"
                  data-testid="transect-submit-btn"
                >
                  {isLoading ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span>Computing Transect...</span>
                    </>
                  ) : (
                    <span>Compute Cross-Section</span>
                  )}
                </button>
              </div>
            </div>
          </form>

          {/* Loading Indicator */}
          {isLoading && (
            <div className="p-8 rounded-xl bg-slate-950 border border-slate-800 flex flex-col items-center justify-center gap-3 text-center" data-testid="transect-loading-indicator">
              <div className="w-8 h-8 border-3 border-cyan-500/30 border-t-cyan-400 rounded-full animate-spin" />
              <div className="text-slate-200 font-medium text-sm">Interpolating Subsurface Ocean Column...</div>
              <div className="text-[11px] text-slate-400">Sampling vertical soundings along pathway with quantitative depth spacing.</div>
            </div>
          )}

          {/* Error Panel with Retry */}
          {error && !isLoading && (
            <div className="p-5 rounded-xl bg-rose-950/40 border border-rose-800/80 space-y-3" data-testid="transect-error-panel">
              <div className="flex items-center gap-2.5 text-rose-300 font-semibold text-sm">
                <svg className="w-5 h-5 text-rose-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
                <span>Cross-Section Computation Failed</span>
              </div>
              <p className="text-rose-200/90 text-xs leading-relaxed">{error}</p>
              <button
                type="button"
                onClick={handleRetry}
                className="px-4 py-1.5 rounded-lg bg-rose-800 hover:bg-rose-700 text-white font-medium transition"
                data-testid="transect-retry-btn"
              >
                Retry Request
              </button>
            </div>
          )}

          {/* Rendered 2D Section Results */}
          {transectData && !isLoading && !error && (() => {
            const matrix = transectData.matrix || [];
            const rawDepths = transectData.depth_levels || [];
            const distances = transectData.distances_km || [];
            const numDistances = distances.length;

            // Validate depth array: non-empty, finite numbers, strictly monotonic
            let depthValidationError = null;
            if (!Array.isArray(rawDepths) || rawDepths.length === 0) {
              depthValidationError = 'No depth levels provided in transect payload.';
            } else if (!rawDepths.every((d) => typeof d === 'number' && Number.isFinite(d))) {
              depthValidationError = 'Depth levels must all be finite numeric values.';
            } else if (matrix.length !== rawDepths.length) {
              depthValidationError = `Data matrix row count (${matrix.length}) does not match depth levels count (${rawDepths.length}).`;
            } else if (rawDepths.length > 1) {
              let isAscending = true;
              let isDescending = true;
              for (let i = 0; i < rawDepths.length - 1; i++) {
                if (rawDepths[i + 1] <= rawDepths[i]) {
                  isAscending = false;
                }
                if (rawDepths[i + 1] >= rawDepths[i]) {
                  isDescending = false;
                }
              }
              if (!isAscending && !isDescending) {
                depthValidationError = 'Depth levels must be strictly monotonic (strictly ascending or strictly descending). Duplicate or non-monotonic depths are not supported.';
              }
            }

            if (depthValidationError) {
              return (
                <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-800 text-rose-300" data-testid="transect-depth-validation-error">
                  <div className="font-semibold text-sm mb-1 flex items-center gap-2">
                    <svg className="w-4 h-4 text-rose-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    <span>Depth Coordinate Validation Error</span>
                  </div>
                  <p className="text-xs text-rose-200/90">{depthValidationError}</p>
                </div>
              );
            }

            // Quantitative physical depth layout calculation
            const K = rawDepths.length;
            const plotTop = 10;
            const plotHeight = 220;
            const plotLeft = 55;
            const plotWidth = 730;

            let layerBounds = [];
            if (K === 1) {
              const d = rawDepths[0];
              layerBounds.push({
                depth: d,
                yTop: plotTop,
                height: plotHeight,
                yCenter: plotTop + plotHeight / 2
              });
            } else {
              const isAscending = rawDepths[1] > rawDepths[0];
              if (isAscending) {
                // rawDepths[0] < rawDepths[1] < ... < rawDepths[K-1]
                const zSurface = rawDepths[0] - (rawDepths[1] - rawDepths[0]) / 2;
                const zDeep = rawDepths[K - 1] + (rawDepths[K - 1] - rawDepths[K - 2]) / 2;
                const deltaZ = zDeep - zSurface || 1.0;

                layerBounds = rawDepths.map((d, k) => {
                  const zTop = k === 0 ? zSurface : (rawDepths[k - 1] + d) / 2;
                  const zBottom = k === K - 1 ? zDeep : (d + rawDepths[k + 1]) / 2;
                  const yTop = plotTop + ((zTop - zSurface) / deltaZ) * plotHeight;
                  const yBottom = plotTop + ((zBottom - zSurface) / deltaZ) * plotHeight;
                  const yCenter = plotTop + ((d - zSurface) / deltaZ) * plotHeight;
                  return {
                    depth: d,
                    yTop,
                    height: yBottom - yTop,
                    yCenter
                  };
                });
              } else {
                // rawDepths[0] > rawDepths[1] > ... > rawDepths[K-1] (descending)
                // rawDepths[K-1] is shallowest (surface), rawDepths[0] is deepest
                const zSurface = rawDepths[K - 1] - (rawDepths[K - 2] - rawDepths[K - 1]) / 2;
                const zDeep = rawDepths[0] + (rawDepths[0] - rawDepths[1]) / 2;
                const deltaZ = zDeep - zSurface || 1.0;

                layerBounds = rawDepths.map((d, k) => {
                  const zTop = k === K - 1 ? zSurface : (d + rawDepths[k + 1]) / 2;
                  const zBottom = k === 0 ? zDeep : (rawDepths[k - 1] + d) / 2;
                  const yTop = plotTop + ((zTop - zSurface) / deltaZ) * plotHeight;
                  const yBottom = plotTop + ((zBottom - zSurface) / deltaZ) * plotHeight;
                  const yCenter = plotTop + ((d - zSurface) / deltaZ) * plotHeight;
                  return {
                    depth: d,
                    yTop,
                    height: yBottom - yTop,
                    yCenter
                  };
                });
              }
            }

            return (
              <div className="space-y-4" data-testid="transect-results-container">
                {/* Summary Metrics Bar */}
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-center">
                  <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                    <div className="text-[10px] text-slate-400">Total Pathway Length</div>
                    <div className="text-base font-bold text-cyan-400 mt-0.5" data-testid="transect-distance-stat">
                      {isFiniteNumber(transectData.total_distance_km) ? `${transectData.total_distance_km.toFixed(1)} km` : 'Unavailable'}
                    </div>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                    <div className="text-[10px] text-slate-400">Minimum Value</div>
                    <div className="text-base font-bold text-sky-400 mt-0.5" data-testid="transect-min-val">
                      {isFiniteNumber(stats?.min) ? `${stats.min.toFixed(2)} ${unit}` : 'No Data'}
                    </div>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                    <div className="text-[10px] text-slate-400">Mean Sounding</div>
                    <div className="text-base font-bold text-emerald-400 mt-0.5" data-testid="transect-mean-val">
                      {isFiniteNumber(stats?.mean) ? `${stats.mean.toFixed(2)} ${unit}` : 'No Data'}
                    </div>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                    <div className="text-[10px] text-slate-400">Maximum Value</div>
                    <div className="text-base font-bold text-rose-400 mt-0.5" data-testid="transect-max-val">
                      {isFiniteNumber(stats?.max) ? `${stats.max.toFixed(2)} ${unit}` : 'No Data'}
                    </div>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                    <div className="text-[10px] text-slate-400">Valid Sampling Fraction</div>
                    <div className="text-base font-bold text-slate-200 mt-0.5" data-testid="transect-valid-fraction">
                      {stats ? `${(stats.validFraction * 100).toFixed(1)}%` : '0%'}
                    </div>
                  </div>
                </div>

                {/* 2D Heatmap Canvas / SVG Representation */}
                <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between text-[11px] font-semibold text-slate-300">
                    <span>Vertical Distance-vs-Depth Section ({activeVar.toUpperCase()} in {unit})</span>
                    <span className="text-slate-400 font-mono text-[10px]" data-testid="transect-hover-sounding">
                      {hoveredCell ? `Dist: ${hoveredCell.distance.toFixed(1)} km | Depth: ${hoveredCell.depth} m | Value: ${hoveredCell.valueText}` : 'Hover cells to inspect soundings'}
                    </span>
                  </div>

                  {/* SVG Heatmap Plot */}
                  <div className="w-full overflow-x-auto">
                    <svg
                      viewBox="0 0 800 280"
                      className="w-full h-64 bg-slate-900/90 rounded-lg border border-slate-800 select-none"
                      data-testid="transect-heatmap-svg"
                    >
                      <defs>
                        {/* Distinct Hatch Pattern for Null / Land / Missing Cells */}
                        <pattern id="transect-no-data-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                          <line x1="0" y1="0" x2="0" y2="8" stroke="#334155" strokeWidth="2" />
                          <rect width="8" height="8" fill="#0f172a" fillOpacity="0.7" />
                        </pattern>
                      </defs>

                      {/* Grid Cells rendered with bounded physical depth heights */}
                      {matrix.map((row, dIdx) => {
                        const bounds = layerBounds[dIdx];
                        if (!bounds) return null;
                        const depth = bounds.depth;
                        const y = bounds.yTop;
                        const cellHeight = bounds.height;

                        return row.map((val, pIdx) => {
                          const dist = distances[pIdx] || 0;
                          const cellWidth = plotWidth / Math.max(1, numDistances);
                          const x = plotLeft + pIdx * cellWidth;

                          const isValid = isFiniteNumber(val);
                          let fillColor = 'url(#transect-no-data-hatch)';
                          if (isValid) {
                            const t = (val - minVal) / valRange;
                            const [r, g, b] = sampleColormap(palette, t);
                            fillColor = `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
                          }

                          return (
                            <rect
                              key={`${dIdx}-${pIdx}`}
                              x={x}
                              y={y}
                              width={cellWidth + 0.5}
                              height={cellHeight}
                              fill={fillColor}
                              stroke={isValid ? 'none' : '#334155'}
                              strokeWidth={isValid ? 0 : 0.5}
                              opacity={isValid ? 0.95 : 0.85}
                              data-testid={isValid ? `cell-valid-${dIdx}-${pIdx}` : `cell-nodata-${dIdx}-${pIdx}`}
                              data-depth-idx={dIdx}
                              data-point-idx={pIdx}
                              data-depth-val={depth}
                              data-cell-y={y}
                              data-cell-height={cellHeight}
                              onMouseEnter={() => {
                                setHoveredCell({
                                  distance: dist,
                                  depth,
                                  valueText: isValid ? formatMetric(val, { decimals: 2, unit }) : 'No Data (Land / Masked)'
                                });
                              }}
                            />
                          );
                        });
                      })}

                      {/* Physical Depth Axis Labels (Y-axis) */}
                      {layerBounds.map((bounds, idx) => (
                        <text
                          key={`d-${idx}`}
                          x="48"
                          y={bounds.yCenter + 3.5}
                          fill="#94a3b8"
                          fontSize="8.5"
                          textAnchor="end"
                          fontFamily="monospace"
                          data-testid={`transect-depth-label-${idx}`}
                        >
                          {bounds.depth}m
                        </text>
                      ))}

                      {/* Distance Axis Labels (X-axis) */}
                      {[0, 0.25, 0.5, 0.75, 1.0].map((frac, idx) => {
                        const x = plotLeft + frac * plotWidth;
                        const distVal = (transectData.total_distance_km || 0) * frac;
                        return (
                          <text key={`dist-${idx}`} x={x} y="255" fill="#94a3b8" fontSize="9" textAnchor="middle" fontFamily="monospace">
                            {distVal.toFixed(0)}km
                          </text>
                        );
                      })}
                    </svg>
                  </div>

                  {/* Legend and Axis Description */}
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-400 pt-1" data-testid="transect-no-data-legend">
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-slate-300">Scale:</span>
                        <span className="font-mono text-cyan-300">{minVal.toFixed(1)} {unit}</span>
                        <div className="w-16 h-2.5 rounded bg-gradient-to-r from-blue-600 via-amber-400 to-rose-600 border border-slate-700" />
                        <span className="font-mono text-rose-300">{maxVal.toFixed(1)} {unit}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <div className="w-3.5 h-3.5 rounded border border-slate-600 bg-slate-800 flex items-center justify-center overflow-hidden">
                          <div className="w-full h-full bg-[linear-gradient(45deg,#334155_25%,transparent_25%,transparent_50%,#334155_50%,#334155_75%,transparent_75%,transparent)] bg-[length:6px_6px]" />
                        </div>
                        <span className="text-slate-300 font-medium">No Data / Land Mask</span>
                      </div>
                    </div>
                    <span>X: Distance (km) · Y: Physical Depth (m)</span>
                  </div>
                </div>
              </div>
            );
          })()}

        </div>

      </div>
    </div>
  );
}
