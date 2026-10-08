/**
 * SAMUDRA-3D Scientific Charting Engine Unit Tests
 */
import assert from 'node:assert/strict';
import {
  unescoPureWaterDensity,
  computePotentialDensity,
  computeIsopycnalContours,
  cleanProfileData,
  createProfileScales,
  generateProfileSvgPaths,
  generateAxisTicks
} from '../src/utils/profileCharts.js';

console.log('--- Testing SAMUDRA-3D Scientific Charting Engine  ---');

// -----------------------------------------------------------------------------
// 1. UNESCO 1983 (EOS-80) Seawater Equation of State
// -----------------------------------------------------------------------------
const rhoPure4 = unescoPureWaterDensity(4.0);
assert.ok(Math.abs(rhoPure4 - 999.972) < 0.05, `Pure water density at 4°C must be ~999.97 kg/m^3 (got ${rhoPure4})`);

// Standard oceanic reference points:
// S = 35.0 PSU, T = 20.0 °C => sigma_theta ~ 24.76 kg/m^3
const sigma20_35 = computePotentialDensity(35.0, 20.0);
assert.ok(Math.abs(sigma20_35 - 24.76) < 0.1, `sigma_theta(35, 20) expected ~24.76 kg/m^3, got ${sigma20_35}`);

// S = 35.0 PSU, T = 4.0 °C => sigma_theta ~ 27.70 kg/m^3
const sigma4_35 = computePotentialDensity(35.0, 4.0);
assert.ok(Math.abs(sigma4_35 - 27.70) < 0.1, `sigma_theta(35, 4) expected ~27.70 kg/m^3, got ${sigma4_35}`);
assert.ok(sigma4_35 > sigma20_35, 'Cold seawater must be denser than warm seawater');
console.log('✓ 1. UNESCO EOS-80 equation of state potential density verified');

// -----------------------------------------------------------------------------
// 2. Isopycnal Contours Generation
// -----------------------------------------------------------------------------
const contours = computeIsopycnalContours([32.0, 37.0], [2.0, 30.0], [24, 25, 26, 27]);
assert.ok(contours.length >= 3, 'Must produce multiple valid isopycnal contours');

contours.forEach((c) => {
  assert.ok(c.points.length >= 2, `Contour for sigma ${c.sigma} must have points`);
  // Verify sampled point density matches target sigma
  const [sSample, tSample] = c.points[Math.floor(c.points.length / 2)];
  const actualSig = computePotentialDensity(sSample, tSample);
  assert.ok(
    Math.abs(actualSig - c.sigma) < 0.05,
    `Calculated density ${actualSig} must match isopycnal ${c.sigma}`
  );
});
console.log('✓ 2. Isopycnal reference density contours generated and verified');

// -----------------------------------------------------------------------------
// 3. Data Cleaning, Monotonic Depth Sorting, and Deduplication
// -----------------------------------------------------------------------------
const rawDepths = [100.0, 0.0, 50.0, 200.0, 50.0, 300.0];
const rawTemps = [18.5, 29.1, 24.2, 13.1, 24.2, 10.4];
const rawQC = [1, 1, 1, 1, 1, 1];

const cleaned = cleanProfileData(rawDepths, rawTemps, rawQC);
assert.equal(cleaned.points.length, 5, 'Deduplication must reduce 6 records with duplicate depth 50m to 5');
assert.equal(cleaned.points[0].depth, 0.0, 'First depth must be 0m (sea surface)');
assert.equal(cleaned.points[4].depth, 300.0, 'Last depth must be 300m');

// Verify strictly monotonic ascending depths
for (let i = 1; i < cleaned.points.length; i++) {
  assert.ok(
    cleaned.points[i].depth > cleaned.points[i - 1].depth,
    `Depth at index ${i} (${cleaned.points[i].depth}) must be > index ${i - 1} (${cleaned.points[i - 1].depth})`
  );
}
assert.equal(cleaned.hasGaps, false);
console.log('✓ 3. Profile data cleaning, monotonic depth sorting, and deduplication verified');

// -----------------------------------------------------------------------------
// 4. Positive-Down Depth Inversion Math
// -----------------------------------------------------------------------------
const scales = createProfileScales({
  minVal: 10.0,
  maxVal: 30.0,
  maxDepth: 2000.0,
  width: 500,
  height: 360,
  padding: { top: 25, right: 30, bottom: 40, left: 55 }
});

// At depth 0m, Y must be top of plot
assert.equal(scales.depthToY(0), 25, 'Depth 0m must map to top padding (25px)');

// At max depth (2000m), Y must be bottom of plot
const expectedBottomY = 25 + (360 - 25 - 40);
assert.equal(scales.depthToY(2000), expectedBottomY, `Depth 2000m must map to bottom (${expectedBottomY}px)`);

// At intermediate depth (1000m), Y must be exactly halfway
const expectedMidY = 25 + (360 - 25 - 40) / 2;
assert.equal(scales.depthToY(1000), expectedMidY, 'Depth 1000m must map to vertical midpoint');
console.log('✓ 4. Positive-down vertical depth axis inversion verified (0m at top)');

// -----------------------------------------------------------------------------
// 5. QC Flag Three-State Handling (Good, Bad, and Absent/Unknown)
// -----------------------------------------------------------------------------
// 5a. Bad/Outlier QC Flag Discontinuity and Broken Curve Gaps
const testDepths = [0, 50, 100, 200, 500];
const testValues = [28, 24, 99.9, 14, 8];
const testQC = [1, 1, 4, 1, 1]; // Middle level (100m) is bad/outlier (flag 4)

const qcCleaned = cleanProfileData(testDepths, testValues, testQC);
assert.equal(qcCleaned.hasGaps, true, 'hasGaps must be true when bad QC flags exist');
assert.equal(qcCleaned.badCount, 1);
assert.equal(qcCleaned.goodCount, 4);
assert.equal(qcCleaned.unknownCount, 0);

const { pathSegments, pointCoords } = generateProfileSvgPaths(
  qcCleaned.points,
  scales.valueToX,
  scales.depthToY
);

// Because 100m is bad, the path must break into 2 separate segments:
// Segment 1: 0m -> 50m
// Segment 2: 200m -> 500m
assert.equal(
  pathSegments.length,
  2,
  `Expected 2 discontinuous path segments across QC outlier, got ${pathSegments.length}`
);
assert.ok(pathSegments[0].startsWith('M '));
assert.ok(pathSegments[1].startsWith('M '));

// Verify bad point is marked in pointCoords
const outlierPt = pointCoords.find((p) => p.depth === 100);
assert.ok(outlierPt, 'Outlier point at 100m must exist in pointCoords for tooltip inspectability');
assert.equal(outlierPt.isGood, false);
assert.equal(outlierPt.isBad, true);
assert.equal(outlierPt.isUnknown, false);
assert.equal(outlierPt.qcFlag, 4);
assert.equal(outlierPt.qcStatus, 'bad');

// 5b. Absent / Missing QC Flags (e.g., Bundled Reference Buoys)
const absentQC = cleanProfileData(testDepths, testValues, null);
assert.equal(absentQC.hasGaps, false, 'Absent QC must not fabricate gaps by default');
assert.equal(absentQC.goodCount, 0, 'Absent QC must not count points as good');
assert.equal(absentQC.badCount, 0, 'Absent QC must not count points as bad');
assert.equal(absentQC.unknownCount, 5, 'All 5 points must be classified as unknown QC');

absentQC.points.forEach((pt) => {
  assert.equal(pt.isGood, false, 'Absent QC point must NOT have isGood=true');
  assert.equal(pt.isBad, false, 'Absent QC point must NOT have isBad=true');
  assert.equal(pt.isUnknown, true, 'Absent QC point must have isUnknown=true');
  assert.equal(pt.qcStatus, 'unknown', 'Absent QC point must have qcStatus="unknown"');
  assert.equal(pt.qcFlag, null);
});

const { pathSegments: absentSegments, pointCoords: absentCoords } = generateProfileSvgPaths(
  absentQC.points,
  scales.valueToX,
  scales.depthToY
);
assert.equal(absentSegments.length, 1, 'Measurements with absent QC must render a continuous curve without gap');
assert.equal(absentCoords.length, 5);
absentCoords.forEach((pt) => {
  assert.equal(pt.isUnknown, true);
});

// 5c. Mixed QC with Good, Bad, and Unknown Points
const mixedQC = cleanProfileData([0, 50, 100, 200, 500], [28, 26, 99, 18, 12], [1, 2, 4, null, 1]);
assert.equal(mixedQC.goodCount, 3); // 0m (flag 1), 50m (flag 2), 500m (flag 1)
assert.equal(mixedQC.badCount, 1);  // 100m (flag 4)
assert.equal(mixedQC.unknownCount, 1); // 200m (null)
assert.equal(mixedQC.hasGaps, true); // has bad point

console.log('✓ 5. QC three-state handling (good, bad outlier, and absent/unknown) verified');

// -----------------------------------------------------------------------------
// 6. Axis Ticks Formatting
// -----------------------------------------------------------------------------
const ticks = generateAxisTicks(0, 2000, 5);
assert.deepEqual(ticks, [0, 500, 1000, 1500, 2000]);
console.log('✓ 6. Scientific axis ticks generation verified');

console.log('\nALL PROFILE CHARTING TESTS PASSED (100%)\n');
