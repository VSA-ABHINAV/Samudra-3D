import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { loadEarthTextures, createAtmosphereMaterial } from '../utils/earthTexture.js';
import { createOceanGlobeMaterial } from '../utils/oceanGlobeShader.js';
import { geoToCartesian, cartesianToGeo, cameraVisibleBoundingBox, DEFAULT_GLOBE_RADIUS } from '../utils/coordinates.js';
import { buildScalarFieldGeometry, createScalarFieldMaterial } from '../utils/scalarField.js';
import { fetchOceanData, fetchOceanVolume } from '../services/api.js';
import ColorBarLegend from './ColorBarLegend.jsx';
import { formatTimeLabel } from '../utils/timeAnimation.js';
import { calculateLOD } from '../utils/lodManager.js';
import { ParticleSystem, PARTICLE_COUNT } from '../utils/particleStreamlines.js';
import {
  createArgoMarker,
  raycastArgoMarkers,
  updateMarkerSelectionVisuals,
  updateOccludedMarkersVisibility,
  disposeArgoMarkers
} from '../utils/argoProfiles.js';
import {
  createAnomalyFieldMesh,
  raycastAnomalyField,
  updateAnomalyOcclusion,
  disposeAnomalyField
} from '../utils/anomalyField.js';
import {
  createGliderTransectMesh,
  raycastGliderTransects,
  updateGliderSelectionVisuals,
  updateGliderOcclusion,
  disposeGliderTransects
} from '../utils/gliderTransects.js';
import {
  createOceanVolumeBlock,
  disposeOceanVolumeBlock,
  createProbePinMesh,
  createTransectCurtainMesh,
  blockToGeo,
  fitVolumeCamera
} from '../utils/oceanVolumeBlock.js';
import {
  createGraticuleMesh,
  createHierarchicalPlaceMeshGroup,
  updatePlaceLabelsLOD,
  raycastPlaceMarker,
  disposeGraticuleGroup
} from '../utils/graticules.js';

export const BASIN_ZOOM_PRESETS = [
  { id: 'arabian', name: 'Arabian Sea', lat: 15.0, lon: 68.0, dist: 145 },
  { id: 'bob', name: 'Bay of Bengal', lat: 14.0, lon: 88.0, dist: 145 },
  { id: 'equator', name: 'Equatorial Basin', lat: 2.0, lon: 78.0, dist: 165 },
  { id: 'global', name: 'Full Basin', lat: 5.0, lon: 75.0, dist: 220 }
];

/**
 * Checks if WebGL is available in the current browser runtime.
 */
function checkWebGLAvailability() {
  try {
    if (typeof window === 'undefined' || !window.WebGLRenderingContext) return false;
    const testCanvas = document.createElement('canvas');
    return !!(
      testCanvas.getContext('webgl') ||
      testCanvas.getContext('experimental-webgl')
    );
  } catch {
    return false;
  }
}

// Initial Indian Ocean camera position: lat ~ 5°N, lon ~ 75°E, distance ~ 220
const INITIAL_CAM_POS = geoToCartesian(5, 75, 0, {
  globeRadius: 220,
  verticalExaggeration: 0
});

// At the old 102-unit zoom minimum, the camera nearly touched the 100-unit
// globe. A finite thermal/salinity patch then filled the screen like a box.
function minimumGlobeDistance(camera) {
  const halfVerticalFov = THREE.MathUtils.degToRad(camera.fov) / 2;
  const visibleHalfWidth = Math.tan(halfVerticalFov) * camera.aspect;
  const desiredRadiusFraction = 0.85;
  return Math.sqrt(
    DEFAULT_GLOBE_RADIUS ** 2 +
    (DEFAULT_GLOBE_RADIUS / (visibleHalfWidth * desiredRadiusFraction)) ** 2
  );
}

function configureGlobeZoom(camera, controls, normalMaximum = 500) {
  const minimum = minimumGlobeDistance(camera);
  controls.minDistance = minimum;
  controls.maxDistance = Math.max(normalMaximum, minimum * 1.25);
}

/**
 * OceanCanvas - Interactive 3D Earth Globe & 3D Regional Ocean Volume Block
 * 
 * Supports Dual View Modes:
 * - View Mode 1: Solid Realistic Earth Globe (no see-through ghost effect)
 * - View Mode 2: Regional 3D Ocean Volume Block (Northern Indian Ocean 0-25°N, 65-95°E)
 *   with instanced volumetric voxel cells, depth slicing, truth-in-depth bounds, and ODV transect slices.
 */
export default function OceanCanvas({
  selectedVariable = 'temperature',
  requestedDepth = 0,
  onDepthResolved = null,
  timeIndex = 0,
  onTimeResolved = null,
  isPlaying = false,
  isBuffering = false,
  onBufferingChange = null,
  showCurrents = false,
  showArgo = false,
  argoFloats = [],
  selectedFloat = null,
  onSelectFloat = null,
  showGliders = false,
  gliderTransects = [],
  selectedGlider = null,
  onSelectGlider = null,
  showAnomalyField = false,
  anomalyPoints = [],
  onSelectAnomalyPoint = null,
  viewMode = 'globe',
  probedPoint = null,
  probeData = null,
  isProbeLoading = false,
  onProbePoint = null,
  activeTransect = null,
  isFullView = false,
  onToggleFullView = null,
  targetRegion = null,
  onSelectRegion = null,
  activeDataset = null,
  availableTimes = [],
  isTransitioningDataset = false,
  isDatasetReady = true,
  datasetTransitionError = null
}) {
  const isDatasetBlocked = isTransitioningDataset || !isDatasetReady || Boolean(datasetTransitionError);
  const containerRef = useRef(null);
  const rendererRef = useRef(null);
  const controlsRef = useRef(null);
  const cameraRef = useRef(null);
  const sceneRef = useRef(null);
  const scalarMeshRef = useRef(null);
  const globeMaterialRef = useRef(null);
  const earthMeshRef = useRef(null);
  const cloudsMeshRef = useRef(null);
  const atmosphereMeshRef = useRef(null);
  const latestRequestIdRef = useRef(0);
  const particleSystemRef = useRef(null);
  const currentsDataRef = useRef(null);
  const requestedDepthRef = useRef(requestedDepth);

  const [hoveredCoord, setHoveredCoord] = useState(null);
  const [showGraticules, setShowGraticules] = useState(true);
  const [showBasinLabels, setShowBasinLabels] = useState(true);

  // 3D Ocean Volume Block state
  const [volumeData, setVolumeData] = useState(null);
  const [volumeLoading, setVolumeLoading] = useState(false);
  const [volumeError, setVolumeError] = useState(null);
  const [depthSliceMode, setDepthSliceMode] = useState('full'); // 'full' | 'slice' | 'surface'
  const [selectedDepthIdx, setSelectedDepthIdx] = useState(0);

  const graticulesGroupRef = useRef(null);
  const basinLabelsGroupRef = useRef(null);

  const showGraticulesRef = useRef(showGraticules);
  useEffect(() => {
    showGraticulesRef.current = showGraticules;
  }, [showGraticules]);

  const [currentLOD, setCurrentLOD] = useState(() => calculateLOD(220));

  const showBasinLabelsRef = useRef(showBasinLabels);
  useEffect(() => {
    showBasinLabelsRef.current = showBasinLabels;
  }, [showBasinLabels]);

  const onSelectRegionRef = useRef(onSelectRegion);
  useEffect(() => {
    onSelectRegionRef.current = onSelectRegion;
  }, [onSelectRegion]);

  const viewModeRef = useRef(viewMode);
  useEffect(() => {
    viewModeRef.current = viewMode;
  }, [viewMode]);

  const onProbePointRef = useRef(onProbePoint);
  useEffect(() => {
    onProbePointRef.current = onProbePoint;
  }, [onProbePoint]);

  const oceanBlockGroupRef = useRef(null);
  const probeGroupRef = useRef(null);
  const transectGroupRef = useRef(null);

  // Earth remains 100% photorealistic and solid - no see-through ghost effect
  useEffect(() => {
    requestedDepthRef.current = requestedDepth;
  }, [requestedDepth]);

  const argoMarkersGroupRef = useRef(null);
  const pointerDownPosRef = useRef({ x: 0, y: 0 });
  const showArgoRef = useRef(showArgo);
  const onSelectFloatRef = useRef(onSelectFloat);
  useEffect(() => {
    showArgoRef.current = showArgo;
  }, [showArgo]);
  useEffect(() => {
    onSelectFloatRef.current = onSelectFloat;
  }, [onSelectFloat]);

  const gliderGroupRef = useRef(null);
  const showGlidersRef = useRef(showGliders);
  const onSelectGliderRef = useRef(onSelectGlider);
  useEffect(() => {
    showGlidersRef.current = showGliders;
  }, [showGliders]);
  useEffect(() => {
    onSelectGliderRef.current = onSelectGlider;
  }, [onSelectGlider]);

  const anomalyGroupRef = useRef(null);
  const showAnomalyFieldRef = useRef(showAnomalyField);
  const onSelectAnomalyPointRef = useRef(onSelectAnomalyPoint);
  useEffect(() => {
    showAnomalyFieldRef.current = showAnomalyField;
  }, [showAnomalyField]);
  useEffect(() => {
    onSelectAnomalyPointRef.current = onSelectAnomalyPoint;
  }, [onSelectAnomalyPoint]);

  // Keep graticules and labels visibility synced with state
  useEffect(() => {
    if (graticulesGroupRef.current) {
      graticulesGroupRef.current.visible = showGraticules && viewMode === 'globe';
    }
  }, [showGraticules, viewMode]);

  useEffect(() => {
    if (basinLabelsGroupRef.current) {
      basinLabelsGroupRef.current.visible = showBasinLabels && viewMode === 'globe';
    }
  }, [showBasinLabels, viewMode]);

  const [webglAvailable] = useState(() => checkWebGLAvailability());
  const [rendererStats, setRendererStats] = useState({ fps: 0, drawCalls: 0 });
  const [retryKey, setRetryKey] = useState(0);
  const [rangeMode, setRangeMode] = useState('dynamic');
  const [oceanStyle, setOceanStyle] = useState(0); // 0: Bathymetric Digital Twin, 1: Satellite Ocean
  const [showDataOverlay, setShowDataOverlay] = useState(true);
  const oceanStyleRef = useRef(0);
  useEffect(() => {
    oceanStyleRef.current = oceanStyle;
    if (globeMaterialRef.current?.uniforms?.uOceanStyle) {
      globeMaterialRef.current.uniforms.uOceanStyle.value = oceanStyle;
    }
  }, [oceanStyle]);

  const [fieldState, setFieldState] = useState({
    loading: true,
    error: null,
    sliceData: null
  });

  const handleResetCamera = () => {
    if (cameraRef.current && controlsRef.current) {
      if (viewMode === 'block') {
        if (oceanBlockGroupRef.current && oceanBlockGroupRef.current.children.length > 0) {
          fitVolumeCamera(cameraRef.current, controlsRef.current, oceanBlockGroupRef.current);
        } else {
          cameraRef.current.position.set(65, 55, 75);
          controlsRef.current.target.set(0, -15, 0);
          controlsRef.current.minDistance = 20;
          controlsRef.current.maxDistance = 350;
          controlsRef.current.update();
        }
      } else {
        cameraRef.current.position.set(INITIAL_CAM_POS.x, INITIAL_CAM_POS.y, INITIAL_CAM_POS.z);
        controlsRef.current.target.set(0, 0, 0);
        configureGlobeZoom(cameraRef.current, controlsRef.current);
        controlsRef.current.update();
      }
    }
  };

  // Smooth camera basin zoom navigation
  const handleZoomBasin = useCallback((preset) => {
    if (!cameraRef.current || !controlsRef.current || viewMode !== 'globe') return;
    const targetPos = geoToCartesian(preset.lat, preset.lon, 0, {
      globeRadius: Math.max(minimumGlobeDistance(cameraRef.current), preset.dist || 120)
    });
    const startPos = cameraRef.current.position.clone();
    const startTime = window.performance.now();
    const duration = 650;

    const animateCam = (now) => {
      const elapsed = now - startTime;
      const progress = Math.min(1.0, elapsed / duration);
      const ease = 1 - Math.pow(1 - progress, 3);

      cameraRef.current.position.lerpVectors(startPos, targetPos, ease);
      controlsRef.current.target.set(0, 0, 0);
      controlsRef.current.update();

      if (progress < 1.0) {
        window.requestAnimationFrame(animateCam);
      }
    };
    window.requestAnimationFrame(animateCam);
  }, [viewMode]);

  // Smooth zoom to exact coordinate
  const handleZoomToCoordinate = useCallback((lat, lon, targetDist = 120) => {
    if (!cameraRef.current || !controlsRef.current || viewMode !== 'globe') return;
    const targetPos = geoToCartesian(lat, lon, 0, {
      globeRadius: Math.max(minimumGlobeDistance(cameraRef.current), targetDist)
    });
    const startPos = cameraRef.current.position.clone();
    const startTime = window.performance.now();
    const duration = 750;

    const animateCam = (now) => {
      const elapsed = now - startTime;
      const progress = Math.min(1.0, elapsed / duration);
      const ease = 1 - Math.pow(1 - progress, 3);

      cameraRef.current.position.lerpVectors(startPos, targetPos, ease);
      controlsRef.current.target.set(0, 0, 0);
      controlsRef.current.update();

      if (progress < 1.0) {
        window.requestAnimationFrame(animateCam);
      }
    };
    window.requestAnimationFrame(animateCam);
  }, [viewMode]);

  const handleZoomBasinRef = useRef(handleZoomBasin);
  useEffect(() => {
    handleZoomBasinRef.current = handleZoomBasin;
  }, [handleZoomBasin]);

  const handleZoomToCoordinateRef = useRef(handleZoomToCoordinate);
  useEffect(() => {
    handleZoomToCoordinateRef.current = handleZoomToCoordinate;
  }, [handleZoomToCoordinate]);

  useEffect(() => {
    if (targetRegion) {
      handleZoomBasin(targetRegion);
    }
  }, [targetRegion, handleZoomBasin]);

  const handleZoomIn = () => {
    if (!cameraRef.current || !controlsRef.current) return;
    const len = cameraRef.current.position.length();
    let factor;
    if (len > 250)      factor = 0.72;   // large zoom from global basin
    else if (len > 130) factor = 0.85;   // medium zoom from regional
    else                factor = 0.95;   // fine zoom at close range
    const newLen = Math.max(controlsRef.current.minDistance, len * factor);
    cameraRef.current.position.setLength(newLen);
    controlsRef.current.update();
  };

  const handleZoomOut = () => {
    if (!cameraRef.current || !controlsRef.current) return;
    const len = cameraRef.current.position.length();
    let factor;
    if (len < 120)      factor = 1.06;
    else if (len < 250) factor = 1.14;
    else                factor = 1.28;
    const newLen = Math.min(controlsRef.current.maxDistance, len * factor);
    cameraRef.current.position.setLength(newLen);
    controlsRef.current.update();
  };

  const handleRetry = () => {
    setFieldState((prev) => ({ ...prev, loading: true, error: null }));
    setRetryKey((k) => k + 1);
  };

  // 1. Data Fetching Effect with AbortController, requestId tracking, and Debounce/Buffering
  useEffect(() => {
    if (isDatasetBlocked) {
      setFieldState((prev) => ({ ...prev, loading: false, error: datasetTransitionError || null, sliceData: null }));
      onBufferingChange?.(false);
      return;
    }

    let ignore = false;
    const controller = new AbortController();
    const currentRequestId = ++latestRequestIdRef.current;

    const delay = isPlaying ? 0 : 100;
    const timer = setTimeout(() => {
      onBufferingChange?.(true);
      setFieldState((prev) => ({ ...prev, loading: true, error: null }));

      const cam = cameraRef.current;
      const bounds = cam
        ? cameraVisibleBoundingBox(cam, DEFAULT_GLOBE_RADIUS)
        : { lat_min: 0, lat_max: 25, lon_min: 65, lon_max: 95 };  // safe default (full Indian Ocean domain)
      fetchOceanData({
        variable: selectedVariable,
        time_idx: timeIndex,
        depth: requestedDepth,
        lat_min: bounds.lat_min,
        lat_max: bounds.lat_max,
        lon_min: bounds.lon_min,
        lon_max: bounds.lon_max,
        signal: controller.signal
      })
        .then((data) => {
          if (!ignore && currentRequestId === latestRequestIdRef.current) {
            setFieldState({
              loading: false,
              error: null,
              sliceData: data
            });
            onBufferingChange?.(false);
            onDepthResolved?.(data.selected_depth != null ? data.selected_depth : data.requested_depth);
            onTimeResolved?.(data.timestamp);
          }
        })
        .catch((err) => {
          if (!ignore && currentRequestId === latestRequestIdRef.current && err.name !== 'AbortError') {
            setFieldState({
              loading: false,
              error: err.message || `Failed to load ${selectedVariable} field at ${requestedDepth}m (t=${timeIndex})`,
              sliceData: null
            });
            onBufferingChange?.(false);
          }
        });
    }, delay);

    return () => {
      ignore = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [selectedVariable, requestedDepth, timeIndex, isPlaying, retryKey, onDepthResolved, onTimeResolved, onBufferingChange, activeDataset?.dataset_id, isDatasetBlocked, datasetTransitionError]);

  // 2. Particle Streamlines Lifecycle Effect (Vector Velocity Flow)
  useEffect(() => {
    const scene = sceneRef.current;
    const isCurrentsActive = showCurrents && !isDatasetBlocked;
    if (!scene || !isCurrentsActive) {
      if (particleSystemRef.current) {
        particleSystemRef.current.dispose();
        particleSystemRef.current = null;
      }
      return;
    }

    let ignore = false;
    const controller = new AbortController();

    if (fieldState.sliceData?.variable === 'currents' && fieldState.sliceData.u_values) {
      currentsDataRef.current = fieldState.sliceData;
      if (!particleSystemRef.current) {
        particleSystemRef.current = new ParticleSystem(PARTICLE_COUNT);
        scene.add(particleSystemRef.current.mesh);
        particleSystemRef.current.init(
          fieldState.sliceData.lats,
          fieldState.sliceData.lons,
          fieldState.sliceData.u_values,
          fieldState.sliceData.v_values
        );
      }
      return;
    }

    // Fallback fetch uses the same visible-window bounds as the main field fetch
    // so the backend's mandatory-bounds contract is never violated.
    const currCam = cameraRef.current;
    const currBounds = currCam
      ? cameraVisibleBoundingBox(currCam, DEFAULT_GLOBE_RADIUS)
      : { lat_min: 0, lat_max: 25, lon_min: 65, lon_max: 95 };
    fetchOceanData({
      variable: 'currents',
      time_idx: timeIndex,
      depth: requestedDepth,
      lat_min: currBounds.lat_min,
      lat_max: currBounds.lat_max,
      lon_min: currBounds.lon_min,
      lon_max: currBounds.lon_max,
      signal: controller.signal
    })
      .then((data) => {
        if (!ignore && data.u_values && data.v_values) {
          currentsDataRef.current = data;
          if (!particleSystemRef.current && sceneRef.current) {
            particleSystemRef.current = new ParticleSystem(PARTICLE_COUNT);
            sceneRef.current.add(particleSystemRef.current.mesh);
            particleSystemRef.current.init(
              data.lats,
              data.lons,
              data.u_values,
              data.v_values
            );
          }
        }
      })
      .catch((err) => {
        if (!ignore && err.name !== 'AbortError') {
          console.warn('Failed to load currents vector field:', err);
        }
      });

    return () => {
      ignore = true;
      controller.abort();
    };
  }, [showCurrents, selectedVariable, timeIndex, requestedDepth, fieldState.sliceData, activeDataset?.dataset_id, isDatasetBlocked]);

  // 3. Three.js Scalar Mesh Update Effect (Draped onto Globe)
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    if (scalarMeshRef.current) {
      scene.remove(scalarMeshRef.current);
      scalarMeshRef.current.geometry?.dispose();
      scalarMeshRef.current.material?.dispose();
      scalarMeshRef.current = null;
    }

    // CRITICAL: CURRENTS is a vector field and must NEVER render an opaque scalar quad!
    // This permanently eliminates the giant yellow rectangle defect.
    if (fieldState.sliceData?.variable === 'currents') {
      return;
    }

    if (!showDataOverlay || isDatasetBlocked) {
      return;
    }

    if (fieldState.sliceData) {
      const isSalinity = fieldState.sliceData.variable === 'salinity';
      const depth = fieldState.sliceData.selected_depth ?? 0.0;
      // Draped directly on surface of globe so subsurface levels are visible without ghost transparency
      const drapeSlice = {
        ...fieldState.sliceData,
        selected_depth: 0.0
      };
      const geometry = buildScalarFieldGeometry(drapeSlice, {
        globeRadius: DEFAULT_GLOBE_RADIUS,
        palette: isSalinity ? 'haline' : 'thermal',
        min_val: rangeMode === 'fixed' ? (isSalinity ? 32.0 : 2.0) : fieldState.sliceData.min_val,
        max_val: rangeMode === 'fixed' ? (isSalinity ? 38.0 : 32.0) : fieldState.sliceData.max_val
      });
      const material = createScalarFieldMaterial(0.60);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = `scalar_field_${fieldState.sliceData.variable}_${depth}`;
      mesh.renderOrder = 3;
      if (viewModeRef.current === 'block') {
        mesh.visible = false;
      }

      scene.add(mesh);
      scalarMeshRef.current = mesh;
    }
  }, [fieldState.sliceData, rangeMode, showDataOverlay, isDatasetBlocked]);

  // 4a. Fetch Volume Data for 3D Block View Mode
  const fetchVolumeData = useCallback(() => {
    if (viewMode !== 'block' || isDatasetBlocked) {
      setVolumeData(null);
      setVolumeLoading(false);
      return;
    }
    setVolumeLoading(true);
    setVolumeError(null);

    const controller = new AbortController();
    fetchOceanVolume({
      dataset_id: activeDataset?.dataset_id,
      variable: selectedVariable,
      time_idx: timeIndex,
      min_lon: 65.0,
      max_lon: 95.0,
      min_lat: 0.0,
      max_lat: 25.0,
      max_lon_samples: 48,
      max_lat_samples: 48,
      max_depth_samples: 24,
      signal: controller.signal
    })
      .then((data) => {
        setVolumeData(data);
        setVolumeLoading(false);
      })
      .catch((err) => {
        if (err.name !== 'AbortError') {
          console.error('Volume fetch error:', err);
          setVolumeError(err.message || 'Failed to load 3D ocean volume');
          setVolumeLoading(false);
        }
      });

    return () => controller.abort();
  }, [viewMode, isDatasetBlocked, activeDataset?.dataset_id, selectedVariable, timeIndex]);

  useEffect(() => {
    const cancel = fetchVolumeData();
    return () => cancel?.();
  }, [fetchVolumeData]);

  // 4b. Regional 3D Ocean Volume Block Update Effect
  useEffect(() => {
    const group = oceanBlockGroupRef.current;
    if (!group) return;
    disposeOceanVolumeBlock(group);
    if (volumeData && viewMode === 'block') {
      const blockMesh = createOceanVolumeBlock(volumeData, {
        variable: selectedVariable,
        rangeMode,
        depthSliceMode,
        selectedDepthIdx
      });
      if (blockMesh) {
        group.add(blockMesh);
        if (cameraRef.current && controlsRef.current) {
          fitVolumeCamera(cameraRef.current, controlsRef.current, blockMesh);
        }
      }
    }
  }, [volumeData, viewMode, selectedVariable, rangeMode, depthSliceMode, selectedDepthIdx]);

  // 5. 3D Probe Pin Beacon Update Effect
  useEffect(() => {
    const group = probeGroupRef.current;
    if (!group) return;
    while (group.children.length > 0) {
      const c = group.children[0];
      if (c.geometry) c.geometry.dispose();
      if (c.material) {
        if (Array.isArray(c.material)) c.material.forEach((m) => m.dispose());
        else c.material.dispose();
      }
      group.remove(c);
    }
    if (probedPoint && probedPoint.lat != null && probedPoint.lon != null) {
      const isBlock = viewMode === 'block';
      const pin = createProbePinMesh(probedPoint.lat, probedPoint.lon, isBlock);
      if (pin) group.add(pin);
    }
  }, [probedPoint, viewMode]);

  // 6. ODV Vertical Transect Curtain Update Effect
  useEffect(() => {
    const group = transectGroupRef.current;
    if (!group) return;
    while (group.children.length > 0) {
      const c = group.children[0];
      if (c.geometry) c.geometry.dispose();
      if (c.material) {
        if (Array.isArray(c.material)) c.material.forEach((m) => m.dispose());
        else c.material.dispose();
      }
      group.remove(c);
    }
    if (activeTransect && viewMode === 'block') {
      const curtain = createTransectCurtainMesh(activeTransect, {
        palette: selectedVariable === 'salinity' ? 'haline' : 'thermal'
      });
      if (curtain) group.add(curtain);
    }
  }, [activeTransect, viewMode, selectedVariable]);

  // 7. View Mode Switching Effect (Globe vs Block) with Smooth Camera Fly
  useEffect(() => {
    const isBlock = viewMode === 'block';
    if (earthMeshRef.current) earthMeshRef.current.visible = !isBlock;
    if (cloudsMeshRef.current) cloudsMeshRef.current.visible = !isBlock;
    if (atmosphereMeshRef.current) atmosphereMeshRef.current.visible = !isBlock;
    if (scalarMeshRef.current) scalarMeshRef.current.visible = !isBlock;
    if (oceanBlockGroupRef.current) oceanBlockGroupRef.current.visible = isBlock;
    if (transectGroupRef.current) transectGroupRef.current.visible = isBlock;

    if (cameraRef.current && controlsRef.current) {
      const cam = cameraRef.current;
      const ctrl = controlsRef.current;
      if (isBlock) {
        ctrl.minDistance = 20;
        ctrl.maxDistance = 350;
      } else {
        configureGlobeZoom(cam, ctrl, 420);
      }

      const targetCamPos = isBlock
        ? new THREE.Vector3(65, 55, 75)
        : new THREE.Vector3(INITIAL_CAM_POS.x, INITIAL_CAM_POS.y, INITIAL_CAM_POS.z);
      const targetLookAt = isBlock
        ? new THREE.Vector3(0, -15, 0)
        : new THREE.Vector3(0, 0, 0);

      const startCamPos = cam.position.clone();
      const startLookAt = ctrl.target.clone();
      const startTime = performance.now();
      const duration = 800; // ms

      let animId;
      const animateTransition = (now) => {
        const elapsed = now - startTime;
        const progress = Math.min(1, elapsed / duration);
        const ease = progress < 0.5
          ? 4 * progress * progress * progress
          : 1 - Math.pow(-2 * progress + 2, 3) / 2;

        cam.position.lerpVectors(startCamPos, targetCamPos, ease);
        ctrl.target.lerpVectors(startLookAt, targetLookAt, ease);
        ctrl.update();

        if (progress < 1) {
          animId = requestAnimationFrame(animateTransition);
        } else {
          ctrl.update();
        }
      };
      animId = requestAnimationFrame(animateTransition);

      return () => {
        if (animId) cancelAnimationFrame(animId);
      };
    }
  }, [viewMode]);

  // 7b. Full View Mode Dynamic Viewport Resize Effect
  useEffect(() => {
    if (!rendererRef.current || !cameraRef.current || !containerRef.current) return;
    const updateSize = () => {
      const container = containerRef.current;
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w > 0 && h > 0) {
        cameraRef.current.aspect = w / h;
        cameraRef.current.updateProjectionMatrix();
        if (viewModeRef.current === 'globe' && controlsRef.current) {
          configureGlobeZoom(cameraRef.current, controlsRef.current);
          controlsRef.current.update();
        }
        rendererRef.current.setSize(w, h);
      }
    };
    updateSize();
    const t1 = setTimeout(updateSize, 60);
    const t2 = setTimeout(updateSize, 280);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [isFullView]);

  // 8. Main Three.js Scene Setup & Lifecycle Effect
  useEffect(() => {
    if (!webglAvailable) return;

    const container = containerRef.current;
    if (!container) return;

    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }

    const width = container.clientWidth || 600;
    const height = container.clientHeight || 450;

    // Scene setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x020712);
    sceneRef.current = scene;

    // Camera setup
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1200);
    camera.position.set(INITIAL_CAM_POS.x, INITIAL_CAM_POS.y, INITIAL_CAM_POS.z);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    // WebGL Renderer
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance'
      });
    } catch {
      return;
    }

    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Orbit Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.rotateSpeed = 0.75;
    controls.zoomSpeed = 0.85;
    configureGlobeZoom(camera, controls);
    controls.target.set(0, 0, 0);
    controlsRef.current = controls;

    // Balanced Photorealistic Illumination
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x1e293b, 1.15);
    scene.add(hemiLight);

    const sunLight = new THREE.DirectionalLight(0xffffff, 1.4);
    sunLight.position.set(160, 130, 140);
    scene.add(sunLight);

    const backFillLight = new THREE.DirectionalLight(0xdbeafe, 0.95);
    backFillLight.position.set(-160, 60, -140);
    scene.add(backFillLight);

    const polarFill = new THREE.DirectionalLight(0x93c5fd, 0.45);
    polarFill.position.set(0, -120, 120);
    scene.add(polarFill);

    // Deep-Space Starfield Dust
    const starCount = 1200;
    const starGeo = new THREE.BufferGeometry();
    const starPositions = new Float32Array(starCount * 3);
    const starColors = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos((Math.random() * 2) - 1);
      const r = 400 + Math.random() * 450;
      starPositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      starPositions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      starPositions[i * 3 + 2] = r * Math.cos(phi);

      const tint = Math.random();
      if (tint > 0.65) {
        starColors[i * 3] = 0.0;
        starColors[i * 3 + 1] = 0.96;
        starColors[i * 3 + 2] = 0.83;
      } else if (tint > 0.35) {
        starColors[i * 3] = 0.22;
        starColors[i * 3 + 1] = 0.74;
        starColors[i * 3 + 2] = 0.97;
      } else {
        starColors[i * 3] = 0.85;
        starColors[i * 3 + 1] = 0.92;
        starColors[i * 3 + 2] = 1.0;
      }
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    starGeo.setAttribute('color', new THREE.BufferAttribute(starColors, 3));
    const starMat = new THREE.PointsMaterial({
      size: 1.6,
      vertexColors: true,
      transparent: true,
      opacity: 0.75,
      depthWrite: false
    });
    const starField = new THREE.Points(starGeo, starMat);
    starField.renderOrder = 0;
    scene.add(starField);

    // Ocean-Centric Digital Twin Globe (GEBCO Bathymetry + Procedural Wave Normals)
    const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
    const earthTextures = loadEarthTextures(maxAnisotropy);
    const globeGeometry = new THREE.SphereGeometry(DEFAULT_GLOBE_RADIUS, 192, 192);
    const globeMaterial = createOceanGlobeMaterial(earthTextures, {
      oceanStyle: oceanStyleRef.current ?? 0,
      waveIntensity: 0.75
    });
    const earthMesh = new THREE.Mesh(globeGeometry, globeMaterial);
    earthMesh.renderOrder = 2;
    scene.add(earthMesh);
    globeMaterialRef.current = globeMaterial;
    earthMeshRef.current = earthMesh;

    // Natural Cloud Layer
    const cloudsGeometry = new THREE.SphereGeometry(DEFAULT_GLOBE_RADIUS * 1.006, 48, 48);
    const cloudsMaterial = new THREE.MeshStandardMaterial({
      map: earthTextures.cloudsTexture,
      transparent: true,
      opacity: 0.28,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const cloudsMesh = new THREE.Mesh(cloudsGeometry, cloudsMaterial);
    cloudsMesh.renderOrder = 3;
    scene.add(cloudsMesh);
    cloudsMeshRef.current = cloudsMesh;

    // Soft Atmospheric Limb Glow
    const atmosphereGeometry = new THREE.SphereGeometry(DEFAULT_GLOBE_RADIUS * 1.020, 48, 48);
    const atmosphereMaterial = createAtmosphereMaterial();
    const atmosphereMesh = new THREE.Mesh(atmosphereGeometry, atmosphereMaterial);
    atmosphereMesh.renderOrder = 4;
    scene.add(atmosphereMesh);
    atmosphereMeshRef.current = atmosphereMesh;

    // In-situ Argo float markers group
    const argoGroup = new THREE.Group();
    argoGroup.name = 'argo-markers-group';
    scene.add(argoGroup);
    argoMarkersGroupRef.current = argoGroup;

    const gliderGroup = new THREE.Group();
    gliderGroup.name = 'glider-transects';
    scene.add(gliderGroup);
    gliderGroupRef.current = gliderGroup;

    // Anomaly Residual Spheres Group
    const anomalyGroup = new THREE.Group();
    anomalyGroup.name = 'anomaly-spheres-group';
    scene.add(anomalyGroup);
    anomalyGroupRef.current = anomalyGroup;

    // 3D Regional Ocean Volume Block Group
    const oceanBlockGroup = new THREE.Group();
    oceanBlockGroup.name = 'ocean-volume-block-container';
    oceanBlockGroup.visible = viewModeRef.current === 'block';
    scene.add(oceanBlockGroup);
    oceanBlockGroupRef.current = oceanBlockGroup;

    // 3D Probe Pin Beacon Group
    const probeGroup = new THREE.Group();
    probeGroup.name = 'probe-pin-group';
    scene.add(probeGroup);
    probeGroupRef.current = probeGroup;

    // ODV Vertical Transect Group
    const transectGroup = new THREE.Group();
    transectGroup.name = 'odv-transect-curtain-group';
    transectGroup.visible = viewModeRef.current === 'block';
    scene.add(transectGroup);
    transectGroupRef.current = transectGroup;

    // 3D Spherical Coordinate Graticules (Parallels & Meridians)
    const graticulesMesh = createGraticuleMesh({ globeRadius: DEFAULT_GLOBE_RADIUS });
    graticulesMesh.visible = showGraticulesRef.current && viewModeRef.current === 'globe';
    scene.add(graticulesMesh);
    graticulesGroupRef.current = graticulesMesh;

    // 3D Ocean Geographic Feature & Basin Labels (Google Maps-Style Multi-Scale LOD)
    const placeLabelsGroup = createHierarchicalPlaceMeshGroup({ globeRadius: DEFAULT_GLOBE_RADIUS });
    placeLabelsGroup.visible = showBasinLabelsRef.current && viewModeRef.current === 'globe';
    scene.add(placeLabelsGroup);
    basinLabelsGroupRef.current = placeLabelsGroup;

    // Pointer events for drag vs click discrimination
    const handlePointerDown = (e) => {
      pointerDownPosRef.current = { x: e.clientX, y: e.clientY };
    };

    const handlePointerUp = (e) => {
      const dx = e.clientX - pointerDownPosRef.current.x;
      const dy = e.clientY - pointerDownPosRef.current.y;
      if (dx * dx + dy * dy > 16) return;

      const rect = renderer.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );

      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(mouse, camera);

      // 1. Raycast against Argo markers
      if (showArgoRef.current && argoMarkersGroupRef.current && viewModeRef.current === 'globe') {
        const hitFloat = raycastArgoMarkers(
          raycaster,
          argoMarkersGroupRef.current,
          camera.position,
          DEFAULT_GLOBE_RADIUS
        );
        if (hitFloat) {
          onSelectFloatRef.current?.(hitFloat);
          return;
        }
      }

      // 2. Raycast against Gliders
      if (showGlidersRef.current && gliderGroupRef.current && viewModeRef.current === 'globe') {
        const hitGlider = raycastGliderTransects(
          raycaster,
          gliderGroupRef.current,
          camera.position,
          DEFAULT_GLOBE_RADIUS
        );
        if (hitGlider) {
          onSelectGliderRef.current?.(hitGlider);
          return;
        }
      }

      // 3. Raycast against Anomaly Residuals
      if (showAnomalyFieldRef.current && anomalyGroupRef.current && viewModeRef.current === 'globe') {
        const hitAnomaly = raycastAnomalyField(raycaster, anomalyGroupRef.current);
        if (hitAnomaly) {
          onSelectAnomalyPointRef.current?.(hitAnomaly);
          return;
        }
      }

      // 3b. Raycast against Hierarchical Ocean Places (Google Maps-Style Place Click & Fly)
      if (showBasinLabelsRef.current && basinLabelsGroupRef.current && viewModeRef.current === 'globe') {
        const hitPlace = raycastPlaceMarker(raycaster, basinLabelsGroupRef.current);
        if (hitPlace) {
          handleZoomBasinRef.current?.({
            lat: hitPlace.lat,
            lon: hitPlace.lon,
            dist: Math.min(hitPlace.peakDist || 114, 114)
          });
          onSelectRegionRef.current?.({
            id: hitPlace.id,
            name: hitPlace.name,
            lat: hitPlace.lat,
            lon: hitPlace.lon,
            dist: Math.min(hitPlace.peakDist || 114, 114),
            level: hitPlace.level === 4 ? 'Local Sector' : (hitPlace.level === 3 ? 'Coastal' : (hitPlace.level === 2 ? 'Sub-Basin' : 'Macro'))
          });
          onProbePointRef.current?.({ lat: hitPlace.lat, lon: hitPlace.lon });
          return;
        }
      }

      // 4. Raycast for Click-to-Probe (Block mode vs Globe mode)
      if (viewModeRef.current === 'block' && oceanBlockGroupRef.current) {
        const hits = raycaster.intersectObjects(oceanBlockGroupRef.current.children, true);
        if (hits.length > 0) {
          const hit = hits[0];
          if (hit.object?.userData?.instances && hit.instanceId !== undefined) {
            const inst = hit.object.userData.instances[hit.instanceId];
            if (inst) {
              const lat = Math.round(inst.lat * 100) / 100;
              const lon = Math.round(inst.lon * 100) / 100;
              onProbePointRef.current?.({ lat, lon, depth: inst.depth, value: inst.value });
              return;
            }
          }
          const geo = blockToGeo(hit.point.x, hit.point.z);
          const lat = Math.round(geo.lat * 1000) / 1000;
          const lon = Math.round(geo.lon * 1000) / 1000;
          onProbePointRef.current?.({ lat, lon });
          return;
        }
      } else if (viewModeRef.current === 'globe' && earthMeshRef.current) {
        const targetMeshes = [scalarMeshRef.current, earthMeshRef.current].filter(Boolean);
        const hits = raycaster.intersectObjects(targetMeshes, false);
        if (hits.length > 0) {
          const hit = hits[0];
          const geo = cartesianToGeo(hit.point.x, hit.point.y, hit.point.z);
          const lat = Math.round(geo.lat * 1000) / 1000;
          const lon = Math.round(geo.lon * 1000) / 1000;
          onProbePointRef.current?.({ lat, lon });
          return;
        }
      }
    };

    // Hover coordinate tracker for real-time cursor feedback
    const handlePointerMove = (e) => {
      if (!camera || !renderer) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(mouse, camera);

      // Dynamic cursor feedback for clickable ocean places and sensor platforms
      let isInteractive = false;
      if (viewModeRef.current === 'globe') {
        if (basinLabelsGroupRef.current && showBasinLabelsRef.current) {
          const hit = raycastPlaceMarker(raycaster, basinLabelsGroupRef.current);
          if (hit) isInteractive = true;
        }
        if (!isInteractive && argoMarkersGroupRef.current && showArgoRef.current) {
          const hit = raycastArgoMarkers(raycaster, argoMarkersGroupRef.current, camera.position, DEFAULT_GLOBE_RADIUS);
          if (hit) isInteractive = true;
        }
        if (!isInteractive && gliderGroupRef.current && showGlidersRef.current) {
          const hit = raycastGliderTransects(raycaster, gliderGroupRef.current, camera.position, DEFAULT_GLOBE_RADIUS);
          if (hit) isInteractive = true;
        }
      }
      renderer.domElement.style.cursor = isInteractive ? 'pointer' : 'default';

      if (viewModeRef.current === 'block' && oceanBlockGroupRef.current) {
        const hits = raycaster.intersectObjects(oceanBlockGroupRef.current.children, true);
        if (hits.length > 0) {
          const hit = hits[0];
          let voxelInfo = null;
          if (hit.object?.userData?.instances && hit.instanceId !== undefined) {
            voxelInfo = hit.object.userData.instances[hit.instanceId];
          }
          const geo = blockToGeo(hit.point.x, hit.point.z);
          setHoveredCoord({
            lat: voxelInfo?.lat != null ? voxelInfo.lat : Math.round(geo.lat * 100) / 100,
            lon: voxelInfo?.lon != null ? voxelInfo.lon : Math.round(geo.lon * 100) / 100,
            depth: voxelInfo?.depth,
            value: voxelInfo?.value,
            variable: voxelInfo?.variable,
            units: voxelInfo?.units,
            dataset: voxelInfo?.dataset,
            source: voxelInfo?.source,
            time: voxelInfo?.time
          });
          return;
        }
      } else if (viewModeRef.current === 'globe' && earthMeshRef.current) {
        const targetMeshes = [scalarMeshRef.current, earthMeshRef.current].filter(Boolean);
        const hits = raycaster.intersectObjects(targetMeshes, false);
        if (hits.length > 0) {
          const geo = cartesianToGeo(hits[0].point.x, hits[0].point.y, hits[0].point.z);
          setHoveredCoord({
            lat: Math.round(geo.lat * 100) / 100,
            lon: Math.round(geo.lon * 100) / 100
          });
          return;
        }
      }
      setHoveredCoord(null);
    };

    const handlePointerLeave = () => {
      setHoveredCoord(null);
    };

    const handleDblClick = (e) => {
      if (!camera || !renderer || viewModeRef.current !== 'globe') return;
      const rect = renderer.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(mouse, camera);
      const targetMeshes = [scalarMeshRef.current, earthMeshRef.current].filter(Boolean);
      const hits = raycaster.intersectObjects(targetMeshes, false);
      if (hits.length > 0) {
        const hit = hits[0];
        const geo = cartesianToGeo(hit.point.x, hit.point.y, hit.point.z);
        const currentDist = camera.position.length();
        const nextDist = Math.max(105, currentDist * 0.7);
        handleZoomToCoordinateRef.current?.(geo.lat, geo.lon, nextDist);
      }
    };

    const handleControlsChange = () => {
      if (camera) {
        setCurrentLOD(calculateLOD(camera.position.length()));
      }
    };
    controls.addEventListener('change', handleControlsChange);

    renderer.domElement.addEventListener('pointerdown', handlePointerDown);
    renderer.domElement.addEventListener('pointerup', handlePointerUp);
    renderer.domElement.addEventListener('pointermove', handlePointerMove);
    renderer.domElement.addEventListener('pointerleave', handlePointerLeave);
    renderer.domElement.addEventListener('dblclick', handleDblClick);

    // Animation & Performance Loop
    let animationFrameId;
    let isDisposed = false;
    let frameCount = 0;
    let lastFpsTime = window.performance.now();
    let lastFrameTime = window.performance.now();

    const animate = () => {
      if (isDisposed) return;
      animationFrameId = window.requestAnimationFrame(animate);

      const now = window.performance.now();
      const dt = Math.min(0.1, (now - lastFrameTime) / 1000);
      lastFrameTime = now;

      // Update particle streamlines advection
      if (particleSystemRef.current && currentsDataRef.current && viewModeRef.current === 'globe') {
        const cData = currentsDataRef.current;
        particleSystemRef.current.update(
          dt,
          cData.u_values,
          cData.v_values,
          cData.lats,
          cData.lons,
          requestedDepthRef.current
        );
      }

      // Update Earth occlusion and hierarchical LOD in Globe mode
      if (viewModeRef.current === 'globe') {
        if (basinLabelsGroupRef.current && showBasinLabelsRef.current) {
          updatePlaceLabelsLOD(basinLabelsGroupRef.current, camera, DEFAULT_GLOBE_RADIUS);
        }
        if (argoMarkersGroupRef.current && showArgoRef.current) {
          updateOccludedMarkersVisibility(argoMarkersGroupRef.current, camera.position, DEFAULT_GLOBE_RADIUS);
        }
        if (gliderGroupRef.current && showGlidersRef.current) {
          updateGliderOcclusion(gliderGroupRef.current, camera.position, DEFAULT_GLOBE_RADIUS);
        }
        if (anomalyGroupRef.current && showAnomalyFieldRef.current) {
          updateAnomalyOcclusion(anomalyGroupRef.current, camera, DEFAULT_GLOBE_RADIUS);
        }
        if (cloudsMesh) {
          cloudsMesh.rotation.y += 0.00015;
        }
        if (globeMaterialRef.current?.uniforms?.uTime) {
          globeMaterialRef.current.uniforms.uTime.value = now * 0.001;
        }
      }

      // Dynamically scale the probe pin beacon so it remains a sharp precision needle
      // without blowing up into a giant blob, nor shrinking into an invisible speck.
      if (probeGroupRef.current && probeGroupRef.current.children.length > 0) {
        probeGroupRef.current.children.forEach((pin) => {
          const worldPos = new THREE.Vector3();
          pin.getWorldPosition(worldPos);
          const distToCam = camera.position.distanceTo(worldPos);
          const scaleFactor = Math.max(0.22, Math.min(1.1, distToCam / 140.0));
          pin.scale.set(scaleFactor, scaleFactor, scaleFactor);
        });
      }

      controls.update();
      renderer.render(scene, camera);

      frameCount++;
      if (now - lastFpsTime >= 1000) {
        const currentFps = Math.round((frameCount * 1000) / (now - lastFpsTime));
        setRendererStats({
          fps: currentFps,
          drawCalls: renderer.info.render.calls
        });
        frameCount = 0;
        lastFpsTime = now;
      }
    };

    animate();

    // Resize Handling
    const handleResize = () => {
      if (!container || isDisposed) return;
      const newWidth = container.clientWidth;
      const newHeight = container.clientHeight;
      if (newWidth > 0 && newHeight > 0) {
        camera.aspect = newWidth / newHeight;
        camera.updateProjectionMatrix();
        if (viewModeRef.current === 'globe') {
          configureGlobeZoom(camera, controls);
          controls.update();
        }
        renderer.setSize(newWidth, newHeight);
      }
    };

    let resizeObserver = null;
    if (typeof window.ResizeObserver !== 'undefined') {
      resizeObserver = new window.ResizeObserver(() => handleResize());
      resizeObserver.observe(container);
    }
    window.addEventListener('resize', handleResize);

    // Clean Resource Teardown on Unmount
    return () => {
      isDisposed = true;
      window.cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', handleResize);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }

      controls.removeEventListener('change', handleControlsChange);
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown);
      renderer.domElement.removeEventListener('pointerup', handlePointerUp);
      renderer.domElement.removeEventListener('pointermove', handlePointerMove);
      renderer.domElement.removeEventListener('pointerleave', handlePointerLeave);
      renderer.domElement.removeEventListener('dblclick', handleDblClick);

      if (argoMarkersGroupRef.current) {
        disposeArgoMarkers(argoMarkersGroupRef.current);
        scene.remove(argoMarkersGroupRef.current);
        argoMarkersGroupRef.current = null;
      }

      if (gliderGroupRef.current) {
        disposeGliderTransects(gliderGroupRef.current);
        scene.remove(gliderGroupRef.current);
        gliderGroupRef.current = null;
      }

      if (anomalyGroupRef.current) {
        disposeAnomalyField(anomalyGroupRef.current);
        scene.remove(anomalyGroupRef.current);
        anomalyGroupRef.current = null;
      }

      if (oceanBlockGroupRef.current) {
        disposeOceanVolumeBlock(oceanBlockGroupRef.current);
        scene.remove(oceanBlockGroupRef.current);
        oceanBlockGroupRef.current = null;
      }

      if (probeGroupRef.current) {
        scene.remove(probeGroupRef.current);
        probeGroupRef.current = null;
      }

      if (transectGroupRef.current) {
        scene.remove(transectGroupRef.current);
        transectGroupRef.current = null;
      }

      if (graticulesGroupRef.current) {
        disposeGraticuleGroup(graticulesGroupRef.current);
        scene.remove(graticulesGroupRef.current);
        graticulesGroupRef.current = null;
      }

      if (basinLabelsGroupRef.current) {
        disposeGraticuleGroup(basinLabelsGroupRef.current);
        scene.remove(basinLabelsGroupRef.current);
        basinLabelsGroupRef.current = null;
      }

      controls.dispose();

      if (particleSystemRef.current) {
        particleSystemRef.current.dispose();
        particleSystemRef.current = null;
      }

      if (scalarMeshRef.current) {
        scene.remove(scalarMeshRef.current);
        scalarMeshRef.current.geometry?.dispose();
        scalarMeshRef.current.material?.dispose();
        scalarMeshRef.current = null;
      }

      scene.remove(earthMesh);
      globeGeometry.dispose();
      globeMaterial.dispose();
      earthTextures.dayTexture?.dispose?.();
      earthTextures.normalTexture?.dispose?.();
      earthTextures.specularTexture?.dispose?.();

      scene.remove(cloudsMesh);
      cloudsGeometry.dispose();
      cloudsMaterial.dispose();
      earthTextures.cloudsTexture?.dispose?.();

      scene.remove(atmosphereMesh);
      atmosphereGeometry.dispose();
      atmosphereMaterial.dispose();

      scene.remove(starField);
      starGeo.dispose();
      starMat.dispose();

      hemiLight.dispose?.();
      sunLight.dispose?.();
      backFillLight.dispose?.();
      polarFill.dispose?.();

      if (renderer) {
        renderer.dispose();
        if (renderer.forceContextLoss) {
          renderer.forceContextLoss();
        }
        if (renderer.domElement && container.contains(renderer.domElement)) {
          container.removeChild(renderer.domElement);
        }
        rendererRef.current = null;
      }
      sceneRef.current = null;
    };
  }, [webglAvailable]);

  // Synchronize Argo float markers
  useEffect(() => {
    const group = argoMarkersGroupRef.current;
    if (!group) return;

    if (!showArgo) {
      group.visible = false;
      disposeArgoMarkers(group);
      return;
    }

    group.visible = true;
    disposeArgoMarkers(group);
    argoFloats.forEach((f) => {
      const isSel = selectedFloat && selectedFloat.id === f.id;
      const marker = createArgoMarker(f, isSel);
      group.add(marker);
    });
  }, [showArgo, argoFloats, selectedFloat]);

  // Update marker selection highlighting
  useEffect(() => {
    if (argoMarkersGroupRef.current) {
      updateMarkerSelectionVisuals(argoMarkersGroupRef.current, selectedFloat?.id || null);
    }
  }, [selectedFloat]);

  // Synchronize Glider transects
  useEffect(() => {
    const group = gliderGroupRef.current;
    if (!group) return;

    if (!showGliders) {
      group.visible = false;
      disposeGliderTransects(group);
      return;
    }

    group.visible = true;
    disposeGliderTransects(group);
    gliderTransects.forEach((g) => {
      const isSel = (selectedGlider && selectedGlider.id === g.id) || (selectedFloat && selectedFloat.id === g.id);
      const mesh = createGliderTransectMesh(g, { isSelected: isSel });
      group.add(mesh);
    });
  }, [showGliders, gliderTransects, selectedGlider, selectedFloat]);

  // Update glider selection visuals
  useEffect(() => {
    if (gliderGroupRef.current) {
      const activeId = selectedGlider?.id || (selectedFloat?.platform_type === 'glider' ? selectedFloat.id : null);
      updateGliderSelectionVisuals(gliderGroupRef.current, activeId);
    }
  }, [selectedGlider, selectedFloat]);

  // Synchronize 3D Anomaly Residual Spheres
  useEffect(() => {
    const group = anomalyGroupRef.current;
    if (!group) return;

    if (!showAnomalyField || !anomalyPoints || anomalyPoints.length === 0) {
      group.visible = false;
      disposeAnomalyField(group);
      return;
    }

    group.visible = true;
    disposeAnomalyField(group);
    const meshGroup = createAnomalyFieldMesh(anomalyPoints, {
      globeRadius: DEFAULT_GLOBE_RADIUS,
      verticalExaggeration: 30
    });
    if (meshGroup) {
      group.add(meshGroup);
    }
  }, [showAnomalyField, anomalyPoints]);

  return (
    <section className={`panel viewport relative flex flex-col ${isFullView ? 'full-view-active' : ''}`} aria-labelledby="viewport-heading">
      <div className="viewport-top flex flex-wrap justify-between items-center gap-3">
        <div>
          <span className="eyebrow text-ocean">SPATIAL OBSERVATORY</span>
          <h2 id="viewport-heading" className="m-0">
            {viewMode === 'block' ? 'Regional 3D Ocean Volume Block (0-25°N, 65-95°E)' : '3D Indian Ocean Globe'}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <span className="subtle-tag border border-emerald-500/30 bg-emerald-950/20 text-emerald-400">
            WebGL2 Active
          </span>
          {fieldState.loading ? (
            <span className="subtle-tag border border-cyan-500/30 bg-cyan-950/20 text-cyan-400">
              Loading 3D Field...
            </span>
          ) : fieldState.error ? (
            <span className="subtle-tag border border-amber-500/30 bg-amber-950/20 text-amber-400">
              API Disconnected
            </span>
          ) : (
            <span className="subtle-tag border border-cyan-500/30 bg-cyan-950/20 text-cyan-400">
              {requestedDepth > 0 ? `3D Subsurface Layer Active (${fieldState.sliceData?.selected_depth ?? requestedDepth}m)` : '3D Thermal Layer Active'}
            </span>
          )}
        </div>
      </div>

      {!webglAvailable ? (
        <div className="viewport-fallback p-6 text-center flex-1 flex flex-col items-center justify-center">
          <div className="empty-symbol text-amber-400">⚠️</div>
          <h3 className="text-lg font-semibold text-amber-200 mt-2">WebGL Acceleration Unavailable</h3>
          <p className="text-sm text-slate-300 max-w-md mt-2">
            Interactive 3D rendering requires WebGL support or hardware acceleration.
            Please verify GPU drivers or browser settings.
          </p>
        </div>
      ) : (
        <div className="viewport-canvas-container relative flex-1 min-h-[520px] w-full overflow-hidden">
          <div
            ref={containerRef}
            className="globe-canvas-wrapper absolute inset-0 w-full h-full cursor-grab active:cursor-grabbing"
            data-testid="three-canvas-container"
          />
          {viewMode === 'block' && volumeLoading && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-slate-950/70 backdrop-blur-sm pointer-events-none">
              <div className="w-8 h-8 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin mb-3" />
              <div className="text-cyan-300 font-mono text-xs font-semibold">
                Loading 3D Ocean Volume ({activeDataset?.name || 'Copernicus GLORYS12V1'})...
              </div>
              <div className="text-slate-400 text-[10px] mt-1 font-mono">
                Downsampling 3D spatial field · 0.49m to 92.33m depth
              </div>
            </div>
          )}

          {viewMode === 'block' && volumeError && (
            <div className="absolute top-16 left-1/2 -translate-x-1/2 z-30 bg-rose-950/90 border border-rose-500/80 rounded-lg p-3 text-rose-200 text-xs shadow-2xl flex items-center gap-3">
              <span>⚠️ {volumeError}</span>
              <button
                type="button"
                onClick={fetchVolumeData}
                className="px-2.5 py-1 rounded bg-rose-800 hover:bg-rose-700 text-white font-mono text-[11px] transition pointer-events-auto"
              >
                Retry
              </button>
            </div>
          )}
          {showAnomalyField && (
            <div
              className="sr-only"
              data-testid="anomaly-sphere-layer"
              aria-label="3D Anomaly Sphere Layer Active"
            />
          )}

          {/* Viewport Floating HUD */}
          <div className="viewport-hud pointer-events-none absolute top-2 left-2 right-2 flex flex-wrap justify-between items-start gap-1.5 text-xs">
            {/* Left Telemetry & Context Area (Offset by 92px to cleanly avoid VerticalDepthBar) */}
            <div className="hud-telemetry-container flex flex-col gap-1.5 pointer-events-auto ml-[92px] max-w-[calc(100%-240px)]">
              {/* Row 1: Primary Scientific Telemetry Ribbon */}
              <div className="flex flex-wrap items-center gap-1.5">
                {fieldState.sliceData && (
                  <div className="hud-badge rounded px-2.5 py-1 font-mono text-[10px] text-slate-200 shadow-md bg-slate-950/90 border border-slate-700/80 flex items-center gap-1.5" data-testid="hud-layer-badge">
                    <span className="text-emerald-400 font-bold">● LAYER:</span>{' '}
                    <span>{fieldState.sliceData.variable === 'salinity' ? 'Practical Salinity' : 'Potential Temperature'}</span>{' '}
                    <span className="text-slate-400">({(fieldState.sliceData.selected_depth ?? 0) === 0 ? '0m Surface' : `${fieldState.sliceData.selected_depth}m`})</span>
                    <span className="text-amber-300 font-semibold border-l border-slate-700 pl-1.5">
                      {fieldState.sliceData.min_val?.toFixed(1)} to {fieldState.sliceData.max_val?.toFixed(1)} {(fieldState.sliceData.units === 'degC' || fieldState.sliceData.units === 'celsius') ? '°C' : (fieldState.sliceData.units || (fieldState.sliceData.variable === 'salinity' ? 'PSU' : '°C'))}
                    </span>
                  </div>
                )}

                {fieldState.sliceData && (
                  <div className="hud-badge rounded px-2.5 py-1 font-mono text-[10px] text-cyan-300 shadow-md bg-slate-950/90 border border-cyan-500/50 flex items-center gap-1.5" data-testid="hud-depth-badge">
                    <span className="text-cyan-400 font-bold">DEPTH:</span>{' '}
                    <span>{fieldState.sliceData.requested_depth ?? requestedDepth}m requested</span>{' '}
                    <span className="text-slate-400 text-[9.5px]">
                      {fieldState.sliceData.selected_depth !== (fieldState.sliceData.requested_depth ?? requestedDepth)
                        ? `(snapped to ${fieldState.sliceData.selected_depth}m model level)`
                        : `(${(fieldState.sliceData.selected_depth ?? 0) === 0 ? 'Surface level' : `${fieldState.sliceData.selected_depth}m model layer`})`}
                    </span>
                    {fieldState.loading && <span className="ml-1 text-amber-300">⟳ Slicing...</span>}
                  </div>
                )}

                {fieldState.sliceData && (
                  <div className="hud-badge rounded px-2.5 py-1 font-mono text-[10px] text-amber-300 shadow-md bg-slate-950/90 border border-amber-600/50 flex items-center gap-1.5" data-testid="hud-time-badge">
                    <span className="text-amber-400 font-bold">TIME:</span>{' '}
                    <span>{formatTimeLabel(fieldState.sliceData.timestamp, fieldState.sliceData.time_idx ?? timeIndex)}</span>{' '}
                    <span className="text-slate-400 font-normal">[STEP {(fieldState.sliceData.time_idx ?? timeIndex) + 1}/{availableTimes?.length || 1}]</span>
                    {isBuffering && <span className="ml-1 text-amber-300">⟳ Buffering...</span>}
                  </div>
                )}

                {viewMode === 'globe' && (
                  <div className="lod-status-pill hud-badge rounded px-2.5 py-1 font-mono text-[10px] shadow-md bg-slate-950/90 border border-slate-700/80 flex items-center gap-1.5" data-testid="lod-status-pill">
                    <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ backgroundColor: currentLOD.color }} />
                    <span className="font-bold text-slate-200">{currentLOD.code}</span>
                    <span className="text-slate-500">•</span>
                    <span className="text-slate-300">{currentLOD.label}</span>
                    <span className="text-slate-400">({currentLOD.resolution})</span>
                  </div>
                )}

                {showArgo && (
                  <div className="hud-badge rounded px-2 py-1 font-mono text-[10px] text-amber-300 shadow-md bg-slate-950/90 border border-amber-600/50 flex items-center gap-1" data-testid="hud-argo-badge">
                    <span className="text-amber-400 font-semibold">ARGO:</span>{' '}
                    <span>{argoFloats.length} active</span>
                  </div>
                )}

                {showGliders && (
                  <div className="hud-badge rounded px-2 py-1 font-mono text-[10px] text-emerald-300 shadow-md bg-slate-950/90 border border-emerald-600/50 flex items-center gap-1" data-testid="hud-glider-badge">
                    <span className="text-emerald-400 font-semibold">GLIDERS:</span>{' '}
                    <span>{gliderTransects.length} active</span>
                  </div>
                )}

                {showCurrents && (
                  <div className="hud-badge rounded px-2 py-1 font-mono text-[10px] text-teal-300 shadow-md bg-slate-950/90 border border-teal-700/50 flex items-center gap-1" data-testid="hud-streamlines-badge">
                    <span className="text-teal-400 font-semibold">STREAMLINES:</span>{' '}
                    <span>1,500</span>
                  </div>
                )}

                {showAnomalyField && (
                  <div className="hud-badge rounded px-2 py-1 font-mono text-[10px] text-pink-300 shadow-md bg-slate-950/90 border border-pink-600/50 flex items-center gap-1" data-testid="hud-anomaly-badge">
                    <span className="text-pink-400 font-semibold">ANOMALIES:</span>{' '}
                    <span>{anomalyPoints.length}</span>
                  </div>
                )}
              </div>

              {/* Row 2: Contextual Inspectors & Mode Controls */}
              {(hoveredCoord || viewMode === 'block' || probedPoint || activeTransect || fieldState.error) && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {hoveredCoord && hoveredCoord.value !== undefined && hoveredCoord.value !== null ? (
                    <div className="hud-badge rounded px-2.5 py-1 font-mono text-[10.5px] text-cyan-200 shadow-xl bg-slate-950/95 border border-cyan-400/90 flex items-center gap-2 flex-wrap" data-testid="hud-voxel-inspector">
                      <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse inline-block" />
                      <span className="text-cyan-300 font-bold">VOXEL INSPECTOR:</span>
                      <span className="text-amber-300 font-bold">
                        {hoveredCoord.value} {hoveredCoord.units || (selectedVariable === 'salinity' ? 'PSU' : (selectedVariable === 'currents' ? 'm/s' : '°C'))}
                      </span>
                      <span className="border-l border-slate-700 pl-2 text-sky-300">
                        Depth: {hoveredCoord.depth != null ? `${Number(hoveredCoord.depth).toFixed(2)}m` : 'Surface'}
                      </span>
                      <span className="border-l border-slate-700 pl-2 text-slate-300">
                        {hoveredCoord.lat >= 0 ? `${Number(hoveredCoord.lat).toFixed(2)}°N` : `${Math.abs(Number(hoveredCoord.lat)).toFixed(2)}°S`},{' '}
                        {hoveredCoord.lon >= 0 ? `${Number(hoveredCoord.lon).toFixed(2)}°E` : `${Math.abs(Number(hoveredCoord.lon)).toFixed(2)}°W`}
                      </span>
                      {hoveredCoord.dataset && (
                        <span className="border-l border-slate-700 pl-2 text-emerald-400 text-[10px]">
                          {hoveredCoord.dataset}
                        </span>
                      )}
                    </div>
                  ) : hoveredCoord ? (
                    <div className="hud-badge rounded px-2.5 py-1 font-mono text-[10px] text-cyan-300 shadow bg-slate-900/95 border border-cyan-500/60">
                      <span className="text-cyan-400 font-bold">📍 CURSOR:</span>{' '}
                      {hoveredCoord.lat >= 0 ? `${hoveredCoord.lat.toFixed(2)}°N` : `${Math.abs(hoveredCoord.lat).toFixed(2)}°S`},{' '}
                      {hoveredCoord.lon >= 0 ? `${hoveredCoord.lon.toFixed(2)}°E` : `${Math.abs(hoveredCoord.lon).toFixed(2)}°W`}{' '}
                      · <span className="text-slate-300">Click to probe data</span>
                    </div>
                  ) : null}

                  {probedPoint && (
                    <div className="hud-badge rounded px-2.5 py-1 font-mono text-[10px] text-emerald-300 shadow bg-slate-900/95 border border-emerald-500/80 flex items-center gap-1.5" data-testid="hud-probed-badge">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />
                      <span className="text-emerald-400 font-semibold">PROBED CTD:</span>
                      <span>{probedPoint.lat}°N, {probedPoint.lon}°E</span>
                      {probeData && probeData.sst !== null && probeData.sst !== undefined && (
                        <span className="text-amber-300 font-bold border-l border-slate-700 pl-1.5">
                          SST: {probeData.sst}°C
                        </span>
                      )}
                      {probeData && probeData.mld !== null && probeData.mld !== undefined && (
                        <span className="text-sky-300 hidden sm:inline">
                          · MLD: {probeData.mld}m
                        </span>
                      )}
                      {isProbeLoading && (
                        <span className="text-amber-400 text-[9.5px]">⟳ Profiling...</span>
                      )}
                    </div>
                  )}

                  {activeTransect && (
                    <div className="hud-badge rounded px-2.5 py-1 font-mono text-[10px] text-amber-300 shadow bg-slate-900/90 border border-amber-600">
                      <span className="text-amber-400 font-semibold">ODV TRANSECT:</span> {activeTransect.total_distance_km} km ({activeTransect.lat1}°N, {activeTransect.lon1}°E → {activeTransect.lat2}°N, {activeTransect.lon2}°E)
                    </div>
                  )}

                  {viewMode === 'block' && (
                    <div className="hud-volume-controls flex items-center gap-1.5 flex-wrap" data-testid="hud-block-controls">
                      <div className="hud-badge rounded px-2.5 py-1 font-mono text-[10px] text-cyan-300 shadow bg-slate-900/95 border border-cyan-500/70 flex items-center gap-1.5">
                        <span className="text-cyan-400 font-bold">📦 3D BLOCK:</span>
                        <span>65°E–95°E, 0°N–25°N</span>
                        {volumeData && (
                          <>
                            <span className="border-l border-slate-700 pl-1.5 text-amber-300">
                              {volumeData.bounds?.min_depth?.toFixed(1)}m—{volumeData.bounds?.max_depth?.toFixed(1)}m
                            </span>
                            <span className="border-l border-slate-700 pl-1.5 text-emerald-400 font-semibold">
                              {(volumeData.provenance?.source_mode === 'REAL_LOCAL' || volumeData.dataset?.source_mode === 'REAL_LOCAL')
                                ? 'REAL • COPERNICUS GLORYS12V1'
                                : (volumeData.provenance_badge || 'SYNTHETIC • DEVELOPMENT')}
                            </span>
                          </>
                        )}
                      </div>

                      <div className="flex items-center gap-1 bg-slate-900/90 border border-slate-700/80 rounded-lg p-1 text-[11px] shadow">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-1">
                          Mode:
                        </span>
                        <button
                          type="button"
                          onClick={() => setDepthSliceMode('full')}
                          className={`px-2 py-0.5 rounded text-[10px] font-mono transition ${
                            depthSliceMode === 'full'
                              ? 'bg-cyan-900/90 text-cyan-200 border border-cyan-500 font-bold'
                              : 'bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700'
                          }`}
                        >
                          Full
                        </button>
                        <button
                          type="button"
                          onClick={() => setDepthSliceMode('slice')}
                          className={`px-2 py-0.5 rounded text-[10px] font-mono transition ${
                            depthSliceMode === 'slice'
                              ? 'bg-cyan-900/90 text-cyan-200 border border-cyan-500 font-bold'
                              : 'bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700'
                          }`}
                        >
                          Slice
                        </button>
                        <button
                          type="button"
                          onClick={() => setDepthSliceMode('surface')}
                          className={`px-2 py-0.5 rounded text-[10px] font-mono transition ${
                            depthSliceMode === 'surface'
                              ? 'bg-cyan-900/90 text-cyan-200 border border-cyan-500 font-bold'
                              : 'bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700'
                          }`}
                        >
                          Surface
                        </button>

                        {depthSliceMode === 'slice' && (volumeData?.coordinates?.depth || volumeData?.depth) && (
                          <div className="flex items-center gap-1 border-l border-slate-700 pl-1.5 ml-1">
                            <label htmlFor="volume-depth-select" className="text-[10px] text-slate-400 font-mono">
                              Depth:
                            </label>
                            <select
                              id="volume-depth-select"
                              value={selectedDepthIdx}
                              onChange={(e) => setSelectedDepthIdx(Number(e.target.value))}
                              className="bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 text-[10.5px] text-cyan-300 font-mono outline-none"
                            >
                              {(volumeData.coordinates?.depth || volumeData.depth).map((d, idx) => (
                                <option key={idx} value={idx}>
                                  {d.toFixed(1)}m
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {fieldState.error && (
                    <div className="hud-badge rounded px-2.5 py-1 text-[11px] shadow bg-red-950/90 border border-red-800 text-red-200 flex items-center gap-2 max-w-md pointer-events-auto">
                      <span className="truncate" title={fieldState.error}>⚠️ {fieldState.error}</span>
                      <button
                        type="button"
                        onClick={handleRetry}
                        className="underline text-amber-300 hover:text-white shrink-0 text-[10px]"
                      >
                        Retry
                      </button>
                      <button
                        type="button"
                        onClick={() => setFieldState((prev) => ({ ...prev, error: null }))}
                        className="text-slate-400 hover:text-white shrink-0 text-[11px] px-1"
                        title="Dismiss notification"
                        aria-label="Dismiss error"
                      >
                        ✕
                      </button>
                    </div>
                  )}
                  {isProbeLoading && (
                    <span className="text-amber-400 text-[9.5px]">⟳ Profiling...</span>
                  )}
                </div>
              )}
              {activeTransect && (
                <div className="hud-badge rounded px-2 py-0.5 font-mono text-[10px] text-amber-300 shadow bg-slate-900/90 border border-amber-600 max-w-full">
                  <span className="text-amber-400 font-semibold">ODV TRANSECT:</span> {activeTransect.total_distance_km} km ({activeTransect.lat1}°N, {activeTransect.lon1}°E → {activeTransect.lat2}°N, {activeTransect.lon2}°E)
                </div>
              )}
            </div>


            <div className="flex flex-wrap items-center gap-1.5 pointer-events-auto">
              {/* Zoom In / Out Buttons */}
              <div className="flex items-center rounded border border-slate-700 bg-slate-800/90 overflow-hidden">
                <span
                  role="button"
                  tabIndex={-1}
                  onClick={handleZoomIn}
                  className="px-2 py-1 text-xs font-mono font-bold hover:bg-slate-700 text-slate-200 cursor-pointer select-none border-r border-slate-700"
                  title="Zoom In"
                  data-testid="zoom-in-btn"
                >
                  +
                </span>
                <span
                  role="button"
                  tabIndex={-1}
                  onClick={handleZoomOut}
                  className="px-2 py-1 text-xs font-mono font-bold hover:bg-slate-700 text-slate-200 cursor-pointer select-none"
                  title="Zoom Out"
                  data-testid="zoom-out-btn"
                >
                  −
                </span>
              </div>

              {/* 3D Coordinate Graticules Toggle */}
              {viewMode === 'globe' && (
                <span
                  role="button"
                  tabIndex={-1}
                  onClick={() => setShowGraticules((v) => !v)}
                  className={`hud-button rounded px-2 py-1 text-[11px] font-sans flex items-center gap-1 transition cursor-pointer select-none border ${
                    showGraticules
                      ? 'border-sky-500 bg-sky-950/60 text-sky-300'
                      : 'border-slate-700 bg-slate-800/90 text-slate-400'
                  }`}
                  title="Toggle 3D Coordinate Graticules (Latitude & Longitude lines)"
                  data-testid="toggle-graticules-btn"
                >
                  <span>🌐 Grid</span>
                </span>
              )}

              {/* 3D Ocean Basin Labels Toggle */}
              {viewMode === 'globe' && (
                <span
                  role="button"
                  tabIndex={-1}
                  onClick={() => setShowBasinLabels((v) => !v)}
                  className={`hud-button rounded px-2 py-1 text-[11px] font-sans flex items-center gap-1 transition cursor-pointer select-none border ${
                    showBasinLabels
                      ? 'border-amber-500 bg-amber-950/60 text-amber-300'
                      : 'border-slate-700 bg-slate-800/90 text-slate-400'
                  }`}
                  title="Toggle Ocean Basin & Ridge Labels"
                  data-testid="toggle-basin-labels-btn"
                >
                  <span>🏷️ Basins</span>
                </span>
              )}

              {/* 3D Ocean Visual Style: Bathymetry Digital Twin vs Satellite Ocean */}
              {viewMode === 'globe' && (
                <span
                  role="button"
                  tabIndex={-1}
                  onClick={() => setOceanStyle((s) => (s === 0 ? 1 : 0))}
                  className={`hud-button rounded px-2 py-1 text-[11px] font-sans flex items-center gap-1 transition cursor-pointer select-none border ${
                    oceanStyle === 0
                      ? 'border-cyan-500 bg-cyan-950/60 text-cyan-300 font-semibold'
                      : 'border-slate-700 bg-slate-800/90 text-slate-300'
                  }`}
                  title="Toggle between Ocean Bathymetry Digital Twin and Satellite Ocean"
                  data-testid="toggle-ocean-style-btn"
                >
                  <span>{oceanStyle === 0 ? '🌊 Bathymetry' : '🛰️ Satellite'}</span>
                </span>
              )}

              {/* Data Layer Overlay Toggle (Thermal/Salinity) */}
              {viewMode === 'globe' && selectedVariable !== 'currents' && (
                <span
                  role="button"
                  tabIndex={-1}
                  onClick={() => setShowDataOverlay((v) => !v)}
                  className={`hud-button rounded px-2 py-1 text-[11px] font-sans flex items-center gap-1 transition cursor-pointer select-none border ${
                    showDataOverlay
                      ? 'border-emerald-500 bg-emerald-950/60 text-emerald-300 font-semibold'
                      : 'border-slate-700 bg-slate-800/90 text-slate-400'
                  }`}
                  title="Toggle 2D Scientific Data Layer on Globe"
                  data-testid="toggle-data-overlay-btn"
                >
                  <span>{showDataOverlay ? '👁️ Layer ON' : '👁️ Layer OFF'}</span>
                </span>
              )}

              <button
                type="button"
                onClick={handleResetCamera}
                className="hud-button rounded px-2.5 py-1 text-[11px] font-sans flex items-center gap-1 transition"
                title="Reset Camera"
              >
                ⟲ Reset View
              </button>
              {onToggleFullView && (
                <span
                  role="button"
                  tabIndex={-1}
                  onClick={onToggleFullView}
                  className="hud-button rounded px-2.5 py-1 text-[11px] font-sans flex items-center gap-1 transition cursor-pointer select-none border border-slate-700 bg-slate-800/90 hover:bg-slate-700 text-slate-200"
                  title={isFullView ? 'Standard View' : 'Full View Globe'}
                  data-testid="toggle-full-view-btn"
                >
                  <span>{isFullView ? '◱ Standard View' : '⛶ Full View Globe'}</span>
                </span>
              )}
            </div>
          </div>

          {/* Floating Probed Station Chip on Canvas */}
          {probedPoint && (
            <div className="probed-floating-chip pointer-events-auto absolute bottom-12 left-1/2 -translate-x-1/2 z-20 bg-slate-900/95 backdrop-blur border border-sky-500/70 rounded-full px-4 py-1.5 shadow-2xl flex items-center gap-2.5 text-xs text-white max-w-[95%]">
              <span className="w-2 h-2 rounded-full bg-sky-400 inline-block flex-shrink-0" />
              <span className="font-mono text-xs font-bold text-sky-300 flex-shrink-0">
                📍 {probedPoint.lat}°N, {probedPoint.lon}°E
              </span>
              {probeData ? (
                <span className="text-slate-200 font-mono text-[11px] flex items-center gap-2 flex-wrap">
                  <span className="text-amber-300 font-bold">SST: {probeData.sst}°C</span>
                  {probeData.sss !== null && probeData.sss !== undefined && (
                    <span className="text-cyan-300 hidden sm:inline">SSS: {probeData.sss} PSU</span>
                  )}
                  {probeData.mld !== null && probeData.mld !== undefined && (
                    <span className="text-sky-300 hidden md:inline">MLD: {probeData.mld}m</span>
                  )}
                </span>
              ) : (
                <span className="text-amber-300 text-[11px] font-mono">
                  {isProbeLoading ? 'Slicing 9-depth water column...' : 'Probed Station'}
                </span>
              )}
              <span
                role="button"
                tabIndex={-1}
                onClick={() => onProbePoint?.(null)}
                className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition cursor-pointer select-none ml-1 flex-shrink-0"
                title="Clear probe station"
              >
                ✕
              </span>
            </div>
          )}

          {/* Controls Usage Hint */}
          <div className="viewport-controls-hint pointer-events-none absolute bottom-3 left-3 bg-slate-900/75 backdrop-blur border border-slate-800 rounded px-2 py-0.5 text-[10px] text-slate-400 font-mono">
            Rotate: Left Click + Drag · Pan: Right Click · Zoom: Scroll Wheel · Click anywhere to probe data
          </div>

          {/* Quick Basin Zoom Presets Toolbar */}
          {viewMode === 'globe' && (
            <div className="ocean-basin-zoom-bar pointer-events-auto absolute bottom-3 right-3 flex items-center gap-1 bg-slate-900/85 backdrop-blur border border-slate-700/70 rounded-lg p-1 text-[11px] shadow-lg">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-1 hidden md:inline">
                Basin Zoom:
              </span>
              {BASIN_ZOOM_PRESETS.map((preset) => (
                <span
                  key={preset.id}
                  role="button"
                  tabIndex={-1}
                  onClick={() => handleZoomBasin(preset)}
                  className="px-2 py-0.5 rounded text-[10.5px] font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-sky-300 border border-slate-700/80 transition cursor-pointer select-none"
                  title={`Focus on ${preset.name} (${preset.lat}°N, ${preset.lon}°E)`}
                  data-testid={`zoom-basin-${preset.id}`}
                >
                  {preset.name}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      <ColorBarLegend
        activeField={fieldState.sliceData}
        rangeMode={rangeMode}
        onToggleRangeMode={() => setRangeMode((m) => (m === 'dynamic' ? 'fixed' : 'dynamic'))}
      />

      {/* Developer-only performance panel .
          Enabled with ?perf=1 — never displayed for normal users. */}
      {typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('perf') === '1' && (
        <div
          className="perf-panel absolute top-3 right-3 z-30 bg-slate-950/90 backdrop-blur border border-slate-700 rounded-lg px-3 py-2 text-[10px] font-mono text-slate-300 space-y-0.5"
          data-testid="perf-panel"
        >
          <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">Perf (dev only)</div>
          <div>Render FPS: {rendererStats.fps}</div>
          <div>Draw Calls: {rendererStats.drawCalls}</div>
          <div>Field: {fieldState.loading ? 'loading…' : fieldState.error ? `error: ${String(fieldState.error).slice(0, 60)}` : `${fieldState.sliceData?.variable ?? '—'} @ ${fieldState.sliceData?.selected_depth ?? fieldState.sliceData?.requested_depth ?? '—'}m · ${fieldState.sliceData?.shape ? `${fieldState.sliceData.shape[0]}x${fieldState.sliceData.shape[1]}` : '—'} cells`}</div>
        </div>
      )}
    </section>
  );
}
