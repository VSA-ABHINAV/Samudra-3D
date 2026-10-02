import React from 'react';

/**
 * BottomControlBar - Professional Floating Scientific Dock
 * Houses the primary Ocean Variable Selector and Continuous Forecast Timeline.
 * Adheres to .
 */
export default function BottomControlBar({
  selectedVariable,
  onSelectVariable,
  timeIndex,
  onSelectTime,
  isPlaying,
  onTogglePlay,
  onStepBack,
  onStepForward,
  playbackSpeed,
  onChangeSpeed,
  availableTimes = [],
  availableVariables = [],
  currentTimeTimestamp,
  isTransitioningDataset = false,
  isDatasetReady = true,
  datasetTransitionError = null,
  showCurrents = false,
  onToggleCurrents,
  showArgo = false,
  onToggleArgo,
  showGliders = false,
  onToggleGliders,
  showObservations = false,
  onToggleObservations,
  showAnomalies = false,
  onToggleAnomalies,
  showCrossSection = false,
  onToggleCrossSection,
  anomalyVariable = 'temperature',
  onChangeAnomalyVariable,
  anomalyThreshold = 0.5,
  onChangeAnomalyThreshold,
  anomalyData = null,
  isAnomalyLoading = false,
  anomalyError = null,
  onRetryAnomaly = null,
  insituSourceMode = 'REAL_LOCAL',
  onSelectSourceMode = null
}) {
  const variables = [
    { id: 'temperature', label: 'TEMP', unit: '°C', desc: 'Sea Water Potential Temperature' },
    { id: 'salinity', label: 'SALINITY', unit: 'PSU', desc: 'Practical Salinity' },
    { id: 'currents', label: 'CURRENTS', unit: 'm/s', desc: 'Horizontal Velocity Vector Field' }
  ];

  const isBlocked = isTransitioningDataset || !isDatasetReady || Boolean(datasetTransitionError);

  const supportsStreamlines = (() => {
    if (isBlocked || !availableVariables || availableVariables.length === 0) return false;
    const lower = availableVariables.map((v) => v.toLowerCase());
    if (lower.some((v) => ['currents', 'velocity', 'flow'].includes(v))) return true;
    const hasU = lower.some((v) => ['uo', 'u', 'vozocrtx', 'ucur'].includes(v));
    const hasV = lower.some((v) => ['vo', 'v', 'vomecrty', 'vcur'].includes(v));
    return hasU && hasV;
  })();

  const isVarSupported = (varId) => {
    if (isBlocked) return false;
    if (!availableVariables || availableVariables.length === 0) return true;
    const lower = availableVariables.map((v) => v.toLowerCase());
    if (varId === 'temperature') {
      return lower.some((v) => ['temperature', 'thetao', 'temp', 'sst', 'votemper'].includes(v));
    }
    if (varId === 'salinity') {
      return lower.some((v) => ['salinity', 'so', 'salt', 'vosaline'].includes(v));
    }
    if (varId === 'currents') {
      return lower.some((v) => ['currents', 'uo', 'vo', 'u', 'v', 'vozocrtx', 'vomecrty'].includes(v));
    }
    return lower.includes(varId.toLowerCase());
  };

  // Map available times to clean Day labels (e.g. "Jan 01", "Jan 02")
  const displayDays = availableTimes && availableTimes.length > 0
    ? availableTimes.map((t, idx) => {
        try {
          const d = new Date(t);
          return {
            index: idx,
            label: isNaN(d.getTime()) ? `T+${idx}` : d.toLocaleDateString('en-US', { month: 'short', day: '2-digit' }),
            iso: t
          };
        } catch {
          return { index: idx, label: `Day ${idx + 1}`, iso: t };
        }
      })
    : [{ index: 0, label: 'Step 1', iso: null }];

  return (
    <div className="bottom-control-dock glassmorphic-panel" role="region" aria-label="Variable and Timeline Controls">
      {/* Top Row: Variable and Layer Selectors */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2 border-b border-slate-800/80">
        <div className="flex items-center gap-1.5" role="tablist" aria-label="Ocean Variables">
          <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400 mr-1">
            VARIABLE:
          </span>
          {variables.map((v) => {
            const isActive = selectedVariable === v.id;
            const supported = isVarSupported(v.id);
            return (
              <button
                key={v.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                disabled={!supported || isBlocked}
                title={supported ? `${v.desc} (${v.unit})` : `${v.label} is not available in the active dataset`}
                className={`variable-tab-btn ${isActive ? 'active' : ''} ${!supported || isBlocked ? 'opacity-40 cursor-not-allowed' : ''}`}
                onClick={() => {
                  if (supported && !isBlocked) onSelectVariable(v.id);
                }}
              >
                <span className="font-bold">{v.label}</span>
                <span className="text-[10px] opacity-75 ml-1">({v.unit})</span>
                {!supported && <span className="text-[9px] ml-1 text-slate-500 font-mono">[N/A]</span>}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2" role="group" aria-label="Map Overlays and In-Situ Controls">
          <button
            type="button"
            className={`layer-toggle-btn ${showCurrents ? 'active' : ''} ${!supportsStreamlines ? 'opacity-40 cursor-not-allowed' : ''}`}
            onClick={() => {
              if (supportsStreamlines && !isBlocked) onToggleCurrents?.(!showCurrents);
            }}
            disabled={!supportsStreamlines || isBlocked}
            aria-pressed={showCurrents}
            title={
              !supportsStreamlines
                ? 'Current velocity vectors unsupported in active dataset'
                : showCurrents
                ? 'Hide current streamlines'
                : 'Show current streamlines'
            }
            data-testid="bottombar-streamlines-btn"
          >
            <span className="dot" aria-hidden="true" />
            <span>STREAMLINES</span>
          </button>
          <button
            type="button"
            className={`layer-toggle-btn ${showArgo ? 'active' : ''}`}
            onClick={() => onToggleArgo?.(!showArgo)}
            aria-pressed={showArgo}
            title={showArgo ? 'Hide Argo float markers' : 'Show Argo float markers'}
            data-testid="bottombar-argo-btn"
          >
            <span className="dot" aria-hidden="true" />
            <span>ARGO</span>
          </button>
          <button
            type="button"
            className={`layer-toggle-btn ${showGliders ? 'active' : ''}`}
            onClick={() => onToggleGliders?.(!showGliders)}
            aria-pressed={showGliders}
            title={showGliders ? 'Hide glider transect markers' : 'Show glider transect markers'}
            data-testid="bottombar-gliders-btn"
          >
            <span className="dot" aria-hidden="true" />
            <span>GLIDERS</span>
          </button>
          <button
            type="button"
            className={`layer-toggle-btn ${showObservations ? 'active' : ''}`}
            onClick={onToggleObservations}
            aria-pressed={showObservations}
            aria-expanded={showObservations}
            title={showObservations ? 'Close observation fleet drawer' : 'Open observation fleet drawer'}
            data-testid="bottombar-observations-btn"
          >
            <span className="dot" aria-hidden="true" />
            <span>FLEET DRAWER</span>
          </button>
          <button
            type="button"
            className={`layer-toggle-btn ${showAnomalies ? 'active' : ''}`}
            onClick={onToggleAnomalies}
            aria-pressed={showAnomalies}
            aria-expanded={showAnomalies}
            title={showAnomalies ? 'Hide Model vs Observation Anomaly Residual Field' : 'Show Model vs Observation Anomaly Residual Field'}
            data-testid="bottombar-anomalies-btn"
          >
            <span className="dot anomaly" aria-hidden="true" />
            <span>ANOMALIES</span>
          </button>
          <button
            type="button"
            className={`layer-toggle-btn ${showCrossSection ? 'active' : ''}`}
            onClick={onToggleCrossSection}
            aria-pressed={showCrossSection}
            aria-expanded={showCrossSection}
            title={showCrossSection ? 'Close Ocean Cross-Section & Vertical Profile tool' : 'Open Ocean Cross-Section & Vertical Profile tool'}
            data-testid="bottombar-transect-btn"
          >
            <span className="dot" style={{ backgroundColor: '#06b6d4' }} aria-hidden="true" />
            <span>CROSS-SECTION</span>
          </button>
        </div>
      </div>

      {/* Anomaly Controls Strip (visible when Anomaly layer is enabled) */}
      {showAnomalies && (
        <div
          className="flex flex-wrap items-center justify-between gap-3 px-4 py-2 bg-slate-950/80 border-b border-slate-800/80 text-xs"
          data-testid="anomaly-controls-panel"
        >
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-1.5">
              <label htmlFor="source-mode-select" className="text-[10px] font-mono text-slate-400 uppercase font-semibold">
                Source:
              </label>
              <select
                id="source-mode-select"
                data-testid="source-mode-select"
                value={insituSourceMode}
                onChange={(e) => onSelectSourceMode?.(e.target.value)}
                className="bg-slate-900 border border-slate-700 text-slate-200 rounded px-2 py-0.5 text-xs font-mono focus:border-cyan-400 outline-none"
              >
                <option value="REAL_LOCAL">Real (Local Files)</option>
                <option value="SYNTHETIC">Synthetic (ROMS)</option>
                <option value="ALL">All Sources (Mixed)</option>
              </select>
            </div>

            <div className="flex items-center gap-1.5">
              <label htmlFor="anomaly-variable-select" className="text-[10px] font-mono text-slate-400 uppercase font-semibold">
                Variable:
              </label>
              <select
                id="anomaly-variable-select"
                data-testid="anomaly-variable-select"
                value={anomalyVariable}
                onChange={(e) => onChangeAnomalyVariable?.(e.target.value)}
                className="bg-slate-900 border border-slate-700 text-slate-200 rounded px-2 py-0.5 text-xs font-mono focus:border-cyan-400 outline-none"
              >
                <option value="temperature">Temperature (°C)</option>
                <option value="salinity">Salinity (PSU)</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <label htmlFor="anomaly-threshold-slider" className="text-[10px] font-mono text-slate-400 uppercase font-semibold">
                Threshold:
              </label>
              <input
                id="anomaly-threshold-slider"
                data-testid="anomaly-threshold-slider"
                type="range"
                min={anomalyVariable === 'temperature' ? '0.1' : '0.02'}
                max={anomalyVariable === 'temperature' ? '3.0' : '1.0'}
                step={anomalyVariable === 'temperature' ? '0.1' : '0.02'}
                value={anomalyThreshold}
                onChange={(e) => onChangeAnomalyThreshold?.(parseFloat(e.target.value))}
                className="w-24 accent-rose-500 h-1 bg-slate-800 rounded cursor-pointer"
              />
              <span data-testid="anomaly-threshold-value" className="font-mono text-rose-400 font-bold text-xs">
                {anomalyThreshold.toFixed(anomalyVariable === 'temperature' ? 1 : 2)} {anomalyVariable === 'temperature' ? '°C' : 'PSU'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3 font-mono text-[11px]">
            <span data-testid="anomaly-source-badge" className="text-slate-400">
              Active: <strong className="text-slate-200 font-bold">{insituSourceMode}</strong>
            </span>

            {isAnomalyLoading && (
              <span data-testid="anomaly-loading-indicator" className="text-amber-400 animate-pulse font-semibold">
                Loading residuals...
              </span>
            )}

            {anomalyError && !isAnomalyLoading && (
              <div data-testid="anomaly-error-panel" className="flex items-center gap-2 text-rose-400">
                <span>{anomalyError}</span>
                <button
                  type="button"
                  data-testid="anomaly-retry-btn"
                  onClick={onRetryAnomaly}
                  className="px-1.5 py-0.5 bg-rose-950/80 border border-rose-700 text-rose-200 rounded text-[10px] hover:bg-rose-900"
                >
                  Retry
                </button>
              </div>
            )}

            {!isAnomalyLoading && !anomalyError && anomalyData && (
              <>
                <span data-testid="anomaly-coverage-badge" className="text-slate-400">
                  Coverage: <strong className="text-cyan-400">{anomalyData.total_valid_pairs}</strong> pairs (<strong className="text-cyan-400">{anomalyData.platform_count}</strong> platforms)
                </span>
                {anomalyData.bias !== null && (
                  <span data-testid="anomaly-metrics-summary" className="text-slate-300 text-[10px]">
                    Bias: {anomalyData.bias > 0 ? `+${anomalyData.bias.toFixed(2)}` : anomalyData.bias.toFixed(2)} | MAE: {anomalyData.mae.toFixed(2)} | RMSE: {anomalyData.rmse.toFixed(2)}
                  </span>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Bottom Row: Scientific Timeline Scrub Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-2.5">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            className="timeline-ctrl-btn"
            onClick={onStepBack}
            disabled={isBlocked}
            aria-label="Previous Forecast Step"
            title="Step Back"
          >
            &lsaquo;
          </button>
          <button
            type="button"
            className="timeline-play-btn"
            onClick={onTogglePlay}
            disabled={isBlocked}
            aria-label={isPlaying ? 'Pause Forecast Animation' : 'Play Forecast Animation'}
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? '❚❚' : '▶'}
          </button>
          <button
            type="button"
            className="timeline-ctrl-btn"
            onClick={onStepForward}
            disabled={isBlocked}
            aria-label="Next Forecast Step"
            title="Step Forward"
          >
            &rsaquo;
          </button>
        </div>

        {/* Timeline Day Markers */}
        <div className="flex-1 flex items-center justify-between gap-1 overflow-x-auto px-2">
          {displayDays.map((d) => {
            const isCurrent = timeIndex === d.index;
            return (
              <button
                key={d.index}
                type="button"
                className={`timeline-step-chip ${isCurrent ? 'active' : ''}`}
                disabled={isBlocked}
                onClick={() => {
                  if (!isBlocked) onSelectTime(d.index);
                }}
              >
                <span className="step-indicator" />
                <span className="step-label font-mono">{d.label}</span>
              </button>
            );
          })}
        </div>

        {/* Playback Speed & Current Timestamp */}
        <div className="flex items-center gap-3 text-xs font-mono text-slate-300">
          <div className="flex items-center gap-1 bg-slate-900/60 px-2 py-1 rounded border border-slate-700/60">
            <span className="text-[10px] text-slate-500">SPEED:</span>
            {[0.5, 1.0, 2.0].map((s) => (
              <button
                key={s}
                type="button"
                className={`speed-chip ${playbackSpeed === s ? 'active' : ''}`}
                disabled={isBlocked}
                onClick={() => onChangeSpeed(s)}
              >
                {s}x
              </button>
            ))}
          </div>

          <div className="current-timestamp-badge font-mono text-sky-300 bg-sky-950/60 px-2.5 py-1 rounded border border-sky-800/60" data-testid="current-time-badge">
            {datasetTransitionError ? (
              <span className="text-rose-400 font-bold">DATASET ERROR</span>
            ) : isBlocked ? (
              <span className="text-amber-400">SYNCING DATASET...</span>
            ) : availableTimes && availableTimes[timeIndex] ? (
              availableTimes[timeIndex].includes('T') ? availableTimes[timeIndex].replace('T', ' ').slice(0, 16) + ' UTC' : availableTimes[timeIndex]
            ) : currentTimeTimestamp ? (
              currentTimeTimestamp.includes('T') ? currentTimeTimestamp.replace('T', ' ').slice(0, 16) + ' UTC' : currentTimeTimestamp
            ) : (
              'Active Simulation'
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
