/**
 * SAMUDRA-3D API Client Service
 * Connects frontend to the FastAPI backend service layer.
 *
 * Architecture note :
 *   The 3D Earth is a spatial index.  Every scientific request is coordinate- and/or
 *   bounding-box-driven, and a client-side LRU cache + AbortController request-ID guard
 *   prevent redundant traffic and stale-response races.
 */

const API_BASE = (
  typeof window !== 'undefined' && (window.location.hostname.endsWith('.vercel.app') || window.location.hostname.includes('trycloudflare.com'))
    ? '/api'
    : (import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000/api')
);

/* ────────────────────────────────────────────────────────────────────────────
 * Client-side LRU cache
 * Key = dataset + lat + lon + variable + depth + time + bounding box + resolution
 * Repeated identical requests resolve instantly without touching the network.
 * ──────────────────────────────────────────────────────────────────────────── */
const CLIENT_CACHE_MAX_ENTRIES = 240;
const clientCache = new Map();
export const clientCacheStats = { hits: 0, misses: 0 };

let currentActiveDatasetId = 'cmems_mod_glo_phy_my_0.083deg_P1D-m';
let currentDatasetGeneration = 0;

export function setActiveDatasetId(id) {
  if (id && id !== currentActiveDatasetId) {
    currentActiveDatasetId = id;
    currentDatasetGeneration++;
    clearClientCache();
  } else if (id) {
    currentActiveDatasetId = id;
  }
}

export function getActiveDatasetId() {
  return currentActiveDatasetId;
}

export function getDatasetGeneration() {
  return currentDatasetGeneration;
}

function cacheGet(key) {
  if (!clientCache.has(key)) {
    clientCacheStats.misses += 1;
    return null;
  }
  const value = clientCache.get(key);
  // Refresh recency (LRU)
  clientCache.delete(key);
  clientCache.set(key, value);
  clientCacheStats.hits += 1;
  return value;
}

function cacheSet(key, value) {
  if (clientCache.size >= CLIENT_CACHE_MAX_ENTRIES) {
    const oldest = clientCache.keys().next().value;
    clientCache.delete(oldest);
  }
  clientCache.set(key, value);
}

export function clearClientCache() {
  clientCache.clear();
  clientCacheStats.hits = 0;
  clientCacheStats.misses = 0;
}

function makeCacheKey(parts) {
  const explicitDatasetId = (parts && parts.dataset_id !== null && parts.dataset_id !== undefined && parts.dataset_id !== '')
    ? parts.dataset_id
    : null;
  const datasetId = explicitDatasetId || currentActiveDatasetId || 'cmems_mod_glo_phy_my_0.083deg_P1D-m';
  const cleanParts = { ...parts, dataset_id: datasetId };
  return Object.entries(cleanParts)
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k, v]) => `${k}=${typeof v === 'number' ? Number(v).toFixed(4) : v}`)
    .sort()
    .join('|');
}

/**
 * Shared fetch + bounded-JSON-error helper used by all scientific endpoints.
 */
async function requestJson(url, { signal = null, cacheKey = null, timeoutMs = 30000 } = {}) {
  if (cacheKey) {
    const cached = cacheGet(cacheKey);
    if (cached) return cached;
  }

  const reqGen = currentDatasetGeneration;
  const reqDatasetId = currentActiveDatasetId;

  let timeoutId = null;
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) throw Object.assign(new Error('Aborted'), { name: 'AbortError' });
    signal.addEventListener('abort', onAbort);
  }
  if (timeoutMs) {
    timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  }

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const errJson = await res.json();
        if (errJson) {
          if (errJson.detail) {
            detail = typeof errJson.detail === 'string' ? errJson.detail : JSON.stringify(errJson.detail);
          } else if (errJson.message) {
            detail = typeof errJson.message === 'string' ? errJson.message : JSON.stringify(errJson.message);
          } else if (errJson.error) {
            detail = typeof errJson.error === 'string' ? errJson.error : JSON.stringify(errJson.error);
          }
        }
      } catch {
        /* response body was not JSON */
      }
      throw new Error(detail);
    }
    const json = await res.json();
    if (cacheKey && reqGen === currentDatasetGeneration && reqDatasetId === currentActiveDatasetId) {
      cacheSet(cacheKey, json);
    }
    return json;
  } finally {
    if (timeoutId) window.clearTimeout(timeoutId);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

export { API_BASE };

/**
 * Checks backend health and dataset readiness.
 */
export async function fetchHealth(signal = null) {
  const res = await fetch(`${API_BASE}/health`, { signal });
  if (!res.ok) {
    throw new Error(`Health check failed: HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Retrieves CF metadata, available variables, ACTUAL dataset depth levels,
 * and ACTUAL dataset timestamps.  The frontend must never hardcode these.
 */
export async function fetchMetadata(signal = null) {
  const res = await fetch(`${API_BASE}/metadata`, { signal });
  if (!res.ok) {
    throw new Error(`Failed to fetch ocean metadata: HTTP ${res.status}`);
  }
  return res.json();
}


/**
 * Slices 2D ocean field by variable, time index, depth, and a REQUIRED bounding box.
 *
 * IMPORTANT : the backend rejects requests without spatial
 * bounds with HTTP 422/400.  This client sends the currently visible window so the
 * full global grid can never be transferred by accident.
 */
export async function fetchOceanData({
  variable = 'temperature',
  time_idx = 0,
  depth = 0,
  lat_min,
  lat_max,
  lon_min,
  lon_max,
  resolution = null,
  signal = null,
  useCache = true
} = {}) {
  const params = new URLSearchParams();
  params.set('variable', variable);
  params.set('time_idx', String(time_idx));
  params.set('depth', String(depth));
  params.set('lat_min', String(lat_min));
  params.set('lat_max', String(lat_max));
  params.set('lon_min', String(lon_min));
  params.set('lon_max', String(lon_max));

  const cacheKey = useCache
    ? makeCacheKey({ ep: 'ocean-data', variable, time_idx, depth, lat_min, lat_max, lon_min, lon_max, resolution })
    : null;

  return requestJson(`${API_BASE}/ocean-data?${params.toString()}`, { signal, cacheKey });
}

/**
 * Availability query : lightweight metadata only, never field values.
 * This is the FIRST request after the user selects a coordinate on the globe.
 */
export async function fetchLocationAvailability({ lat, lon, signal = null, useCache = true } = {}) {
  const params = new URLSearchParams({ lat: String(lat), lon: String(lon) });
  const cacheKey = useCache ? makeCacheKey({ ep: 'availability', lat, lon }) : null;
  return requestJson(`${API_BASE}/location/availability?${params.toString()}`, { signal, cacheKey });
}

/**
 * Single-value point query .  Payload target < 10 KB.
 */
export async function fetchOceanPoint({
  lat, lon, variable = 'temperature', depth = 0, time_idx = 0, signal = null, useCache = true
} = {}) {
  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
    variable,
    depth: String(depth),
    time_idx: String(time_idx)
  });
  const cacheKey = useCache
    ? makeCacheKey({ ep: 'point', lat, lon, variable, depth, time_idx })
    : null;
  return requestJson(`${API_BASE}/ocean/point?${params.toString()}`, { signal, cacheKey });
}

/**
 * Vertical profile query : returns only depth[] and value[]
 * for the selected coordinate — far smaller than the global horizontal field.
 */
export async function fetchOceanProfile({
  lat, lon, variable = 'temperature', time_idx = 0, signal = null, useCache = true
} = {}) {
  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
    variable,
    time_idx: String(time_idx)
  });
  const cacheKey = useCache ? makeCacheKey({ ep: 'profile', lat, lon, variable, time_idx }) : null;
  return requestJson(`${API_BASE}/ocean/profile?${params.toString()}`, { signal, cacheKey });
}

/**
 * Bounded local 3D region query  — the *detailed* local
 * ocean model.  Only called when the user explicitly requests a local 3D view.
 */
export async function fetchOceanRegion({
  center_lat,
  center_lon,
  radius_km = 25,
  variable = 'temperature',
  depth_min = 0,
  depth_max = 100,
  time_idx = 0,
  signal = null,
  useCache = true
} = {}) {
  const params = new URLSearchParams({
    center_lat: String(center_lat),
    center_lon: String(center_lon),
    radius_km: String(radius_km),
    variable,
    depth_min: String(depth_min),
    depth_max: String(depth_max),
    time_idx: String(time_idx)
  });
  const cacheKey = useCache
    ? makeCacheKey({ ep: 'region', center_lat, center_lon, radius_km, variable, depth_min, depth_max, time_idx })
    : null;
  return requestJson(`${API_BASE}/ocean/region?${params.toString()}`, { signal, cacheKey });
}


/**
 * Retrieves 3D spatial volume data for volumetric ocean block visualization.
 * Returns downsampled 3D grid coordinates, scalar values (and current components),
 * metadata, and real dataset provenance.
/**
 * Generates high-fidelity volumetric ocean slab data (0-25°N, 65-95°E)
 * when remote backend is sleeping, deploying, or offline, ensuring 3D Volume Block ALWAYS renders smoothly.
 */
export function generateSyntheticVolumeData({
  variable = 'temperature',
  time_idx = 0,
  min_lon = 65.0,
  max_lon = 95.0,
  min_lat = 0.0,
  max_lat = 25.0,
  depth_min: _depth_min = 0.49,
  depth_max = 92.33,
  nx = 32,
  ny = 28,
  nz = 12
} = {}) {
  const lons = [];
  for (let i = 0; i < nx; i++) lons.push(Number((min_lon + (i / (nx - 1)) * (max_lon - min_lon)).toFixed(3)));
  const lats = [];
  for (let j = 0; j < ny; j++) lats.push(Number((min_lat + (j / (ny - 1)) * (max_lat - min_lat)).toFixed(3)));
  const standardDepths = [0.49, 1.5, 3.0, 5.0, 8.0, 12.0, 18.0, 26.0, 38.0, 52.0, 70.0, 92.33];
  const depths = standardDepths.slice(0, nz);

  const isSalinity = variable === 'salinity';
  const isCurrents = variable === 'currents' || variable === 'u_current' || variable === 'v_current';

  const values = [];
  let min_val = Infinity;
  let max_val = -Infinity;

  for (let z = 0; z < depths.length; z++) {
    const d = depths[z];
    const depthRatio = d / depth_max;
    const zLayer = [];
    for (let y = 0; y < ny; y++) {
      const lat = lats[y];
      const yRow = [];
      for (let x = 0; x < nx; x++) {
        const lon = lons[x];
        let val;
        if (isSalinity) {
          const basinGrad = lon > 80 ? -1.8 * ((lat / 25.0) ** 1.5) : 1.2;
          const depthGrad = depthRatio * 1.5;
          val = 34.2 + basinGrad + depthGrad + Math.sin(lon * 0.15 + lat * 0.2) * 0.4;
        } else if (isCurrents) {
          const decay = Math.exp(-depthRatio * 3.0);
          val = Math.max(0.05, (0.35 + 0.45 * Math.sin(lat * 0.2 + lon * 0.1)) * decay);
        } else {
          const sst = 29.2 - 0.08 * lat + 0.4 * Math.sin(lon * 0.1);
          const thermocline = 1.0 / (1.0 + Math.exp((d - 45.0) / 14.0));
          val = 14.0 + (sst - 14.0) * thermocline;
        }
        val = Number(val.toFixed(3));
        if (val < min_val) min_val = val;
        if (val > max_val) max_val = val;
        yRow.push(val);
      }
      zLayer.push(yRow);
    }
    values.push(zLayer);
  }

  return {
    dataset_id: 'incois-roms-synthetic',
    variable,
    time_idx,
    shape: [depths.length, ny, nx],
    dimensions: ['depth', 'latitude', 'longitude'],
    coordinates: {
      longitude: lons,
      latitude: lats,
      depth: depths
    },
    bounds: {
      min_lat,
      max_lat,
      min_lon,
      max_lon,
      min_depth: depths[0],
      max_depth: depths[depths.length - 1]
    },
    min_value: min_val,
    max_value: max_val,
    values,
    source_mode: 'SYNTHETIC_OFFLINE_FALLBACK',
    is_fallback: true,
    is_synthetic: true,
    timestamp: '2026-09-10T00:00:00Z'
  };
}

export async function fetchOceanVolume({
  dataset_id = null,
  variable = 'temperature',
  time_idx = 0,
  center_lat = null,
  center_lon = null,
  radius_km = null,
  min_lon = null,
  max_lon = null,
  min_lat = null,
  max_lat = null,
  depth_min = null,
  depth_max = null,
  min_depth = null,
  max_depth = null,
  max_lon_samples = 48,
  max_lat_samples = 48,
  max_depth_samples = 24,
  signal = null,
  useCache = true
} = {}) {
  const effMinLon = min_lon !== null && min_lon !== undefined ? min_lon : 65.0;
  const effMaxLon = max_lon !== null && max_lon !== undefined ? max_lon : 95.0;
  const effMinLat = min_lat !== null && min_lat !== undefined ? min_lat : 0.0;
  const effMaxLat = max_lat !== null && max_lat !== undefined ? max_lat : 25.0;
  const effDepthMin = depth_min !== null && depth_min !== undefined ? depth_min : (min_depth ?? 0.49);
  const effDepthMax = depth_max !== null && depth_max !== undefined ? depth_max : (max_depth ?? 92.33);

  const params = new URLSearchParams();
  if (dataset_id) params.set('dataset_id', dataset_id);
  params.set('variable', variable);
  params.set('time_idx', String(time_idx));
  if (center_lat !== null && center_lat !== undefined) params.set('center_lat', String(center_lat));
  if (center_lon !== null && center_lon !== undefined) params.set('center_lon', String(center_lon));
  if (radius_km !== null && radius_km !== undefined) params.set('radius_km', String(radius_km));
  params.set('min_lon', String(effMinLon));
  params.set('max_lon', String(effMaxLon));
  params.set('min_lat', String(effMinLat));
  params.set('max_lat', String(effMaxLat));
  params.set('depth_min', String(effDepthMin));
  params.set('depth_max', String(effDepthMax));
  params.set('max_lon_samples', String(max_lon_samples));
  params.set('max_lat_samples', String(max_lat_samples));
  params.set('max_depth_samples', String(max_depth_samples));

  const cacheKey = useCache
    ? makeCacheKey({
        ep: 'volume',
        dataset_id,
        variable,
        time_idx,
        center_lat,
        center_lon,
        radius_km,
        min_lon: effMinLon,
        max_lon: effMaxLon,
        min_lat: effMinLat,
        max_lat: effMaxLat,
        depth_min: effDepthMin,
        depth_max: effDepthMax,
        max_lon_samples,
        max_lat_samples,
        max_depth_samples
      })
    : null;

  try {
    return await requestJson(`${API_BASE}/ocean/volume?${params.toString()}`, { signal, cacheKey });
  } catch (err) {
    if (signal?.aborted) throw err;
    console.warn('Live ocean volume API unreachable or returned error, activating synthetic 3D volume fallback:', err);
    return generateSyntheticVolumeData({
      variable,
      time_idx,
      min_lon: effMinLon,
      max_lon: effMaxLon,
      min_lat: effMinLat,
      max_lat: effMaxLat,
      depth_min: effDepthMin,
      depth_max: effDepthMax
    });
  }
}


/**
 * Evaluates vertical water column CTD profile, derived metrics (MLD, D20, D26, TCHP),
 * and nearest in-situ observation collocation for a probed coordinate.
 */
export async function fetchOceanProbe({ lat, lon, time_idx = 0, signal = null } = {}) {
  const params = new URLSearchParams();
  params.set('lat', String(lat));
  params.set('lon', String(lon));
  params.set('time_idx', String(time_idx));

  const res = await fetch(`${API_BASE}/ocean/probe?${params.toString()}`, { signal });
  if (!res.ok) {
    let errorDetail = `HTTP ${res.status}`;
    try {
      const errJson = await res.json();
      if (errJson.detail) errorDetail = errJson.detail;
    } catch {
      // ignore
    }
    throw new Error(errorDetail);
  }
  return res.json();
}

/**
 * Interpolates 100 points along transect for ODV-style vertical cross-section plotting.
 */
export async function fetchOceanTransect({
  lat1,
  lon1,
  lat2,
  lon2,
  variable = 'temperature',
  time_idx = 0,
  signal = null
} = {}) {
  const params = new URLSearchParams();
  params.set('lat1', String(lat1));
  params.set('lon1', String(lon1));
  params.set('lat2', String(lat2));
  params.set('lon2', String(lon2));
  params.set('variable', variable);
  params.set('time_idx', String(time_idx));

  const res = await fetch(`${API_BASE}/ocean/transect?${params.toString()}`, { signal });
  if (!res.ok) {
    let errorDetail = `HTTP ${res.status}`;
    try {
      const errJson = await res.json();
      if (errJson.detail) errorDetail = errJson.detail;
    } catch {
      // ignore
    }
    throw new Error(errorDetail);
  }
  return res.json();
}

/**
 * Retrieves in-situ observation profiles (Argo floats and Glider transects).
 */
export async function fetchInsituProfiles({ source_mode = null, signal = null } = {}) {
  const params = new URLSearchParams();
  if (source_mode) params.set('source_mode', source_mode);
  const qs = params.toString();
  const res = await fetch(`${API_BASE}/insitu/profiles${qs ? `?${qs}` : ''}`, { signal });
  if (!res.ok) {
    throw new Error(`Failed to fetch in-situ profiles: HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Retrieves Argo float profiles list.
 */
export async function fetchArgoFloats({ qc_filter = false, source_mode = null, signal = null } = {}) {
  const params = new URLSearchParams();
  if (qc_filter) params.set('qc_filter', 'true');
  if (source_mode) params.set('source_mode', source_mode);

  const qs = params.toString();
  const url = `${API_BASE}/insitu/argo${qs ? `?${qs}` : ''}`;
  const res = await fetch(url, { signal });
  if (!res.ok) {
    throw new Error(`Failed to fetch Argo floats: HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Retrieves single detailed Argo float profile by ID.
 */
export async function fetchArgoFloatById(floatId, signal = null) {
  return requestJson(`${API_BASE}/insitu/argo/${encodeURIComponent(floatId)}`, { signal });
}

/**
 * Retrieves in-situ ingestion status and ERDDAP telemetry.
 */
export async function fetchInsituStatus(signal = null) {
  const res = await fetch(`${API_BASE}/insitu/status`, { signal });
  if (!res.ok) {
    throw new Error(`Failed to fetch in-situ status: HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Retrieves underwater glider mission transects.
 */
export async function fetchGliderTransects({ qc_filter = false, source_mode = null, signal = null } = {}) {
  const params = new URLSearchParams();
  if (qc_filter) params.set('qc_filter', 'true');
  if (source_mode) params.set('source_mode', source_mode);

  const qs = params.toString();
  const url = `${API_BASE}/insitu/gliders${qs ? `?${qs}` : ''}`;
  const res = await fetch(url, { signal });
  if (!res.ok) {
    throw new Error(`Failed to fetch glider transects: HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Retrieves detailed glider mission transect by ID (with 3D waypoints).
 */
export async function fetchGliderById(gliderId, signal = null) {
  return requestJson(`${API_BASE}/insitu/gliders/${encodeURIComponent(gliderId)}`, { signal });
}

/**
 * Retrieves supported moored ocean buoy stations.
 */
export async function fetchBuoyStations({ qc_filter = false, source_mode = null, signal = null } = {}) {
  const params = new URLSearchParams();
  if (qc_filter) params.set('qc_filter', 'true');
  if (source_mode) params.set('source_mode', source_mode);

  const qs = params.toString();
  const url = `${API_BASE}/insitu/buoys${qs ? `?${qs}` : ''}`;
  const res = await fetch(url, { signal });
  if (!res.ok) {
    throw new Error(`Failed to fetch buoy stations: HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Retrieves single detailed moored buoy station with thermistor depth series.
 */
export async function fetchBuoyDetail(buoyId, signal = null) {
  return requestJson(`${API_BASE}/insitu/buoys/${encodeURIComponent(buoyId)}`, { signal });
}

/**
 * Retrieves co-located 4D model profile and bias analytics for a given sensor profile.
 */
export async function fetchProfileCollocation(profileId, { time_strategy = 'linear', signal = null } = {}) {
  const url = `${API_BASE}/collocation/profile/${encodeURIComponent(profileId)}?time_strategy=${encodeURIComponent(time_strategy)}`;
  return requestJson(url, { signal });
}

/**
 * Retrieves co-located 4D model metrics for all waypoints of a glider mission.
 */
export async function fetchGliderCollocation(gliderId, signal = null) {
  const url = `${API_BASE}/collocation/glider/${encodeURIComponent(gliderId)}`;
  return requestJson(url, { signal });
}

/**
 * Retrieves collocation engine health and domain verification status.
 */
export async function fetchCollocationHealth(signal = null) {
  const url = `${API_BASE}/collocation/health`;
  return requestJson(url, { signal });
}

/**
 * Retrieves sparse 3D residual/anomaly field across all platforms.
 */
export async function fetchAnomalyField({
  variable = 'temperature',
  threshold = null,
  depth_min = 0,
  depth_max = 4000,
  source_mode = null,
  signal = null
} = {}) {
  const params = new URLSearchParams();
  if (variable) params.set('variable', variable);
  if (threshold !== null && threshold !== undefined) params.set('threshold', threshold);
  if (depth_min !== undefined) params.set('depth_min', depth_min);
  if (depth_max !== undefined) params.set('depth_max', depth_max);
  if (source_mode) params.set('source_mode', source_mode);

  const url = `${API_BASE}/anomaly/field?${params.toString()}`;
  const res = await fetch(url, { signal });
  if (!res.ok) {
    throw new Error(`Failed to fetch anomaly field: HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Retrieves cross-variable anomaly summary and coverage metadata.
 */
export async function fetchAnomalySummary({ source_mode = null, signal = null } = {}) {
  const params = new URLSearchParams();
  if (source_mode) params.set('source_mode', source_mode);
  const qs = params.toString();
  const url = `${API_BASE}/anomaly/summary${qs ? `?${qs}` : ''}`;
  const res = await fetch(url, { signal });
  if (!res.ok) {
    throw new Error(`Failed to fetch anomaly summary: HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Submits a bounded natural language or scientific query to the AI Ocean Assistant.
 */
export async function queryAssistant(query, context = {}, options = {}, signal = null) {
  const url = `${API_BASE}/assistant/query`;
  let actualSignal = signal;
  let apiKey = null;
  let apiProvider = 'gemini';
  let conversationHistory = [];

  if (options instanceof AbortSignal) {
    actualSignal = options;
  } else if (options && typeof options === 'object') {
    apiKey = options.apiKey || null;
    apiProvider = options.apiProvider || 'gemini';
    conversationHistory = options.conversationHistory || [];
    actualSignal = options.signal || signal;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      context,
      api_key: apiKey,
      api_provider: apiProvider,
      conversation_history: conversationHistory
    }),
    signal: actualSignal
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.detail || `Assistant query failed: HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Retrieves pre-canned scientific query presets for the AI Assistant.
 */
export async function fetchAssistantPresets(signal = null) {
  const url = `${API_BASE}/assistant/presets`;
  const res = await fetch(url, { signal });
  if (!res.ok) {
    throw new Error(`Failed to fetch assistant presets: HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Authenticates officer credentials against MoES/INCOIS personnel records.
 */
export async function loginUser({ username, password }, signal = null) {
  const url = `${API_BASE}/auth/login`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
    signal
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.detail || `Authentication failed: HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Validates active session token and returns officer profile and capabilities.
 */
export async function fetchCurrentUser(token, signal = null) {
  const url = `${API_BASE}/auth/me`;
  const headers = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const res = await fetch(url, { headers, signal });
  if (!res.ok) {
    throw new Error(`Failed to verify session: HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Revokes active session token and signs officer out.
 */
export async function logoutUser(token, signal = null) {
  const url = `${API_BASE}/auth/logout`;
  const headers = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const res = await fetch(url, { method: 'POST', headers, signal });
  if (!res.ok) {
    throw new Error(`Logout failed: HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Retrieves operational persona presets for single-click executive briefing.
 */
export async function fetchAuthPersonas(signal = null) {
  const url = `${API_BASE}/auth/personas`;
  const res = await fetch(url, { signal });
  if (!res.ok) {
    throw new Error(`Failed to fetch personas: HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Retrieves all registered users from the SQLite database.
 */
export async function fetchAllUsers(signal = null) {
  const url = `${API_BASE}/auth/users`;
  const res = await fetch(url, { signal });
  if (!res.ok) {
    throw new Error(`Failed to fetch user directory: HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Creates a new officer/analyst account in the database.
 */
export async function createUserAdmin(userData, signal = null) {
  const url = `${API_BASE}/auth/users`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(userData),
    signal
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.detail || `Failed to create user: HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Deletes an officer account from the database.
 */
export async function deleteUser(userId, signal = null) {
  const url = `${API_BASE}/auth/users/${encodeURIComponent(userId)}`;
  const res = await fetch(url, { method: 'DELETE', signal });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.detail || `Failed to delete user: HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Registers a new in-situ ocean sensor into the database and active 3D visualization.
 */
export async function registerNewSensor(sensorData, signal = null) {
  const url = `${API_BASE}/insitu/sensors`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sensorData),
    signal
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.detail || `Failed to register sensor: HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Retrieves all custom registered ocean sensors.
 */
export async function fetchCustomSensors(signal = null) {
  const url = `${API_BASE}/insitu/sensors`;
  const res = await fetch(url, { signal });
  if (!res.ok) {
    throw new Error(`Failed to fetch custom sensors: HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Decommissions a registered ocean sensor.
 */
export async function deleteCustomSensor(sensorId, signal = null) {
  const url = `${API_BASE}/insitu/sensors/${encodeURIComponent(sensorId)}`;
  const res = await fetch(url, { method: 'DELETE', signal });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.detail || `Failed to decommission sensor: HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Administrative API Services
 */
export async function fetchAdminOverview(token, signal = null) {
  const res = await fetch(`${API_BASE}/admin/overview`, {
    headers: { Authorization: `Bearer ${token}` },
    signal
  });
  if (!res.ok) throw new Error(`Admin overview request failed: HTTP ${res.status}`);
  return res.json();
}

export async function fetchAdminUsers(token, signal = null) {
  const res = await fetch(`${API_BASE}/admin/users`, {
    headers: { Authorization: `Bearer ${token}` },
    signal
  });
  if (!res.ok) throw new Error(`Failed to load users: HTTP ${res.status}`);
  return res.json();
}

export async function createAdminUser(userData, token, signal = null) {
  const res = await fetch(`${API_BASE}/admin/users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(userData),
    signal
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Failed to create user: HTTP ${res.status}`);
  }
  return res.json();
}

export async function updateUserStatus(userId, isActive, token, signal = null) {
  const res = await fetch(`${API_BASE}/admin/users/${encodeURIComponent(userId)}/status`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ is_active: isActive }),
    signal
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Failed to update status: HTTP ${res.status}`);
  }
  return res.json();
}

export async function updateUserRole(userId, role, token, signal = null) {
  const res = await fetch(`${API_BASE}/admin/users/${encodeURIComponent(userId)}/role`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ role }),
    signal
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Failed to update role: HTTP ${res.status}`);
  }
  return res.json();
}

export async function resetUserPassword(userId, newPassword, token, signal = null) {
  const res = await fetch(`${API_BASE}/admin/users/${encodeURIComponent(userId)}/reset-password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ new_password: newPassword }),
    signal
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Failed to reset password: HTTP ${res.status}`);
  }
  return res.json();
}

export async function fetchAdminAuditLogs(token, limit = 50, signal = null) {
  const res = await fetch(`${API_BASE}/admin/audit-logs?limit=${limit}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal
  });
  if (!res.ok) throw new Error(`Failed to load audit logs: HTTP ${res.status}`);
  return res.json();
}

export async function fetchAdminSensors(token, signal = null) {
  const res = await fetch(`${API_BASE}/admin/sensors`, {
    headers: { Authorization: `Bearer ${token}` },
    signal
  });
  if (!res.ok) throw new Error(`Failed to load sensors: HTTP ${res.status}`);
  return res.json();
}

export async function registerAdminSensor(sensorData, token, signal = null) {
  const res = await fetch(`${API_BASE}/admin/sensors`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(sensorData),
    signal
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Failed to register sensor: HTTP ${res.status}`);
  }
  return res.json();
}

export async function deleteAdminSensor(sensorId, token, signal = null) {
  const res = await fetch(`${API_BASE}/admin/sensors/${encodeURIComponent(sensorId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
    signal
  });
  if (!res.ok) throw new Error(`Failed to delete sensor: HTTP ${res.status}`);
  return res.json();
}

export async function fetchDataSources(token = null, signal = null) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const res = await fetch(`${API_BASE}/admin/data-sources`, {
    headers,
    signal
  });
  if (!res.ok) throw new Error(`Failed to load data sources: HTTP ${res.status}`);
  return res.json();
}

/**
 * Dataset Catalog & Download Management
 */
export async function fetchDatasets(signal = null) {
  const res = await fetch(`${API_BASE}/datasets`, { signal });
  if (!res.ok) throw new Error(`Failed to load datasets: HTTP ${res.status}`);
  return res.json();
}

export async function selectActiveDataset(datasetId, signal = null) {
  const res = await fetch(`${API_BASE}/datasets/select`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dataset_id: datasetId }),
    signal
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Failed to switch dataset: HTTP ${res.status}`);
  }
  const json = await res.json();
  if (json?.active_dataset?.dataset_id) {
    setActiveDatasetId(json.active_dataset.dataset_id);
  } else if (datasetId) {
    setActiveDatasetId(datasetId);
  }
  return json;
}

export async function estimateDatasetDownloadSize(estimateData, signal = null) {
  const res = await fetch(`${API_BASE}/datasets/estimate-size`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(estimateData),
    signal
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Failed to estimate dataset size: HTTP ${res.status}`);
  }
  return res.json();
}

export async function registerCustomDataset(customData, signal = null) {
  const res = await fetch(`${API_BASE}/datasets/custom`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(customData),
    signal
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Failed to register custom dataset: HTTP ${res.status}`);
  }
  return res.json();
}



export async function generateSubsetCommand(subsetParams, signal = null) {
  const res = await fetch(`${API_BASE}/datasets/generate-command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(subsetParams),
    signal
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Failed to generate command: HTTP ${res.status}`);
  }
  return res.json();
}

export async function fetchDatasetManifests(signal = null) {
  const res = await fetch(`${API_BASE}/datasets/manifests`, { signal });
  if (!res.ok) {
    throw new Error(`Failed to fetch manifests: HTTP ${res.status}`);
  }
  return res.json();
}

export async function fetchDatasetManifestById(manifestId, signal = null) {
  const res = await fetch(`${API_BASE}/datasets/manifests/${manifestId}`, { signal });
  if (!res.ok) {
    throw new Error(`Failed to fetch manifest: HTTP ${res.status}`);
  }
  return res.json();
}

export async function startDatasetDownload(subsetParams, forceOverride = false, signal = null) {
  const res = await fetch(`${API_BASE}/datasets/download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subset_request: subsetParams, force_override: forceOverride }),
    signal
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Download request failed: HTTP ${res.status}`);
  }
  return res.json();
}

export async function fetchDownloadStatus(jobId, signal = null) {
  const res = await fetch(`${API_BASE}/datasets/download/status/${encodeURIComponent(jobId)}`, { signal });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Failed to poll download status: HTTP ${res.status}`);
  }
  return res.json();
}

export async function cancelDatasetDownload(jobId, signal = null) {
  const res = await fetch(`${API_BASE}/datasets/download/cancel/${encodeURIComponent(jobId)}`, {
    method: 'POST',
    signal
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Failed to cancel download: HTTP ${res.status}`);
  }
  return res.json();
}

export async function fetchThermalFronts({ lat_min = 0.0, lat_max = 25.0, lon_min = 50.0, lon_max = 100.0, time_idx = 0, signal = null } = {}) {
  const params = new URLSearchParams({
    lat_min: String(lat_min),
    lat_max: String(lat_max),
    lon_min: String(lon_min),
    lon_max: String(lon_max),
    time_idx: String(time_idx)
  });
  const res = await fetch(`${API_BASE}/ocean/thermal-fronts?${params.toString()}`, { signal });
  if (!res.ok) {
    throw new Error(`Failed to fetch thermal fronts: HTTP ${res.status}`);
  }
  return res.json();
}

export async function fetchInDepthOceanAnalysis({ lat, lon, time_idx = 0, signal = null } = {}) {
  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
    time_idx: String(time_idx)
  });
  const res = await fetch(`${API_BASE}/ocean/in-depth-analysis?${params.toString()}`, { signal });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Failed to fetch in-depth ocean analysis: ${res.statusText}`);
  }
  return res.json();
}
