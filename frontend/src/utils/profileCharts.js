/**
 * SAMUDRA-3D Oceanographic Scientific Charting Engine
 * 
 * Features:
 * - Positive-down vertical depth axis inversion (depth 0m at top down to 2,000m/4,000m).
 * - UNESCO 1983 (EOS-80) Seawater Equation of State potential density (sigma-theta).
 * - Discontinuous curve gap rendering across rejected QC flags or missing measurements.
 * - Non-uniform irregular depth sampling with monotonic depth sorting and deduplication.
 * - Temperature-Salinity (T-S) correlation diagram with background isopycnal contours.
 */

/**
 * Computes pure water density at atmospheric pressure (kg/m^3) according to UNESCO 1983 / Millero & Poisson 1981.
 * @param {number} T - Temperature in degrees Celsius
 * @returns {number}
 */
export function unescoPureWaterDensity(T) {
  return (
    999.842594 +
    6.793952e-2 * T -
    9.09529e-3 * Math.pow(T, 2) +
    1.001685e-4 * Math.pow(T, 3) -
    1.120083e-6 * Math.pow(T, 4) +
    6.536332e-9 * Math.pow(T, 5)
  );
}

/**
 * Computes UNESCO 1983 Seawater Potential Density Anomaly sigma_theta = rho(S, T, 0) - 1000 (kg/m^3).
 * @param {number} S - Practical Salinity (PSU)
 * @param {number} T - Potential Temperature (°C)
 * @returns {number} sigma_theta in kg/m^3
 */
export function computePotentialDensity(S, T) {
  const rhoW = unescoPureWaterDensity(T);

  const A =
    8.24493e-1 -
    4.0899e-3 * T +
    7.6438e-5 * Math.pow(T, 2) -
    8.2467e-7 * Math.pow(T, 3) +
    5.3875e-9 * Math.pow(T, 4);

  const B =
    -5.72466e-3 +
    1.0227e-4 * T -
    1.6546e-6 * Math.pow(T, 2);

  const C = 4.8314e-4;

  const rho = rhoW + A * S + B * Math.pow(S, 1.5) + C * Math.pow(S, 2);
  return rho - 1000.0;
}

/**
 * Computes isopycnal contour lines across a given salinity and temperature bounding domain.
 * @param {[number, number]} salBounds - [minSal, maxSal]
 * @param {[number, number]} tempBounds - [minTemp, maxTemp]
 * @param {number[]} [targetSigmas=[22, 23, 24, 25, 26, 27, 28]]
 * @returns {Array<{ sigma: number, points: Array<[number, number]> }>}
 */
export function computeIsopycnalContours(
  salBounds = [32.0, 37.0],
  tempBounds = [2.0, 31.0],
  targetSigmas = [22, 23, 24, 25, 26, 27, 28]
) {
  const contours = [];
  const [sMin, sMax] = salBounds;
  const [tMin, tMax] = tempBounds;

  targetSigmas.forEach((targetSigma) => {
    const pts = [];
    const numSteps = 40;
    for (let i = 0; i <= numSteps; i++) {
      const s = sMin + (i / numSteps) * (sMax - sMin);

      // Binary search temperature t such that computePotentialDensity(s, t) == targetSigma
      // Note: sigma decreases as temperature increases
      let lowT = tMin;
      let highT = tMax;
      const sigAtLow = computePotentialDensity(s, lowT);
      const sigAtHigh = computePotentialDensity(s, highT);

      if (targetSigma <= sigAtLow && targetSigma >= sigAtHigh) {
        for (let iter = 0; iter < 18; iter++) {
          const midT = (lowT + highT) / 2;
          const sigMid = computePotentialDensity(s, midT);
          if (sigMid > targetSigma) {
            lowT = midT;
          } else {
            highT = midT;
          }
        }
        pts.push([s, (lowT + highT) / 2]);
      }
    }

    if (pts.length >= 2) {
      contours.push({ sigma: targetSigma, points: pts });
    }
  });

  return contours;
}

/**
 * Cleans, validates, sorts monotonically, and deduplicates profile depth points.
 * Identifies QC flags and marks missing data gaps.
 * 
 * @param {number[]} depths - Raw depth values in meters
 * @param {number[]} values - Physical measurements (Temperature in °C or Salinity in PSU)
 * @param {number[]} [qcFlags=[]] - WMO QC flags (1=good, 2=probably good, 3=bad, 4=outlier)
 * @returns {Object}
 */
export function cleanProfileData(depths = [], values = [], qcFlags = []) {
  if (!depths || !depths.length || !values || !values.length) {
    return {
      points: [],
      minVal: 0,
      maxVal: 1,
      maxDepth: 100,
      hasGaps: false,
      goodCount: 0,
      badCount: 0
    };
  }

  const raw = [];
  const flags = Array.isArray(qcFlags) ? qcFlags : [];
  const n = Math.min(depths.length, values.length);
  for (let i = 0; i < n; i++) {
    const d = depths[i];
    const v = values[i];
    const qc = flags[i] !== undefined ? flags[i] : (qcFlags === null ? null : 1);
    if (d !== null && d !== undefined && !isNaN(d) && v !== null && v !== undefined && !isNaN(v)) {
      raw.push({
        depth: Number(d),
        value: Number(v),
        qcFlag: qc,
        isGood: qc === 1 || qc === 2 || qc === null,
        originalIndex: i
      });
    }
  }

  // Monotonic ascending sort by depth (positive-down: 0m at surface down to ocean floor)
  raw.sort((a, b) => a.depth - b.depth);

  // Deduplicate identical depth records (keep first)
  const points = [];
  const seenDepths = new Set();
  for (const item of raw) {
    const dRounded = Math.round(item.depth * 10) / 10;
    if (!seenDepths.has(dRounded)) {
      seenDepths.add(dRounded);
      points.push(item);
    }
  }

  const goodCount = points.filter((p) => p.isGood).length;
  const badCount = points.filter((p) => !p.isGood).length;
  const hasGaps = badCount > 0;

  let minVal = points.length ? Math.min(...points.map((p) => p.value)) : 0;
  let maxVal = points.length ? Math.max(...points.map((p) => p.value)) : 1;
  const maxDepth = points.length ? Math.max(...points.map((p) => p.depth)) : 100;

  if (minVal === maxVal) {
    minVal -= 1;
    maxVal += 1;
  } else {
    // Add small margin to value bounds
    const span = maxVal - minVal;
    minVal = Math.floor((minVal - span * 0.05) * 10) / 10;
    maxVal = Math.ceil((maxVal + span * 0.05) * 10) / 10;
  }

  return {
    points,
    minVal,
    maxVal,
    maxDepth: Math.max(100, maxDepth),
    hasGaps,
    goodCount,
    badCount
  };
}

/**
 * Coordinate mapping from Data space (Value, Depth) to SVG Canvas space.
 * Positive-down vertical axis: depth 0m is at y = padding.top; maxDepth is at y = padding.top + plotHeight.
 */
export function createProfileScales({
  minVal,
  maxVal,
  maxDepth,
  width = 500,
  height = 360,
  padding = { top: 25, right: 30, bottom: 40, left: 55 }
}) {
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const valueToX = (v) => {
    const ratio = (v - minVal) / (maxVal - minVal);
    return padding.left + Math.max(0, Math.min(1, ratio)) * plotWidth;
  };

  const depthToY = (d) => {
    const ratio = d / maxDepth;
    return padding.top + Math.max(0, Math.min(1, ratio)) * plotHeight;
  };

  const xToValue = (x) => {
    const ratio = (x - padding.left) / plotWidth;
    return minVal + ratio * (maxVal - minVal);
  };

  const yToDepth = (y) => {
    const ratio = (y - padding.top) / plotHeight;
    return ratio * maxDepth;
  };

  return {
    valueToX,
    depthToY,
    xToValue,
    yToDepth,
    plotWidth,
    plotHeight,
    padding,
    width,
    height
  };
}

/**
 * Generates discontinuous SVG paths for vertical depth profiles.
 * Segments break across bad QC flags (flags 3, 4) to visually disclose data gaps.
 * 
 * @param {Array<Object>} points - Cleaned profile points
 * @param {Function} valueToX - X mapping
 * @param {Function} depthToY - Y mapping
 * @returns {{ pathSegments: string[], pointCoords: Array<Object> }}
 */
export function generateProfileSvgPaths(points, valueToX, depthToY) {
  const segments = [];
  const pointCoords = [];
  let currentSegment = [];

  points.forEach((pt) => {
    const x = valueToX(pt.value);
    const y = depthToY(pt.depth);

    pointCoords.push({
      ...pt,
      x,
      y
    });

    if (pt.isGood) {
      currentSegment.push({ x, y });
    } else {
      // Bad QC flag triggers a path gap
      if (currentSegment.length > 0) {
        segments.push(toSvgPathD(currentSegment));
        currentSegment = [];
      }
    }
  });

  if (currentSegment.length > 0) {
    segments.push(toSvgPathD(currentSegment));
  }

  return { pathSegments: segments, pointCoords };
}

function toSvgPathD(pts) {
  if (!pts.length) return '';
  if (pts.length === 1) {
    return `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)} L ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  }
  return pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
}

/**
 * Formats rounded tick values for depth and measurement axes.
 */
export function generateAxisTicks(min, max, count = 5) {
  const ticks = [];
  const step = (max - min) / (count - 1);
  for (let i = 0; i < count; i++) {
    ticks.push(min + i * step);
  }
  return ticks;
}

/**
 * Generates SVG path segments and point coordinates for co-located numerical model profile.
 * Only connects valid, unmasked model points.
 * 
 * @param {Array<Object>} modelLevels - Array of CollocationLevel objects
 * @param {Function} valueToX - X scale mapping
 * @param {Function} depthToY - Y scale mapping
 * @returns {{ pathSegments: string[], modelCoords: Array<Object> }}
 */
export function generateModelOverlaySvgPath(modelLevels = [], valueToX, depthToY) {
  const segments = [];
  const modelCoords = [];
  let currentSegment = [];

  const sorted = [...modelLevels].sort((a, b) => a.depth - b.depth);

  sorted.forEach((lvl) => {
    if (lvl.model_value !== null && lvl.model_value !== undefined && lvl.valid) {
      const x = valueToX(lvl.model_value);
      const y = depthToY(lvl.depth);

      modelCoords.push({
        ...lvl,
        x,
        y
      });
      currentSegment.push({ x, y });
    } else {
      if (currentSegment.length > 0) {
        segments.push(toSvgPathD(currentSegment));
        currentSegment = [];
      }
    }
  });

  if (currentSegment.length > 0) {
    segments.push(toSvgPathD(currentSegment));
  }

  return { pathSegments: segments, modelCoords };
}

