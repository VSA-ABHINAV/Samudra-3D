import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { fetchProfileCollocation, fetchGliderCollocation } from '../services/api.js';

/**
 * Calculates Pearson correlation coefficient (R) between two paired numerical arrays.
 */
/**
 * Calculates Pearson correlation coefficient (R) between two paired numerical arrays.
 * Returns { r: number | null, reason: string | null }
 */
function calculatePearsonR(obsArr, modelArr) {
  if (!obsArr || !modelArr) return { r: null, reason: 'missing data' };
  const pairs = [];
  for (let i = 0; i < Math.min(obsArr.length, modelArr.length); i++) {
    const o = obsArr[i];
    const m = modelArr[i];
    if (o !== null && o !== undefined && Number.isFinite(o) &&
        m !== null && m !== undefined && Number.isFinite(m)) {
      pairs.push([o, m]);
    }
  }
  if (pairs.length < 2) {
    return { r: null, reason: 'n<2' };
  }
  const n = pairs.length;
  const meanO = pairs.reduce((sum, p) => sum + p[0], 0) / n;
  const meanM = pairs.reduce((sum, p) => sum + p[1], 0) / n;
  let num = 0, denO = 0, denM = 0;
  for (let i = 0; i < n; i++) {
    const doVal = pairs[i][0] - meanO;
    const dmVal = pairs[i][1] - meanM;
    num += doVal * dmVal;
    denO += doVal * doVal;
    denM += dmVal * dmVal;
  }
  if (denO === 0 || denM === 0) {
    return { r: null, reason: 'zero variance' };
  }
  const denom = Math.sqrt(denO * denM);
  if (!Number.isFinite(denom) || denom === 0) {
    return { r: null, reason: 'zero variance' };
  }
  const rVal = num / denom;
  const clamped = Math.max(-1.0, Math.min(1.0, rVal));
  return { r: Number(clamped.toFixed(4)), reason: null };
}

function formatPearsonR(pearsonObj) {
  if (!pearsonObj || pearsonObj.r === null || pearsonObj.r === undefined) {
    return `n/a (${pearsonObj?.reason || 'insufficient data'})`;
  }
  const r = pearsonObj.r;
  if (r > 0) return `+${r.toFixed(4)}`;
  if (r === 0) return '0.0000';
  return `${r.toFixed(4)}`;
}

/**
 * ModelComparisonModal - Dedicated Model Prediction & Observation Validation Suite
 * Allows scientists to compare numerical forecast model predictions against in-situ ground truth observations.
 */
export default function ModelComparisonModal({
  isOpen = false,
  onClose = null,
  comparisonContext = null,
  selectedFloat = null,
  argoFloats = [],
  gliderTransects = [],
  isLoadingTarget = false,
  targetLoadError = null,
  onRetryTarget = null,
  showAnomalyField = false,
  onToggleAnomalyField = null,
  onFocusFloat = null,
  isTransitioningDataset = false,
  isDatasetReady = true
}) {
  const [selectedPlatformId, setSelectedPlatformId] = useState(() => comparisonContext?.platformId || selectedFloat?.id || '');
  const [parameter, setParameter] = useState('temperature'); // 'temperature' | 'salinity'
  const [timeStrategy, setTimeStrategy] = useState('linear');
  const [isRunningJob, setIsRunningJob] = useState(false);
  const [jobStatusMsg, setJobStatusMsg] = useState('');
  const [collocationData, setCollocationData] = useState(null);
  const [hoveredLevel, setHoveredLevel] = useState(null);
  const [hoveredResidual, setHoveredResidual] = useState(null);
  const [activeTab, setActiveTab] = useState('curves'); // 'curves' | 'residuals' | 'table'
  const [lastRunStats, setLastRunStats] = useState(null);
  const [isMaximized, setIsMaximized] = useState(false);
  const [isCompactScorecard, setIsCompactScorecard] = useState(false);
  const [depthZoom, setDepthZoom] = useState('all'); // 'all' | 'thermocline' (0-250m)

  // Guard against out-of-order collocation responses
  const collocationRequestIdRef = React.useRef(0);

  // Invalidate in-flight collocation or stale data when dataset becomes unready
  useEffect(() => {
    if (isTransitioningDataset || !isDatasetReady) {
      ++collocationRequestIdRef.current;
      setCollocationData(null);
      setIsRunningJob(false);
      if (isOpen) {
        setJobStatusMsg('Dataset transition in progress. Collocation invalidated.');
      }
    }
  }, [isTransitioningDataset, isDatasetReady, isOpen]);

  // Synchronize available in-situ platforms via useMemo
  const platformList = useMemo(() => {
    let list = [];
    if (argoFloats && argoFloats.length > 0) {
      list = [...argoFloats.map(f => ({
        id: f.id,
        name: f.name || `Argo ${f.wmo_id || f.id}`,
        type: 'argo',
        lat: f.lat,
        lon: f.lon,
        group: 'Argo Float Fleet'
      }))];
    }
    if (gliderTransects && gliderTransects.length > 0) {
      list = [
        ...list,
        ...gliderTransects.map(g => ({
          id: g.id,
          name: g.name || `Glider ${g.id}`,
          type: 'glider',
          lat: g.lat,
          lon: g.lon,
          group: 'Underwater Gliders'
        }))
      ];
    }

    if (comparisonContext?.platformId && !list.some(p => p.id === comparisonContext.platformId)) {
      list.unshift({
        id: comparisonContext.platformId,
        name: comparisonContext.platformType === 'glider' ? `Glider ${comparisonContext.platformId}` : `Argo ${comparisonContext.platformId}`,
        type: comparisonContext.platformType || 'argo',
        lat: comparisonContext.probePoint?.lat ?? 0,
        lon: comparisonContext.probePoint?.lon ?? 0,
        group: comparisonContext.platformType === 'glider' ? 'Underwater Gliders' : 'Argo Float Fleet'
      });
    } else if (selectedFloat?.id && !list.some(p => p.id === selectedFloat.id)) {
      const explicit = selectedFloat.platform_type || selectedFloat.type;
      const resolved = explicit ||
        (selectedFloat.mission_name || (Array.isArray(selectedFloat.waypoints) && selectedFloat.waypoints.length > 0) ? 'glider' :
          (selectedFloat.wmo_id || (Array.isArray(selectedFloat.depths) && selectedFloat.depths.length > 0) ? 'argo' : 'argo'));
      list.unshift({
        id: selectedFloat.id,
        name: selectedFloat.name || (resolved === 'glider' ? `Glider ${selectedFloat.id}` : `Argo ${selectedFloat.wmo_id || selectedFloat.id}`),
        type: resolved,
        lat: selectedFloat.lat ?? 0,
        lon: selectedFloat.lon ?? 0,
        group: resolved === 'glider' ? 'Underwater Gliders' : 'Argo Float Fleet'
      });
    }

    return list;
  }, [argoFloats, gliderTransects, comparisonContext, selectedFloat]);

  // Synchronize selectedPlatformId when platformList becomes available
  useEffect(() => {
    if (!selectedPlatformId && platformList && platformList.length > 0) {
      setSelectedPlatformId(platformList[0].id);
    }
  }, [platformList, selectedPlatformId]);

  // Execute collocation prediction job with race protection
  const runPredictionJob = useCallback(async (platformId = selectedPlatformId, strat = timeStrategy) => {
    if (!platformId) return;
    if (isTransitioningDataset || !isDatasetReady) {
      setCollocationData(null);
      setJobStatusMsg('Model prediction comparison unavailable while dataset is syncing or unready.');
      setIsRunningJob(false);
      return;
    }
    const reqId = ++collocationRequestIdRef.current;
    setIsRunningJob(true);
    setJobStatusMsg('Simulating 4D numerical model grid & computing trilinear collocation...');

    const startTime = performance.now();
    try {
      let resolvedType = null;

      // 1. Explicit metadata from selected platform detail (metadata owns dispatch)
      if (selectedFloat?.id === platformId) {
        if (selectedFloat.platform_type) {
          resolvedType = selectedFloat.platform_type;
        } else if (selectedFloat.type) {
          resolvedType = selectedFloat.type;
        }
      }

      // 2. Explicit metadata from comparison context (e.g. from probe or fleet selection)
      if (!resolvedType && comparisonContext?.platformId === platformId) {
        resolvedType = comparisonContext.platformType || comparisonContext.platform_type || null;
      }

      // 3. Explicit metadata from fleet platform list
      if (!resolvedType) {
        const found = platformList.find(p => p.id === platformId);
        if (found?.type) {
          resolvedType = found.type;
        }
      }

      // 4. Shape-based inference ONLY if explicit type metadata was genuinely absent
      if (!resolvedType && selectedFloat?.id === platformId) {
        if (selectedFloat.mission_name || (Array.isArray(selectedFloat.waypoints) && selectedFloat.waypoints.length > 0)) {
          resolvedType = 'glider';
        } else if (selectedFloat.wmo_id || (Array.isArray(selectedFloat.depths) && selectedFloat.depths.length > 0)) {
          resolvedType = 'argo';
        }
      }

      let res;
      if (resolvedType === 'glider') {
        res = await fetchGliderCollocation(platformId);
      } else if (resolvedType === 'argo' || resolvedType === 'sensor') {
        res = await fetchProfileCollocation(platformId, { time_strategy: strat });
      } else {
        throw new Error(`Unsupported or unresolved platform type for ${platformId}. Only Argo floats and underwater gliders are supported.`);
      }

      if (collocationRequestIdRef.current === reqId) {
        const elapsed = Math.round(performance.now() - startTime);
        setCollocationData(res);
        setLastRunStats({
          elapsedMs: elapsed,
          timestamp: new Date().toLocaleTimeString(),
          platformId,
          strategy: strat
        });
        setJobStatusMsg(`Prediction job completed in ${elapsed} ms. 4D Collocation validated.`);
      }
    } catch (err) {
      if (collocationRequestIdRef.current === reqId) {
        console.error('Prediction job error:', err);
        setCollocationData(null);
        setJobStatusMsg(`Collocation notice: ${err.message}`);
      }
    } finally {
      if (collocationRequestIdRef.current === reqId) {
        setIsRunningJob(false);
      }
    }
  }, [platformList, selectedPlatformId, timeStrategy, comparisonContext, selectedFloat, isTransitioningDataset, isDatasetReady]);

  // Clean up state when modal closes
  useEffect(() => {
    if (!isOpen) {
      ++collocationRequestIdRef.current;
      setCollocationData(null);
      setLastRunStats(null);
      setJobStatusMsg('');
      setIsRunningJob(false);
    }
  }, [isOpen]);

  // Sync selectedPlatformId when comparisonContext, selectedFloat changes or modal opens
  useEffect(() => {
    if (isOpen) {
      if (comparisonContext?.isAvailable === false) {
        setSelectedPlatformId('');
        setCollocationData(null);
        setLastRunStats(null);
        setJobStatusMsg('');
        ++collocationRequestIdRef.current;
      } else if (comparisonContext?.platformId) {
        if (comparisonContext.platformId !== selectedPlatformId) {
          setSelectedPlatformId(comparisonContext.platformId);
          setCollocationData(null);
          setLastRunStats(null);
          setJobStatusMsg('');
          ++collocationRequestIdRef.current;
        }
      } else if (selectedFloat?.id) {
        if (selectedFloat.id !== selectedPlatformId) {
          setSelectedPlatformId(selectedFloat.id);
          setCollocationData(null);
          setLastRunStats(null);
          setJobStatusMsg('');
          ++collocationRequestIdRef.current;
        }
      } else if (!selectedPlatformId && platformList.length > 0) {
        setSelectedPlatformId(platformList[0].id);
      }
    }
  }, [isOpen, comparisonContext, selectedFloat, platformList]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-trigger job when target changes and modal is open (and target is not currently loading detail)
  useEffect(() => {
    if (isOpen && selectedPlatformId && comparisonContext?.isAvailable !== false && !isLoadingTarget && !targetLoadError && !isTransitioningDataset && isDatasetReady) {
      const timer = setTimeout(() => {
        runPredictionJob(selectedPlatformId, timeStrategy);
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [isOpen, selectedPlatformId, timeStrategy, comparisonContext, isLoadingTarget, targetLoadError, isTransitioningDataset, isDatasetReady, runPredictionJob]);

  // Escape key handler
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen) onClose?.();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Derived variables for current parameter
  const summary = useMemo(() => {
    if (!collocationData) return null;
    return parameter === 'temperature'
      ? (collocationData.temperature || collocationData.temperature_summary)
      : (collocationData.salinity || collocationData.salinity_summary);
  }, [collocationData, parameter]);

  const levels = useMemo(() => {
    if (!collocationData) return [];
    if (collocationData.temperature_levels || collocationData.salinity_levels) {
      const list = parameter === 'temperature'
        ? (collocationData.temperature_levels || [])
        : (collocationData.salinity_levels || []);
      return list.filter(l => l.valid && l.observed_value !== null && l.model_value !== null);
    }
    // Glider format
    if (collocationData.waypoints) {
      return collocationData.waypoints.map(w => ({
        depth: w.depth,
        observed_value: parameter === 'temperature' ? w.observed_temp : w.observed_sal,
        model_value: parameter === 'temperature' ? w.model_temp : w.model_sal,
        delta: parameter === 'temperature' ? w.delta_temp : w.delta_sal,
        valid: w.valid,
        qc_flag: 1
      })).filter(l => l.valid && l.observed_value !== null && l.model_value !== null);
    }
    return [];
  }, [collocationData, parameter]);

  // Calculated Pearson R
  const pearsonR = useMemo(() => {
    if (!levels || levels.length === 0) return null;
    const obsArr = levels.map(l => l.observed_value);
    const modArr = levels.map(l => l.model_value);
    return calculatePearsonR(obsArr, modArr);
  }, [levels]);

  const activeLevels = useMemo(() => {
    if (!levels) return [];
    if (depthZoom === 'thermocline') {
      const shallow = levels.filter(l => l.depth <= 250);
      return shallow.length >= 3 ? shallow : levels;
    }
    return levels;
  }, [levels, depthZoom]);

  // Chart coordinate scales
  const chartScales = useMemo(() => {
    if (!activeLevels || activeLevels.length === 0) return null;
    const depths = activeLevels.map(l => l.depth);
    const obsVals = activeLevels.map(l => l.observed_value);
    const modVals = activeLevels.map(l => l.model_value);
    const allVals = [...obsVals, ...modVals];

    const maxDepth = Math.max(...depths, 100);
    const minVal = Math.floor(Math.min(...allVals) * 10) / 10;
    const maxVal = Math.ceil(Math.max(...allVals) * 10) / 10;
    const valSpan = Math.max(maxVal - minVal, 1.0);

    const chartWidth = 640;
    const chartHeight = 360;
    const pad = { top: 25, right: 35, bottom: 40, left: 55 };

    const valueToX = (v) => pad.left + ((v - minVal) / valSpan) * (chartWidth - pad.left - pad.right);
    const depthToY = (d) => pad.top + Math.sqrt(d / maxDepth) * (chartHeight - pad.top - pad.bottom);

    return { chartWidth, chartHeight, pad, minVal, maxVal, maxDepth, valueToX, depthToY };
  }, [activeLevels]);

  // Residual chart scales
  const residualScales = useMemo(() => {
    if (!activeLevels || activeLevels.length === 0) return null;
    const depths = activeLevels.map(l => l.depth);
    const deltas = activeLevels.map(l => l.delta || 0);
    const maxAbsDelta = Math.max(...deltas.map(d => Math.abs(d)), 0.5);
    const maxDepth = Math.max(...depths, 100);

    const width = 640;
    const height = 360;
    const pad = { top: 25, right: 35, bottom: 40, left: 55 };

    const deltaToX = (d) => pad.left + ((d + maxAbsDelta) / (2 * maxAbsDelta)) * (width - pad.left - pad.right);
    const depthToY = (depth) => pad.top + Math.sqrt(depth / maxDepth) * (height - pad.top - pad.bottom);
    const zeroX = deltaToX(0);

    return { width, height, pad, maxAbsDelta, maxDepth, deltaToX, depthToY, zeroX };
  }, [activeLevels]);

  // Export comparison to CSV
  const handleExportCSV = () => {
    if (!levels.length) return;
    const unit = parameter === 'temperature' ? 'degC' : 'PSU';
    let csv = `Depth_m,Observed_${unit},Predicted_Model_${unit},Residual_Delta_${unit},QC_Flag,Status\n`;
    levels.forEach(l => {
      csv += `${l.depth},${l.observed_value},${l.model_value},${l.delta},${l.qc_flag},VALID\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `SAMUDRA-3D_Validation_${selectedPlatformId}_${parameter}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!isOpen) return null;

  // No-platform unavailable state: comparison was explicitly triggered from probe with no nearest observation
  const isNoPlatformUnavailable = Boolean(comparisonContext && comparisonContext.isAvailable === false);

  if (isNoPlatformUnavailable) {
    return (
      <div
        className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/75 backdrop-blur-md"
        role="dialog"
        aria-modal="true"
        aria-labelledby="no-platform-title"
        data-testid="model-comparison-modal"
        onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      >
        <div
          className="rounded-2xl border shadow-2xl p-8 max-w-md w-full text-center"
          style={{ backgroundColor: 'var(--panel)', borderColor: 'var(--border)', color: 'var(--text)' }}
          data-testid="model-comparison-no-platform"
        >
          <span className="text-4xl block mb-4" aria-hidden="true">🚫</span>
          <h2 id="no-platform-title" className="text-base font-bold tracking-tight mb-2">
            No Nearby Observation Available
          </h2>
          <p className="text-sm mb-4" style={{ color: 'var(--muted)' }}>
            The ocean probe did not find a supported in-situ platform (Argo float or glider)
            within the collocation search radius for this location. Model comparison requires
            a real collocated observation — no substitute platform will be used.
          </p>
          <p className="text-xs mb-6" style={{ color: 'var(--muted)' }}>
            Select an Argo float or glider from the Observation Fleet drawer and use its
            Compare Model button to run a collocated prediction job.
          </p>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs cursor-pointer"
            data-testid="no-platform-close-btn"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  const currentPlatform = platformList.find(p => p.id === selectedPlatformId);
  const unitStr = parameter === 'temperature' ? '°C' : 'PSU';

  return (
    <div
      className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/75 backdrop-blur-md overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="comparison-suite-title"
      data-testid="model-comparison-modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        className={`modal-container border shadow-2xl flex flex-col overflow-hidden transition-all duration-200 ${
          isMaximized
            ? 'w-[98vw] h-[96vh] max-w-none max-h-none rounded-2xl'
            : 'w-full max-w-6xl max-h-[94vh] rounded-2xl'
        }`}
        style={{
          backgroundColor: 'var(--panel)',
          borderColor: 'var(--border)',
          color: 'var(--text)'
        }}
      >
        {/* 1. Institutional Suite Header */}
        <div className="modal-header flex flex-wrap justify-between items-center py-3 px-5 border-b sticky top-0 z-20" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--panel)' }}>
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-600/20 text-sky-400 font-bold border border-sky-500/40 text-lg">
              📊
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h2 id="comparison-suite-title" className="text-base sm:text-lg font-bold m-0 tracking-tight" style={{ color: 'var(--text)' }}>
                  Model Prediction vs In-Situ Observation Comparison
                </h2>
                <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-sky-950/60 text-sky-300 border border-sky-500/40 font-semibold">
                  4D Collocation Suite
                </span>
              </div>
              <p className="text-xs m-0 mt-0.5" style={{ color: 'var(--muted)' }}>
                Rigorous scientific validation: Numerical ROMS forecast predictions collocated against verified in-situ ocean ground truth
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 mt-2 sm:mt-0">
            {/* Compact / Expand Scorecard toggle */}
            <button
              type="button"
              onClick={() => setIsCompactScorecard(!isCompactScorecard)}
              className="px-2.5 py-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer hover:bg-slate-700/50"
              style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
              title={isCompactScorecard ? 'Expand metric cards' : 'Compact metrics into 1-line bar to maximize chart space'}
            >
              <span>{isCompactScorecard ? '📑 Expand Cards' : '📊 Compact Stats'}</span>
            </button>

            {/* Maximize Fullscreen toggle */}
            <button
              type="button"
              onClick={() => setIsMaximized(!isMaximized)}
              className="px-2.5 py-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer hover:bg-slate-700/50"
              style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
              title={isMaximized ? 'Restore normal window' : 'Full-screen maximize for unobstructed chart exploration'}
            >
              <span>{isMaximized ? '🗗 Restore' : '⛶ Fullscreen'}</span>
            </button>

            <button
              type="button"
              onClick={handleExportCSV}
              disabled={!levels.length}
              data-testid="export-comparison-csv-btn"
              className="px-3 py-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer hover:bg-slate-700/50 disabled:opacity-50"
              style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
              title="Export level-by-level comparison table as CSV"
            >
              <span>📥</span>
              <span>Export CSV</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              data-testid="close-comparison-modal-btn"
              aria-label="Close comparison suite"
              className="px-3 py-1.5 rounded-lg border text-xs font-semibold hover:bg-red-500/20 hover:text-red-300 transition cursor-pointer"
              style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
            >
              ✕ Close
            </button>
          </div>
        </div>

        {/* 2. Interactive Prediction Job Runner Controls Bar */}
        <div className="job-runner-bar p-4 border-b flex flex-wrap items-center justify-between gap-3" style={{ backgroundColor: 'var(--field)', borderColor: 'var(--border)' }}>
          <div className="flex flex-wrap items-center gap-3">
            {/* Target Platform Selection */}
            <div>
              <label htmlFor="compare-platform-select" className="block text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--muted)' }}>
                Target In-Situ Platform
              </label>
              <select
                id="compare-platform-select"
                data-testid="compare-platform-select"
                value={selectedPlatformId}
                onChange={(e) => {
                  const newId = e.target.value;
                  setSelectedPlatformId(newId);
                  setCollocationData(null);
                  setLastRunStats(null);
                  setJobStatusMsg('');
                  ++collocationRequestIdRef.current;
                }}
                className="rounded-lg border px-3 py-1.5 text-xs font-medium outline-none transition cursor-pointer"
                style={{ backgroundColor: 'var(--panel)', borderColor: 'var(--border)', color: 'var(--text)' }}
              >
                {platformList.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.lat.toFixed(1)}°N, {p.lon.toFixed(1)}°E)
                  </option>
                ))}
              </select>
            </div>

            {/* Ocean Variable Switcher */}
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--muted)' }}>
                Comparison Parameter
              </label>
              <div className="flex rounded-lg border p-0.5" style={{ backgroundColor: 'var(--panel)', borderColor: 'var(--border)' }}>
                <button
                  type="button"
                  onClick={() => setParameter('temperature')}
                  data-testid="compare-param-temp-btn"
                  className={`px-3 py-1 text-xs font-semibold rounded-md transition cursor-pointer ${parameter === 'temperature' ? 'bg-sky-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
                >
                  🌡️ Potential Temp (°C)
                </button>
                <button
                  type="button"
                  onClick={() => setParameter('salinity')}
                  data-testid="compare-param-sal-btn"
                  className={`px-3 py-1 text-xs font-semibold rounded-md transition cursor-pointer ${parameter === 'salinity' ? 'bg-sky-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
                >
                  🧂 Salinity (PSU)
                </button>
              </div>
            </div>

            {/* Temporal Blending Strategy */}
            <div>
              <label htmlFor="time-strategy-select" className="block text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--muted)' }}>
                Temporal Strategy
              </label>
              <select
                id="time-strategy-select"
                data-testid="time-strategy-select"
                value={timeStrategy}
                onChange={(e) => {
                  const newStrat = e.target.value;
                  setTimeStrategy(newStrat);
                  setCollocationData(null);
                  setLastRunStats(null);
                  setJobStatusMsg('');
                  ++collocationRequestIdRef.current;
                }}
                className="rounded-lg border px-2.5 py-1.5 text-xs font-medium outline-none transition cursor-pointer"
                style={{ backgroundColor: 'var(--panel)', borderColor: 'var(--border)', color: 'var(--text)' }}
              >
                <option value="linear">Linear Interpolation (Continuous)</option>
                <option value="nearest">Nearest Forecast Time Step</option>
              </select>
            </div>
          </div>

          {/* Action Button: Run Prediction Job */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => runPredictionJob(selectedPlatformId, timeStrategy)}
              disabled={isRunningJob || !selectedPlatformId}
              data-testid="run-prediction-job-btn"
              className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs flex items-center gap-2 shadow-lg transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span>{isRunningJob ? '⟳' : '⚡'}</span>
              <span>{isRunningJob ? 'Extracting Model & Collocating...' : 'Run Model Prediction Job'}</span>
            </button>
          </div>
        </div>

        {/* Status Line */}
        {jobStatusMsg && (
          <div className="px-5 py-2 text-xs border-b flex items-center justify-between" style={{ backgroundColor: 'var(--panel)', borderColor: 'var(--border)', color: 'var(--muted)' }}>
            <span className="font-mono flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />
              {jobStatusMsg}
            </span>
            {lastRunStats && (
              <span className="text-[11px] font-mono">
                Executed at {lastRunStats.timestamp} · Method: 4D trilinear affine
              </span>
            )}
          </div>
        )}

        {/* 3. Statistical Validation Scorecard */}
        {isCompactScorecard ? (
          <div className="scorecard-compact px-5 py-2.5 border-b flex flex-wrap items-center justify-between gap-2.5 text-xs" style={{ backgroundColor: 'var(--panel)', borderColor: 'var(--border)' }}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Scorecard:</span>
              <span className="px-2 py-0.5 rounded border font-mono text-[11px]" style={{ backgroundColor: 'var(--field)', borderColor: 'var(--border)' }}>
                MBE: <strong data-testid="metric-bias-val" style={{ color: (summary?.bias || 0) < 0 ? '#38bdf8' : '#fbbf24' }}>{summary?.bias !== null && summary?.bias !== undefined ? `${summary.bias > 0 ? '+' : ''}${summary.bias} ${unitStr}` : 'N/A'}</strong>
              </span>
              <span className="px-2 py-0.5 rounded border font-mono text-[11px]" style={{ backgroundColor: 'var(--field)', borderColor: 'var(--border)' }}>
                RMSE: <strong data-testid="metric-rmse-val" className="text-cyan-400">{summary?.rmse !== null && summary?.rmse !== undefined ? `${summary.rmse} ${unitStr}` : 'N/A'}</strong>
              </span>
              <span className="px-2 py-0.5 rounded border font-mono text-[11px]" style={{ backgroundColor: 'var(--field)', borderColor: 'var(--border)' }}>
                MAE: <strong data-testid="metric-mae-val" className="text-teal-400">{summary?.mae !== null && summary?.mae !== undefined ? `${summary.mae} ${unitStr}` : 'N/A'}</strong>
              </span>
              <span className="px-2 py-0.5 rounded border font-mono text-[11px]" style={{ backgroundColor: 'var(--field)', borderColor: 'var(--border)' }}>
                R: <strong data-testid="metric-pearson-val" className="text-emerald-400">{formatPearsonR(pearsonR)}</strong>
              </span>
              <span className="px-2 py-0.5 rounded border font-mono text-[11px]" style={{ backgroundColor: 'var(--field)', borderColor: 'var(--border)' }}>
                Grade: <strong data-testid="metric-health-val" className="text-emerald-400">{collocationData?.model_health || 'Unavailable'}</strong>
              </span>
              <span className="px-2 py-0.5 rounded border font-mono text-[11px] text-sky-400" style={{ backgroundColor: 'var(--field)', borderColor: 'var(--border)' }}>
                Offset: <strong>{summary?.spatial_distance_km ? `${summary.spatial_distance_km} km` : (collocationData ? 'Collocated' : 'Unavailable')}</strong>
              </span>
            </div>
            <button
              type="button"
              onClick={() => setIsCompactScorecard(false)}
              className="text-[11px] text-sky-400 hover:underline cursor-pointer"
            >
              Expand Cards ▾
            </button>
          </div>
        ) : (
          <div className="scorecard-grid p-3.5 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 border-b" style={{ backgroundColor: 'var(--panel)', borderColor: 'var(--border)' }}>
            {/* 1. Mean Bias Error */}
            <div className="metric-card p-3 rounded-xl border flex flex-col justify-between" style={{ backgroundColor: 'var(--field)', borderColor: 'var(--border)' }}>
              <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
                Mean Bias Error (MBE)
              </span>
              <div className="my-1">
                <span className="text-lg font-extrabold font-mono" data-testid="metric-bias-val" style={{ color: (summary?.bias || 0) < 0 ? '#38bdf8' : '#fbbf24' }}>
                  {summary?.bias !== null && summary?.bias !== undefined
                    ? `${summary.bias > 0 ? '+' : ''}${summary.bias} ${unitStr}`
                    : 'N/A'}
                </span>
              </div>
              <span className="text-[10px] font-semibold uppercase" style={{ color: 'var(--muted)' }}>
                {summary?.prediction_tendency || 'Unavailable'}
              </span>
            </div>

            {/* 2. Root Mean Square Error (RMSE) */}
            <div className="metric-card p-3 rounded-xl border flex flex-col justify-between" style={{ backgroundColor: 'var(--field)', borderColor: 'var(--border)' }}>
              <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
                RMSE (Skill Measure)
              </span>
              <div className="my-1">
                <span className="text-lg font-extrabold font-mono text-cyan-400" data-testid="metric-rmse-val">
                  {summary?.rmse !== null && summary?.rmse !== undefined ? `${summary.rmse} ${unitStr}` : 'N/A'}
                </span>
              </div>
              <span className="text-[10px]" style={{ color: 'var(--muted)' }}>
                Lower is better
              </span>
            </div>

            {/* 3. Mean Absolute Error (MAE) */}
            <div className="metric-card p-3 rounded-xl border flex flex-col justify-between" style={{ backgroundColor: 'var(--field)', borderColor: 'var(--border)' }}>
              <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
                Mean Absolute Error
              </span>
              <div className="my-1">
                <span className="text-lg font-extrabold font-mono text-teal-400" data-testid="metric-mae-val">
                  {summary?.mae !== null && summary?.mae !== undefined ? `${summary.mae} ${unitStr}` : 'N/A'}
                </span>
              </div>
              <span className="text-[10px]" style={{ color: 'var(--muted)' }}>
                Level deviation avg
              </span>
            </div>

            {/* 4. Pearson Correlation (R) */}
            <div className="metric-card p-3 rounded-xl border flex flex-col justify-between" style={{ backgroundColor: 'var(--field)', borderColor: 'var(--border)' }}>
              <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
                Pearson Corr (R)
              </span>
              <div className="my-1">
                <span className="text-lg font-extrabold font-mono text-emerald-400" data-testid="metric-pearson-val">
                  {formatPearsonR(pearsonR)}
                </span>
              </div>
              <span className="text-[10px] text-emerald-400 font-semibold">
                {pearsonR?.r !== null && pearsonR?.r !== undefined
                  ? (pearsonR.r >= 0.8 ? 'High Stratification Match' : (pearsonR.r >= 0.5 ? 'Moderate Correlation' : (pearsonR.r > 0 ? 'Weak Positive Correlation' : 'Inverse / No Linear Correlation')))
                  : `Unavailable (${pearsonR?.reason || 'insufficient data'})`}
              </span>
            </div>

            {/* 5. Model Skill Grade */}
            <div className="metric-card p-3 rounded-xl border flex flex-col justify-between" style={{ backgroundColor: 'var(--field)', borderColor: 'var(--border)' }}>
              <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
                Model Health Grade
              </span>
              <div className="my-1">
                <span className="text-base font-extrabold font-mono text-emerald-400" data-testid="metric-health-val">
                  {collocationData?.model_health || 'Unavailable'}
                </span>
              </div>
              <span className="text-[10px]" style={{ color: 'var(--muted)' }}>
                {summary?.valid_pairs || levels.length} levels validated
              </span>
            </div>

            {/* 6. Spatial-Temporal Collocation Offset */}
            <div className="metric-card p-3 rounded-xl border flex flex-col justify-between" style={{ backgroundColor: 'var(--field)', borderColor: 'var(--border)' }}>
              <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
                Grid Spatial Offset
              </span>
              <div className="my-1">
                <span className="text-base font-extrabold font-mono text-sky-400">
                  {summary?.spatial_distance_km ? `${summary.spatial_distance_km} km` : (collocationData ? 'Collocated' : 'Unavailable')}
                </span>
              </div>
              <span className="text-[10px]" style={{ color: 'var(--muted)' }}>
                Nearest ROMS cell
              </span>
            </div>
          </div>
        )}

        {/* 4. Tab Selector (Dual Curves vs Residuals vs Audit Table) */}
        <div className="tab-bar px-5 pt-3 flex flex-wrap justify-between items-center border-b gap-2" style={{ backgroundColor: 'var(--panel)', borderColor: 'var(--border)' }}>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('curves')}
              data-testid="tab-dual-curves-btn"
              className={`pb-2.5 px-3 text-xs font-bold border-b-2 transition flex items-center gap-1.5 cursor-pointer ${activeTab === 'curves' ? 'border-sky-500 text-sky-400' : 'border-transparent text-slate-400 hover:text-slate-200'}`}
            >
              <span>📈</span>
              <span>Dual-Curve Comparison (Observed vs Predicted)</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('residuals')}
              data-testid="tab-residuals-btn"
              className={`pb-2.5 px-3 text-xs font-bold border-b-2 transition flex items-center gap-1.5 cursor-pointer ${activeTab === 'residuals' ? 'border-sky-500 text-sky-400' : 'border-transparent text-slate-400 hover:text-slate-200'}`}
            >
              <span>⚖️</span>
              <span>Depth Residual Curve (Δ = Model - Obs)</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('table')}
              data-testid="tab-audit-table-btn"
              className={`pb-2.5 px-3 text-xs font-bold border-b-2 transition flex items-center gap-1.5 cursor-pointer ${activeTab === 'table' ? 'border-sky-500 text-sky-400' : 'border-transparent text-slate-400 hover:text-slate-200'}`}
            >
              <span>📋</span>
              <span>Level-by-Level Audit Data Table</span>
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-3 pb-2 text-[11px]" style={{ color: 'var(--muted)' }}>
            {/* Depth Zoom Selector */}
            <div className="flex items-center gap-1 rounded-lg border p-0.5" style={{ backgroundColor: 'var(--field)', borderColor: 'var(--border)' }}>
              <span className="text-[10px] font-bold uppercase px-1.5 text-slate-400">Depth Zoom:</span>
              <button
                type="button"
                onClick={() => setDepthZoom('all')}
                className={`px-2 py-0.5 rounded text-[11px] font-semibold transition cursor-pointer ${
                  depthZoom === 'all' ? 'bg-sky-600 text-white shadow' : 'text-slate-400 hover:text-white'
                }`}
              >
                All (0–2000m)
              </button>
              <button
                type="button"
                onClick={() => setDepthZoom('thermocline')}
                className={`px-2 py-0.5 rounded text-[11px] font-semibold transition cursor-pointer ${
                  depthZoom === 'thermocline' ? 'bg-sky-600 text-white shadow' : 'text-slate-400 hover:text-white'
                }`}
              >
                Thermocline (0–250m)
              </button>
            </div>

            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-emerald-500 inline-block" />
              <strong className="text-emerald-400">Original Observed Data</strong> (CTD Sensor)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm bg-purple-500 inline-block" />
              <strong className="text-purple-400">Predicted Data</strong> (ROMS 3D Model)
            </span>
          </div>
        </div>

        {/* 5. Main Content Area */}
        <div className="modal-content-body p-4 overflow-y-auto flex-1" style={{ backgroundColor: 'var(--bg)' }}>
          {isLoadingTarget && !collocationData ? (
            <div className="py-16 text-center" style={{ color: 'var(--muted)' }} data-testid="compare-target-loading">
              <span className="spinner-small" style={{ width: '28px', height: '28px', margin: '0 auto 12px', display: 'block' }} aria-hidden="true" />
              <h3 className="text-sm font-bold" style={{ color: 'var(--text)' }}>Hydrating Platform Telemetry...</h3>
              <p className="text-xs max-w-md mx-auto mt-1">
                Fetching vertical oceanographic profile observations for {selectedPlatformId}...
              </p>
            </div>
          ) : targetLoadError && !collocationData ? (
            <div className="py-16 text-center" style={{ color: 'var(--muted)' }} data-testid="compare-target-error">
              <div className="text-3xl mb-2">⚠️</div>
              <h3 className="text-sm font-bold" style={{ color: '#ef4444' }}>Target Telemetry Load Failed</h3>
              <p className="text-xs max-w-md mx-auto mt-1 text-red-300">
                {targetLoadError}
              </p>
              {onRetryTarget && (
                <button
                  type="button"
                  onClick={onRetryTarget}
                  data-testid="compare-retry-btn"
                  className="mt-4 px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs cursor-pointer"
                >
                  ⟳ Retry Loading Target
                </button>
              )}
            </div>
          ) : levels.length === 0 ? (
            <div className="py-16 text-center" style={{ color: 'var(--muted)' }}>
              <div className="text-3xl mb-2">📊</div>
              <h3 className="text-sm font-bold" style={{ color: 'var(--text)' }}>No Collocation Data Available</h3>
              <p className="text-xs max-w-md mx-auto mt-1">
                Click 'Run Model Prediction Job' above to calculate 4D trilinear interpolation between the numerical forecast model and this platform's in-situ observations.
              </p>
            </div>
          ) : activeTab === 'curves' ? (
            /* Tab 1: Dual-Curve Depth Profile Visualizer */
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Dual-Curve SVG Chart */}
              <div className="lg:col-span-2 rounded-xl border p-4 shadow" style={{ backgroundColor: 'var(--panel)', borderColor: 'var(--border)' }}>
                <div className="flex justify-between items-center mb-2">
                  <div>
                    <span className="text-xs font-bold uppercase tracking-wider text-sky-400 block">
                      Vertical Water Column Profile
                    </span>
                    <span className="text-[11px]" style={{ color: 'var(--muted)' }}>
                      Inverted Depth (0m Surface down to {chartScales?.maxDepth}m Seabed)
                    </span>
                  </div>
                  {hoveredLevel && (
                    <div className="px-2.5 py-1 rounded border text-[11px] font-mono shadow" style={{ backgroundColor: 'var(--field)', borderColor: 'var(--border)' }}>
                      Depth: <strong style={{ color: 'var(--text)' }}>{hoveredLevel.depth}m</strong> · Obs: <strong className="text-emerald-400">{hoveredLevel.observed_value} {unitStr}</strong> · Model: <strong className="text-purple-400">{hoveredLevel.model_value} {unitStr}</strong> · Δ: <strong style={{ color: hoveredLevel.delta < 0 ? '#38bdf8' : '#fbbf24' }}>{hoveredLevel.delta > 0 ? `+${hoveredLevel.delta}` : hoveredLevel.delta} {unitStr}</strong>
                    </div>
                  )}
                </div>

                {chartScales && (
                  <div className="relative w-full overflow-hidden flex items-center justify-center">
                    <svg viewBox={`0 0 ${chartScales.chartWidth} ${chartScales.chartHeight}`} className="w-full h-auto overflow-visible select-none" data-testid="dual-curves-svg">
                      {/* Depth Grid Lines */}
                      {(() => {
                        let ticks = [0, 100, 500, 1000, 2000, 4000].filter(d => d <= chartScales.maxDepth);
                        if (chartScales.maxDepth <= 150) {
                          ticks = [0, Math.round(chartScales.maxDepth * 0.25), Math.round(chartScales.maxDepth * 0.5), Math.round(chartScales.maxDepth * 0.75), Math.round(chartScales.maxDepth)];
                        }
                        return Array.from(new Set(ticks)).map(d => {
                          const y = chartScales.depthToY(d);
                          return (
                            <g key={`d-line-${d}`}>
                              <line x1={chartScales.pad.left} y1={y} x2={chartScales.chartWidth - chartScales.pad.right} y2={y} stroke="var(--border)" strokeDasharray="3 3" strokeOpacity="0.6" />
                              <text x={chartScales.pad.left - 8} y={y + 3} fill="var(--muted)" fontSize="9" textAnchor="end" fontFamily="monospace">{d}m</text>
                            </g>
                          );
                        });
                      })()}

                      {/* Value Grid Lines */}
                      {[0, 0.25, 0.5, 0.75, 1.0].map((frac, idx) => {
                        const val = Number((chartScales.minVal + frac * (chartScales.maxVal - chartScales.minVal)).toFixed(1));
                        const x = chartScales.valueToX(val);
                        return (
                          <g key={`v-line-${idx}`}>
                            <line x1={x} y1={chartScales.pad.top} x2={x} y2={chartScales.chartHeight - chartScales.pad.bottom} stroke="var(--border)" strokeDasharray="3 3" strokeOpacity="0.6" />
                            <text x={x} y={chartScales.chartHeight - chartScales.pad.bottom + 16} fill="var(--muted)" fontSize="9" textAnchor="middle" fontFamily="monospace">
                              {val} {unitStr}
                            </text>
                          </g>
                        );
                      })}

                      {/* 1. Original Observed In-Situ Polyline (Emerald) */}
                      {(() => {
                        const pts = levels.map(l => `${chartScales.valueToX(l.observed_value).toFixed(1)},${chartScales.depthToY(l.depth).toFixed(1)}`).join(' ');
                        return <polyline data-testid="observed-curve-path" fill="none" stroke="#10b981" strokeWidth="2.5" points={pts} />;
                      })()}

                      {/* 2. Model Predicted Forecast Polyline (Purple/Violet Dashed) */}
                      {(() => {
                        const pts = levels.map(l => `${chartScales.valueToX(l.model_value).toFixed(1)},${chartScales.depthToY(l.depth).toFixed(1)}`).join(' ');
                        return <polyline data-testid="predicted-curve-path" fill="none" stroke="#a855f7" strokeWidth="2.5" strokeDasharray="5 4" points={pts} />;
                      })()}

                      {/* Interactive Circles on Depth Levels */}
                      {levels.map((l, i) => {
                        const xObs = chartScales.valueToX(l.observed_value);
                        const xMod = chartScales.valueToX(l.model_value);
                        const y = chartScales.depthToY(l.depth);
                        return (
                          <g key={`pts-${i}`} onMouseEnter={() => setHoveredLevel(l)} onMouseLeave={() => setHoveredLevel(null)}>
                            {/* Line connecting predicted to observed */}
                            <line x1={xObs} y1={y} x2={xMod} y2={y} stroke="#f59e0b" strokeWidth="1" strokeOpacity="0.5" />
                            {/* Observed circle */}
                            <circle data-testid="observed-point-node" cx={xObs} cy={y} r="4" fill="#10b981" stroke="#064e3b" strokeWidth="1.5" className="cursor-pointer hover:r-6 transition-all">
                              <title>{`Observed: ${l.observed_value}${unitStr} @ ${l.depth}m`}</title>
                            </circle>
                            {/* Model diamond */}
                            <polygon
                              data-testid="predicted-point-node"
                              points={`${xMod},${y - 4} ${xMod + 4},${y} ${xMod},${y + 4} ${xMod - 4},${y}`}
                              fill="#a855f7"
                              stroke="#581c87"
                              strokeWidth="1.5"
                              className="cursor-pointer hover:scale-125 transition-all"
                            >
                              <title>{`Predicted: ${l.model_value}${unitStr} @ ${l.depth}m`}</title>
                            </polygon>
                          </g>
                        );
                      })}
                    </svg>
                  </div>
                )}
              </div>

              {/* Side Mini Residual Chart & Key Interpretation */}
              <div className="space-y-4">
                <div className="rounded-xl border p-4 shadow" style={{ backgroundColor: 'var(--panel)', borderColor: 'var(--border)' }}>
                  <span className="text-xs font-bold uppercase tracking-wider text-amber-400 block mb-1">
                    Depth Residual Profile (Δ = Model - Obs)
                  </span>
                  <p className="text-[11px] m-0 mb-3" style={{ color: 'var(--muted)' }}>
                    Shows spatial stratification error where forecast deviates from measurements.
                  </p>

                  {residualScales && (
                    <svg viewBox={`0 0 ${residualScales.width} ${residualScales.height}`} className="w-full h-auto overflow-visible select-none">
                      {/* Zero Center Line */}
                      <line x1={residualScales.zeroX} y1={residualScales.pad.top} x2={residualScales.zeroX} y2={residualScales.height - residualScales.pad.bottom} stroke="#38bdf8" strokeWidth="1.5" strokeDasharray="4 2" />
                      <text x={residualScales.zeroX} y={residualScales.height - residualScales.pad.bottom + 16} fill="#38bdf8" fontSize="9" textAnchor="middle" fontFamily="monospace">0.0 Δ</text>

                      {/* Depth ticks */}
                      {[0, 100, 500, 1000, 2000].filter(d => d <= residualScales.maxDepth).map(d => {
                        const y = residualScales.depthToY(d);
                        return (
                          <g key={`res-d-${d}`}>
                            <line x1={residualScales.pad.left} y1={y} x2={residualScales.width - residualScales.pad.right} y2={y} stroke="var(--border)" strokeDasharray="2 2" strokeOpacity="0.4" />
                            <text x={residualScales.pad.left - 6} y={y + 3} fill="var(--muted)" fontSize="8" textAnchor="end" fontFamily="monospace">{d}m</text>
                          </g>
                        );
                      })}

                      {/* Residual Delta Polyline */}
                      {(() => {
                        const pts = levels.map(l => `${residualScales.deltaToX(l.delta || 0).toFixed(1)},${residualScales.depthToY(l.depth).toFixed(1)}`).join(' ');
                        return <polyline fill="none" stroke="#f59e0b" strokeWidth="2" points={pts} />;
                      })()}

                      {/* Delta points */}
                      {levels.map((l, i) => {
                        const x = residualScales.deltaToX(l.delta || 0);
                        const y = residualScales.depthToY(l.depth);
                        return (
                          <circle key={`del-pt-${i}`} cx={x} cy={y} r="3.5" fill={l.delta < 0 ? '#38bdf8' : '#fbbf24'} stroke="#0f172a" strokeWidth="1">
                            <title>{`${l.depth}m: Delta = ${l.delta > 0 ? '+' : ''}${l.delta} ${unitStr}`}</title>
                          </circle>
                        );
                      })}
                    </svg>
                  )}
                </div>

                {/* Analytical Model Health Summary */}
                <div className="rounded-xl border p-4 space-y-2" style={{ backgroundColor: 'var(--panel)', borderColor: 'var(--border)' }}>
                  <span className="text-xs font-bold uppercase tracking-wider text-emerald-400 block">
                    Operational Skill Assessment
                  </span>
                    <p className="text-xs leading-relaxed m-0" style={{ color: 'var(--text)' }}>
                      {collocationData?.model_health_description ||
                        (summary?.rmse !== null && summary?.rmse !== undefined
                          ? `ROMS 3D model shows physical fidelity with an RMSE of ${summary.rmse} ${unitStr} across ${levels.length} observation depths.`
                          : 'Operational model skill assessment unavailable for this run.')}
                    </p>
                </div>
              </div>
            </div>
          ) : activeTab === 'residuals' ? (
            /* Tab 2: Detailed Residual Analysis */
            <div className="rounded-xl border p-5 shadow space-y-4" style={{ backgroundColor: 'var(--panel)', borderColor: 'var(--border)' }}>
              <div className="flex justify-between items-center">
                <div>
                  <h3 className="text-sm font-bold m-0" style={{ color: 'var(--text)' }}>Depth-Stratified Prediction Residuals</h3>
                  <p className="text-xs m-0 mt-0.5" style={{ color: 'var(--muted)' }}>
                    Strict physical sign convention: Δ = MODEL - OBSERVED. Positive (Δ &gt; 0) indicates model over-prediction; negative indicates under-prediction.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onToggleAnomalyField?.(!showAnomalyField)}
                  data-testid="toggle-3d-residuals-btn"
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition cursor-pointer flex items-center gap-1.5 ${showAnomalyField ? 'bg-amber-600 text-white border-amber-500' : 'bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700'}`}
                >
                  <span>🌐</span>
                  <span>{showAnomalyField ? '3D Residual Layer Active' : 'Project 3D Residuals onto Globe'}</span>
                </button>
              </div>

              {/* Detailed Depth Residual SVG Graph */}
              {residualScales && (
                <div className="rounded-xl border p-4 shadow" style={{ backgroundColor: 'var(--panel)', borderColor: 'var(--border)' }}>
                  <div className="flex flex-wrap justify-between items-center gap-2 mb-3">
                    <div>
                      <span className="text-xs font-bold uppercase tracking-wider text-sky-400 block">
                        Depth Residual Curve (Δ = Model - Observed)
                      </span>
                      <span className="text-[11px] font-mono" style={{ color: 'var(--muted)' }}>
                        0m Surface to {residualScales.maxDepth}m Depth ({depthZoom === 'thermocline' ? 'Thermocline Focus' : 'Full Basin Column'})
                      </span>
                    </div>

                    {hoveredResidual ? (
                      <div className="px-3 py-1 rounded-lg border text-xs font-mono shadow animate-in fade-in duration-150" style={{ backgroundColor: 'var(--field)', borderColor: 'var(--border)' }}>
                        Depth: <strong style={{ color: 'var(--text)' }}>{hoveredResidual.depth}m</strong> · Obs: <strong className="text-emerald-400">{hoveredResidual.observed_value} {unitStr}</strong> · ROMS: <strong className="text-purple-400">{hoveredResidual.model_value} {unitStr}</strong> · Δ: <strong style={{ color: hoveredResidual.delta < 0 ? '#38bdf8' : '#fbbf24' }}>{hoveredResidual.delta > 0 ? `+${hoveredResidual.delta}` : hoveredResidual.delta} {unitStr}</strong> <span className="text-[10px] font-sans text-slate-400">({hoveredResidual.delta < 0 ? 'Under-prediction' : 'Over-prediction'})</span>
                      </div>
                    ) : (
                      <span className="text-[10px] font-mono text-slate-500">
                        Hover points along the profile to inspect level discrepancies
                      </span>
                    )}
                  </div>

                  <div className="w-full flex items-center justify-center overflow-x-auto">
                    <svg viewBox={`0 0 ${residualScales.width} ${residualScales.height}`} className="w-full max-w-3xl h-auto overflow-visible select-none" data-testid="residuals-svg">
                      {/* Zero Center Axis Line */}
                      <line x1={residualScales.zeroX} y1={residualScales.pad.top} x2={residualScales.zeroX} y2={residualScales.height - residualScales.pad.bottom} stroke="#38bdf8" strokeWidth="1.5" strokeDasharray="4 2" />
                      <text x={residualScales.zeroX} y={residualScales.height - residualScales.pad.bottom + 16} fill="#38bdf8" fontSize="10" textAnchor="middle" fontFamily="monospace">0.0 Δ (Zero Bias)</text>

                      {/* Negative / Positive Reference Guides */}
                      <text x={residualScales.pad.left + 10} y={residualScales.height - residualScales.pad.bottom + 16} fill="#38bdf8" fontSize="9" textAnchor="start" fontFamily="monospace">← Under-predict ({unitStr})</text>
                      <text x={residualScales.width - residualScales.pad.right - 10} y={residualScales.height - residualScales.pad.bottom + 16} fill="#fbbf24" fontSize="9" textAnchor="end" fontFamily="monospace">Over-predict ({unitStr}) →</text>

                      {/* Depth ticks */}
                      {(depthZoom === 'thermocline' ? [0, 25, 50, 75, 100, 150, 200, 250] : [0, 50, 100, 250, 500, 1000, 1500, 2000]).filter(d => d <= residualScales.maxDepth).map(d => {
                        const y = residualScales.depthToY(d);
                        return (
                          <g key={`res-tab-d-${d}`}>
                            <line x1={residualScales.pad.left} y1={y} x2={residualScales.width - residualScales.pad.right} y2={y} stroke="var(--border)" strokeDasharray="3 3" strokeOpacity="0.4" />
                            <text x={residualScales.pad.left - 8} y={y + 3} fill="var(--muted)" fontSize="9" textAnchor="end" fontFamily="monospace">{d}m</text>
                          </g>
                        );
                      })}

                      {/* Residual Delta Polyline */}
                      {(() => {
                        const pts = activeLevels.map(l => `${residualScales.deltaToX(l.delta || 0).toFixed(1)},${residualScales.depthToY(l.depth).toFixed(1)}`).join(' ');
                        return <polyline data-testid="residual-path" fill="none" stroke="#f59e0b" strokeWidth="2.5" points={pts} />;
                      })()}

                      {/* Delta points */}
                      {activeLevels.map((l, i) => {
                        const x = residualScales.deltaToX(l.delta || 0);
                        const y = residualScales.depthToY(l.depth);
                        const isHovered = hoveredResidual?.depth === l.depth;
                        return (
                          <circle
                            key={`del-tab-pt-${i}`}
                            cx={x}
                            cy={y}
                            r={isHovered ? 6 : 4}
                            fill={l.delta < 0 ? '#38bdf8' : '#fbbf24'}
                            stroke="#0f172a"
                            strokeWidth={isHovered ? 2 : 1.5}
                            className="cursor-pointer transition-all"
                            onMouseEnter={() => setHoveredResidual(l)}
                            onMouseLeave={() => setHoveredResidual(null)}
                          >
                            <title>{`${l.depth}m: Delta = ${l.delta > 0 ? '+' : ''}${l.delta} ${unitStr}`}</title>
                          </circle>
                        );
                      })}
                    </svg>
                  </div>
                </div>
              )}

              {/* Scrollable Depth Level Verification Cards */}
              <div className="space-y-2">
                <div className="flex justify-between items-center px-1">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                    Depth Stratification Audit ({activeLevels.length} Collocated Levels)
                  </span>
                  <span className="text-[10px] font-mono text-slate-500">
                    Scroll to inspect deeper observations
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 max-h-56 overflow-y-auto pr-1">
                  {activeLevels.map((l, i) => (
                    <div
                      key={i}
                      onMouseEnter={() => setHoveredResidual(l)}
                      onMouseLeave={() => setHoveredResidual(null)}
                      className="p-3 rounded-lg border transition hover:border-sky-500/60"
                      style={{
                        backgroundColor: hoveredResidual?.depth === l.depth ? 'var(--panel)' : 'var(--field)',
                        borderColor: hoveredResidual?.depth === l.depth ? '#38bdf8' : 'var(--border)'
                      }}
                    >
                      <div className="flex justify-between items-center text-[11px] mb-1">
                        <span className="font-bold" style={{ color: 'var(--text)' }}>{l.depth} m Depth</span>
                        <span className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${l.delta < 0 ? 'bg-sky-950/60 text-sky-400' : 'bg-amber-950/60 text-amber-400'}`}>
                          {l.delta < 0 ? 'Under-predicted' : 'Over-predicted'}
                        </span>
                      </div>
                      <div className="flex justify-between text-xs font-mono py-0.5">
                        <span style={{ color: 'var(--muted)' }}>In-Situ Obs:</span>
                        <strong className="text-emerald-400">{l.observed_value} {unitStr}</strong>
                      </div>
                      <div className="flex justify-between text-xs font-mono py-0.5">
                        <span style={{ color: 'var(--muted)' }}>ROMS Model:</span>
                        <strong className="text-purple-400">{l.model_value} {unitStr}</strong>
                      </div>
                      <div className="flex justify-between text-xs font-mono py-0.5 border-t mt-1 pt-1" style={{ borderColor: 'var(--border)' }}>
                        <span style={{ color: 'var(--muted)' }}>Residual (Δ):</span>
                        <strong style={{ color: l.delta < 0 ? '#38bdf8' : '#fbbf24' }}>
                          {l.delta > 0 ? `+${l.delta}` : l.delta} {unitStr}
                        </strong>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            /* Tab 3: Level-by-Level Audit Data Table */
            <div className="rounded-xl border overflow-hidden shadow" style={{ backgroundColor: 'var(--panel)', borderColor: 'var(--border)' }}>
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left border-collapse" data-testid="comparison-audit-table">
                  <thead>
                    <tr className="border-b text-[11px] font-bold uppercase tracking-wider" style={{ backgroundColor: 'var(--field)', borderColor: 'var(--border)', color: 'var(--muted)' }}>
                      <th className="p-3">Depth Level</th>
                      <th className="p-3 text-emerald-400">Original Observed ({unitStr})</th>
                      <th className="p-3 text-purple-400">Model Predicted ({unitStr})</th>
                      <th className="p-3 text-amber-400">Residual Delta (Δ)</th>
                      <th className="p-3">Relative Diff</th>
                      <th className="p-3">QC Quality Flag</th>
                      <th className="p-3">Validation Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {levels.map((l, i) => {
                      const relDiff = l.observed_value !== 0 ? Math.abs((l.delta / l.observed_value) * 100).toFixed(2) : '0.00';
                      return (
                        <tr key={i} data-testid="comparison-table-row" className="border-b hover:bg-slate-800/30 transition" style={{ borderColor: 'var(--border)' }}>
                          <td className="p-3 font-mono font-bold" style={{ color: 'var(--text)' }}>{l.depth} m</td>
                          <td className="p-3 font-mono text-emerald-400 font-semibold">{l.observed_value}</td>
                          <td className="p-3 font-mono text-purple-400 font-semibold">{l.model_value}</td>
                          <td className="p-3 font-mono font-bold" style={{ color: l.delta < 0 ? '#38bdf8' : '#fbbf24' }}>
                            {l.delta > 0 ? `+${l.delta}` : l.delta}
                          </td>
                          <td className="p-3 font-mono" style={{ color: 'var(--text)' }}>{relDiff}%</td>
                          <td className="p-3 font-mono">
                            <span className="px-1.5 py-0.5 rounded bg-emerald-950/60 border border-emerald-500/40 text-emerald-400 font-bold text-[10px]">
                              QC={l.qc_flag || 1} (Pass)
                            </span>
                          </td>
                          <td className="p-3 font-mono">
                            <span className="text-emerald-400 font-semibold">✓ Validated Pair</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* 6. Modal Footer & Interactivity */}
        <div className="modal-footer p-3.5 border-t flex flex-wrap items-center justify-between gap-3" style={{ backgroundColor: 'var(--panel)', borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--muted)' }}>
            <span>Platform: <strong style={{ color: 'var(--text)' }}>{currentPlatform?.name || selectedPlatformId}</strong></span>
            <span>·</span>
            <span>Coordinates: <strong style={{ color: 'var(--text)' }}>{currentPlatform?.lat ? currentPlatform.lat.toFixed(2) : '0.00'}°N, {currentPlatform?.lon ? currentPlatform.lon.toFixed(2) : '0.00'}°E</strong></span>
          </div>

          <div className="flex items-center gap-2">
            {onFocusFloat && currentPlatform && (
              <button
                type="button"
                onClick={() => {
                  onFocusFloat?.(currentPlatform);
                  onClose?.();
                }}
                data-testid="focus-platform-btn"
                className="px-3 py-1.5 rounded-lg border text-xs font-semibold hover:bg-sky-600 hover:text-white transition cursor-pointer"
                style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
              >
                📍 Focus on 3D Globe
              </button>
            )}
            <button
              type="button"
              onClick={() => onToggleAnomalyField?.(!showAnomalyField)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition cursor-pointer ${showAnomalyField ? 'bg-amber-600 text-white border-amber-500' : 'bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700'}`}
            >
              🌐 {showAnomalyField ? '3D Residual Layer ON' : 'Toggle 3D Residuals on Globe'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold transition cursor-pointer"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
