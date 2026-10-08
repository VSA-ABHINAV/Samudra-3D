import { useState, useMemo, useEffect, useRef } from 'react';
import {
  cleanProfileData,
  createProfileScales,
  generateProfileSvgPaths,
  generateAxisTicks,
  computeIsopycnalContours,
  computePotentialDensity,
  generateModelOverlaySvgPath
} from '../utils/profileCharts.js';
import { formatFloatCoordinates, formatFloatDate } from '../utils/argoProfiles.js';
import { fetchProfileCollocation, fetchGliderCollocation } from '../services/api.js';

/**
 * ProfileModal - Interactive Oceanographic Sensor Profile Inspector
 */
export default function ProfileModal({
  selectedFloat = null,
  onSelectFloat = null,
  collocation = null,
  isLoading = false,
  error = null,
  onRetry = null
}) {
  const [activeTab, setActiveTab] = useState('temperature'); // 'temperature' | 'salinity' | 'ts'
  const [hoveredPoint, setHoveredPoint] = useState(null);
  const [showModelOverlay, setShowModelOverlay] = useState(true);
  const [fetchedCollocation, setFetchedCollocation] = useState(null);
  const closeBtnRef = useRef(null);

  const isModel = Boolean(selectedFloat?.isModelProfile || selectedFloat?.platform_type === 'model_profile');
  const explicitType = selectedFloat?.platform_type || selectedFloat?.type;
  const isGlider = Boolean(
    !isModel && (
      explicitType === 'glider' ||
      (!explicitType && (
        Boolean(selectedFloat?.mission_name) ||
        (Array.isArray(selectedFloat?.waypoints) && selectedFloat.waypoints.length > 0)
      ))
    )
  );
  const isBuoy = Boolean(
    !isModel && (
      explicitType === 'buoy' ||
      explicitType === 'moored_buoy' ||
      (!explicitType && !isGlider && Boolean(selectedFloat?.id?.includes('BUOY')))
    )
  );
  const isArgo = Boolean(
    !isModel && !isBuoy && (
      explicitType === 'argo' ||
      explicitType === 'sensor' ||
      (!explicitType && !isGlider && (
        Boolean(selectedFloat?.wmo_id) ||
        (Array.isArray(selectedFloat?.depths) && selectedFloat.depths.length > 0)
      ))
    )
  );

  // Fetch collocation data when observation platform is selected (skip for model profiles)
  useEffect(() => {
    let ignore = false;
    setFetchedCollocation(null);
    if (selectedFloat && !isModel) {
      if (!isGlider && !isArgo && !isBuoy) return;
      const fetchPromise = isGlider
        ? fetchGliderCollocation(selectedFloat.id)
        : fetchProfileCollocation(selectedFloat.id);

      fetchPromise
        .then((data) => {
          if (!ignore && data) {
            setFetchedCollocation(data);
          }
        })
        .catch((err) => {
          console.warn('Collocation fetch note:', err.message);
        });
    }
    return () => {
      ignore = true;
    };
  }, [selectedFloat, isModel, isGlider, isArgo, isBuoy]);

  const activeCollocation = (selectedFloat && !isModel) ? (collocation || fetchedCollocation) : null;

  // Normalize depths, temperature, and salinity across Argo (depth arrays) and Glider (waypoints)
  const depths = useMemo(() => {
    if (Array.isArray(selectedFloat?.depths) && selectedFloat.depths.length > 0) return selectedFloat.depths;
    if (Array.isArray(selectedFloat?.waypoints)) return selectedFloat.waypoints.map(w => w.depth);
    return [];
  }, [selectedFloat]);

  const temperatures = useMemo(() => {
    if (Array.isArray(selectedFloat?.temperature) && selectedFloat.temperature.length > 0) return selectedFloat.temperature;
    if (Array.isArray(selectedFloat?.waypoints)) return selectedFloat.waypoints.map(w => w.observed_temp ?? w.temperature);
    return [];
  }, [selectedFloat]);

  const salinities = useMemo(() => {
    if (Array.isArray(selectedFloat?.salinity) && selectedFloat.salinity.length > 0) return selectedFloat.salinity;
    if (Array.isArray(selectedFloat?.waypoints)) return selectedFloat.waypoints.map(w => w.observed_sal ?? w.salinity);
    return [];
  }, [selectedFloat]);

  const hasData = Boolean(selectedFloat && selectedFloat.has_observations !== false && depths.length > 0);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && (selectedFloat || isLoading || error)) {
        onSelectFloat?.(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedFloat, isLoading, error, onSelectFloat]);

  // Clean data for Temperature
  const tempData = useMemo(() => {
    if (!selectedFloat || depths.length === 0) return null;
    return cleanProfileData(
      depths,
      temperatures,
      selectedFloat.qc_flags
    );
  }, [selectedFloat, depths, temperatures]);

  // Collocated model levels
  const currentModelLevels = useMemo(() => {
    if (!activeCollocation || isModel) return [];
    if (activeCollocation.temperature_levels || activeCollocation.salinity_levels) {
      return activeTab === 'temperature'
        ? activeCollocation.temperature_levels || []
        : activeCollocation.salinity_levels || [];
    }
    if (activeCollocation.waypoints) {
      return activeCollocation.waypoints.map(w => ({
        depth: w.depth,
        observed_value: activeTab === 'temperature' ? w.observed_temp : w.observed_sal,
        model_value: activeTab === 'temperature' ? w.model_temp : w.model_sal,
        delta: activeTab === 'temperature' ? w.delta_temp : w.delta_sal,
        valid: w.valid
      })).filter(l => l.depth !== null && l.depth !== undefined);
    }
    return [];
  }, [activeCollocation, activeTab, isModel]);

  const currentSummary = useMemo(() => {
    if (!activeCollocation || isModel) return null;
    if (activeTab === 'temperature') {
      return activeCollocation.temperature || activeCollocation.temperature_summary;
    }
    return activeCollocation.salinity || activeCollocation.salinity_summary;
  }, [activeCollocation, activeTab, isModel]);

  // Clean data for Salinity
  const salData = useMemo(() => {
    if (!selectedFloat || depths.length === 0) return null;
    return cleanProfileData(
      depths,
      salinities,
      selectedFloat.qc_flags
    );
  }, [selectedFloat, depths, salinities]);

  if (isLoading && !hasData) {
    return (
      <section
        className="profile-modal-container"
        aria-labelledby="profile-heading"
        data-testid="profile-modal-loading"
        style={{
          background: 'var(--panel)',
          borderRadius: '8px',
          border: '1px solid var(--border)',
          padding: '24px',
          marginTop: '8px',
          textAlign: 'center'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '8px' }}>
          <button
            type="button"
            onClick={() => onSelectFloat?.(null)}
            aria-label="Close profile inspector"
            style={{
              padding: '3px 7px',
              fontSize: '11px',
              cursor: 'pointer',
              background: 'var(--field)',
              border: '1px solid var(--border)',
              borderRadius: '4px',
              color: 'var(--text)'
            }}
            data-testid="deselect-float-btn"
          >
            ✕ Close
          </button>
        </div>
        <div style={{ padding: '24px 0' }}>
          <span className="spinner-small" style={{ width: '24px', height: '24px', margin: '0 auto 12px', display: 'block' }} aria-hidden="true" />
          <p style={{ margin: 0, fontSize: '13px', fontWeight: 600, color: 'var(--text)' }}>
            Loading platform telemetry & profile details...
          </p>
          <p style={{ margin: '4px 0 0', fontSize: '11px', color: 'var(--muted)' }}>
            {selectedFloat?.id ? `Fetching vertical observations for ${selectedFloat.name || selectedFloat.id}` : 'Hydrating in-situ telemetry...'}
          </p>
        </div>
      </section>
    );
  }

  if (error && !hasData) {
    return (
      <section
        className="profile-modal-container"
        aria-labelledby="profile-heading"
        data-testid="profile-modal-error"
        style={{
          background: 'var(--panel)',
          borderRadius: '8px',
          border: '1px solid var(--border)',
          padding: '20px',
          marginTop: '8px'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span className="subtle-tag" style={{ background: '#ef4444', color: '#fff', fontWeight: 700, fontSize: '10px' }}>
                TELEMETRY ERROR
              </span>
            </div>
            <h3 id="profile-heading" style={{ fontSize: '14px', fontWeight: 600, marginTop: '4px', color: 'var(--text)' }}>
              {selectedFloat?.name || selectedFloat?.id || 'In-Situ Platform'} • Profile Ingestion Failed
            </h3>
          </div>
          <button
            type="button"
            onClick={() => onSelectFloat?.(null)}
            aria-label="Close profile inspector"
            style={{
              padding: '3px 7px',
              fontSize: '11px',
              cursor: 'pointer',
              background: 'var(--field)',
              border: '1px solid var(--border)',
              borderRadius: '4px',
              color: 'var(--text)'
            }}
            data-testid="deselect-float-btn"
          >
            ✕ Close
          </button>
        </div>

        <div style={{ padding: '16px', backgroundColor: 'var(--field)', borderRadius: '6px', textAlign: 'center', marginBottom: '12px' }}>
          <span style={{ fontSize: '24px', display: 'block', marginBottom: '6px' }}>⚠️</span>
          <p style={{ margin: '0 0 6px 0', fontSize: '13px', fontWeight: 600, color: '#ef4444' }}>
            Failed to Load Platform Profile
          </p>
          <p style={{ margin: 0, fontSize: '11px', color: 'var(--muted)', lineHeight: 1.4 }}>
            {error}
          </p>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              data-testid="profile-retry-btn"
              style={{
                padding: '6px 12px',
                fontSize: '11px',
                fontWeight: 600,
                cursor: 'pointer',
                background: 'var(--primary, #0284c7)',
                color: '#fff',
                border: 'none',
                borderRadius: '4px'
              }}
            >
              ⟳ Retry
            </button>
          )}
          <button
            type="button"
            onClick={() => onSelectFloat?.(null)}
            style={{
              padding: '6px 12px',
              fontSize: '11px',
              cursor: 'pointer',
              background: 'var(--field)',
              border: '1px solid var(--border)',
              borderRadius: '4px',
              color: 'var(--text)'
            }}
          >
            Close
          </button>
        </div>
      </section>
    );
  }

  if (!selectedFloat) {
    return (
      <section className="profile-placeholder" aria-labelledby="profile-heading" data-testid="profile-placeholder">
        <span className="profile-symbol" aria-hidden="true">⌖</span>
        <h3 id="profile-heading">No sensor selected</h3>
        <p className="helper">Click an Argo float marker on the 3D globe or choose from the sidebar dropdown to view vertical depth curves.</p>
        <button type="button" disabled aria-describedby="profile-help">
          View depth profile
        </button>
        <p className="helper" id="profile-help">Profile inspection is ready. Select an active sensor to view depth profiles and T-S diagram.</p>
      </section>
    );
  }

  const wmoId = selectedFloat.wmo_id || selectedFloat.metadata?.wmo_id || selectedFloat.id;
  const dataCentre = selectedFloat.metadata?.data_centre || 'Not supplied';
  const cycleNumber = selectedFloat.metadata?.cycle_number ?? 'N/A';
  const sourceMode = selectedFloat.source_mode === 'SYNTHETIC' ? 'OPERATIONAL' : (selectedFloat.source_mode || 'OPERATIONAL');
  const qc = selectedFloat.qc_summary || (selectedFloat.qc_flags && selectedFloat.qc_flags.length > 0 ? {
    pass_rate_pct: Math.round((selectedFloat.qc_flags.filter(f => f === 1 || f === 2).length / selectedFloat.qc_flags.length) * 100),
    good: selectedFloat.qc_flags.filter(f => f === 1 || f === 2).length,
    total: selectedFloat.qc_flags.length
  } : null);

  if (!hasData) {
    if (isModel) {
      return (
        <section
          className="profile-modal-container"
          aria-labelledby="profile-heading"
          data-testid="profile-modal-model-unavailable"
          style={{
            background: 'var(--panel)',
            borderRadius: '8px',
            border: '1px solid var(--border)',
            padding: '14px',
            marginTop: '8px'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span className="subtle-tag" style={{ background: '#0284c7', color: '#fff', fontWeight: 700, fontSize: '10px' }}>
                  NUMERICAL MODEL PROFILE
                </span>
                <span style={{ fontSize: '10px', color: '#fbbf24', background: 'rgba(245, 158, 11, 0.15)', padding: '1px 6px', borderRadius: '3px', fontWeight: 600 }}>
                  DATA UNAVAILABLE
                </span>
              </div>
              <h3 id="profile-heading" style={{ fontSize: '14px', fontWeight: 600, marginTop: '4px', color: 'var(--text)' }}>
                Model Profile • {formatFloatCoordinates(selectedFloat.lat, selectedFloat.lon)}
              </h3>
            </div>
            <button
              type="button"
              onClick={() => onSelectFloat?.(null)}
              aria-label="Close profile inspector"
              style={{
                padding: '3px 7px',
                fontSize: '11px',
                cursor: 'pointer',
                background: 'var(--field)',
                border: '1px solid var(--border)',
                borderRadius: '4px',
                color: 'var(--text)'
              }}
              data-testid="deselect-float-btn"
            >
              ✕ Close
            </button>
          </div>

          <div style={{ padding: '16px', backgroundColor: 'var(--field)', borderRadius: '6px', textAlign: 'center', marginBottom: '12px' }}>
            <span style={{ fontSize: '24px', display: 'block', marginBottom: '6px' }}>🌊</span>
            <p style={{ margin: '0 0 6px 0', fontSize: '13px', fontWeight: 600, color: '#f59e0b' }}>
              Model Profile Data Unavailable
            </p>
            <p style={{ margin: 0, fontSize: '11px', color: 'var(--muted)', lineHeight: 1.4 }}>
              {selectedFloat.unavailableReason || 'Selected coordinate lies on land or outside active numerical model domain. Vertical column cannot be extracted.'}
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px', fontSize: '11px' }}>
            <div style={{ background: 'var(--field)', padding: '6px 8px', borderRadius: '4px' }}>
              <span style={{ color: 'var(--muted)', display: 'block' }}>Target Location:</span>
              <strong>{formatFloatCoordinates(selectedFloat.lat, selectedFloat.lon)}</strong>
            </div>
            <div style={{ background: 'var(--field)', padding: '6px 8px', borderRadius: '4px' }}>
              <span style={{ color: 'var(--muted)', display: 'block' }}>Active Dataset:</span>
              <strong>{selectedFloat.datasetName || 'Active Model Dataset'}</strong>
            </div>
            <div style={{ background: 'var(--field)', padding: '6px 8px', borderRadius: '4px' }}>
              <span style={{ color: 'var(--muted)', display: 'block' }}>Simulation Timestamp:</span>
              <span>{selectedFloat.timestamp ? `${formatFloatDate(selectedFloat.timestamp)} (T+${selectedFloat.time_idx ?? 0})` : 'Unavailable'}</span>
            </div>
          </div>
        </section>
      );
    }

    return (
      <section
        className="profile-modal-container"
        aria-labelledby="profile-heading"
        data-testid="profile-modal-empty-state"
        style={{
          background: 'var(--panel)',
          borderRadius: '8px',
          border: '1px solid var(--border)',
          padding: '14px',
          marginTop: '8px'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span className="subtle-tag" style={{ background: 'var(--field)', color: 'var(--accent)', fontWeight: 600, fontSize: '10px' }}>
                {(selectedFloat.platform_type || 'sensor').toUpperCase()}
              </span>
              <span style={{ fontSize: '10px', color: '#fbbf24', background: 'rgba(245, 158, 11, 0.15)', padding: '1px 6px', borderRadius: '3px', fontWeight: 600 }}>
                PENDING INGESTION
              </span>
            </div>
            <h3 id="profile-heading" style={{ fontSize: '14px', fontWeight: 600, marginTop: '4px', color: 'var(--text)' }}>
              {selectedFloat.name || `Platform ${wmoId}`}
            </h3>
          </div>
          <button
            type="button"
            onClick={() => onSelectFloat?.(null)}
            aria-label="Close profile inspector"
            style={{
              padding: '3px 7px',
              fontSize: '11px',
              cursor: 'pointer',
              background: 'var(--field)',
              border: '1px solid var(--border)',
              borderRadius: '4px',
              color: 'var(--text)'
            }}
            data-testid="deselect-float-btn"
          >
            ✕ Close
          </button>
        </div>

        <div style={{ padding: '16px', backgroundColor: 'var(--field)', borderRadius: '6px', textAlign: 'center', marginBottom: '12px' }}>
          <span style={{ fontSize: '24px', display: 'block', marginBottom: '6px' }}>📡</span>
          <p style={{ margin: '0 0 6px 0', fontSize: '13px', fontWeight: 600, color: 'var(--text)' }}>
            No observation available for this platform.
          </p>
          <p style={{ margin: 0, fontSize: '11px', color: 'var(--muted)', lineHeight: 1.4 }}>
            This platform is registered in the institutional fleet catalog. Telemetric oceanographic profiles have not yet been ingested.
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '6px', fontSize: '11px' }}>
          <div style={{ background: 'var(--field)', padding: '6px 8px', borderRadius: '4px' }}>
            <span style={{ color: 'var(--muted)', display: 'block' }}>Platform ID:</span>
            <strong>{wmoId}</strong>
          </div>
          <div style={{ background: 'var(--field)', padding: '6px 8px', borderRadius: '4px' }}>
            <span style={{ color: 'var(--muted)', display: 'block' }}>Coordinates:</span>
            <strong>{formatFloatCoordinates(selectedFloat.lat || selectedFloat.latitude, selectedFloat.lon || selectedFloat.longitude)}</strong>
          </div>
          <div style={{ background: 'var(--field)', padding: '6px 8px', borderRadius: '4px' }}>
            <span style={{ color: 'var(--muted)', display: 'block' }}>Deployment Status:</span>
            <span style={{ color: '#fbbf24', fontWeight: 600 }}>Registered / Standby</span>
          </div>
          <div style={{ background: 'var(--field)', padding: '6px 8px', borderRadius: '4px' }}>
            <span style={{ color: 'var(--muted)', display: 'block' }}>Operating Agency:</span>
            <span>{selectedFloat.organization || 'MoES / INCOIS'}</span>
          </div>
        </div>
      </section>
    );
  }

  // Chart configuration
  const chartWidth = 440;
  const chartHeight = 280;
  const padding = { top: 20, right: 25, bottom: 35, left: 55 };

  return (
    <section
      className="profile-modal-container"
      aria-labelledby="profile-heading"
      data-testid="profile-modal-container"
      style={{
        background: 'var(--panel)',
        borderRadius: '8px',
        border: '1px solid var(--border)',
        padding: '12px',
        marginTop: '8px'
      }}
    >
      <div data-testid="profile-details">
        {/* 1. Modal Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span className="subtle-tag" style={{ background: isModel ? '#0284c7' : 'var(--field)', color: isModel ? '#fff' : 'var(--accent)', fontWeight: 700, fontSize: '10px' }}>
                {isModel ? 'NUMERICAL MODEL PROFILE' : (isGlider ? 'GLIDER TRANSECT' : (isBuoy ? 'MOORED BUOY' : (isArgo ? 'ARGO FLOAT' : 'UNKNOWN PLATFORM')))}
              </span>
              <span style={{ fontSize: '10px', color: 'var(--muted)', background: 'var(--field)', padding: '1px 5px', borderRadius: '3px' }}>
                {isModel ? (selectedFloat.datasetName || 'Unavailable') : (selectedFloat.provenance_badge || sourceMode)}
              </span>
              {isModel ? (
                <span style={{ fontSize: '10px', color: '#38bdf8', background: 'var(--field)', padding: '1px 5px', borderRadius: '3px', fontWeight: 600 }}>
                  {selectedFloat.depths.length} Depths ({Math.min(...selectedFloat.depths).toFixed(1)}m – {Math.max(...selectedFloat.depths).toFixed(1)}m)
                </span>
              ) : qc ? (
                <span
                  style={{
                    fontSize: '10px',
                    color: qc.pass_rate_pct >= 90 ? 'var(--accent)' : '#f43f5e',
                    background: 'var(--field)',
                    padding: '1px 5px',
                    borderRadius: '3px',
                    fontWeight: 600
                  }}
                  data-testid="qc-badge"
                >
                  {qc.pass_rate_pct}% Pass ({qc.good ?? qc.total}/{qc.total} levels)
                </span>
              ) : (
                <span
                  style={{
                    fontSize: '10px',
                    color: 'var(--muted)',
                    background: 'var(--field)',
                    padding: '1px 5px',
                    borderRadius: '3px',
                    fontWeight: 600
                  }}
                  data-testid="qc-badge"
                >
                  QC: Not reported
                </span>
              )}
            </div>
            <h3 id="profile-heading" style={{ fontSize: '14px', fontWeight: 600, marginTop: '4px', color: 'var(--text)' }} data-testid="profile-title">
              {isModel
                ? `Model Water Column Profile • ${formatFloatCoordinates(selectedFloat.lat, selectedFloat.lon)}`
                : (selectedFloat?.mission_name || selectedFloat?.name || (isGlider ? `Glider ${selectedFloat?.id}` : (isBuoy ? `Buoy ${selectedFloat?.id}` : (isArgo ? `Float ${wmoId}` : `Platform ${selectedFloat?.id}`))))}
            </h3>
            {(selectedFloat.provenance_note || selectedFloat.metadata?.provenance_note) && (
              <p style={{ margin: '2px 0 0', fontSize: '10px', color: '#fbbf24', fontFamily: 'monospace' }} data-testid="provenance-note">
                ℹ️ {selectedFloat.provenance_note || selectedFloat.metadata?.provenance_note}
              </p>
            )}
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={() => onSelectFloat?.(null)}
            aria-label="Close profile inspector"
            style={{
              padding: '3px 7px',
              fontSize: '11px',
              cursor: 'pointer',
              background: 'var(--field)',
              border: '1px solid var(--border)',
              borderRadius: '4px',
              color: 'var(--text)'
            }}
            data-testid="deselect-float-btn"
            className="close-profile-btn"
          >
            ✕ Close
          </button>
        </div>

        {/* 2. Sensor Metadata Summary Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '4px', fontSize: '10px', marginBottom: '8px' }}>
          <div style={{ background: 'var(--field)', padding: '4px 6px', borderRadius: '4px' }}>
            <span style={{ color: 'var(--muted)', display: 'block' }}>{isModel ? 'Profile Type' : isGlider ? 'Platform / Mission' : (isBuoy ? 'Station / WMO' : 'WMO ID')}</span>
            <strong data-testid={isModel ? 'model-type-val' : 'wmo-number-val'}>{isModel ? 'Numerical Column' : (selectedFloat.mission_name || wmoId)}</strong>
          </div>
          <div style={{ background: 'var(--field)', padding: '4px 6px', borderRadius: '4px' }}>
            <span style={{ color: 'var(--muted)', display: 'block' }}>Position</span>
            <strong data-testid="float-coords-val">{formatFloatCoordinates(selectedFloat.lat, selectedFloat.lon)}</strong>
          </div>
          <div style={{ background: 'var(--field)', padding: '4px 6px', borderRadius: '4px' }}>
            <span style={{ color: 'var(--muted)', display: 'block' }}>{isModel ? 'Active Dataset' : (isBuoy ? 'Provider' : 'Cycle / DAC')}</span>
            <span>{isModel ? (selectedFloat.datasetName || 'Unavailable') : (isBuoy ? (selectedFloat.provider || selectedFloat.metadata?.institution || 'INCOIS') : `#${cycleNumber} (${dataCentre})`)}</span>
          </div>
          <div style={{ background: 'var(--field)', padding: '4px 6px', borderRadius: '4px' }}>
            <span style={{ color: 'var(--muted)', display: 'block' }}>{isModel ? 'Model Time' : 'Timestamp'}</span>
            <span style={{ fontFamily: 'monospace' }}>{selectedFloat.timestamp ? formatFloatDate(selectedFloat.timestamp) : 'Unavailable'}</span>
          </div>
        </div>

        {/* Meteorological Parameters (when available on moored buoys) */}
        {Boolean(
          (selectedFloat.air_temperature !== undefined && selectedFloat.air_temperature !== null) ||
          (selectedFloat.wind_speed_ms !== undefined && selectedFloat.wind_speed_ms !== null) ||
          (selectedFloat.surface_pressure_hpa !== undefined && selectedFloat.surface_pressure_hpa !== null) ||
          (selectedFloat.significant_wave_height_m !== undefined && selectedFloat.significant_wave_height_m !== null)
        ) && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '4px', fontSize: '10px', marginBottom: '8px' }}>
            <div style={{ background: 'var(--field)', padding: '4px 6px', borderRadius: '4px' }}>
              <span style={{ color: 'var(--muted)', display: 'block' }}>Air Temp</span>
              <strong style={{ color: '#38bdf8' }}>{selectedFloat.air_temperature !== null && selectedFloat.air_temperature !== undefined ? `${selectedFloat.air_temperature}°C` : 'N/A'}</strong>
            </div>
            <div style={{ background: 'var(--field)', padding: '4px 6px', borderRadius: '4px' }}>
              <span style={{ color: 'var(--muted)', display: 'block' }}>Surface Pressure</span>
              <span>{selectedFloat.surface_pressure_hpa !== null && selectedFloat.surface_pressure_hpa !== undefined ? `${selectedFloat.surface_pressure_hpa} hPa` : 'N/A'}</span>
            </div>
            <div style={{ background: 'var(--field)', padding: '4px 6px', borderRadius: '4px' }}>
              <span style={{ color: 'var(--muted)', display: 'block' }}>Wind Speed/Dir</span>
              <span>
                {selectedFloat.wind_speed_ms !== null && selectedFloat.wind_speed_ms !== undefined ? `${selectedFloat.wind_speed_ms} m/s` : 'N/A'}
                {selectedFloat.wind_direction_deg !== null && selectedFloat.wind_direction_deg !== undefined ? ` (${selectedFloat.wind_direction_deg}°)` : ''}
              </span>
            </div>
            <div style={{ background: 'var(--field)', padding: '4px 6px', borderRadius: '4px' }}>
              <span style={{ color: 'var(--muted)', display: 'block' }}>Significant Wave</span>
              <span>{selectedFloat.significant_wave_height_m !== null && selectedFloat.significant_wave_height_m !== undefined ? `${selectedFloat.significant_wave_height_m}m` : 'N/A'}</span>
            </div>
          </div>
        )}

      {/* 3. Variable Switching Tabs */}
      <div
        role="tablist"
        aria-label="Profile Views"
        style={{
          display: 'flex',
          gap: '4px',
          borderBottom: '1px solid var(--border)',
          paddingBottom: '4px',
          marginBottom: '8px'
        }}
      >
        <button
          role="tab"
          type="button"
          aria-selected={activeTab === 'temperature'}
          onClick={() => { setActiveTab('temperature'); setHoveredPoint(null); }}
          style={{
            padding: '4px 8px',
            fontSize: '11px',
            cursor: 'pointer',
            borderRadius: '4px',
            border: 'none',
            background: activeTab === 'temperature' ? 'var(--accent)' : 'transparent',
            color: activeTab === 'temperature' ? '#fff' : 'var(--text)',
            fontWeight: activeTab === 'temperature' ? 600 : 400
          }}
          data-testid="tab-temperature"
        >
          Temperature (°C)
        </button>
        <button
          role="tab"
          type="button"
          aria-selected={activeTab === 'salinity'}
          onClick={() => { setActiveTab('salinity'); setHoveredPoint(null); }}
          style={{
            padding: '4px 8px',
            fontSize: '11px',
            cursor: 'pointer',
            borderRadius: '4px',
            border: 'none',
            background: activeTab === 'salinity' ? 'var(--accent)' : 'transparent',
            color: activeTab === 'salinity' ? '#fff' : 'var(--text)',
            fontWeight: activeTab === 'salinity' ? 600 : 400
          }}
          data-testid="tab-salinity"
        >
          Salinity (PSU)
        </button>
        <button
          role="tab"
          type="button"
          aria-selected={activeTab === 'ts'}
          onClick={() => { setActiveTab('ts'); setHoveredPoint(null); }}
          style={{
            padding: '4px 8px',
            fontSize: '11px',
            cursor: 'pointer',
            borderRadius: '4px',
            border: 'none',
            background: activeTab === 'ts' ? 'var(--accent)' : 'transparent',
            color: activeTab === 'ts' ? '#fff' : 'var(--text)',
            fontWeight: activeTab === 'ts' ? 600 : 400
          }}
          data-testid="tab-ts"
        >
          T-S Diagram (σ<sub>θ</sub>)
        </button>
      </div>

      {/* 4. Chart Visualization Viewport with Clear Comparison Legend */}
      {activeTab !== 'ts' && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 8px', background: 'rgba(15, 23, 42, 0.75)', borderRadius: '4px', border: '1px solid var(--border)', marginBottom: '4px', fontSize: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: activeTab === 'salinity' ? '#34d399' : '#38bdf8' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: activeTab === 'salinity' ? '#34d399' : '#38bdf8', display: 'inline-block' }} />
              <strong>● Observed (In-Situ)</strong>
            </span>
            {showModelOverlay && (
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#ec4899' }}>
                <span style={{ width: '8px', height: '8px', background: '#ec4899', display: 'inline-block' }} />
                <strong>■ Model (Copernicus GLORYS12V1)</strong>
              </span>
            )}
          </div>
          <span style={{ color: 'var(--muted)', fontSize: '9px', fontStyle: 'italic' }}>
            {showModelOverlay ? 'Interpolated from surrounding model grid cells' : ''}
          </span>
        </div>
      )}
      <div
        style={{
          position: 'relative',
          background: 'rgba(15, 23, 42, 0.65)',
          borderRadius: '6px',
          border: '1px solid var(--border)',
          overflow: 'hidden'
        }}
        data-testid="chart-viewport"
      >
        {activeTab === 'temperature' && tempData && (
          <VerticalDepthSvgChart
            data={tempData}
            unit="°C"
            paramName="Potential Temperature"
            color="#38bdf8"
            chartWidth={chartWidth}
            chartHeight={chartHeight}
            padding={padding}
            hoveredPoint={hoveredPoint}
            onHoverPoint={setHoveredPoint}
            modelLevels={showModelOverlay ? currentModelLevels : []}
            showModelOverlay={showModelOverlay}
          />
        )}

        {activeTab === 'salinity' && salData && (
          <VerticalDepthSvgChart
            data={salData}
            unit="PSU"
            paramName="Practical Salinity"
            color="#34d399"
            chartWidth={chartWidth}
            chartHeight={chartHeight}
            padding={padding}
            hoveredPoint={hoveredPoint}
            onHoverPoint={setHoveredPoint}
            modelLevels={showModelOverlay ? currentModelLevels : []}
            showModelOverlay={showModelOverlay}
          />
        )}

        {activeTab === 'ts' && (
          <TSDiagramSvgChart
            depths={depths}
            temperatures={temperatures}
            salinities={salinities}
            qcFlags={selectedFloat.qc_flags}
            chartWidth={chartWidth}
            chartHeight={chartHeight}
            padding={padding}
            hoveredPoint={hoveredPoint}
            onHoverPoint={setHoveredPoint}
          />
        )}
      </div>

      {/* 5. Tooltip Readout */}
      <div
        style={{
          minHeight: '22px',
          marginTop: '6px',
          fontSize: '11px',
          fontFamily: 'Consolas, monospace',
          color: 'var(--muted)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}
        data-testid="chart-tooltip"
      >
        {hoveredPoint ? (() => {
          const matchedModel = showModelOverlay && currentModelLevels.find(m => Math.abs(m.depth - hoveredPoint.depth) < 1.0);
          const isUnknownQC = hoveredPoint.qcStatus === 'unknown' || hoveredPoint.isUnknown || hoveredPoint.qcFlag === null || hoveredPoint.qcFlag === undefined;
          const isGoodQC = !isUnknownQC && hoveredPoint.isGood;
          const qcLabel = isUnknownQC
            ? 'Not reported'
            : isGoodQC
              ? `Good (Flag ${hoveredPoint.qcFlag})`
              : `Bad (Flag ${hoveredPoint.qcFlag})`;
          const qcColor = isUnknownQC
            ? 'var(--muted)'
            : isGoodQC
              ? 'var(--accent)'
              : '#f43f5e';

          return (
            <span>
              Depth: <strong style={{ color: 'var(--text)' }}>{hoveredPoint.depth}m</strong> · Obs:{' '}
              <strong style={{ color: hoveredPoint.color || 'var(--accent)' }}>
                {hoveredPoint.value} {hoveredPoint.unit}
              </strong>
              {matchedModel && matchedModel.model_value !== null ? (
                <>
                  {' '}· Model: <strong style={{ color: '#ec4899' }}>{matchedModel.model_value} {hoveredPoint.unit}</strong>
                  {' '}· Δ: <strong style={{ color: matchedModel.delta < 0 ? '#38bdf8' : '#fbbf24' }}>
                    {matchedModel.delta > 0 ? `+${matchedModel.delta}` : matchedModel.delta} {hoveredPoint.unit}
                  </strong>
                </>
              ) : null}
              {' '}· QC:{' '}
              <span style={{ color: qcColor, fontWeight: 600 }} data-testid="tooltip-qc-status">
                {qcLabel}
              </span>
            </span>
          );
        })() : (
          <span>Hover over curve data points to inspect physical depth observations.</span>
        )}
        <span style={{ fontSize: '10px' }}>{depths.length} levels</span>
      </div>

      {/* 6. Model Comparison Section (Model Collocation) */}
      <div
        style={{
          marginTop: '8px',
          paddingTop: '8px',
          borderTop: '1px solid var(--border)',
          fontSize: '11px'
        }}
        data-testid="model-contract-section"
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
            <input
              id="toggle-model-overlay"
              data-testid="model-overlay-toggle"
              type="checkbox"
              checked={showModelOverlay}
              onChange={(e) => setShowModelOverlay(e.target.checked)}
            />
            <span style={{ fontWeight: showModelOverlay ? 600 : 400 }}>Overlay co-located ROMS model profile</span>
          </label>
          <span
            style={{
              padding: '1px 5px',
              borderRadius: '3px',
              background: 'var(--field)',
              color: 'var(--accent)',
              fontSize: '10px',
              fontWeight: 600
            }}
            data-testid="collocation-contract-tag"
          >
            Model Collocation Contract
          </span>
        </div>
        {showModelOverlay && currentSummary && (
          <div
            style={{
              marginTop: '6px',
              padding: '4px 8px',
              background: 'rgba(236, 72, 153, 0.12)',
              border: '1px solid rgba(236, 72, 153, 0.35)',
              borderRadius: '4px',
              display: 'flex',
              flexWrap: 'wrap',
              gap: '8px',
              alignItems: 'center',
              fontSize: '10px',
              fontFamily: 'Consolas, monospace'
            }}
            data-testid="collocation-metrics-badge"
          >
            <span>
              Bias: <strong style={{ color: currentSummary.bias < 0 ? '#38bdf8' : '#fbbf24' }}>
                {currentSummary.bias > 0 ? `+${currentSummary.bias}` : currentSummary.bias}{currentSummary.unit}
              </strong> ({currentSummary.prediction_tendency})
            </span>
            <span>
              MAE: <strong>{currentSummary.mae}{currentSummary.unit}</strong>
            </span>
            <span>
              RMSE: <strong>{currentSummary.rmse}{currentSummary.unit}</strong>
            </span>
            <span>
              Correlation: <strong data-testid="metric-correlation-r-val">{
                currentSummary.correlation_r !== null && currentSummary.correlation_r !== undefined
                  ? (typeof currentSummary.correlation_r === 'number'
                      ? (currentSummary.correlation_r > 0 ? `R = +${currentSummary.correlation_r.toFixed(4)}` : (currentSummary.correlation_r === 0 ? 'R = 0.0000' : `R = ${currentSummary.correlation_r.toFixed(4)}`))
                      : `R = ${currentSummary.correlation_r}`)
                  : 'R = n/a (insufficient pairs)'
              }</strong>
            </span>
            <span style={{ color: 'var(--muted)' }}>
              ({currentSummary.valid_pairs}/{currentSummary.total_levels} levels matched)
            </span>
          </div>
        )}
        <p className="helper" style={{ margin: '4px 0 0 0', fontSize: '10px' }}>
          {showModelOverlay
            ? 'Dashed line indicates 3D trilinear spatially and bounding temporally collocated ROMS numerical model profile.'
            : 'Check overlay to compare in-situ physical measurements with co-located ROMS numerical simulation.'}
        </p>
      </div>
      </div>
    </section>
  );
}

/**
 * Vertical Depth Profile SVG Chart Component
 * Inverted Depth on Y (0m at top down to maxDepth at bottom), Measurement on X
 */
function VerticalDepthSvgChart({
  data,
  unit,
  paramName,
  color,
  chartWidth,
  chartHeight,
  padding,
  hoveredPoint,
  onHoverPoint,
  modelLevels = [],
  showModelOverlay = false
}) {
  const { minVal, maxVal, maxDepth, points, hasGaps } = data;

  const scales = useMemo(() => {
    return createProfileScales({
      minVal,
      maxVal,
      maxDepth,
      width: chartWidth,
      height: chartHeight,
      padding
    });
  }, [minVal, maxVal, maxDepth, chartWidth, chartHeight, padding]);

  const { pathSegments, pointCoords } = useMemo(() => {
    return generateProfileSvgPaths(points, scales.valueToX, scales.depthToY);
  }, [points, scales]);

  const { pathSegments: modelSegments, modelCoords } = useMemo(() => {
    return generateModelOverlaySvgPath(modelLevels, scales.valueToX, scales.depthToY);
  }, [modelLevels, scales]);

  const depthTicks = useMemo(() => generateAxisTicks(0, maxDepth, 5), [maxDepth]);
  const valTicks = useMemo(() => generateAxisTicks(minVal, maxVal, 5), [minVal, maxVal]);

  return (
    <svg
      viewBox={`0 0 ${chartWidth} ${chartHeight}`}
      style={{ width: '100%', height: 'auto', display: 'block' }}
      data-testid="vertical-depth-svg"
    >
      {/* Grid Lines */}
      {depthTicks.map((d, i) => (
        <line
          key={`d-grid-${i}`}
          x1={padding.left}
          y1={scales.depthToY(d)}
          x2={chartWidth - padding.right}
          y2={scales.depthToY(d)}
          stroke="rgba(148, 163, 184, 0.15)"
          strokeDasharray="2,2"
        />
      ))}
      {valTicks.map((v, i) => (
        <line
          key={`v-grid-${i}`}
          x1={scales.valueToX(v)}
          y1={padding.top}
          x2={scales.valueToX(v)}
          y2={chartHeight - padding.bottom}
          stroke="rgba(148, 163, 184, 0.15)"
          strokeDasharray="2,2"
        />
      ))}

      {/* Y-Axis: Inverted Depth */}
      <line
        x1={padding.left}
        y1={padding.top}
        x2={padding.left}
        y2={chartHeight - padding.bottom}
        stroke="var(--border)"
        strokeWidth="1.5"
      />
      <text
        x={12}
        y={chartHeight / 2}
        transform={`rotate(-90 12 ${chartHeight / 2})`}
        fill="var(--muted)"
        fontSize="10"
        textAnchor="middle"
        fontFamily="sans-serif"
        data-testid="y-axis-label"
      >
        Depth (m) ↓
      </text>
      {depthTicks.map((d, i) => (
        <g key={`d-tick-${i}`}>
          <line
            x1={padding.left - 4}
            y1={scales.depthToY(d)}
            x2={padding.left}
            y2={scales.depthToY(d)}
            stroke="var(--border)"
          />
          <text
            x={padding.left - 7}
            y={scales.depthToY(d) + 3}
            fill="var(--muted)"
            fontSize="9"
            textAnchor="end"
            fontFamily="monospace"
          >
            {Math.round(d)}
          </text>
        </g>
      ))}

      {/* X-Axis: Parameter Value */}
      <line
        x1={padding.left}
        y1={chartHeight - padding.bottom}
        x2={chartWidth - padding.right}
        y2={chartHeight - padding.bottom}
        stroke="var(--border)"
        strokeWidth="1.5"
      />
      <text
        x={padding.left + scales.plotWidth / 2}
        y={chartHeight - 8}
        fill="var(--muted)"
        fontSize="10"
        textAnchor="middle"
        fontFamily="sans-serif"
        data-testid="x-axis-label"
      >
        {paramName} ({unit}) →
      </text>
      {valTicks.map((v, i) => (
        <g key={`v-tick-${i}`}>
          <line
            x1={scales.valueToX(v)}
            y1={chartHeight - padding.bottom}
            x2={scales.valueToX(v)}
            y2={chartHeight - padding.bottom + 4}
            stroke="var(--border)"
          />
          <text
            x={scales.valueToX(v)}
            y={chartHeight - padding.bottom + 14}
            fill="var(--muted)"
            fontSize="9"
            textAnchor="middle"
            fontFamily="monospace"
          >
            {v.toFixed(1)}
          </text>
        </g>
      ))}

      {/* Profile Curve Line Segments (Discontinuous on Gaps) */}
      {pathSegments.map((d, i) => (
        <path
          key={`seg-${i}`}
          d={d}
          fill="none"
          stroke={color}
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          data-testid="profile-curve-path"
        />
      ))}

      {/* Co-located Model Curve (Dashed Magenta) */}
      {showModelOverlay && modelSegments.map((d, i) => (
        <path
          key={`mod-seg-${i}`}
          d={d}
          fill="none"
          stroke="#ec4899"
          strokeWidth="2.0"
          strokeDasharray="4,4"
          strokeLinecap="round"
          strokeLinejoin="round"
          data-testid="model-curve-path"
        />
      ))}

      {/* Co-located Model Points */}
      {showModelOverlay && modelCoords.map((pt, i) => (
        <circle
          key={`mod-pt-${i}`}
          cx={pt.x}
          cy={pt.y}
          r={2.5}
          fill="#ec4899"
          stroke="#0f172a"
          strokeWidth={1.2}
          data-testid="model-point"
        />
      ))}

      {/* Active Hover Crosshairs (rendered behind points with pointerEvents: none) */}
      {hoveredPoint && (
        <g style={{ pointerEvents: 'none' }} pointerEvents="none">
          <line
            x1={padding.left}
            y1={hoveredPoint.y}
            x2={chartWidth - padding.right}
            y2={hoveredPoint.y}
            stroke="rgba(245, 158, 11, 0.6)"
            strokeDasharray="3,3"
            style={{ pointerEvents: 'none' }}
          />
          <line
            x1={hoveredPoint.x}
            y1={padding.top}
            x2={hoveredPoint.x}
            y2={chartHeight - padding.bottom}
            stroke="rgba(245, 158, 11, 0.6)"
            strokeDasharray="3,3"
            style={{ pointerEvents: 'none' }}
          />
        </g>
      )}

      {/* Observation Points */}
      {pointCoords.map((pt, i) => {
        const isBad = pt.isBad;
        const isUnknown = pt.isUnknown;
        const ptColor = isBad ? '#f43f5e' : (isUnknown ? '#94a3b8' : color);
        const isHovered = hoveredPoint && hoveredPoint.depth === pt.depth;

        return (
          <g key={`pt-${i}`}>
            <circle
              cx={pt.x}
              cy={pt.y}
              r={isHovered ? 6 : isBad ? 4.5 : 3.5}
              fill={isBad ? '#f43f5e' : '#0f172a'}
              stroke={ptColor}
              strokeWidth={isHovered ? 2.5 : 1.8}
              style={{ cursor: 'pointer' }}
              onMouseEnter={() => onHoverPoint?.({ ...pt, unit, color: ptColor })}
              onMouseLeave={() => onHoverPoint?.(null)}
              data-testid={isBad ? 'qc-outlier-point' : (isUnknown ? 'qc-unknown-point' : 'profile-point')}
            />
            {isBad && (
              <text
                x={pt.x + 6}
                y={pt.y + 3}
                fill="#f43f5e"
                fontSize="8"
                fontWeight="bold"
                fontFamily="monospace"
              >
                QC Alert
              </text>
            )}
          </g>
        );
      })}

      {/* QC Gap Notification Banner */}
      {hasGaps && (
        <g transform={`translate(${padding.left + 10}, ${padding.top + 10})`}>
          <rect width="180" height="18" rx="3" fill="rgba(244, 63, 94, 0.15)" stroke="#f43f5e" strokeWidth="0.8" />
          <text x="6" y="12" fill="#f43f5e" fontSize="9" fontWeight="600" fontFamily="sans-serif">
            ⚠ QC Flag Discontinuity (Gap Rendered)
          </text>
        </g>
      )}
    </svg>
  );
}

/**
 * Temperature-Salinity (T-S) Diagram with UNESCO Equation of State Isopycnals
 */
function TSDiagramSvgChart({
  depths = [],
  temperatures = [],
  salinities = [],
  qcFlags = [],
  chartWidth,
  chartHeight,
  padding,
  hoveredPoint: _hoveredPoint,
  onHoverPoint
}) {
  // Combine points
  const points = useMemo(() => {
    const pts = [];
    const n = Math.min(depths.length, temperatures.length, salinities.length);
    for (let i = 0; i < n; i++) {
      const d = depths[i];
      const t = temperatures[i];
      const s = salinities[i];
      let qc = null;
      if (Array.isArray(qcFlags)) {
        qc = qcFlags[i] !== undefined ? qcFlags[i] : null;
      } else if (qcFlags !== null && qcFlags !== undefined) {
        qc = qcFlags;
      }

      if (d != null && t != null && s != null && !isNaN(d) && !isNaN(t) && !isNaN(s)) {
        const isGood = qc === 1 || qc === 2;
        const isBad = qc === 3 || qc === 4;
        const isUnknown = !isGood && !isBad;
        const qcStatus = isGood ? 'good' : (isBad ? 'bad' : 'unknown');

        pts.push({
          depth: d,
          temperature: t,
          salinity: s,
          qcFlag: qc,
          qcStatus,
          isGood,
          isBad,
          isUnknown,
          density: computePotentialDensity(s, t)
        });
      }
    }
    pts.sort((a, b) => a.depth - b.depth);
    return pts;
  }, [depths, temperatures, salinities, qcFlags]);

  const salBounds = useMemo(() => {
    if (!points.length) return [32.0, 37.0];
    const sals = points.map((p) => p.salinity);
    const sMin = Math.floor(Math.min(...sals) * 2) / 2 - 0.5;
    const sMax = Math.ceil(Math.max(...sals) * 2) / 2 + 0.5;
    return [Math.max(30.0, sMin), Math.min(38.0, sMax)];
  }, [points]);

  const tempBounds = useMemo(() => {
    if (!points.length) return [0.0, 30.0];
    const temps = points.map((p) => p.temperature);
    const tMin = Math.floor(Math.min(...temps)) - 1;
    const tMax = Math.ceil(Math.max(...temps)) + 1;
    return [Math.max(-1.0, tMin), Math.min(35.0, tMax)];
  }, [points]);

  const isopycnals = useMemo(() => {
    return computeIsopycnalContours(salBounds, tempBounds, [22, 23, 24, 25, 26, 27, 28]);
  }, [salBounds, tempBounds]);

  const plotWidth = chartWidth - padding.left - padding.right;
  const plotHeight = chartHeight - padding.top - padding.bottom;

  const salToX = (s) => {
    const ratio = (s - salBounds[0]) / (salBounds[1] - salBounds[0]);
    return padding.left + Math.max(0, Math.min(1, ratio)) * plotWidth;
  };

  const tempToY = (t) => {
    // Normal Cartesian Y: warm temperature at top, cold at bottom
    const ratio = (t - tempBounds[0]) / (tempBounds[1] - tempBounds[0]);
    return chartHeight - padding.bottom - Math.max(0, Math.min(1, ratio)) * plotHeight;
  };

  const salTicks = useMemo(() => generateAxisTicks(salBounds[0], salBounds[1], 5), [salBounds]);
  const tempTicks = useMemo(() => generateAxisTicks(tempBounds[0], tempBounds[1], 5), [tempBounds]);

  // Connect T-S points into trajectory (include good and unknown, break on bad outliers)
  const tsPathD = useMemo(() => {
    const valid = points.filter((p) => !p.isBad);
    if (valid.length < 2) return '';
    const toX = (s) => padding.left + Math.max(0, Math.min(1, (s - salBounds[0]) / (salBounds[1] - salBounds[0]))) * (chartWidth - padding.left - padding.right);
    const toY = (t) => chartHeight - padding.bottom - Math.max(0, Math.min(1, (t - tempBounds[0]) / (tempBounds[1] - tempBounds[0]))) * (chartHeight - padding.top - padding.bottom);
    return valid.reduce(
      (acc, p, i) => `${acc} ${i === 0 ? 'M' : 'L'} ${toX(p.salinity).toFixed(1)} ${toY(p.temperature).toFixed(1)}`,
      ''
    );
  }, [points, salBounds, tempBounds, chartWidth, chartHeight, padding]);

  return (
    <svg
      viewBox={`0 0 ${chartWidth} ${chartHeight}`}
      style={{ width: '100%', height: 'auto', display: 'block' }}
      data-testid="ts-diagram-svg"
    >
      {/* Background Isopycnal Contours (sigma_theta) */}
      {isopycnals.map((iso, i) => {
        const d = iso.points.reduce((acc, pt, idx) => {
          const x = salToX(pt[0]);
          const y = tempToY(pt[1]);
          return `${acc} ${idx === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
        }, '');

        const labelPt = iso.points[Math.floor(iso.points.length * 0.75)];
        return (
          <g key={`iso-${i}`} opacity="0.65">
            <path
              d={d}
              fill="none"
              stroke="rgba(148, 163, 184, 0.35)"
              strokeWidth="1"
              strokeDasharray="3,3"
              data-testid="isopycnal-path"
            />
            {labelPt && (
              <text
                x={salToX(labelPt[0]) + 2}
                y={tempToY(labelPt[1]) - 2}
                fill="rgba(148, 163, 184, 0.7)"
                fontSize="8"
                fontFamily="monospace"
                data-testid="isopycnal-label"
              >
                σθ = {iso.sigma}
              </text>
            )}
          </g>
        );
      })}

      {/* Axes */}
      <line
        x1={padding.left}
        y1={padding.top}
        x2={padding.left}
        y2={chartHeight - padding.bottom}
        stroke="var(--border)"
        strokeWidth="1.5"
      />
      <text
        x={12}
        y={chartHeight / 2}
        transform={`rotate(-90 12 ${chartHeight / 2})`}
        fill="var(--muted)"
        fontSize="10"
        textAnchor="middle"
        fontFamily="sans-serif"
      >
        Potential Temp (°C) ↑
      </text>
      {tempTicks.map((t, i) => (
        <g key={`t-tick-${i}`}>
          <line
            x1={padding.left - 4}
            y1={tempToY(t)}
            x2={padding.left}
            y2={tempToY(t)}
            stroke="var(--border)"
          />
          <text
            x={padding.left - 7}
            y={tempToY(t) + 3}
            fill="var(--muted)"
            fontSize="9"
            textAnchor="end"
            fontFamily="monospace"
          >
            {t.toFixed(1)}
          </text>
        </g>
      ))}

      <line
        x1={padding.left}
        y1={chartHeight - padding.bottom}
        x2={chartWidth - padding.right}
        y2={chartHeight - padding.bottom}
        stroke="var(--border)"
        strokeWidth="1.5"
      />
      <text
        x={padding.left + plotWidth / 2}
        y={chartHeight - 8}
        fill="var(--muted)"
        fontSize="10"
        textAnchor="middle"
        fontFamily="sans-serif"
      >
        Practical Salinity (PSU) →
      </text>
      {salTicks.map((s, i) => (
        <g key={`s-tick-${i}`}>
          <line
            x1={salToX(s)}
            y1={chartHeight - padding.bottom}
            x2={salToX(s)}
            y2={chartHeight - padding.bottom + 4}
            stroke="var(--border)"
          />
          <text
            x={salToX(s)}
            y={chartHeight - padding.bottom + 14}
            fill="var(--muted)"
            fontSize="9"
            textAnchor="middle"
            fontFamily="monospace"
          >
            {s.toFixed(1)}
          </text>
        </g>
      ))}

      {/* T-S Trajectory Line */}
      {tsPathD && (
        <path
          d={tsPathD}
          fill="none"
          stroke="#f59e0b"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          data-testid="ts-path"
        />
      )}

      {/* Observation Points colored by depth or neutral for unknown */}
      {points.map((pt, i) => {
        const x = salToX(pt.salinity);
        const y = tempToY(pt.temperature);
        const isBad = pt.isBad;
        const isUnknown = pt.isUnknown;
        const color = isBad
          ? '#f43f5e'
          : isUnknown
            ? '#94a3b8'
            : (pt.depth <= 100 ? '#f59e0b' : pt.depth <= 500 ? '#38bdf8' : '#818cf8');

        return (
          <circle
            key={`ts-pt-${i}`}
            cx={x}
            cy={y}
            r={isBad ? 4.5 : 3.5}
            fill={isBad ? '#f43f5e' : color}
            stroke="#0f172a"
            strokeWidth="1.2"
            style={{ cursor: 'pointer' }}
            onMouseEnter={() =>
              onHoverPoint?.({
                depth: pt.depth,
                value: `${pt.temperature}°C / ${pt.salinity} PSU (σθ=${pt.density.toFixed(2)} kg/m³)`,
                unit: '',
                isGood: pt.isGood,
                isUnknown: pt.isUnknown,
                isBad: pt.isBad,
                qcStatus: pt.qcStatus,
                qcFlag: pt.qcFlag,
                color
              })
            }
            onMouseLeave={() => onHoverPoint?.(null)}
            data-testid={isBad ? 'ts-qc-outlier-point' : (isUnknown ? 'ts-qc-unknown-point' : 'ts-data-point')}
          />
        );
      })}
    </svg>
  );
}
