import './styles.css';
import * as THREE from 'three';
import * as GaussianSplats3D from '@mkkellogg/gaussian-splats-3d';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import { MeshSurfaceSampler } from 'three/examples/jsm/math/MeshSurfaceSampler.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clone as cloneSkeletonRoot } from 'three/examples/jsm/utils/SkeletonUtils.js';
import {
  Box,
  Camera,
  createIcons,
  Download,
  Film,
  FolderOpen,
  KeyRound,
  Lightbulb,
  Maximize2,
  Move3D,
  Orbit,
  PanelLeftClose,
  PanelLeftOpen,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Rotate3D,
  Save,
  Sun,
  Sparkles,
  Trash2,
  Waves
} from 'lucide';

createIcons({
  icons: {
    Box,
    Camera,
    Download,
    Film,
    FolderOpen,
    KeyRound,
    Lightbulb,
    Maximize2,
    Move3D,
    Move3d: Move3D,
    Orbit,
    PanelLeftClose,
    PanelLeftOpen,
    Pause,
    Play,
    Plus,
    Rotate3D,
    Rotate3d: Rotate3D,
    RotateCcw,
    Save,
    Sun,
    Sparkles,
    Trash2,
    Waves
  }
});

const canvas = document.querySelector('#scene');
const panel = document.querySelector('.panel');
const panelToggle = document.querySelector('#panelToggle');
const cameraPreviewUi = {
  root: document.querySelector('#cameraPreview'),
  canvas: document.querySelector('#cameraPreviewCanvas'),
  info: document.querySelector('#cameraPreviewInfo'),
  hide: document.querySelector('#cameraPreviewHide'),
  restore: document.querySelector('#cameraPreviewRestore')
};
const cameraViewUi = {
  toggle: document.querySelector('#toggleCameraView')
};
const modelInput = document.querySelector('#modelInput');
const dropZone = document.querySelector('#dropZone');
const modelName = document.querySelector('#modelName');
const statusText = document.querySelector('#status');
const statsText = document.querySelector('#stats');
const resetCameraButton = document.querySelector('#resetCamera');
const projectUi = {
  input: document.querySelector('#projectInput'),
  open: document.querySelector('#openProject'),
  save: document.querySelector('#saveProject'),
  name: document.querySelector('#projectName')
};
const presetButtons = [...document.querySelectorAll('[data-preset]')];
const effectModeButtons = [...document.querySelectorAll('[data-effect-mode]')];
const MODEL_EXTENSIONS = new Set(['blend', 'glb', 'gltf', 'obj', 'stl', 'fbx']);
const RASTER_IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp']);
const PANORAMA_TEXTURE_EXTENSIONS = new Set(['hdr', 'exr']);
const IMAGE_EXTENSIONS = new Set([...RASTER_IMAGE_EXTENSIONS, ...PANORAMA_TEXTURE_EXTENSIONS]);
const GAUSSIAN_SPLAT_EXTENSIONS = new Set(['ply', 'splat', 'ksplat', 'spz']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'm4v', 'webm']);
const INLINE_MODEL_PAYLOAD_LIMIT = 160 * 1024 * 1024;
const MIN_PARTICLE_COUNT = 1;
const SHARP_PLY_PREVIEW_LIMIT = 320000;
const SHARP_PLY_EXPORT_LIMIT = 520000;
const SHARP_DC_COLOR_FACTOR = 0.28209479177387814;
const urlParams = new URLSearchParams(window.location.search);
const exportHideUi = urlParams.get('export') === '1';
const exportSettings = {
  transparent: urlParams.get('transparent') === '1',
  hideUi: exportHideUi,
  autoDissolve: urlParams.get('autoDissolve') === '1',
  duration: Number(urlParams.get('duration') || 5),
  modelUrl: urlParams.get('model') || (exportHideUi ? '' : '/cs.glb'),
  morphTargetUrl: urlParams.get('morphTarget') || '',
  worldUrl: urlParams.get('world') || '',
  pixelRatio: Number(urlParams.get('pixelRatio') || window.devicePixelRatio || 1)
};
const PREVIEW_PIXEL_RATIO_CAP = 1.25;
const EXPORT_RENDER_PIXEL_RATIO = 1;
const CAMERA_DEFAULT_NEAR = 0.001;
const CAMERA_DEFAULT_FAR = 10000;
const CAMERA_ORBIT_MAX_DISTANCE = 10000;
const CAMERA_FOCUS_DISTANCE_MAX = 10000;
const PICK_POINT_SAMPLE_LIMIT = 16000;
const MODEL_PICK_BOX_PADDING_PX = 42;
const CAMERA_PREVIEW_ORBIT_PAUSE_MS = 160;
const PANEL_COLLAPSED_STORAGE_KEY = 'particle-studio-panel-collapsed';
const WORKSPACE_LAYOUT_STORAGE_KEY = 'particle-studio-workspace-layout';
const CAMERA_PREVIEW_VISIBLE_STORAGE_KEY = 'particle-studio-camera-preview-visible';
const requestedPixelRatio = Number.isFinite(exportSettings.pixelRatio) ? exportSettings.pixelRatio : 1;
const renderPixelRatio = exportSettings.hideUi
  ? EXPORT_RENDER_PIXEL_RATIO
  : THREE.MathUtils.clamp(Math.min(requestedPixelRatio, PREVIEW_PIXEL_RATIO_CAP), 0.5, PREVIEW_PIXEL_RATIO_CAP);
const studioPixelRatio = renderPixelRatio;

if (exportSettings.hideUi) {
  document.documentElement.classList.add('export-mode');
}

const controlsUi = {
  particleCount: document.querySelector('#particleCount'),
  pointSize: document.querySelector('#pointSize'),
  edgeFeather: document.querySelector('#edgeFeather'),
  sampleCleanup: document.querySelector('#sampleCleanup'),
  sizeRandom: document.querySelector('#sizeRandom'),
  glowRadius: document.querySelector('#glowRadius'),
  glowExposure: document.querySelector('#glowExposure'),
  particleizeProgress: document.querySelector('#particleizeProgress'),
  modelVisibility: document.querySelector('#modelVisibility'),
  spread: document.querySelector('#spread'),
  noise: document.querySelector('#noise'),
  noiseScale: document.querySelector('#noiseScale'),
  swirl: document.querySelector('#swirl'),
  speed: document.querySelector('#speed'),
  dissolve: document.querySelector('#dissolve'),
  dissolveSpread: document.querySelector('#dissolveSpread'),
  dissolveEdgeWidth: document.querySelector('#dissolveEdgeWidth'),
  dissolveTurbulence: document.querySelector('#dissolveTurbulence'),
  dissolveCurl: document.querySelector('#dissolveCurl'),
  dissolveMist: document.querySelector('#dissolveMist'),
  dissolveDirectionX: document.querySelector('#dissolveDirectionX'),
  dissolveDirectionY: document.querySelector('#dissolveDirectionY'),
  dissolveDirectionZ: document.querySelector('#dissolveDirectionZ'),
  dissolveLift: document.querySelector('#dissolveLift'),
  growth: document.querySelector('#growth'),
  growthFlow: document.querySelector('#growthFlow'),
  growthWidth: document.querySelector('#growthWidth'),
  growthTurbulence: document.querySelector('#growthTurbulence'),
  organicFlow: document.querySelector('#organicFlow'),
  edgeBreak: document.querySelector('#edgeBreak'),
  filamentLength: document.querySelector('#filamentLength'),
  filamentCurl: document.querySelector('#filamentCurl'),
  emissionEnabled: document.querySelector('#emissionEnabled'),
  emissionCount: document.querySelector('#emissionCount'),
  modelWhite: document.querySelector('#modelWhite'),
  modelRoughness: document.querySelector('#modelRoughness'),
  emissionIntensity: document.querySelector('#emissionIntensity'),
  emissionDistance: document.querySelector('#emissionDistance'),
  emissionSpeed: document.querySelector('#emissionSpeed'),
  emissionWindX: document.querySelector('#emissionWindX'),
  emissionWindY: document.querySelector('#emissionWindY'),
  emissionWindZ: document.querySelector('#emissionWindZ'),
  emissionTurbulence: document.querySelector('#emissionTurbulence'),
  emissionSize: document.querySelector('#emissionSize'),
  emissionOpacity: document.querySelector('#emissionOpacity'),
  emissionGlow: document.querySelector('#emissionGlow'),
  breakAmount: document.querySelector('#breakAmount'),
  breakProgress: document.querySelector('#breakProgress'),
  breakRadius: document.querySelector('#breakRadius'),
  breakFeather: document.querySelector('#breakFeather'),
  breakCenterX: document.querySelector('#breakCenterX'),
  breakCenterY: document.querySelector('#breakCenterY'),
  breakCenterZ: document.querySelector('#breakCenterZ'),
  breakSpeed: document.querySelector('#breakSpeed'),
  breakSize: document.querySelector('#breakSize'),
  imageSplatCount: document.querySelector('#imageSplatCount'),
  imageSplatDepth: document.querySelector('#imageSplatDepth'),
  imageSplatScatter: document.querySelector('#imageSplatScatter'),
  imageSplatSpeed: document.querySelector('#imageSplatSpeed'),
  imageSplatDirX: document.querySelector('#imageSplatDirX'),
  imageSplatDirY: document.querySelector('#imageSplatDirY'),
  imageSplatDirZ: document.querySelector('#imageSplatDirZ'),
  imageSplatTurbulence: document.querySelector('#imageSplatTurbulence'),
  imageSplatSize: document.querySelector('#imageSplatSize'),
  imageSplatFeather: document.querySelector('#imageSplatFeather'),
  imageSplatColorKeep: document.querySelector('#imageSplatColorKeep'),
  imageSplatOpacity: document.querySelector('#imageSplatOpacity'),
  imageSplatGlow: document.querySelector('#imageSplatGlow'),
  imageSplatPlaneVisible: document.querySelector('#imageSplatPlaneVisible'),
  imageSplatPlaneOpacity: document.querySelector('#imageSplatPlaneOpacity'),
  modelAnimClip: document.querySelector('#modelAnimClip'),
  modelAnimEnabled: document.querySelector('#modelAnimEnabled'),
  modelAnimPlaying: document.querySelector('#modelAnimPlaying'),
  modelAnimProgress: document.querySelector('#modelAnimProgress'),
  modelAnimSpeed: document.querySelector('#modelAnimSpeed'),
  moveImageSplat: document.querySelector('#moveImageSplat'),
  rotateImageSplat: document.querySelector('#rotateImageSplat'),
  scaleImageSplat: document.querySelector('#scaleImageSplat'),
  sceneModelList: document.querySelector('#sceneModelList'),
  addSceneModel: document.querySelector('#addSceneModel'),
  duplicateSceneModel: document.querySelector('#duplicateSceneModel'),
  deleteSceneModel: document.querySelector('#deleteSceneModel'),
  moveSceneModel: document.querySelector('#moveSceneModel'),
  rotateSceneModel: document.querySelector('#rotateSceneModel'),
  scaleSceneModel: document.querySelector('#scaleSceneModel'),
  videoPlaneList: document.querySelector('#videoPlaneList'),
  addVideoPlane: document.querySelector('#addVideoPlane'),
  duplicateVideoPlane: document.querySelector('#duplicateVideoPlane'),
  deleteVideoPlane: document.querySelector('#deleteVideoPlane'),
  moveVideoPlane: document.querySelector('#moveVideoPlane'),
  rotateVideoPlane: document.querySelector('#rotateVideoPlane'),
  scaleVideoPlane: document.querySelector('#scaleVideoPlane'),
  videoPlaneWidth: document.querySelector('#videoPlaneWidth'),
  videoPlaneHeight: document.querySelector('#videoPlaneHeight'),
  videoPlaneOpacity: document.querySelector('#videoPlaneOpacity'),
  videoPlanePlaybackRate: document.querySelector('#videoPlanePlaybackRate'),
  videoPlaneTime: document.querySelector('#videoPlaneTime'),
  videoPlaneLoop: document.querySelector('#videoPlaneLoop'),
  videoPlaneStatus: document.querySelector('#videoPlaneStatus'),
  morphProgress: document.querySelector('#morphProgress'),
  morphFlow: document.querySelector('#morphFlow'),
  morphScatter: document.querySelector('#morphScatter'),
  morphTurbulence: document.querySelector('#morphTurbulence'),
  morphTrail: document.querySelector('#morphTrail'),
  morphDirX: document.querySelector('#morphDirX'),
  morphDirY: document.querySelector('#morphDirY'),
  morphDirZ: document.querySelector('#morphDirZ'),
  colorA: document.querySelector('#colorA'),
  colorB: document.querySelector('#colorB'),
  useTexture: document.querySelector('#useTexture'),
  autoRotate: document.querySelector('#autoRotate'),
  worldEnabled: document.querySelector('#worldEnabled'),
  worldVisible: document.querySelector('#worldVisible'),
  worldExport: document.querySelector('#worldExport'),
  worldIntensity: document.querySelector('#worldIntensity'),
  worldBlur: document.querySelector('#worldBlur'),
  worldRotation: document.querySelector('#worldRotation'),
  cameraType: document.querySelector('#cameraType'),
  cameraDisplaySize: document.querySelector('#cameraDisplaySize'),
  cameraFocalLength: document.querySelector('#cameraFocalLength'),
  cameraDofEnabled: document.querySelector('#cameraDofEnabled'),
  cameraAperture: document.querySelector('#cameraAperture'),
  cameraFocusDistance: document.querySelector('#cameraFocusDistance'),
  cameraModeHint: document.querySelector('#cameraModeHint'),
  timeline: document.querySelector('#timeline'),
  duration: document.querySelector('#duration'),
  cameraPathMode: document.querySelector('#cameraPathMode'),
  cameraCurve: document.querySelector('#cameraCurve'),
  cameraCurveStrength: document.querySelector('#cameraCurveStrength'),
  handControlEnabled: document.querySelector('#handControlEnabled'),
  handControlMode: document.querySelector('#handControlMode'),
  handControlInfluence: document.querySelector('#handControlInfluence'),
  handControlSmoothing: document.querySelector('#handControlSmoothing'),
  handControlFps: document.querySelector('#handControlFps'),
  handControlMirror: document.querySelector('#handControlMirror'),
  handControlRebase: document.querySelector('#handControlRebase'),
  handVideo: document.querySelector('#handVideo'),
  handOverlay: document.querySelector('#handOverlay'),
  handStatus: document.querySelector('#handStatus'),
  playTimeline: document.querySelector('#playTimeline'),
  addKeyframe: document.querySelector('#addKeyframe'),
  clearKeyframes: document.querySelector('#clearKeyframes'),
  moveKeyframe: document.querySelector('#moveKeyframe'),
  rotateKeyframe: document.querySelector('#rotateKeyframe'),
  scaleKeyframe: document.querySelector('#scaleKeyframe'),
  timelineMarkers: document.querySelector('#timelineMarkers'),
  keyframeCount: document.querySelector('#keyframeCount'),
  exportWidth: document.querySelector('#exportWidth'),
  exportHeight: document.querySelector('#exportHeight'),
  exportFps: document.querySelector('#exportFps'),
  exportFormat: document.querySelector('#exportFormat'),
  exportMov: document.querySelector('#exportMov'),
  exportStatus: document.querySelector('#exportStatus')
};

const outputUi = {
  particleCount: document.querySelector('#particleCountValue'),
  pointSize: document.querySelector('#pointSizeValue'),
  edgeFeather: document.querySelector('#edgeFeatherValue'),
  sampleCleanup: document.querySelector('#sampleCleanupValue'),
  sizeRandom: document.querySelector('#sizeRandomValue'),
  glowRadius: document.querySelector('#glowRadiusValue'),
  glowExposure: document.querySelector('#glowExposureValue'),
  particleizeProgress: document.querySelector('#particleizeProgressValue'),
  modelVisibility: document.querySelector('#modelVisibilityValue'),
  spread: document.querySelector('#spreadValue'),
  noise: document.querySelector('#noiseValue'),
  noiseScale: document.querySelector('#noiseScaleValue'),
  swirl: document.querySelector('#swirlValue'),
  speed: document.querySelector('#speedValue'),
  dissolve: document.querySelector('#dissolveValue'),
  dissolveSpread: document.querySelector('#dissolveSpreadValue'),
  dissolveEdgeWidth: document.querySelector('#dissolveEdgeWidthValue'),
  dissolveTurbulence: document.querySelector('#dissolveTurbulenceValue'),
  dissolveCurl: document.querySelector('#dissolveCurlValue'),
  dissolveMist: document.querySelector('#dissolveMistValue'),
  dissolveDirectionX: document.querySelector('#dissolveDirectionXValue'),
  dissolveDirectionY: document.querySelector('#dissolveDirectionYValue'),
  dissolveDirectionZ: document.querySelector('#dissolveDirectionZValue'),
  dissolveLift: document.querySelector('#dissolveLiftValue'),
  growth: document.querySelector('#growthValue'),
  growthFlow: document.querySelector('#growthFlowValue'),
  growthWidth: document.querySelector('#growthWidthValue'),
  growthTurbulence: document.querySelector('#growthTurbulenceValue'),
  organicFlow: document.querySelector('#organicFlowValue'),
  edgeBreak: document.querySelector('#edgeBreakValue'),
  filamentLength: document.querySelector('#filamentLengthValue'),
  filamentCurl: document.querySelector('#filamentCurlValue'),
  emissionCount: document.querySelector('#emissionCountValue'),
  modelWhite: document.querySelector('#modelWhiteValue'),
  modelRoughness: document.querySelector('#modelRoughnessValue'),
  emissionIntensity: document.querySelector('#emissionIntensityValue'),
  emissionDistance: document.querySelector('#emissionDistanceValue'),
  emissionSpeed: document.querySelector('#emissionSpeedValue'),
  emissionWindX: document.querySelector('#emissionWindXValue'),
  emissionWindY: document.querySelector('#emissionWindYValue'),
  emissionWindZ: document.querySelector('#emissionWindZValue'),
  emissionTurbulence: document.querySelector('#emissionTurbulenceValue'),
  emissionSize: document.querySelector('#emissionSizeValue'),
  emissionOpacity: document.querySelector('#emissionOpacityValue'),
  emissionGlow: document.querySelector('#emissionGlowValue'),
  breakAmount: document.querySelector('#breakAmountValue'),
  breakProgress: document.querySelector('#breakProgressValue'),
  breakRadius: document.querySelector('#breakRadiusValue'),
  breakFeather: document.querySelector('#breakFeatherValue'),
  breakCenterX: document.querySelector('#breakCenterXValue'),
  breakCenterY: document.querySelector('#breakCenterYValue'),
  breakCenterZ: document.querySelector('#breakCenterZValue'),
  breakSpeed: document.querySelector('#breakSpeedValue'),
  breakSize: document.querySelector('#breakSizeValue'),
  imageSplatCount: document.querySelector('#imageSplatCountValue'),
  imageSplatDepth: document.querySelector('#imageSplatDepthValue'),
  imageSplatScatter: document.querySelector('#imageSplatScatterValue'),
  imageSplatSpeed: document.querySelector('#imageSplatSpeedValue'),
  imageSplatDirX: document.querySelector('#imageSplatDirXValue'),
  imageSplatDirY: document.querySelector('#imageSplatDirYValue'),
  imageSplatDirZ: document.querySelector('#imageSplatDirZValue'),
  imageSplatTurbulence: document.querySelector('#imageSplatTurbulenceValue'),
  imageSplatSize: document.querySelector('#imageSplatSizeValue'),
  imageSplatFeather: document.querySelector('#imageSplatFeatherValue'),
  imageSplatColorKeep: document.querySelector('#imageSplatColorKeepValue'),
  imageSplatOpacity: document.querySelector('#imageSplatOpacityValue'),
  imageSplatGlow: document.querySelector('#imageSplatGlowValue'),
  imageSplatPlaneOpacity: document.querySelector('#imageSplatPlaneOpacityValue'),
  modelAnimProgress: document.querySelector('#modelAnimProgressValue'),
  modelAnimSpeed: document.querySelector('#modelAnimSpeedValue'),
  morphProgress: document.querySelector('#morphProgressValue'),
  morphFlow: document.querySelector('#morphFlowValue'),
  morphScatter: document.querySelector('#morphScatterValue'),
  morphTurbulence: document.querySelector('#morphTurbulenceValue'),
  morphTrail: document.querySelector('#morphTrailValue'),
  morphDirX: document.querySelector('#morphDirXValue'),
  morphDirY: document.querySelector('#morphDirYValue'),
  morphDirZ: document.querySelector('#morphDirZValue'),
  worldIntensity: document.querySelector('#worldIntensityValue'),
  worldBlur: document.querySelector('#worldBlurValue'),
  worldRotation: document.querySelector('#worldRotationValue'),
  cameraDisplaySize: document.querySelector('#cameraDisplaySizeValue'),
  cameraFocalLength: document.querySelector('#cameraFocalLengthValue'),
  cameraAperture: document.querySelector('#cameraApertureValue'),
  cameraFocusDistance: document.querySelector('#cameraFocusDistanceValue'),
  videoPlaneWidth: document.querySelector('#videoPlaneWidthValue'),
  videoPlaneHeight: document.querySelector('#videoPlaneHeightValue'),
  videoPlaneOpacity: document.querySelector('#videoPlaneOpacityValue'),
  videoPlanePlaybackRate: document.querySelector('#videoPlanePlaybackRateValue'),
  videoPlaneTime: document.querySelector('#videoPlaneTimeValue'),
  handControlInfluence: document.querySelector('#handControlInfluenceValue'),
  handControlSmoothing: document.querySelector('#handControlSmoothingValue'),
  handControlFps: document.querySelector('#handControlFpsValue'),
  timeline: document.querySelector('#timelineValue')
};

const morphUi = {
  input: document.querySelector('#morphTargetInput'),
  dropZone: document.querySelector('#morphTargetDropZone'),
  name: document.querySelector('#morphTargetName')
};

const worldUi = {
  input: document.querySelector('#worldInput'),
  dropZone: document.querySelector('#worldDropZone'),
  name: document.querySelector('#worldName')
};

const localSharpUi = {
  check: document.querySelector('#checkLocalSharp'),
  install: document.querySelector('#installLocalSharp'),
  acceptLicense: document.querySelector('#sharpAcceptLicense'),
  run: document.querySelector('#runLocalSharp'),
  status: document.querySelector('#sharpStatus'),
  output: document.querySelector('#sharpOutputName'),
  log: document.querySelector('#sharpLog')
};

const lightsUi = {
  panel: document.querySelector('#lightsPanel'),
  list: document.querySelector('#lightList'),
  addPoint: document.querySelector('#addPointLight'),
  addSun: document.querySelector('#addSunLight'),
  addSpot: document.querySelector('#addSpotLight'),
  addArea: document.querySelector('#addAreaLight'),
  delete: document.querySelector('#deleteLight'),
  type: document.querySelector('#lightType'),
  color: document.querySelector('#lightColor'),
  colorValue: document.querySelector('#lightColorValue'),
  intensity: document.querySelector('#lightIntensity'),
  intensityValue: document.querySelector('#lightIntensityValue'),
  size: document.querySelector('#lightSize'),
  sizeValue: document.querySelector('#lightSizeValue'),
  sizeLabel: document.querySelector('#lightSizeLabel'),
  move: document.querySelector('#moveLight'),
  rotate: document.querySelector('#rotateLight')
};

const workspaceLayoutDefaults = {
  rightWidth: 360,
  timelineHeight: 184,
  outlinerHeight: 252
};
let workspaceLayoutState = { ...workspaceLayoutDefaults };
let workspaceResizeFrame = 0;

function clampLayoutValue(value, min, max) {
  const safeMax = Math.max(min, max);
  return Math.round(THREE.MathUtils.clamp(Number(value) || min, min, safeMax));
}

function clampWorkspaceLayout(layout = workspaceLayoutState) {
  const viewportWidth = Math.max(760, window.innerWidth || 1280);
  const viewportHeight = Math.max(560, window.innerHeight || 780);
  const rightWidth = clampLayoutValue(layout.rightWidth, 300, viewportWidth - 420);
  const timelineHeight = clampLayoutValue(layout.timelineHeight, 120, viewportHeight - 220);
  const outlinerHeight = clampLayoutValue(
    layout.outlinerHeight,
    116,
    viewportHeight - timelineHeight - 170
  );
  return { rightWidth, timelineHeight, outlinerHeight };
}

function readWorkspaceLayout() {
  try {
    const stored = JSON.parse(window.localStorage?.getItem(WORKSPACE_LAYOUT_STORAGE_KEY) || 'null');
    if (stored && typeof stored === 'object') {
      return clampWorkspaceLayout({ ...workspaceLayoutDefaults, ...stored });
    }
  } catch {
    // Keep defaults when localStorage is blocked or contains older invalid data.
  }
  return clampWorkspaceLayout(workspaceLayoutDefaults);
}

function persistWorkspaceLayout() {
  try {
    window.localStorage?.setItem(WORKSPACE_LAYOUT_STORAGE_KEY, JSON.stringify(workspaceLayoutState));
  } catch {
    // Layout persistence is a convenience only.
  }
}

function applyWorkspaceLayout(layout, options = {}) {
  workspaceLayoutState = clampWorkspaceLayout({ ...workspaceLayoutState, ...layout });
  const root = document.querySelector('#app');
  if (root) {
    root.style.setProperty('--workspace-right-width', `${workspaceLayoutState.rightWidth}px`);
    root.style.setProperty('--workspace-timeline-height', `${workspaceLayoutState.timelineHeight}px`);
    root.style.setProperty('--workspace-outliner-height', `${workspaceLayoutState.outlinerHeight}px`);
  }
  if (options.persist !== false) {
    persistWorkspaceLayout();
  }
  requestWorkspaceResize();
}

function requestWorkspaceResize() {
  if (workspaceResizeFrame) {
    return;
  }
  workspaceResizeFrame = window.requestAnimationFrame(() => {
    workspaceResizeFrame = 0;
    if (typeof resizeRenderer === 'function') {
      resizeRenderer();
    }
  });
}

function getMainCanvasCssSize() {
  const rect = canvas?.getBoundingClientRect?.();
  const width = Math.max(2, Math.round(rect?.width || canvas?.clientWidth || window.innerWidth || 2));
  const height = Math.max(2, Math.round(rect?.height || canvas?.clientHeight || window.innerHeight || 2));
  return {
    width,
    height,
    aspect: width / Math.max(height, 1)
  };
}

function createWorkspacePaneHeader(title, subtitle = '') {
  const header = document.createElement('div');
  header.className = 'workspace-pane-header';
  const copy = document.createElement('div');
  copy.className = 'workspace-pane-copy';
  const titleElement = document.createElement('span');
  titleElement.className = 'workspace-pane-title';
  titleElement.textContent = title;
  copy.append(titleElement);
  if (subtitle) {
    const subtitleElement = document.createElement('span');
    subtitleElement.className = 'workspace-pane-subtitle';
    subtitleElement.textContent = subtitle;
    copy.append(subtitleElement);
  }
  header.append(copy);
  return header;
}

function setupWorkspaceDragHandle(handle, onDrag) {
  if (!handle) {
    return;
  }

  let pointerId = null;
  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    pointerId = event.pointerId;
    handle.setPointerCapture?.(pointerId);
    document.body.classList.add('workspace-resizing');
  });
  handle.addEventListener('pointermove', (event) => {
    if (pointerId !== event.pointerId) {
      return;
    }
    event.preventDefault();
    onDrag(event);
  });
  const endDrag = (event) => {
    if (pointerId !== event.pointerId) {
      return;
    }
    handle.releasePointerCapture?.(pointerId);
    pointerId = null;
    document.body.classList.remove('workspace-resizing');
    persistWorkspaceLayout();
  };
  handle.addEventListener('pointerup', endDrag);
  handle.addEventListener('pointercancel', endDrag);
}

function setupWorkspaceLayout() {
  if (exportSettings.hideUi || document.body.classList.contains('workspace-layout')) {
    return;
  }

  const app = document.querySelector('#app');
  const cameraRow = document.querySelector('.camera-row');
  const sceneModelsPanel = document.querySelector('#sceneModelsPanel');
  const videoPlanesPanel = document.querySelector('#videoPlanesPanel');
  if (!app || !panel || !cameraRow || !sceneModelsPanel || !videoPlanesPanel) {
    return;
  }

  document.body.classList.add('workspace-layout');

  const topbar = document.createElement('header');
  topbar.className = 'workspace-topbar';
  topbar.innerHTML = `
    <div class="workspace-app-mark">Particle Model Studio</div>
    <nav class="workspace-menu" aria-label="Workspace menus">
      <span>文件</span>
      <span>编辑</span>
      <span>渲染</span>
      <span>窗口</span>
      <span>帮助</span>
    </nav>
    <div class="workspace-tabs" aria-label="Workspace tabs">
      <span class="active">布局</span>
      <span>建模</span>
      <span>动画</span>
      <span>渲染</span>
      <span>合成</span>
    </div>
  `;

  const leftToolbar = document.createElement('aside');
  leftToolbar.className = 'workspace-left-toolbar';
  leftToolbar.setAttribute('aria-label', 'Viewport tools');
  ['选择', '移动', '旋转', '缩放', '相机', '灯光'].forEach((label) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'workspace-tool';
    item.textContent = label.slice(0, 1);
    item.title = label;
    leftToolbar.append(item);
  });

  const timelineDock = document.createElement('section');
  timelineDock.className = 'workspace-timeline-dock';
  timelineDock.setAttribute('aria-label', 'Timeline');
  timelineDock.append(cameraRow);

  const rightWidthHandle = document.createElement('div');
  rightWidthHandle.className = 'workspace-resizer workspace-resizer-right';
  rightWidthHandle.setAttribute('role', 'separator');
  rightWidthHandle.setAttribute('aria-label', '调整右侧面板宽度');

  const timelineHandle = document.createElement('div');
  timelineHandle.className = 'workspace-resizer workspace-resizer-timeline';
  timelineHandle.setAttribute('role', 'separator');
  timelineHandle.setAttribute('aria-label', '调整时间轴高度');

  const outlinerPane = document.createElement('section');
  outlinerPane.className = 'workspace-outliner-pane';
  outlinerPane.setAttribute('aria-label', 'Scene outliner');
  const outlinerHeader = createWorkspacePaneHeader('场景集合', '模型 / 视频素材');
  const resetLayoutButton = document.createElement('button');
  resetLayoutButton.type = 'button';
  resetLayoutButton.className = 'workspace-reset-layout';
  resetLayoutButton.textContent = '重置布局';
  resetLayoutButton.addEventListener('click', () => applyWorkspaceLayout(workspaceLayoutDefaults));
  outlinerHeader.append(resetLayoutButton);
  outlinerPane.append(outlinerHeader, sceneModelsPanel, videoPlanesPanel);

  const paneSplitHandle = document.createElement('div');
  paneSplitHandle.className = 'workspace-pane-resizer';
  paneSplitHandle.setAttribute('role', 'separator');
  paneSplitHandle.setAttribute('aria-label', '调整模型列表高度');

  const propertiesPane = document.createElement('section');
  propertiesPane.className = 'workspace-properties-pane';
  propertiesPane.setAttribute('aria-label', 'Properties');
  propertiesPane.append(createWorkspacePaneHeader('属性与特效', '粒子、材质、灯光、导出'));
  [...panel.children].forEach((child) => {
    if (child !== sceneModelsPanel && child !== videoPlanesPanel && child !== cameraRow) {
      propertiesPane.append(child);
    }
  });
  panel.replaceChildren(outlinerPane, paneSplitHandle, propertiesPane);

  app.prepend(topbar, leftToolbar);
  app.append(timelineHandle, timelineDock, rightWidthHandle);

  setupWorkspaceDragHandle(rightWidthHandle, (event) => {
    applyWorkspaceLayout({ rightWidth: window.innerWidth - event.clientX }, { persist: false });
  });
  setupWorkspaceDragHandle(timelineHandle, (event) => {
    applyWorkspaceLayout({ timelineHeight: window.innerHeight - event.clientY }, { persist: false });
  });
  setupWorkspaceDragHandle(paneSplitHandle, (event) => {
    const topbarHeight = Number.parseFloat(getComputedStyle(app).getPropertyValue('--workspace-topbar-height')) || 34;
    applyWorkspaceLayout({ outlinerHeight: event.clientY - topbarHeight }, { persist: false });
  });

  applyWorkspaceLayout(readWorkspaceLayout(), { persist: false });
}

const state = {
  effectMode: 'particles',
  particleCount: Number(controlsUi.particleCount.value),
  pointSize: Number(controlsUi.pointSize.value),
  edgeFeather: Number(controlsUi.edgeFeather.value),
  sampleCleanup: Number(controlsUi.sampleCleanup.value),
  sizeRandom: Number(controlsUi.sizeRandom.value),
  glowRadius: Number(controlsUi.glowRadius.value),
  glowExposure: Number(controlsUi.glowExposure.value),
  particleizeProgress: Number(controlsUi.particleizeProgress.value),
  modelVisibility: Number(controlsUi.modelVisibility.value),
  spread: Number(controlsUi.spread.value),
  noise: Number(controlsUi.noise.value),
  noiseScale: Number(controlsUi.noiseScale.value),
  swirl: Number(controlsUi.swirl.value),
  speed: Number(controlsUi.speed.value),
  dissolve: Number(controlsUi.dissolve.value),
  dissolveSpread: Number(controlsUi.dissolveSpread.value),
  dissolveEdgeWidth: Number(controlsUi.dissolveEdgeWidth.value),
  dissolveTurbulence: Number(controlsUi.dissolveTurbulence.value),
  dissolveCurl: Number(controlsUi.dissolveCurl.value),
  dissolveMist: Number(controlsUi.dissolveMist.value),
  dissolveDirectionX: Number(controlsUi.dissolveDirectionX.value),
  dissolveDirectionY: Number(controlsUi.dissolveDirectionY.value),
  dissolveDirectionZ: Number(controlsUi.dissolveDirectionZ.value),
  dissolveLift: Number(controlsUi.dissolveLift.value),
  growth: Number(controlsUi.growth.value),
  growthFlow: Number(controlsUi.growthFlow.value),
  growthWidth: Number(controlsUi.growthWidth.value),
  growthTurbulence: Number(controlsUi.growthTurbulence.value),
  organicFlow: Number(controlsUi.organicFlow.value),
  edgeBreak: Number(controlsUi.edgeBreak.value),
  filamentLength: Number(controlsUi.filamentLength.value),
  filamentCurl: Number(controlsUi.filamentCurl.value),
  emissionEnabled: controlsUi.emissionEnabled.checked,
  emissionCount: Number(controlsUi.emissionCount.value),
  modelWhite: Number(controlsUi.modelWhite.value),
  modelRoughness: Number(controlsUi.modelRoughness.value),
  emissionIntensity: Number(controlsUi.emissionIntensity.value),
  emissionDistance: Number(controlsUi.emissionDistance.value),
  emissionSpeed: Number(controlsUi.emissionSpeed.value),
  emissionWindX: Number(controlsUi.emissionWindX.value),
  emissionWindY: Number(controlsUi.emissionWindY.value),
  emissionWindZ: Number(controlsUi.emissionWindZ.value),
  emissionTurbulence: Number(controlsUi.emissionTurbulence.value),
  emissionSize: Number(controlsUi.emissionSize.value),
  emissionOpacity: Number(controlsUi.emissionOpacity.value),
  emissionGlow: Number(controlsUi.emissionGlow.value),
  breakAmount: Number(controlsUi.breakAmount.value),
  breakProgress: Number(controlsUi.breakProgress.value),
  breakRadius: Number(controlsUi.breakRadius.value),
  breakFeather: Number(controlsUi.breakFeather.value),
  breakCenterX: Number(controlsUi.breakCenterX.value),
  breakCenterY: Number(controlsUi.breakCenterY.value),
  breakCenterZ: Number(controlsUi.breakCenterZ.value),
  breakSpeed: Number(controlsUi.breakSpeed.value),
  breakSize: Number(controlsUi.breakSize.value),
  imageSplatCount: Number(controlsUi.imageSplatCount.value),
  imageSplatDepth: Number(controlsUi.imageSplatDepth.value),
  imageSplatScatter: Number(controlsUi.imageSplatScatter.value),
  imageSplatSpeed: Number(controlsUi.imageSplatSpeed.value),
  imageSplatDirX: Number(controlsUi.imageSplatDirX.value),
  imageSplatDirY: Number(controlsUi.imageSplatDirY.value),
  imageSplatDirZ: Number(controlsUi.imageSplatDirZ.value),
  imageSplatTurbulence: Number(controlsUi.imageSplatTurbulence.value),
  imageSplatSize: Number(controlsUi.imageSplatSize.value),
  imageSplatFeather: Number(controlsUi.imageSplatFeather.value),
  imageSplatColorKeep: Number(controlsUi.imageSplatColorKeep.value),
  imageSplatOpacity: Number(controlsUi.imageSplatOpacity.value),
  imageSplatGlow: Number(controlsUi.imageSplatGlow.value),
  imageSplatPlaneVisible: controlsUi.imageSplatPlaneVisible.checked,
  imageSplatPlaneOpacity: Number(controlsUi.imageSplatPlaneOpacity.value),
  modelAnimEnabled: Boolean(controlsUi.modelAnimEnabled?.checked),
  modelAnimPlaying: Boolean(controlsUi.modelAnimPlaying?.checked),
  modelAnimProgress: Number(controlsUi.modelAnimProgress?.value || 0),
  modelAnimSpeed: Number(controlsUi.modelAnimSpeed?.value || 1),
  imageSplatPositionX: 0,
  imageSplatPositionY: 0,
  imageSplatPositionZ: 0,
  imageSplatRotationX: 0,
  imageSplatRotationY: 0,
  imageSplatRotationZ: 0,
  imageSplatScale: 1,
  morphProgress: Number(controlsUi.morphProgress.value),
  morphFlow: Number(controlsUi.morphFlow.value),
  morphScatter: Number(controlsUi.morphScatter.value),
  morphTurbulence: Number(controlsUi.morphTurbulence.value),
  morphTrail: Number(controlsUi.morphTrail.value),
  morphDirX: Number(controlsUi.morphDirX.value),
  morphDirY: Number(controlsUi.morphDirY.value),
  morphDirZ: Number(controlsUi.morphDirZ.value),
  colorA: controlsUi.colorA.value,
  colorB: controlsUi.colorB.value,
  useTexture: controlsUi.useTexture.checked,
  autoRotate: controlsUi.autoRotate.checked,
  worldEnabled: controlsUi.worldEnabled.checked,
  worldVisible: controlsUi.worldVisible.checked,
  worldExport: controlsUi.worldExport.checked,
  worldIntensity: Number(controlsUi.worldIntensity.value),
  worldBlur: Number(controlsUi.worldBlur.value),
  worldRotation: Number(controlsUi.worldRotation.value),
  handControlEnabled: Boolean(controlsUi.handControlEnabled?.checked),
  handControlMode: controlsUi.handControlMode?.value || 'fluid',
  handControlInfluence: Number(controlsUi.handControlInfluence?.value || 0.85),
  handControlSmoothing: Number(controlsUi.handControlSmoothing?.value || 0.72),
  handControlFps: Number(controlsUi.handControlFps?.value || 18),
  handControlMirror: Boolean(controlsUi.handControlMirror?.checked),
  cameraType: controlsUi.cameraType?.value || 'perspective',
  cameraSensorWidth: 36,
  cameraDisplaySize: Number(controlsUi.cameraDisplaySize?.value || 1),
  cameraFocalLength: Number(controlsUi.cameraFocalLength?.value || 22.74),
  cameraDofEnabled: Boolean(controlsUi.cameraDofEnabled?.checked),
  cameraAperture: Number(controlsUi.cameraAperture?.value || 5.6),
  cameraFocusDistance: Number(controlsUi.cameraFocusDistance?.value || 7.18)
};

const cameraAnimation = {
  duration: Number(exportSettings.duration || controlsUi.duration.value),
  time: 0,
  playing: false,
  pathMode: controlsUi.cameraPathMode?.value || 'linear',
  curve: controlsUi.cameraCurve?.value || 'easeInOut',
  curveStrength: Number(controlsUi.cameraCurveStrength?.value || 2),
  keyframes: []
};
const parameterKeyframes = [];
const parameterKeyframeButtons = new Map();
const VALID_CAMERA_PATH_MODES = new Set(['linear', 'bezier', 'smooth']);
const VALID_CAMERA_CURVES = new Set(['linear', 'easeInOut', 'easeIn', 'easeOut', 'hold']);
const undoHistory = {
  past: [],
  restoring: false,
  maxEntries: 50
};

function cloneUndoValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function captureUndoSceneModels() {
  return sceneModelObjects.map((record) => ({
    id: record.id,
    name: record.name,
    source: record.source,
    payload: record.payload,
    options: cloneUndoValue(record.options),
    transform: cloneUndoValue(record.transform),
    effectRotation: cloneUndoValue(record.effectRotation),
    hidden: Boolean(record.hidden)
  }));
}

function captureUndoSnapshot(label = '编辑') {
  return {
    label,
    options: cloneUndoValue(captureKeyframeOptions()),
    cameraSettings: cloneUndoValue(getCameraSettings()),
    cameraSnapshot: cloneUndoValue(captureCameraSnapshot()),
    exportSettings: {
      ...getExportResolution(),
      fps: Number(controlsUi.exportFps.value) || 30
    },
    cameraAnimation: {
      duration: cameraAnimation.duration,
      time: cameraAnimation.time,
      pathMode: cameraAnimation.pathMode,
      curve: cameraAnimation.curve,
      curveStrength: cameraAnimation.curveStrength
    },
    cameraKeyframes: cloneUndoValue(getSortedCameraKeyframes()),
    parameterKeyframes: cloneUndoValue(serializeParameterKeyframes()),
    lights: cloneUndoValue(serializeSceneLights()),
    worldExport: state.worldExport,
    sceneModels: captureUndoSceneModels(),
    activeSceneModelId: selectedSceneModelId,
    videoPlanes: cloneUndoValue(serializeVideoPlanes()),
    activeVideoPlaneId: selectedVideoPlaneId,
    imageSplatTransform: imageSplatRoot || realSplatRoot ? cloneUndoValue(captureImageSplatTransform()) : null
  };
}

function getUndoSnapshotFingerprint(snapshot) {
  return JSON.stringify({
    options: snapshot.options,
    cameraSettings: snapshot.cameraSettings,
    cameraSnapshot: snapshot.cameraSnapshot,
    exportSettings: snapshot.exportSettings,
    cameraAnimation: snapshot.cameraAnimation,
    cameraKeyframes: snapshot.cameraKeyframes,
    parameterKeyframes: snapshot.parameterKeyframes,
    lights: snapshot.lights,
    worldExport: snapshot.worldExport,
    sceneModels: snapshot.sceneModels.map((record) => ({
      id: record.id,
      name: record.name,
      options: record.options,
      transform: record.transform,
      effectRotation: record.effectRotation,
      hidden: record.hidden
    })),
    activeSceneModelId: snapshot.activeSceneModelId,
    videoPlanes: snapshot.videoPlanes,
    activeVideoPlaneId: snapshot.activeVideoPlaneId,
    imageSplatTransform: snapshot.imageSplatTransform
  });
}

function recordUndoStep(label = '编辑') {
  if (undoHistory.restoring || exportSettings.hideUi || !initialModelReady) {
    return false;
  }
  const snapshot = captureUndoSnapshot(label);
  const fingerprint = getUndoSnapshotFingerprint(snapshot);
  const previous = undoHistory.past[undoHistory.past.length - 1];
  if (previous?.fingerprint === fingerprint) {
    return false;
  }
  undoHistory.past.push({ snapshot, fingerprint });
  if (undoHistory.past.length > undoHistory.maxEntries) {
    undoHistory.past.splice(0, undoHistory.past.length - undoHistory.maxEntries);
  }
  return true;
}

async function restoreUndoSceneModels(models = [], activeId = null) {
  if (!models.length) {
    return;
  }
  const structureChanged = models.length !== sceneModelObjects.length || models.some((snapshot, index) => {
    const current = sceneModelObjects[index];
    return !current || current.id !== snapshot.id || current.source !== snapshot.source;
  });

  if (!structureChanged) {
    models.forEach((snapshot, index) => {
      const record = sceneModelObjects[index];
      record.name = snapshot.name;
      record.payload = snapshot.payload;
      record.options = sanitizeSceneModelOptions(snapshot.options);
      record.transform = normalizeSceneModelTransform(snapshot.transform);
      record.effectRotation = normalizeVectorArray(snapshot.effectRotation, [0, 0, 0]);
      record.hidden = Boolean(snapshot.hidden);
      if (record.snapshotRoot) {
        applySceneModelTransformToObject(record.snapshotRoot, record.transform);
        const effectRoot = record.snapshotRoot.children[0];
        if (effectRoot) {
          effectRoot.rotation.fromArray(record.effectRotation);
          effectRoot.updateMatrixWorld(true);
        }
      }
    });
    const targetId = models.some((record) => record.id === activeId) ? activeId : models[0].id;
    if (selectedSceneModelId !== targetId) {
      await activateSceneModel(targetId, { force: true });
    } else {
      const activeRecord = getSelectedSceneModel();
      applySceneModelOptionsToState(activeRecord.options);
      applyActiveSceneModelTransform(activeRecord.transform);
      modelEffectRoot.rotation.fromArray(activeRecord.effectRotation);
    }
    return;
  }

  sceneModelObjects.forEach((record) => disposeSceneModelSnapshot(record));
  sceneModelObjects.length = 0;
  models.forEach((snapshot) => {
    sceneModelObjects.push(createSceneModelRecord({
      id: snapshot.id,
      name: snapshot.name,
      source: snapshot.source,
      payload: snapshot.payload,
      options: snapshot.options,
      transform: snapshot.transform,
      effectRotation: snapshot.effectRotation,
      hidden: snapshot.hidden
    }));
  });

  const targetId = sceneModelObjects.some((record) => record.id === activeId)
    ? activeId
    : sceneModelObjects[0].id;
  sceneModelSaveSuspended = true;
  try {
    for (const record of sceneModelObjects) {
      selectedSceneModelId = record.id;
      currentModelPayload = record.payload || null;
      applySceneModelOptionsToState(record.options);
      applyActiveSceneModelTransform(record.transform);
      modelEffectRoot.rotation.fromArray(record.effectRotation);
      await buildParticles(record.source, record.name, { resetView: false });
      buildSceneModelSnapshotFromActive(record);
    }
    const activeRecord = sceneModelObjects.find((record) => record.id === targetId) || sceneModelObjects[0];
    selectedSceneModelId = activeRecord.id;
    disposeSceneModelSnapshot(activeRecord);
    currentModelPayload = activeRecord.payload || null;
    applySceneModelOptionsToState(activeRecord.options);
    applyActiveSceneModelTransform(activeRecord.transform);
    modelEffectRoot.rotation.fromArray(activeRecord.effectRotation);
    await buildParticles(activeRecord.source, activeRecord.name, { resetView: false });
    currentSource = activeRecord.source;
    currentLabel = activeRecord.name;
  } finally {
    sceneModelSaveSuspended = false;
  }
}

async function undoLastAction() {
  if (undoHistory.restoring || !undoHistory.past.length) {
    setStatus(undoHistory.restoring ? 'Undoing' : 'Nothing to undo');
    return false;
  }
  const entry = undoHistory.past.pop();
  undoHistory.restoring = true;
  cameraAnimation.playing = false;
  updatePlayButton();
  setStatus(`Undo: ${entry.snapshot.label}`);
  try {
    await restoreUndoSceneModels(entry.snapshot.sceneModels, entry.snapshot.activeSceneModelId);
    await importVideoPlanes(entry.snapshot.videoPlanes, { selectId: entry.snapshot.activeVideoPlaneId });
    await applyOptionsSnapshot(entry.snapshot.options, true);
    state.worldExport = Boolean(entry.snapshot.worldExport);
    controlsUi.worldExport.checked = state.worldExport;
    cameraAnimation.duration = entry.snapshot.cameraAnimation.duration;
    cameraAnimation.pathMode = normalizeCameraPathMode(entry.snapshot.cameraAnimation.pathMode);
    cameraAnimation.curve = entry.snapshot.cameraAnimation.curve;
    cameraAnimation.curveStrength = entry.snapshot.cameraAnimation.curveStrength;
    controlsUi.duration.value = cameraAnimation.duration;
    controlsUi.timeline.max = cameraAnimation.duration;
    importCameraKeyframes(entry.snapshot.cameraKeyframes);
    importParameterKeyframes(entry.snapshot.parameterKeyframes);
    applySceneLightSnapshots(entry.snapshot.lights, { updateUi: true });
    setCameraSettings(entry.snapshot.cameraSettings, true);
    setExportResolution(
      entry.snapshot.exportSettings.width,
      entry.snapshot.exportSettings.height,
      entry.snapshot.exportSettings.fps
    );
    applyCameraSnapshot(entry.snapshot.cameraSnapshot);
    if (entry.snapshot.imageSplatTransform) {
      applyImageSplatTransformSnapshot(entry.snapshot.imageSplatTransform);
    }
    setCameraTime(entry.snapshot.cameraAnimation.time, true);
    syncUi();
    renderSceneModelList();
    setStatus('Undone');
    return true;
  } catch (error) {
    console.error(error);
    setStatus('Undo failed');
    return false;
  } finally {
    undoHistory.restoring = false;
  }
}

const NUMERIC_KEYFRAME_FIELDS = [
  'pointSize',
  'edgeFeather',
  'sampleCleanup',
  'sizeRandom',
  'glowRadius',
  'glowExposure',
  'particleizeProgress',
  'modelVisibility',
  'spread',
  'noise',
  'noiseScale',
  'swirl',
  'speed',
  'dissolve',
  'dissolveSpread',
  'dissolveEdgeWidth',
  'dissolveTurbulence',
  'dissolveCurl',
  'dissolveMist',
  'dissolveDirectionX',
  'dissolveDirectionY',
  'dissolveDirectionZ',
  'dissolveLift',
  'growth',
  'growthFlow',
  'growthWidth',
  'growthTurbulence',
  'organicFlow',
  'edgeBreak',
  'filamentLength',
  'filamentCurl',
  'emissionCount',
  'modelWhite',
  'modelRoughness',
  'emissionIntensity',
  'emissionDistance',
  'emissionSpeed',
  'emissionWindX',
  'emissionWindY',
  'emissionWindZ',
  'emissionTurbulence',
  'emissionSize',
  'emissionOpacity',
  'emissionGlow',
  'breakAmount',
  'breakProgress',
  'breakRadius',
  'breakFeather',
  'breakCenterX',
  'breakCenterY',
  'breakCenterZ',
  'breakSpeed',
  'breakSize',
  'imageSplatCount',
  'imageSplatDepth',
  'imageSplatScatter',
  'imageSplatSpeed',
  'imageSplatDirX',
  'imageSplatDirY',
  'imageSplatDirZ',
  'imageSplatTurbulence',
  'imageSplatSize',
  'imageSplatFeather',
  'imageSplatColorKeep',
  'imageSplatOpacity',
  'imageSplatGlow',
  'imageSplatPlaneOpacity',
  'modelAnimProgress',
  'modelAnimSpeed',
  'imageSplatPositionX',
  'imageSplatPositionY',
  'imageSplatPositionZ',
  'imageSplatRotationX',
  'imageSplatRotationY',
  'imageSplatRotationZ',
  'imageSplatScale',
  'morphProgress',
  'morphFlow',
  'morphScatter',
  'morphTurbulence',
  'morphTrail',
  'morphDirX',
  'morphDirY',
  'morphDirZ',
  'worldIntensity',
  'worldBlur',
  'worldRotation',
  'cameraSensorWidth',
  'cameraFocalLength',
  'cameraAperture',
  'cameraFocusDistance'
];
const COLOR_KEYFRAME_FIELDS = ['colorA', 'colorB'];
const BOOLEAN_KEYFRAME_FIELDS = [
  'useTexture',
  'autoRotate',
  'emissionEnabled',
  'imageSplatPlaneVisible',
  'modelAnimEnabled',
  'modelAnimPlaying',
  'worldEnabled',
  'worldVisible',
  'cameraDofEnabled'
];
const STRING_KEYFRAME_FIELDS = ['effectMode', 'cameraType'];
const REBUILD_NUMERIC_FIELDS = new Set(['sampleCleanup', 'emissionCount', 'imageSplatCount']);
const CAMERA_KEYFRAME_FIELDS = new Set([
  'cameraSensorWidth',
  'cameraFocalLength',
  'cameraAperture',
  'cameraFocusDistance',
  'cameraDofEnabled'
]);
const PARAMETER_KEYFRAME_FIELDS = [
  ...NUMERIC_KEYFRAME_FIELDS.filter((field) => !REBUILD_NUMERIC_FIELDS.has(field)),
  'cameraDofEnabled'
];
const VISIBLE_MODEL_MATERIAL_FIELDS = new Set(['particleizeProgress', 'modelVisibility', 'modelWhite', 'modelRoughness', 'dissolve']);
const MAX_TEXTURE_SAMPLER_SIZE = 1024;
const safeDisplayTextureCache = new WeakMap();
const CLAMP_01_FIELDS = new Set([
  'edgeFeather',
  'sampleCleanup',
  'organicFlow',
  'edgeBreak',
  'dissolve',
  'particleizeProgress',
  'modelVisibility',
  'dissolveEdgeWidth',
  'dissolveMist',
  'modelWhite',
  'modelRoughness',
  'emissionOpacity',
  'breakAmount',
  'breakProgress',
  'imageSplatFeather',
  'imageSplatColorKeep',
  'imageSplatOpacity',
  'imageSplatPlaneOpacity',
  'modelAnimProgress',
  'morphProgress',
  'morphTrail',
  'worldBlur'
]);
const SIGNED_NUMERIC_FIELDS = new Set([
  'swirl',
  'dissolveDirectionX',
  'dissolveDirectionY',
  'dissolveDirectionZ',
  'dissolveLift',
  'emissionWindX',
  'emissionWindY',
  'emissionWindZ',
  'breakCenterX',
  'breakCenterY',
  'breakCenterZ',
  'imageSplatDirX',
  'imageSplatDirY',
  'imageSplatDirZ',
  'imageSplatPositionX',
  'imageSplatPositionY',
  'imageSplatPositionZ',
  'imageSplatRotationX',
  'imageSplatRotationY',
  'imageSplatRotationZ',
  'morphDirX',
  'morphDirY',
  'morphDirZ',
  'worldRotation'
]);
const HAND_CONTROL_NUMERIC_FIELDS = ['handControlInfluence', 'handControlSmoothing', 'handControlFps'];
const HAND_CONTROL_MODES = new Set(['fluid', 'growth', 'dissolve', 'morph']);
const HAND_WASM_BASE = '/mediapipe/wasm';
const HAND_MODEL_URL = '/mediapipe/models/hand_landmarker.task';
const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17]
];

const VALID_EFFECT_MODES = new Set(['particles', 'emission', 'image', 'morph']);

const LIGHT_TYPES = {
  point: '点光',
  sun: '日光',
  spot: '聚光',
  area: '面光'
};

const LIGHT_DEFAULTS = {
  point: { color: '#ffffff', intensity: 8, size: 0.75, position: [1.8, 1.7, 2.2], rotation: [0, 0, 0] },
  sun: { color: '#ffffff', intensity: 0.65, size: 0, position: [-3.5, 5.2, 4.6], rotation: [-0.82, -0.56, -0.42] },
  spot: { color: '#ffffff', intensity: 12, size: 0.72, position: [2.4, 2.4, 3.2], rotation: [-0.62, 0.55, 0.08] },
  area: { color: '#ffffff', intensity: 5, size: 2.4, position: [-2.8, 2.8, 2.8], rotation: [-0.74, -0.62, -0.42] }
};
const MAX_PARTICLE_SHADER_LIGHTS = 8;
const PARTICLE_LIGHT_TYPE_IDS = {
  point: 0,
  sun: 1,
  spot: 2,
  area: 3
};

const presets = {
  shape: {
    pointSize: 2.4,
    edgeFeather: 0.18,
    sizeRandom: 0.28,
    glowRadius: 80,
    glowExposure: 0.85,
    spread: 0,
    noise: 0,
    noiseScale: 1.8,
    swirl: 0,
    speed: 0,
    dissolve: 0,
    dissolveSpread: 1.55,
    dissolveEdgeWidth: 0.22,
    dissolveTurbulence: 0.9,
    dissolveCurl: 1.1,
    dissolveMist: 0.62,
    dissolveDirectionX: 0.82,
    dissolveDirectionY: 0.18,
    dissolveDirectionZ: -0.22,
    dissolveLift: 0.24,
    growth: 1,
    growthFlow: 0.65,
    growthWidth: 0.24,
    growthTurbulence: 0.45,
    organicFlow: 0,
    edgeBreak: 0,
    filamentLength: 0,
    filamentCurl: 0,
    colorA: '#00f0ff',
    colorB: '#ffbf36'
  },
  calm: {
    pointSize: 2.2,
    edgeFeather: 0.22,
    sizeRandom: 0.36,
    glowRadius: 110,
    glowExposure: 1.05,
    spread: 0.22,
    noise: 0.36,
    noiseScale: 2.4,
    swirl: 0.16,
    speed: 0.72,
    dissolve: 0,
    dissolveSpread: 1.25,
    dissolveEdgeWidth: 0.24,
    dissolveTurbulence: 0.82,
    dissolveCurl: 1.0,
    dissolveMist: 0.55,
    dissolveDirectionX: 0.62,
    dissolveDirectionY: 0.12,
    dissolveDirectionZ: -0.18,
    dissolveLift: 0.18,
    growth: 1,
    growthFlow: 0.82,
    growthWidth: 0.28,
    growthTurbulence: 0.62,
    organicFlow: 0.28,
    edgeBreak: 0.18,
    filamentLength: 0.65,
    filamentCurl: 0.5,
    colorA: '#00f0ff',
    colorB: '#ffbf36'
  },
  burst: {
    pointSize: 2.8,
    edgeFeather: 0.16,
    sizeRandom: 0.58,
    glowRadius: 150,
    glowExposure: 1.35,
    spread: 2.25,
    noise: 1.18,
    noiseScale: 1.25,
    swirl: 0.62,
    speed: 1.18,
    dissolve: 0,
    dissolveSpread: 2.75,
    dissolveEdgeWidth: 0.18,
    dissolveTurbulence: 1.45,
    dissolveCurl: 1.35,
    dissolveMist: 0.72,
    dissolveDirectionX: 1.0,
    dissolveDirectionY: 0.28,
    dissolveDirectionZ: -0.16,
    dissolveLift: 0.34,
    growth: 1,
    growthFlow: 1.15,
    growthWidth: 0.18,
    growthTurbulence: 1.05,
    organicFlow: 0.35,
    edgeBreak: 0.35,
    filamentLength: 1.0,
    filamentCurl: 0.75,
    colorA: '#ff6f61',
    colorB: '#ffe86b'
  },
  vortex: {
    pointSize: 2.0,
    edgeFeather: 0.2,
    sizeRandom: 0.46,
    glowRadius: 130,
    glowExposure: 1.2,
    spread: 0.82,
    noise: 0.95,
    noiseScale: 1.6,
    swirl: 2.12,
    speed: 1.35,
    dissolve: 0,
    dissolveSpread: 1.8,
    dissolveEdgeWidth: 0.2,
    dissolveTurbulence: 1.35,
    dissolveCurl: 2.15,
    dissolveMist: 0.66,
    dissolveDirectionX: 0.45,
    dissolveDirectionY: 0.22,
    dissolveDirectionZ: -0.75,
    dissolveLift: 0.26,
    growth: 1,
    growthFlow: 1.0,
    growthWidth: 0.22,
    growthTurbulence: 0.9,
    organicFlow: 0.45,
    edgeBreak: 0.28,
    filamentLength: 1.15,
    filamentCurl: 1.35,
    colorA: '#8cfffb',
    colorB: '#ff4d9d'
  },
  bloom: {
    pointSize: 1.45,
    edgeFeather: 0.1,
    sizeRandom: 0.48,
    glowRadius: 80,
    glowExposure: 0.95,
    spread: 0.08,
    noise: 0.22,
    noiseScale: 1.35,
    swirl: 0.18,
    speed: 0.75,
    dissolve: 0,
    dissolveSpread: 2.25,
    dissolveEdgeWidth: 0.16,
    dissolveTurbulence: 1.25,
    dissolveCurl: 1.8,
    dissolveMist: 0.76,
    dissolveDirectionX: 0.92,
    dissolveDirectionY: 0.22,
    dissolveDirectionZ: -0.28,
    dissolveLift: 0.3,
    growth: 0.58,
    growthFlow: 1.15,
    growthWidth: 0.18,
    growthTurbulence: 0.9,
    organicFlow: 0.92,
    edgeBreak: 0.7,
    filamentLength: 1.35,
    filamentCurl: 1.15,
    colorA: '#ffd7ef',
    colorB: '#ffb238'
  },
  whale: {
    particleCount: 160000,
    pointSize: 1.42,
    edgeFeather: 0.08,
    sizeRandom: 0.34,
    glowRadius: 72,
    glowExposure: 0.48,
    spread: 0.02,
    noise: 0.05,
    noiseScale: 3.4,
    swirl: 0,
    speed: 0.32,
    particleizeProgress: 1,
    dissolve: 0.32,
    dissolveSpread: 0.22,
    dissolveEdgeWidth: 0.24,
    dissolveTurbulence: 0.2,
    dissolveCurl: 1.65,
    dissolveMist: 0.18,
    dissolveDirectionX: 1,
    dissolveDirectionY: 0.02,
    dissolveDirectionZ: -0.08,
    dissolveLift: 0.02,
    growth: 1,
    growthFlow: 0.72,
    growthWidth: 0.26,
    growthTurbulence: 0.42,
    organicFlow: 0.32,
    edgeBreak: 0.08,
    filamentLength: 0.95,
    filamentCurl: 1.65,
    colorA: '#83b3cf',
    colorB: '#eef8ff',
    useTexture: false,
    autoRotate: false
  }
};

setupWorkspaceLayout();
const initialCanvasSize = getMainCanvasCssSize();

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: true,
  premultipliedAlpha: false,
  preserveDrawingBuffer: true,
  powerPreference: 'high-performance'
});

renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.AgXToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.setClearColor(0x090a0c, exportSettings.transparent ? 0 : 1);
renderer.setPixelRatio(renderPixelRatio);
renderer.setSize(initialCanvasSize.width, initialCanvasSize.height, false);

const cameraPreviewRenderer = !exportSettings.hideUi && cameraPreviewUi.canvas
  ? new THREE.WebGLRenderer({
    canvas: cameraPreviewUi.canvas,
    antialias: false,
    alpha: true,
    premultipliedAlpha: false,
    powerPreference: 'high-performance'
  })
  : null;

if (cameraPreviewRenderer) {
  cameraPreviewRenderer.outputColorSpace = THREE.SRGBColorSpace;
  cameraPreviewRenderer.toneMapping = renderer.toneMapping;
  cameraPreviewRenderer.toneMappingExposure = renderer.toneMappingExposure;
  cameraPreviewRenderer.setClearColor(0x090a0c, 1);
  cameraPreviewRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1));
}

let mainWebglContextLost = false;
let cameraPreviewContextLost = false;

function bindWebglContextLossHandlers(targetCanvas, label, isMainRenderer = false) {
  if (!targetCanvas) {
    return;
  }

  targetCanvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    if (isMainRenderer) {
      mainWebglContextLost = true;
      document.body.classList.add('webgl-context-lost');
      setStatus('WebGL reset');
    } else {
      cameraPreviewContextLost = true;
    }
    console.warn(`${label} WebGL context lost.`);
  }, false);

  targetCanvas.addEventListener('webglcontextrestored', () => {
    if (isMainRenderer) {
      mainWebglContextLost = false;
      document.body.classList.remove('webgl-context-lost');
      setStatus('Ready');
      resizePostTargets();
      resizeRenderer();
    } else {
      cameraPreviewContextLost = false;
      renderCameraPreview(true);
    }
    console.warn(`${label} WebGL context restored.`);
  }, false);
}

bindWebglContextLossHandlers(canvas, 'Main renderer', true);
bindWebglContextLossHandlers(cameraPreviewUi.canvas, 'Camera preview');

const pmremGenerator = new THREE.PMREMGenerator(renderer);
pmremGenerator.compileEquirectangularShader();

const postSize = new THREE.Vector2();
const postClearColor = new THREE.Color();
// Preview, camera view, and hidden export must use the same bloom resolution.
// Different scales change the apparent glow energy and break WYSIWYG output.
const bloomScale = 0.4;
const perfStats = {
  requestedPixelRatio,
  renderPixelRatio,
  bloomScale,
  frameMs: 0,
  renderMs: 0,
  cameraPreviewMs: 0,
  buildMs: 0,
  lastParticleCount: 0,
  lastEmissionCount: 0,
  gpu: null
};

function smoothPerfStat(key, value, alpha = 0.14) {
  if (!Number.isFinite(value)) {
    return;
  }
  perfStats[key] = perfStats[key] > 0
    ? perfStats[key] * (1 - alpha) + value * alpha
    : value;
}

function readGpuInfo() {
  try {
    const gl = renderer.getContext();
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    if (debugInfo) {
      return {
        vendor: gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL),
        renderer: gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
      };
    }
    return {
      vendor: gl.getParameter(gl.VENDOR),
      renderer: gl.getParameter(gl.RENDERER)
    };
  } catch (error) {
    return { error: error?.message || 'GPU info unavailable' };
  }
}

perfStats.gpu = readGpuInfo();

function createPostTarget(name, width, height, options = {}) {
  const target = new THREE.WebGLRenderTarget(width, height, {
    format: THREE.RGBAFormat,
    type: THREE.HalfFloatType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: Boolean(options.depthBuffer),
    stencilBuffer: false
  });
  target.texture.name = name;
  target.texture.generateMipmaps = false;
  if (options.depthBuffer) {
    target.depthTexture = new THREE.DepthTexture(width, height, THREE.UnsignedIntType);
    target.depthTexture.format = THREE.DepthFormat;
    target.depthTexture.type = THREE.UnsignedIntType;
    target.depthTexture.name = `${name}-depth`;
  }
  return target;
}

function currentDrawingBufferSize() {
  renderer.getDrawingBufferSize(postSize);
  return {
    width: Math.max(2, Math.floor(postSize.x)),
    height: Math.max(2, Math.floor(postSize.y))
  };
}

let drawingSize = currentDrawingBufferSize();
let sceneTarget = createPostTarget('particle-base', drawingSize.width, drawingSize.height, { depthBuffer: true });
let glowTarget = createPostTarget(
  'particle-glow-source',
  Math.max(2, Math.floor(drawingSize.width * bloomScale)),
  Math.max(2, Math.floor(drawingSize.height * bloomScale)),
  { depthBuffer: true }
);
let blurTargetA = createPostTarget('particle-glow-blur-a', glowTarget.width, glowTarget.height);
let blurTargetB = createPostTarget('particle-glow-blur-b', glowTarget.width, glowTarget.height);
let cameraPreviewPostTargets = cameraPreviewRenderer ? createPostTargetSet('camera-preview', 2, 2) : null;
let cameraViewPostTargets = !exportSettings.hideUi ? createPostTargetSet('camera-view', 2, 2) : null;

function createPostTargetSet(prefix, width, height) {
  const safeWidth = Math.max(2, Math.floor(width));
  const safeHeight = Math.max(2, Math.floor(height));
  const bloomWidth = Math.max(2, Math.floor(safeWidth * bloomScale));
  const bloomHeight = Math.max(2, Math.floor(safeHeight * bloomScale));
  return {
    sceneTarget: createPostTarget(`${prefix}-base`, safeWidth, safeHeight, { depthBuffer: true }),
    glowTarget: createPostTarget(`${prefix}-glow-source`, bloomWidth, bloomHeight, { depthBuffer: true }),
    blurTargetA: createPostTarget(`${prefix}-glow-blur-a`, bloomWidth, bloomHeight),
    blurTargetB: createPostTarget(`${prefix}-glow-blur-b`, bloomWidth, bloomHeight)
  };
}

function resizePostTargetSet(targets, width, height) {
  if (!targets) {
    return;
  }

  const safeWidth = Math.max(2, Math.floor(width));
  const safeHeight = Math.max(2, Math.floor(height));
  const bloomWidth = Math.max(2, Math.floor(safeWidth * bloomScale));
  const bloomHeight = Math.max(2, Math.floor(safeHeight * bloomScale));
  targets.sceneTarget.setSize(safeWidth, safeHeight);
  targets.glowTarget.setSize(bloomWidth, bloomHeight);
  targets.blurTargetA.setSize(bloomWidth, bloomHeight);
  targets.blurTargetB.setSize(bloomWidth, bloomHeight);
}

function resizePostTargets() {
  drawingSize = currentDrawingBufferSize();
  const bloomWidth = Math.max(2, Math.floor(drawingSize.width * bloomScale));
  const bloomHeight = Math.max(2, Math.floor(drawingSize.height * bloomScale));
  sceneTarget.setSize(drawingSize.width, drawingSize.height);
  glowTarget.setSize(bloomWidth, bloomHeight);
  blurTargetA.setSize(bloomWidth, bloomHeight);
  blurTargetB.setSize(bloomWidth, bloomHeight);
}

const scene = new THREE.Scene();
// Camera-distance fog made unchanged lighting appear darker when the camera
// moved away. Atmospheric depth should be an explicit effect, not an editor
// default, so keep the base scene camera-distance invariant.
scene.fog = null;
RectAreaLightUniformsLib.init();
const activeModelTransformRoot = new THREE.Group();
activeModelTransformRoot.name = 'Active Scene Model Transform';
activeModelTransformRoot.userData.sceneModelPickTarget = true;
const modelEffectRoot = new THREE.Group();
modelEffectRoot.name = 'Model Effect Root';
modelEffectRoot.userData.sceneModelPickTarget = true;
activeModelTransformRoot.add(modelEffectRoot);
scene.add(activeModelTransformRoot);

const ambientLight = new THREE.AmbientLight(0xf2f5ff, 0.55);
scene.add(ambientLight);
const keyLight = new THREE.DirectionalLight(0xffffff, 0.55);
keyLight.position.set(-3.5, 5.2, 4.6);
scene.add(keyLight);
const rimLight = new THREE.DirectionalLight(0xbfdcff, 0.28);
rimLight.position.set(3.6, 2.1, -4.8);
scene.add(rimLight);
const baseLightIntensities = {
  ambient: ambientLight.intensity,
  key: keyLight.intensity,
  rim: rimLight.intensity
};
const sceneLightGroup = new THREE.Group();
scene.add(sceneLightGroup);
const lightHandleGroup = new THREE.Group();
lightHandleGroup.visible = !exportSettings.hideUi;
scene.add(lightHandleGroup);

const camera = new THREE.PerspectiveCamera(48, initialCanvasSize.aspect, CAMERA_DEFAULT_NEAR, CAMERA_DEFAULT_FAR);
const cameraPreviewCamera = new THREE.PerspectiveCamera(48, 16 / 9, CAMERA_DEFAULT_NEAR, CAMERA_DEFAULT_FAR);
const outputFrameCamera = new THREE.PerspectiveCamera(48, 16 / 9, CAMERA_DEFAULT_NEAR, CAMERA_DEFAULT_FAR);
camera.filmGauge = state.cameraSensorWidth;
camera.setFocalLength(state.cameraFocalLength);
const CAMERA_PREVIEW_INTERVAL_MS = exportSettings.hideUi ? 1000 / 15 : 1000 / 10;
const ANIMATED_PARTICLE_PREVIEW_INTERVAL_MS = exportSettings.hideUi ? 1000 / 30 : 1000 / 18;
perfStats.cameraPreviewFps = 1000 / CAMERA_PREVIEW_INTERVAL_MS;
perfStats.animatedParticlePreviewFps = 1000 / ANIMATED_PARTICLE_PREVIEW_INTERVAL_MS;
let cameraPreviewLastRender = -Infinity;
let cameraPreviewLayoutCache = null;
let cameraViewLocked = false;
let orbitInteracting = false;
let cameraPreviewResumeAt = 0;
let cameraPreviewVisible = true;
const mainRendererSize = new THREE.Vector2();
const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;
orbit.dampingFactor = 0.07;
orbit.minDistance = 0.02;
orbit.maxDistance = CAMERA_ORBIT_MAX_DISTANCE;
const clock = new THREE.Clock();
const cameraPathGroup = new THREE.Group();
cameraPathGroup.visible = !exportSettings.hideUi;
scene.add(cameraPathGroup);
const transformControls = new TransformControls(camera, renderer.domElement);
transformControls.setMode('translate');
transformControls.setSize(1.15);
transformControls.visible = false;
scene.add(transformControls);
let activeCameraQuaternion = null;
transformControls.addEventListener('dragging-changed', (event) => {
  if (event.value) {
    recordUndoStep('对象变换');
  }
  orbit.enabled = !event.value;
  if (!event.value) {
    if (selectedCameraBezierHandle) {
      commitSelectedBezierHandleTransform();
      rebuildCameraPath();
      selectCameraBezierHandle(selectedCameraBezierHandle.keyframeId, selectedCameraBezierHandle.type);
    } else if (selectedImageSplat) {
      commitSelectedImageSplatTransform();
      syncImageSplatTransformButtons();
    } else if (selectedVideoPlaneId) {
      commitSelectedVideoPlaneTransform();
      renderVideoPlaneList();
    } else if (selectedLightId) {
      commitSelectedLightTransform();
      syncLightUi();
      selectLightHandle(selectedLightId);
    } else if (selectedKeyframeId) {
      commitSelectedKeyframeTransform();
      rebuildCameraPath();
      selectCameraKeyframeHandle(selectedKeyframeId);
    } else if (transformControls.object === activeModelTransformRoot && selectedSceneModelId) {
      commitSelectedSceneModelTransform();
      renderSceneModelList();
    }
  }
});
transformControls.addEventListener('objectChange', () => {
  if (selectedCameraBezierHandle) {
    commitSelectedBezierHandleTransform();
    updateCameraPathCurve();
    setCameraPreviewDirty();
    return;
  }

  if (selectedImageSplat) {
    commitSelectedImageSplatTransform();
    return;
  }

  if (selectedVideoPlaneId) {
    commitSelectedVideoPlaneTransform();
    return;
  }

  if (selectedLightId) {
    commitSelectedLightTransform();
    syncLightUi();
    return;
  }

  if (transformControls.object === activeModelTransformRoot && selectedSceneModelId && !selectedKeyframeId) {
    commitSelectedSceneModelTransform();
    return;
  }

  const keyframe = commitSelectedKeyframeTransform();
  if (keyframe) {
    updateSelectedCameraMarkerFromKeyframe(keyframe);
    setCameraPreviewDirty();
  }
  updateCameraPathCurve();
});
orbit.addEventListener('start', () => {
  recordUndoStep('摄像机视角');
  orbitInteracting = true;
  cameraPreviewResumeAt = performance.now() + CAMERA_PREVIEW_ORBIT_PAUSE_MS;
  if (!transformControls.dragging && !cameraAnimation.playing) {
    activeCameraQuaternion = null;
  }
});
orbit.addEventListener('end', () => {
  orbitInteracting = false;
  cameraPreviewResumeAt = performance.now() + CAMERA_PREVIEW_ORBIT_PAUSE_MS;
  setCameraPreviewDirty();
});
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const selectedTransformProxy = new THREE.Object3D();
selectedTransformProxy.visible = false;
scene.add(selectedTransformProxy);
let selectedKeyframeId = null;
let selectedKeyframeObject = null;
let selectedKeyframeMode = 'translate';
let selectedCameraBezierHandle = null;
let transformAxisConstraint = null;
let modalTransform = null;
const sceneLights = [];
let selectedLightId = null;
let selectedLightMode = 'translate';
let selectedImageSplat = false;
let selectedImageSplatMode = 'translate';
const sceneModelObjects = [];
let selectedSceneModelId = null;
let selectedSceneModelMode = 'translate';
let sceneModelSaveSuspended = false;
const videoPlaneObjects = [];
let selectedVideoPlaneId = null;
let selectedVideoPlaneMode = 'translate';
let pendingModelImportMode = 'replace';
let appendModelImportClickArmed = false;

const TRANSFORM_AXIS_LABELS = {
  x: 'X',
  y: 'Y',
  z: 'Z'
};
const lastScenePointer = {
  clientX: null,
  clientY: null
};

function getCurrentTransformMode() {
  return transformControls.mode || 'translate';
}

function applyTransformAxisConstraint() {
  const axes = { x: true, y: true, z: true };

  if (transformAxisConstraint) {
    const axis = transformAxisConstraint.axis;
    if (transformAxisConstraint.mode === 'lock') {
      axes[axis] = false;
    } else {
      axes.x = false;
      axes.y = false;
      axes.z = false;
      axes[axis] = true;
    }
  }

  transformControls.showX = axes.x;
  transformControls.showY = axes.y;
  transformControls.showZ = axes.z;
}

function resetTransformAxisConstraint(showStatus = false) {
  transformAxisConstraint = null;
  applyTransformAxisConstraint();
  if (showStatus) {
    setStatus('Transform axes reset');
  }
}

function setTransformAxisConstraint(axis, mode = 'only') {
  const normalizedAxis = String(axis || '').toLowerCase();
  if (!['x', 'y', 'z'].includes(normalizedAxis)) {
    return false;
  }

  transformAxisConstraint = {
    axis: normalizedAxis,
    mode: mode === 'lock' ? 'lock' : 'only'
  };
  applyTransformAxisConstraint();

  const label = TRANSFORM_AXIS_LABELS[normalizedAxis];
  setStatus(transformAxisConstraint.mode === 'lock'
    ? `Transform locked ${label}`
    : `Transform constrained to ${label}`);
  return true;
}

function getTransformShortcutTarget() {
  if (selectedCameraBezierHandle) {
    return 'camera-bezier';
  }
  if (selectedImageSplat) {
    return 'image';
  }
  if (selectedVideoPlaneId) {
    return 'video';
  }
  if (selectedLightId) {
    return 'light';
  }
  if (selectedKeyframeId) {
    return 'camera';
  }
  if (selectedSceneModelId) {
    return 'model';
  }
  return 'none';
}

function setTransformModeForSelection(mode) {
  const normalizedMode = ['translate', 'rotate', 'scale'].includes(mode) ? mode : 'translate';
  const target = getTransformShortcutTarget();
  if (target === 'none') {
    return null;
  }

  resetTransformAxisConstraint(false);

  if (target === 'camera-bezier') {
    transformControls.setMode('translate');
    transformControls.setSpace('world');
    applyTransformAxisConstraint();
    if (normalizedMode !== 'translate') {
      setStatus('Bezier handles support move (G)');
      return null;
    } else {
      setStatus('Move');
    }
    return 'translate';
  }

  if (target === 'image') {
    setSelectedImageSplatMode(normalizedMode);
  } else if (target === 'video') {
    setSelectedVideoPlaneMode(normalizedMode);
  } else if (target === 'light') {
    if (normalizedMode === 'scale') {
      setSelectedLightMode('translate');
      setStatus('Lights support move (G) and rotate (R)');
      return null;
    }
    setSelectedLightMode(normalizedMode);
  } else if (target === 'camera') {
    setSelectedKeyframeMode(normalizedMode);
  } else {
    setSelectedSceneModelMode(normalizedMode);
  }

  applyTransformAxisConstraint();
  setStatus(normalizedMode === 'translate' ? 'Move' : normalizedMode === 'rotate' ? 'Rotate' : 'Scale');
  return normalizedMode;
}

function getTransformShortcutObject(target = getTransformShortcutTarget()) {
  if (target === 'camera-bezier') {
    return selectedCameraBezierHandle?.object || null;
  }
  if (target === 'image' || target === 'light' || target === 'camera') {
    return selectedTransformProxy;
  }
  if (target === 'video') {
    return getSelectedVideoPlane()?.root || null;
  }
  if (target === 'model') {
    return activeModelTransformRoot;
  }
  return null;
}

function updateLastScenePointer(event) {
  if (!event || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) {
    return;
  }
  lastScenePointer.clientX = event.clientX;
  lastScenePointer.clientY = event.clientY;
}

function getScenePointerStart(event) {
  updateLastScenePointer(event);
  if (Number.isFinite(lastScenePointer.clientX) && Number.isFinite(lastScenePointer.clientY)) {
    return {
      clientX: lastScenePointer.clientX,
      clientY: lastScenePointer.clientY
    };
  }

  const rect = renderer.domElement.getBoundingClientRect();
  return {
    clientX: rect.left + rect.width * 0.5,
    clientY: rect.top + rect.height * 0.5
  };
}

function captureObjectTransform(object) {
  return {
    position: object.position.clone(),
    quaternion: object.quaternion.clone(),
    scale: object.scale.clone()
  };
}

function applyObjectTransformSnapshot(object, snapshot) {
  object.position.copy(snapshot.position);
  object.quaternion.copy(snapshot.quaternion);
  object.scale.copy(snapshot.scale);
  object.updateMatrixWorld(true);
}

function getWorldAxisVector(axis) {
  if (axis === 'x') {
    return new THREE.Vector3(1, 0, 0);
  }
  if (axis === 'y') {
    return new THREE.Vector3(0, 1, 0);
  }
  return new THREE.Vector3(0, 0, 1);
}

function getWorldUnitsPerPixelAt(object) {
  const rect = renderer.domElement.getBoundingClientRect();
  const height = Math.max(1, rect.height);
  if (camera.isPerspectiveCamera) {
    const distance = Math.max(0.05, camera.position.distanceTo(object.position));
    return (2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5)) / height;
  }
  if (camera.isOrthographicCamera) {
    return Math.abs(camera.top - camera.bottom) / Math.max(1, camera.zoom) / height;
  }
  return 0.01;
}

function getViewPlaneDelta(object, dx, dy) {
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
  const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize();
  const unitsPerPixel = getWorldUnitsPerPixelAt(object);
  return right.multiplyScalar(dx * unitsPerPixel).add(up.multiplyScalar(-dy * unitsPerPixel));
}

function getAxisScreenDelta(object, axis, dx, dy) {
  const axisVector = getWorldAxisVector(axis);
  const rect = renderer.domElement.getBoundingClientRect();
  const origin = object.position.clone();
  const originScreen = origin.clone().project(camera);
  const axisScreen = origin.clone().add(axisVector).project(camera);
  const sx = ((axisScreen.x - originScreen.x) * rect.width) / 2;
  const sy = (-(axisScreen.y - originScreen.y) * rect.height) / 2;
  const pixelsPerWorldUnit = Math.hypot(sx, sy);

  if (!Number.isFinite(pixelsPerWorldUnit) || pixelsPerWorldUnit < 0.001) {
    return getViewPlaneDelta(object, dx, dy).projectOnVector(axisVector);
  }

  const screenX = sx / pixelsPerWorldUnit;
  const screenY = sy / pixelsPerWorldUnit;
  const units = dx * screenX + dy * screenY;
  return axisVector.multiplyScalar(units / pixelsPerWorldUnit);
}

function getConstrainedMoveDelta(object, dx, dy) {
  if (transformAxisConstraint?.mode === 'only') {
    return getAxisScreenDelta(object, transformAxisConstraint.axis, dx, dy);
  }

  const delta = getViewPlaneDelta(object, dx, dy);
  if (transformAxisConstraint?.mode === 'lock') {
    const axisVector = getWorldAxisVector(transformAxisConstraint.axis);
    delta.addScaledVector(axisVector, -delta.dot(axisVector));
  }
  return delta;
}

function getModalRotationAxis() {
  if (transformAxisConstraint?.mode === 'only') {
    return getWorldAxisVector(transformAxisConstraint.axis);
  }
  return camera.getWorldDirection(new THREE.Vector3()).normalize();
}

function getModalScaleVector(dx, dy) {
  const factor = THREE.MathUtils.clamp(Math.exp((dx - dy) * 0.006), 0.02, 50);
  const scale = modalTransform.start.scale.clone();

  if (transformAxisConstraint?.mode === 'only') {
    scale[transformAxisConstraint.axis] *= factor;
    return scale;
  }
  if (transformAxisConstraint?.mode === 'lock') {
    ['x', 'y', 'z'].forEach((axis) => {
      if (axis !== transformAxisConstraint.axis) {
        scale[axis] *= factor;
      }
    });
    return scale;
  }

  return scale.multiplyScalar(factor);
}

function syncModalTransformToSelection({ final = false } = {}) {
  if (selectedCameraBezierHandle) {
    commitSelectedBezierHandleTransform();
    updateCameraPathCurve();
    setCameraPreviewDirty();
    return;
  }

  if (selectedImageSplat) {
    commitSelectedImageSplatTransform();
    return;
  }

  if (selectedVideoPlaneId) {
    commitSelectedVideoPlaneTransform();
    if (final) {
      renderVideoPlaneList();
    }
    return;
  }

  if (selectedLightId) {
    commitSelectedLightTransform();
    if (final) {
      syncLightUi();
    }
    return;
  }

  if (selectedKeyframeId) {
    const keyframe = commitSelectedKeyframeTransform();
    if (keyframe) {
      updateSelectedCameraMarkerFromKeyframe(keyframe);
      updateCameraPathCurve();
      setCameraPreviewDirty();
    }
    return;
  }

  if (transformControls.object === activeModelTransformRoot && selectedSceneModelId) {
    commitSelectedSceneModelTransform();
    if (final) {
      renderSceneModelList();
    }
  }
}

function getModalTransformLabel() {
  const modeLabel = modalTransform?.mode === 'rotate' ? 'Rotate' : modalTransform?.mode === 'scale' ? 'Scale' : 'Move';
  if (!transformAxisConstraint) {
    return `${modeLabel}: move mouse, click to confirm, Esc/right-click to cancel`;
  }
  const axis = TRANSFORM_AXIS_LABELS[transformAxisConstraint.axis];
  return transformAxisConstraint.mode === 'lock'
    ? `${modeLabel}: locked ${axis}`
    : `${modeLabel}: ${axis} axis`;
}

function applyModalTransform(clientX, clientY) {
  if (!modalTransform?.object) {
    return;
  }

  const dx = clientX - modalTransform.startClientX;
  const dy = clientY - modalTransform.startClientY;
  const object = modalTransform.object;
  applyObjectTransformSnapshot(object, modalTransform.start);

  if (modalTransform.mode === 'translate') {
    object.position.copy(modalTransform.start.position).add(getConstrainedMoveDelta(object, dx, dy));
  } else if (modalTransform.mode === 'rotate') {
    const axis = getModalRotationAxis();
    const angle = (dx - dy) * 0.008;
    const rotation = new THREE.Quaternion().setFromAxisAngle(axis, angle);
    object.quaternion.copy(rotation.multiply(modalTransform.start.quaternion)).normalize();
  } else if (modalTransform.mode === 'scale') {
    object.scale.copy(getModalScaleVector(dx, dy));
  }

  object.updateMatrixWorld(true);
  syncModalTransformToSelection();
  setStatus(getModalTransformLabel());
}

function beginModalTransform(mode, event = null) {
  if (modalTransform) {
    finishModalTransform(true);
  }

  const target = getTransformShortcutTarget();
  const actualMode = setTransformModeForSelection(mode);
  if (!actualMode) {
    return false;
  }

  const object = getTransformShortcutObject(target);
  if (!object) {
    return false;
  }

  const startPointer = getScenePointerStart(event);
  recordUndoStep(actualMode === 'translate' ? 'Move object' : actualMode === 'rotate' ? 'Rotate object' : 'Scale object');
  modalTransform = {
    mode: actualMode,
    target,
    object,
    start: captureObjectTransform(object),
    startClientX: startPointer.clientX,
    startClientY: startPointer.clientY,
    previousTransformControlsEnabled: transformControls.enabled,
    pointerDown: false,
    pointerMoved: false
  };
  orbit.enabled = false;
  transformControls.enabled = false;
  setStatus(getModalTransformLabel());
  return true;
}

function finishModalTransform(confirm = true) {
  if (!modalTransform) {
    return;
  }

  const activeModal = modalTransform;
  if (!confirm) {
    applyObjectTransformSnapshot(activeModal.object, activeModal.start);
    syncModalTransformToSelection({ final: true });
  } else {
    syncModalTransformToSelection({ final: true });
  }

  modalTransform = null;
  orbit.enabled = true;
  transformControls.enabled = activeModal.previousTransformControlsEnabled;
  resetTransformAxisConstraint(false);
  setStatus(confirm ? 'Transform applied' : 'Transform cancelled');
}

function handleModalTransformPointerMove(event) {
  updateLastScenePointer(event);
  if (!modalTransform) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  const moved = Math.hypot(
    event.clientX - modalTransform.startClientX,
    event.clientY - modalTransform.startClientY
  );
  modalTransform.pointerMoved = modalTransform.pointerMoved || moved > 1.5;
  applyModalTransform(event.clientX, event.clientY);
}

function handleModalTransformPointerDown(event) {
  updateLastScenePointer(event);
  if (!modalTransform) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  if (event.button === 2) {
    finishModalTransform(false);
    return;
  }
  if (event.button === 0) {
    modalTransform.pointerDown = true;
  }
}

function handleModalTransformPointerUp(event) {
  updateLastScenePointer(event);
  if (!modalTransform) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  if (event.button === 0) {
    finishModalTransform(true);
  }
}

function createParticleLightingUniforms() {
  return {
    uParticleAmbient: { value: baseLightIntensities.ambient },
    uParticleLightCount: { value: 0 },
    uParticleLightType: { value: new Array(MAX_PARTICLE_SHADER_LIGHTS).fill(0) },
    uParticleLightPosition: {
      value: Array.from({ length: MAX_PARTICLE_SHADER_LIGHTS }, () => new THREE.Vector3())
    },
    uParticleLightDirection: {
      value: Array.from({ length: MAX_PARTICLE_SHADER_LIGHTS }, () => new THREE.Vector3(0, 0, -1))
    },
    uParticleLightColor: {
      value: Array.from({ length: MAX_PARTICLE_SHADER_LIGHTS }, () => new THREE.Color(0, 0, 0))
    },
    uParticleLightIntensity: { value: new Array(MAX_PARTICLE_SHADER_LIGHTS).fill(0) },
    uParticleLightSize: { value: new Array(MAX_PARTICLE_SHADER_LIGHTS).fill(1) },
    uParticleLightAngle: { value: new Array(MAX_PARTICLE_SHADER_LIGHTS).fill(0.8) }
  };
}

const uniforms = {
  uTime: { value: 0 },
  uPixelRatio: { value: studioPixelRatio },
  uPointSize: { value: state.pointSize },
  uEdgeFeather: { value: state.edgeFeather },
  uSizeRandom: { value: state.sizeRandom },
  uGlowRadius: { value: state.glowRadius },
  uGlowExposure: { value: state.glowExposure },
  uParticleizeProgress: { value: state.particleizeProgress },
  uModelVisibility: { value: state.modelVisibility },
  uSpread: { value: state.spread },
  uNoise: { value: state.noise },
  uNoiseScale: { value: state.noiseScale },
  uSwirl: { value: state.swirl },
  uDissolve: { value: state.dissolve },
  uDissolveSpread: { value: state.dissolveSpread },
  uDissolveEdgeWidth: { value: state.dissolveEdgeWidth },
  uDissolveTurbulence: { value: state.dissolveTurbulence },
  uDissolveCurl: { value: state.dissolveCurl },
  uDissolveMist: { value: state.dissolveMist },
  uDissolveDirection: { value: new THREE.Vector3(state.dissolveDirectionX, state.dissolveDirectionY, state.dissolveDirectionZ) },
  uDissolveLift: { value: state.dissolveLift },
  uGrowth: { value: state.growth },
  uGrowthFlow: { value: state.growthFlow },
  uGrowthWidth: { value: state.growthWidth },
  uGrowthTurbulence: { value: state.growthTurbulence },
  uOrganicFlow: { value: state.organicFlow },
  uEdgeBreak: { value: state.edgeBreak },
  uFilamentLength: { value: state.filamentLength },
  uFilamentCurl: { value: state.filamentCurl },
  uMorphMode: { value: state.effectMode === 'morph' ? 1 : 0 },
  uMorphReady: { value: 0 },
  uMorphProgress: { value: state.morphProgress },
  uMorphFlow: { value: state.morphFlow },
  uMorphScatter: { value: state.morphScatter },
  uMorphTurbulence: { value: state.morphTurbulence },
  uMorphTrail: { value: state.morphTrail },
  uMorphDirection: { value: new THREE.Vector3(state.morphDirX, state.morphDirY, state.morphDirZ) },
  uUseTexture: { value: state.useTexture ? 1 : 0 },
  uColorA: { value: new THREE.Color(state.colorA) },
  uColorB: { value: new THREE.Color(state.colorB) },
  ...createParticleLightingUniforms()
};
uniforms.uGlowPass = { value: 0 };
const glowUniforms = { ...uniforms, uGlowPass: { value: 1 } };

const screenVertexShader = `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const blurMaterial = new THREE.ShaderMaterial({
  uniforms: {
    uTexture: { value: null },
    uDirection: { value: new THREE.Vector2(1, 0) },
    uTexelSize: { value: new THREE.Vector2(1 / glowTarget.width, 1 / glowTarget.height) },
    uRadius: { value: 1 }
  },
  depthTest: false,
  depthWrite: false,
  toneMapped: false,
  vertexShader: screenVertexShader,
  fragmentShader: `
    uniform sampler2D uTexture;
    uniform vec2 uDirection;
    uniform vec2 uTexelSize;
    uniform float uRadius;

    varying vec2 vUv;

    void main() {
      vec2 stepOffset = uDirection * uTexelSize * max(uRadius, 0.001);
      vec4 color = texture2D(uTexture, vUv) * 0.227027;
      color += texture2D(uTexture, vUv + stepOffset * 1.384615) * 0.316216;
      color += texture2D(uTexture, vUv - stepOffset * 1.384615) * 0.316216;
      color += texture2D(uTexture, vUv + stepOffset * 3.230769) * 0.070270;
      color += texture2D(uTexture, vUv - stepOffset * 3.230769) * 0.070270;
      gl_FragColor = color;
    }
  `
});

const compositeMaterial = new THREE.ShaderMaterial({
  uniforms: {
    uBaseTexture: { value: sceneTarget.texture },
    uBloomTexture: { value: blurTargetA.texture },
    uDepthTexture: { value: sceneTarget.depthTexture },
    uBloomStrength: { value: 1 },
    uBloomAlpha: { value: 1 },
    uToneExposure: { value: renderer.toneMappingExposure },
    uTransparentOutput: { value: exportSettings.transparent ? 1 : 0 },
    uDofEnabled: { value: 0 },
    uCameraNear: { value: camera.near },
    uCameraFar: { value: camera.far },
    uFocusDistance: { value: state.cameraFocusDistance },
    uAperture: { value: state.cameraAperture },
    uFocalLength: { value: state.cameraFocalLength },
    uResolution: { value: new THREE.Vector2(drawingSize.width, drawingSize.height) }
  },
  depthTest: false,
  depthWrite: false,
  vertexShader: screenVertexShader,
  fragmentShader: `
    uniform sampler2D uBaseTexture;
    uniform sampler2D uBloomTexture;
    uniform sampler2D uDepthTexture;
    uniform float uBloomStrength;
    uniform float uBloomAlpha;
    uniform float uToneExposure;
    uniform float uTransparentOutput;
    uniform float uDofEnabled;
    uniform float uCameraNear;
    uniform float uCameraFar;
    uniform float uFocusDistance;
    uniform float uAperture;
    uniform float uFocalLength;
    uniform vec2 uResolution;

    varying vec2 vUv;

    const mat3 PMS_LINEAR_REC2020_TO_LINEAR_SRGB = mat3(
      vec3(1.6605, -0.1246, -0.0182),
      vec3(-0.5876, 1.1329, -0.1006),
      vec3(-0.0728, -0.0083, 1.1187)
    );

    const mat3 PMS_LINEAR_SRGB_TO_LINEAR_REC2020 = mat3(
      vec3(0.6274, 0.0691, 0.0164),
      vec3(0.3293, 0.9195, 0.0880),
      vec3(0.0433, 0.0113, 0.8956)
    );

    vec3 pmsAgxDefaultContrastApprox(vec3 x) {
      vec3 x2 = x * x;
      vec3 x4 = x2 * x2;
      return 15.5 * x4 * x2
        - 40.14 * x4 * x
        + 31.96 * x4
        - 6.868 * x2 * x
        + 0.4298 * x2
        + 0.1191 * x
        - 0.00232;
    }

    vec3 pmsAgxToneMap(vec3 color) {
      const mat3 AgXInsetMatrix = mat3(
        vec3(0.856627153315983, 0.137318972929847, 0.11189821299995),
        vec3(0.0951212405381588, 0.761241990602591, 0.0767994186031903),
        vec3(0.0482516061458583, 0.101439036467562, 0.811302368396859)
      );
      const mat3 AgXOutsetMatrix = mat3(
        vec3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826),
        vec3(-0.11060664309660323, 1.157823702216272, -0.11060664309660294),
        vec3(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405)
      );
      const float AgxMinEv = -12.47393;
      const float AgxMaxEv = 4.026069;
      color *= uToneExposure;
      color = PMS_LINEAR_SRGB_TO_LINEAR_REC2020 * color;
      color = AgXInsetMatrix * color;
      color = max(color, 1e-10);
      color = log2(color);
      color = (color - AgxMinEv) / (AgxMaxEv - AgxMinEv);
      color = clamp(color, 0.0, 1.0);
      color = pmsAgxDefaultContrastApprox(color);
      color = AgXOutsetMatrix * color;
      color = pow(max(vec3(0.0), color), vec3(2.2));
      color = PMS_LINEAR_REC2020_TO_LINEAR_SRGB * color;
      return clamp(color, 0.0, 1.0);
    }

    vec3 linearToSrgb(vec3 value) {
      vec3 low = value * 12.92;
      vec3 high = 1.055 * pow(max(value, 0.0), vec3(1.0 / 2.4)) - 0.055;
      return mix(low, high, step(vec3(0.0031308), value));
    }

    float perspectiveDepthToViewZ(float invClipZ, float nearValue, float farValue) {
      return (nearValue * farValue) / ((farValue - nearValue) * invClipZ - farValue);
    }

    float viewDistanceAt(vec2 uv) {
      float depth = texture2D(uDepthTexture, clamp(uv, vec2(0.0), vec2(1.0))).x;
      if (depth >= 0.999999) {
        return uCameraFar;
      }
      return max(-perspectiveDepthToViewZ(depth, uCameraNear, uCameraFar), 0.001);
    }

    float depthCircleOfConfusion(float viewDistance) {
      float focusDistance = max(uFocusDistance, 0.05);
      float focusError = abs(viewDistance - focusDistance);
      float focusHold = max(0.035, focusDistance * (0.035 + clamp(uAperture, 1.2, 22.0) * 0.006));
      float normalizedError = max(focusError - focusHold, 0.0) / max(focusDistance, 0.1);
      float apertureStrength = clamp(1.65 / max(uAperture, 1.2), 0.075, 1.35);
      float focalStrength = clamp(uFocalLength / 45.0, 0.28, 4.2);
      return clamp(normalizedError * apertureStrength * focalStrength * 3.0, 0.0, 1.0);
    }

    vec4 sampleDepthOfField(vec2 uv) {
      vec4 center = texture2D(uBaseTexture, uv);
      if (uDofEnabled < 0.5) {
        return center;
      }

      float viewDistance = viewDistanceAt(uv);
      float coc = depthCircleOfConfusion(viewDistance);
      vec2 texel = 1.0 / max(uResolution, vec2(2.0));
      float focusBlend = smoothstep(0.018, 0.32, coc);
      if (focusBlend <= 0.001) {
        return center;
      }

      float maxRadiusPixels = clamp(min(uResolution.x, uResolution.y) * 0.045, 4.0, 22.0);
      vec2 radius = texel * (maxRadiusPixels * smoothstep(0.0, 1.0, coc));
      vec4 accum = center * 1.15;
      float totalWeight = 1.15;
      const float GOLDEN_ANGLE = 2.39996323;

      for (int i = 0; i < 24; i++) {
        float fi = float(i) + 0.5;
        float ring = sqrt(fi / 24.0);
        float angle = fi * GOLDEN_ANGLE;
        vec2 disk = vec2(cos(angle), sin(angle)) * ring;
        vec2 sampleUv = clamp(uv + disk * radius, texel * 0.5, vec2(1.0) - texel * 0.5);
        float sampleDistance = viewDistanceAt(sampleUv);
        float sampleCoc = depthCircleOfConfusion(sampleDistance);
        float sampleBlur = max(coc, sampleCoc);
        float focusWeight = smoothstep(0.025, 0.34, sampleBlur);
        float foregroundGuard = sampleDistance + 0.025 < viewDistance
          ? smoothstep(0.04, 0.55, sampleCoc + coc * 0.55)
          : 1.0;
        float edgeWeight = mix(1.08, 0.72, ring);
        float weight = mix(0.26, 1.0, focusWeight) * foregroundGuard * edgeWeight;
        vec4 sampleColor = texture2D(uBaseTexture, sampleUv);
        float highlight = smoothstep(0.58, 1.35, max(max(sampleColor.r, sampleColor.g), sampleColor.b));
        sampleColor.rgb *= 1.0 + highlight * coc * 0.08;
        accum += sampleColor * weight;
        totalWeight += weight;
      }

      vec4 blurred = accum / max(totalWeight, 0.0001);
      return mix(center, blurred, focusBlend);
    }

    void main() {
      vec4 base = sampleDepthOfField(vUv);
      vec4 bloom = texture2D(uBloomTexture, vUv);
      bloom.rgb = max(bloom.rgb - vec3(0.0012), vec3(0.0));
      bloom.a = max(bloom.a - 0.001, 0.0);
      float bloomEnergy = max(max(bloom.r, bloom.g), bloom.b);
      float bloomMask = smoothstep(0.0, 0.008, bloomEnergy);
      bloom *= bloomMask;
      vec3 color = base.rgb + bloom.rgb * uBloomStrength;
      float alpha = max(base.a, bloom.a * uBloomAlpha);
      alpha = mix(1.0, alpha, uTransparentOutput);
      color = linearToSrgb(pmsAgxToneMap(color));
      gl_FragColor = vec4(color, alpha);
    }
  `
});

const postScene = new THREE.Scene();
const postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const postQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), compositeMaterial);
postQuad.frustumCulled = false;
postScene.add(postQuad);

const panoramaMaterial = new THREE.ShaderMaterial({
  uniforms: {
    uCubeTexture: { value: null },
    uTransparentOutput: { value: exportSettings.transparent ? 1 : 0 }
  },
  depthTest: false,
  depthWrite: false,
  toneMapped: false,
  vertexShader: screenVertexShader,
  fragmentShader: `
    uniform samplerCube uCubeTexture;
    uniform float uTransparentOutput;
    varying vec2 vUv;

    const float PI = 3.141592653589793;

    void main() {
      float longitude = (vUv.x * 2.0 - 1.0) * PI;
      float latitude = (vUv.y - 0.5) * PI;
      float cosLatitude = cos(latitude);
      vec3 direction = normalize(vec3(
        sin(longitude) * cosLatitude,
        sin(latitude),
        -cos(longitude) * cosLatitude
      ));
      vec4 color = textureCube(uCubeTexture, direction);
      color.a = mix(1.0, color.a, uTransparentOutput);
      gl_FragColor = color;
    }
  `
});

const panoramaResources = new WeakMap();

function getPanoramaResources(targetRenderer, outputHeight = 1024) {
  const requestedFaceSize = THREE.MathUtils.clamp(Math.ceil(Number(outputHeight) / 2), 256, 1536);
  let resources = panoramaResources.get(targetRenderer);
  if (!resources) {
    const target = new THREE.WebGLCubeRenderTarget(requestedFaceSize, {
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false,
      depthBuffer: true
    });
    target.texture.name = 'particle-panorama-cube';
    resources = {
      target,
      camera: new THREE.CubeCamera(camera.near, camera.far, target),
      faceSize: requestedFaceSize
    };
    panoramaResources.set(targetRenderer, resources);
  } else if (resources.faceSize !== requestedFaceSize) {
    resources.target.setSize(requestedFaceSize);
    resources.faceSize = requestedFaceSize;
  }
  return resources;
}

function renderPanoramaFor(targetRenderer, poseCamera, options = {}) {
  const outputTarget = options.outputTarget ?? targetRenderer.getRenderTarget();
  const width = Math.max(2, Math.round(Number(options.width) || 2048));
  const height = Math.max(2, Math.round(Number(options.height) || width / 2));
  const transparent = options.transparent ?? exportSettings.transparent;
  const viewport = options.viewport || null;
  const resources = getPanoramaResources(targetRenderer, height);
  const previousTarget = targetRenderer.getRenderTarget();
  const previousClearColor = new THREE.Color();
  const previousAlpha = targetRenderer.getClearAlpha();
  const previousViewport = new THREE.Vector4();
  const previousScissor = new THREE.Vector4();
  const previousScissorTest = targetRenderer.getScissorTest?.() || false;
  const previousPostMaterial = postQuad.material;
  targetRenderer.getClearColor(previousClearColor);
  targetRenderer.getViewport(previousViewport);
  targetRenderer.getScissor(previousScissor);

  resources.camera.near = poseCamera.near;
  resources.camera.far = poseCamera.far;
  resources.camera.position.copy(poseCamera.position);
  resources.camera.quaternion.copy(poseCamera.quaternion).normalize();
  resources.camera.updateMatrixWorld(true);
  resources.camera.update(targetRenderer, scene);

  panoramaMaterial.uniforms.uCubeTexture.value = resources.target.texture;
  panoramaMaterial.uniforms.uTransparentOutput.value = transparent ? 1 : 0;
  postQuad.material = panoramaMaterial;
  targetRenderer.setRenderTarget(outputTarget);
  if (outputTarget) {
    setFullTargetViewport(targetRenderer, outputTarget);
  } else if (viewport) {
    targetRenderer.setViewport(viewport.x, viewport.y, viewport.width, viewport.height);
    targetRenderer.setScissor(viewport.x, viewport.y, viewport.width, viewport.height);
    targetRenderer.setScissorTest(true);
  } else {
    targetRenderer.setViewport(0, 0, width, height);
    targetRenderer.setScissor(0, 0, width, height);
    targetRenderer.setScissorTest(false);
  }
  targetRenderer.setClearColor(0x090a0c, transparent ? 0 : 1);
  targetRenderer.clear(true, true, true);
  targetRenderer.render(postScene, postCamera);

  postQuad.material = previousPostMaterial;
  targetRenderer.setRenderTarget(previousTarget);
  targetRenderer.setViewport(previousViewport);
  targetRenderer.setScissor(previousScissor);
  targetRenderer.setScissorTest(previousScissorTest);
  targetRenderer.setClearColor(previousClearColor, previousAlpha);
}

const particleMaterial = new THREE.ShaderMaterial({
  uniforms,
  transparent: true,
  depthTest: true,
  depthWrite: true,
  blending: THREE.NormalBlending,
  vertexShader: `
    attribute vec3 aNormal;
    attribute vec3 aOffset;
    attribute vec3 aParticleColor;
    attribute float aSeed;
    attribute float aMix;
    attribute float aTextureWeight;
    attribute float aGrowthOrder;
    attribute float aFilament;
    attribute vec3 aFlowStart;
    attribute vec3 aMorphTarget;
    attribute vec3 aMorphColor;
    attribute float aMorphTextureWeight;

    uniform float uTime;
    uniform float uPixelRatio;
    uniform float uPointSize;
    uniform float uEdgeFeather;
    uniform float uSizeRandom;
    uniform float uParticleizeProgress;
    uniform float uSpread;
    uniform float uNoise;
    uniform float uNoiseScale;
    uniform float uSwirl;
    uniform float uDissolve;
    uniform float uDissolveSpread;
    uniform float uDissolveEdgeWidth;
    uniform float uDissolveTurbulence;
    uniform float uDissolveCurl;
    uniform float uDissolveMist;
    uniform vec3 uDissolveDirection;
    uniform float uDissolveLift;
    uniform float uGrowth;
    uniform float uGrowthFlow;
    uniform float uGrowthWidth;
    uniform float uGrowthTurbulence;
    uniform float uOrganicFlow;
    uniform float uEdgeBreak;
    uniform float uFilamentLength;
    uniform float uFilamentCurl;
    uniform float uMorphMode;
    uniform float uMorphReady;
    uniform float uMorphProgress;
    uniform float uMorphFlow;
    uniform float uMorphScatter;
    uniform float uMorphTurbulence;
    uniform float uMorphTrail;
    uniform vec3 uMorphDirection;
    uniform float uGlowRadius;
    uniform float uGlowExposure;
    uniform float uModelVisibility;
    uniform float uGlowPass;
    uniform float uUseTexture;
    uniform vec3 uColorA;
    uniform vec3 uColorB;
    #define MAX_PARTICLE_LIGHTS 8
    uniform float uParticleAmbient;
    uniform float uParticleLightCount;
    uniform float uParticleLightType[MAX_PARTICLE_LIGHTS];
    uniform vec3 uParticleLightPosition[MAX_PARTICLE_LIGHTS];
    uniform vec3 uParticleLightDirection[MAX_PARTICLE_LIGHTS];
    uniform vec3 uParticleLightColor[MAX_PARTICLE_LIGHTS];
    uniform float uParticleLightIntensity[MAX_PARTICLE_LIGHTS];
    uniform float uParticleLightSize[MAX_PARTICLE_LIGHTS];
    uniform float uParticleLightAngle[MAX_PARTICLE_LIGHTS];

    varying vec3 vColor;
    varying float vAlpha;
    varying float vCoreRadius;
    varying float vGlowSeed;

    mat2 rotate2d(float angle) {
      float s = sin(angle);
      float c = cos(angle);
      return mat2(c, -s, s, c);
    }

    float wave(vec3 p, float seed) {
      return sin(dot(p, vec3(1.71, 2.47, 1.19)) + uTime * 1.35 + seed * 6.28318);
    }

    float blobNoise(vec3 p) {
      float a = sin(p.x * 1.45 + sin(p.y * 1.1) + p.z * 0.62);
      float b = sin(p.y * 1.7 + cos(p.z * 1.25) + p.x * 0.58);
      float c = sin(p.z * 1.32 + sin(p.x * 1.18) + p.y * 0.72);
      float d = sin(dot(p, vec3(1.9, 1.15, 1.45)) + sin(p.x + p.y));
      return (a + b + c + d) * 0.25;
    }

    vec3 applyParticleLights(vec3 baseColor, vec3 worldPosition, vec3 worldNormal, float emissiveMix) {
      vec3 n = normalize(worldNormal);
      vec3 lit = baseColor * max(uParticleAmbient * 0.78, 0.06);

      for (int i = 0; i < MAX_PARTICLE_LIGHTS; i++) {
        float lightEnabled = step(float(i) + 0.5, uParticleLightCount);
        float type = uParticleLightType[i];
        float intensity = max(uParticleLightIntensity[i], 0.0) * lightEnabled;
        vec3 lightColor = uParticleLightColor[i];
        float diffuse = 0.0;
        float attenuation = 1.0;

        if (type < 0.5) {
          vec3 delta = uParticleLightPosition[i] - worldPosition;
          float dist = max(length(delta), 0.001);
          vec3 l = delta / dist;
          diffuse = pow(max(dot(n, l) * 0.5 + 0.5, 0.0), 1.35);
          float range = max(1.0, 4.0 + uParticleLightSize[i] * 6.0);
          attenuation = 1.0 / (1.0 + (dist * dist) / (range * range));
        } else if (type < 1.5) {
          vec3 l = normalize(uParticleLightDirection[i]);
          diffuse = pow(max(dot(n, l) * 0.5 + 0.5, 0.0), 1.28);
        } else if (type < 2.5) {
          vec3 fromLight = worldPosition - uParticleLightPosition[i];
          float dist = max(length(fromLight), 0.001);
          vec3 coneDir = normalize(uParticleLightDirection[i]);
          float cone = dot(normalize(fromLight), coneDir);
          float outer = cos(max(uParticleLightAngle[i], 0.03));
          float inner = cos(max(uParticleLightAngle[i] * 0.72, 0.02));
          float spotMask = smoothstep(outer, inner, cone);
          vec3 l = -fromLight / dist;
          diffuse = pow(max(dot(n, l) * 0.5 + 0.5, 0.0), 1.34) * spotMask;
          float range = max(1.4, 4.0 + uParticleLightSize[i] * 5.0);
          attenuation = spotMask / (1.0 + (dist * dist) / (range * range));
        } else {
          vec3 delta = uParticleLightPosition[i] - worldPosition;
          float dist = max(length(delta), 0.001);
          vec3 l = delta / dist;
          diffuse = pow(max(dot(n, l) * 0.5 + 0.5, 0.0), 1.32);
          float range = max(1.6, 5.0 + uParticleLightSize[i] * 4.0);
          attenuation = 1.0 / (1.0 + (dist * dist) / (range * range));
        }

        float sunMask = step(0.5, type) * (1.0 - step(1.5, type));
        float lightScale = mix(0.13, 0.82, sunMask);
        lit += baseColor * lightColor * diffuse * attenuation * intensity * lightScale;
      }

      vec3 emissiveColor = baseColor * (0.95 + emissiveMix * 0.48);
      return mix(lit, emissiveColor, clamp(emissiveMix, 0.0, 0.86));
    }

    void main() {
      vec3 p = position;
      vec3 surfacePosition = position;
      float pulse = wave(p, aSeed);
      float noiseSize = max(uNoiseScale, 0.01);
      vec3 q = p / noiseSize + aSeed * 0.07;
      float blob = blobNoise(q + vec3(uTime * 0.09, -uTime * 0.06, uTime * 0.045));
      float blobFine = blobNoise(q * 2.15 + vec3(1.7, 0.4, 2.2)) * 0.34;
      float lumpyNoise = blob + blobFine;
      vec3 field = vec3(
        sin(q.y * 1.7 + uTime * 1.2 + aSeed * 3.1),
        cos(q.z * 1.55 + uTime * 1.05 + aSeed * 2.4),
        sin(q.x * 1.65 + uTime * 0.95 + aSeed * 4.2)
      );
      field += normalize(aNormal + vec3(lumpyNoise)) * lumpyNoise;

      float morphMode = clamp(uMorphMode * uMorphReady, 0.0, 1.0);
      float particleize = clamp(uParticleizeProgress, 0.0, 1.0);
      vec3 morphDirection = uMorphDirection;
      if (length(morphDirection) < 0.001) {
        morphDirection = vec3(0.25, 0.35, -0.12);
      }
      morphDirection = normalize(morphDirection);
      float directionalOrder = clamp(dot(normalize(position + vec3(0.0001)), morphDirection) * 0.28 + 0.5, 0.0, 1.0);
      float morphOrder = clamp(aGrowthOrder * 0.48 + directionalOrder * 0.24 + aSeed * 0.22 + aMix * 0.06, 0.0, 1.0);
      float particleizeOrder = clamp(aGrowthOrder * 0.72 + directionalOrder * 0.1 + aMix * 0.08 + aSeed * 0.1 - 0.035, 0.0, 1.0);
      float particleizeWidth = 0.18;
      float particleizeLocal = (particleize - particleizeOrder + particleizeWidth) / max(particleizeWidth * 2.0, 0.001);
      float particleizeReveal = particleize >= 0.999 ? 1.0 : smoothstep(0.0, 1.0, clamp(particleizeLocal, 0.0, 1.0));
      float particleizeHead = smoothstep(0.12, 0.42, particleizeLocal) * (1.0 - smoothstep(0.62, 0.95, particleizeLocal));
      float particleizeAlpha = particleize <= 0.0001 ? 0.0 : particleizeReveal;
      float morphTrail = max(uMorphTrail, 0.035);
      float morphLocal = clamp((uMorphProgress - morphOrder * (1.0 - morphTrail)) / morphTrail, 0.0, 1.0);
      float morphEase = smoothstep(0.0, 1.0, morphLocal);
      float morphBand = smoothstep(0.04, 0.24, morphLocal) * (1.0 - smoothstep(0.72, 1.0, morphLocal));
      float morphRibbon = pow(max(0.0, sin(morphEase * 3.14159265)), 1.45) * (0.35 + morphBand * 0.65);
      vec3 morphDelta = aMorphTarget - position;
      vec3 morphSide = cross(normalize(morphDelta + vec3(0.0001, 0.001, 0.0002)), vec3(0.0, 1.0, 0.0));
      if (length(morphSide) < 0.001) {
        morphSide = normalize(cross(normalize(morphDelta + vec3(0.001, 0.0001, 0.0002)), vec3(1.0, 0.0, 0.0)));
      }
      vec3 morphLift = normalize(morphDirection * 0.64 + field * (0.16 + uMorphTurbulence * 0.12) + aOffset * 0.34 + morphSide * 0.26);
      float travel = length(morphDelta);
      vec3 morphMid = mix(position, aMorphTarget, 0.5) +
        morphLift * uMorphScatter * (0.06 + aSeed * 0.34 + min(travel, 4.0) * 0.045) * (0.55 + uMorphFlow * 0.18);
      morphMid += morphDirection * (0.04 + uMorphFlow * 0.07) * morphRibbon;
      vec3 morphA = mix(position, morphMid, smoothstep(0.02, 0.52, morphEase));
      vec3 morphB = mix(morphMid, aMorphTarget, smoothstep(0.48, 1.0, morphEase));
      vec3 morphPosition = mix(morphA, morphB, smoothstep(0.18, 0.82, morphEase));
      morphPosition += field * uMorphTurbulence * morphRibbon * (0.032 + uMorphScatter * 0.032);
      morphPosition += morphSide * sin(uTime * (0.72 + uMorphFlow * 0.56) + aSeed * 14.0) * morphRibbon * uMorphTurbulence * 0.032;

      float organicFlow = clamp(uOrganicFlow, 0.0, 1.0);
      float filamentNoise = sin(aSeed * 91.0 + position.x * 4.7 + position.y * 2.9 + position.z * 3.6) * 0.5 + 0.5;
      float filamentMask = smoothstep(0.34, 0.96, aFilament + uEdgeBreak * 0.18 + filamentNoise * 0.16) * organicFlow;
      float strandMask = filamentMask * (0.42 + smoothstep(0.58, 0.98, filamentNoise) * 0.58);
      vec3 filamentDirection = normalize(
        field * (0.82 + uFilamentCurl * 0.26) +
        aOffset * (0.55 + uEdgeBreak * 0.35) +
        aNormal * (0.28 + uEdgeBreak * 0.44) +
        vec3(0.0, 0.12 + organicFlow * 0.16, 0.0)
      );
      float spark = sin(aSeed * 48.0 + uTime * 6.0) * 0.5 + 0.5;
      float organicGrowthOrder = mix(
        aGrowthOrder,
        clamp(aGrowthOrder * 0.56 + aFilament * 0.34 + filamentNoise * 0.1, 0.0, 1.0),
        organicFlow
      );
      float localGrowth = (uGrowth - organicGrowthOrder) / max(uGrowthWidth, 0.035);
      float arrive = smoothstep(0.0, 1.0, clamp(localGrowth, 0.0, 1.0));
      float visible = smoothstep(-0.18, 0.08, localGrowth);
      float growHead = smoothstep(-0.04, 0.12, localGrowth) *
        (1.0 - smoothstep(0.48, 1.08, localGrowth));
      float completeGrowth = smoothstep(0.985, 1.0, uGrowth);
      vec3 flowDir = normalize(position - aFlowStart + field * (0.14 + uGrowthTurbulence * 0.16) + aNormal * 0.08);
      vec3 flowMid = mix(aFlowStart, position, 0.56) +
        normalize(aOffset + field * (0.18 + uGrowthTurbulence * 0.36) + vec3(0.0, 0.6, 0.0)) *
        (0.08 + uGrowthFlow * 0.22 + aSeed * (0.16 + uGrowthFlow * 0.18));
      flowMid += filamentDirection * strandMask * uFilamentLength * (0.1 + uGrowthFlow * 0.12 + filamentNoise * 0.18);
      vec3 firstLeg = mix(aFlowStart, flowMid, arrive);
      vec3 secondLeg = mix(flowMid, position, arrive);
      p = mix(firstLeg, secondLeg, arrive);
      p = mix(p, position, completeGrowth);
      arrive = mix(arrive, 1.0, completeGrowth);
      visible = mix(visible, 1.0, completeGrowth);
      growHead *= 1.0 - completeGrowth;

      float current = visible * (1.0 - arrive);
      p += normalize(field + aOffset * 0.45) * current * (0.055 + uNoise * 0.07) * (0.62 + uGrowthTurbulence * 0.58);
      p += flowDir * growHead * (0.045 + uGrowthFlow * (0.1 + aSeed * 0.16));
      p += field * sin(localGrowth * 6.28318 + uTime * 2.4 + aSeed * 5.0) * current *
        (0.012 + uGrowthTurbulence * 0.045);
      float silkGrowth = strandMask * (current + growHead * 0.72);
      p += filamentDirection * silkGrowth * uFilamentLength * (0.16 + filamentNoise * 0.36);
      p += field * silkGrowth * uFilamentCurl * (0.06 + aSeed * 0.12);

      vec3 organicSource = position
        - filamentDirection * strandMask * uFilamentLength * (0.18 + filamentNoise * 0.38)
        - field * uFilamentCurl * strandMask * (0.04 + aSeed * 0.12)
        + aNormal * filamentMask * uEdgeBreak * (0.03 + aSeed * 0.12);
      vec3 organicPosition = mix(organicSource, position, arrive);
      organicPosition += filamentDirection * strandMask * growHead * uFilamentLength * (0.18 + filamentNoise * 0.28);
      organicPosition += field * strandMask * (current + growHead) * uFilamentCurl * (0.045 + aSeed * 0.07);
      p = mix(p, organicPosition, organicFlow);

      p += aOffset * uSpread * arrive * (0.22 + aSeed * 0.78);
      float lumpAmplitude = uNoise * arrive * (0.5 + min(noiseSize, 6.0) * 0.12);
      p += normalize(aNormal + field * 0.35) * lumpyNoise * lumpAmplitude;
      p += field * uNoise * arrive * 0.08;
      p += aNormal * pulse * arrive * uNoise * 0.028;
      p += normalize(aNormal * 0.85 + aOffset * 0.34 + field * 0.16) *
        particleizeHead * (0.018 + uNoise * 0.035 + uSpread * 0.018);

      float dissolveAmount = clamp(uDissolve, 0.0, 1.0);
      float dissolveEdgeWidth = max(uDissolveEdgeWidth, 0.025);
      vec3 dissolveDirection = uDissolveDirection;
      if (length(dissolveDirection) < 0.001) {
        dissolveDirection = vec3(0.82, 0.18, -0.22);
      }
      dissolveDirection = normalize(dissolveDirection);
      float directionalDissolveOrder = clamp(
        dot(normalize(position + aNormal * 0.35 + vec3(0.0001)), dissolveDirection) * 0.32 + 0.5,
        0.0,
        1.0
      );
      float dissolveOrder = clamp(
        aGrowthOrder * 0.36 +
        directionalDissolveOrder * 0.28 +
        aMix * 0.18 +
        aSeed * 0.16 -
        aFilament * 0.08,
        0.0,
        1.0
      );
      float dissolveLocal = (dissolveAmount - dissolveOrder) / dissolveEdgeWidth;
      float dissolve = dissolveAmount <= 0.0001
        ? 0.0
        : smoothstep(0.0, 1.0, clamp(dissolveLocal, 0.0, 1.0));
      float dissolveEdge = dissolveAmount <= 0.0001
        ? 0.0
        : smoothstep(-0.42, 0.16, dissolveLocal) * (1.0 - smoothstep(0.78, 1.58, dissolveLocal));
      dissolveEdge *= 0.56 + filamentNoise * 0.44;
      float mistSeed = smoothstep(0.52, 0.98, aSeed + aFilament * 0.18 + filamentNoise * 0.12);
      float sheetMask = dissolveEdge * (0.34 + strandMask * 0.66) * (0.72 + filamentNoise * 0.28);
      float spraySeed = smoothstep(0.74, 1.0, aSeed * 0.72 + aFilament * 0.18 + filamentNoise * 0.2);
      float dissolveMistMask = clamp(uDissolveMist, 0.0, 1.0) *
        max(sheetMask * 0.62, dissolve * spraySeed * 0.24);
      float dissolvePulse = sin(uTime * (1.35 + uDissolveCurl * 0.24) + aSeed * 17.0 + position.y * 3.1) * 0.5 + 0.5;
      vec3 crossCurl = cross(dissolveDirection, normalize(aNormal + vec3(0.001, 0.002, 0.003)));
      if (length(crossCurl) < 0.001) {
        crossCurl = normalize(cross(dissolveDirection, vec3(0.0, 1.0, 0.0)));
      }
      vec3 dissolveCurlField = normalize(
        field * (0.56 + uDissolveTurbulence * 0.2) +
        crossCurl * (0.28 + uDissolveCurl * 0.22) +
        aOffset * (0.34 + dissolvePulse * 0.2)
      );
      vec3 sheetDir = normalize(
        filamentDirection * (0.68 + uFilamentCurl * 0.16) +
        dissolveCurlField * (0.48 + uDissolveCurl * 0.12) +
        crossCurl * 0.32 +
        dissolveDirection * 0.16
      );
      vec3 peelDir = normalize(
        dissolveDirection * 0.34 +
        aNormal * (0.46 + dissolveEdge * 0.32) +
        dissolveCurlField * uDissolveTurbulence * 0.34 +
        aOffset * (0.18 + dissolveMistMask * 0.2)
      );
      float dissolveSpread = max(uDissolveSpread, 0.0);
      float edgeTravel = dissolveSpread * sheetMask * (0.05 + mistSeed * 0.18);
      float sprayTravel = dissolveSpread * dissolve * spraySeed *
        (0.03 + clamp(dissolveLocal, 0.0, 1.3) * 0.055);
      p += peelDir * (edgeTravel + sprayTravel);
      p += sheetDir * sheetMask *
        (uFilamentLength * 0.46 + uDissolveCurl * 0.12 + dissolveSpread * 0.08) *
        (0.65 + mistSeed * 0.35);
      p += dissolveCurlField * uDissolveCurl * (sheetMask * 0.055 + dissolveMistMask * 0.08);
      float spray = spraySeed * dissolveEdge * clamp(uDissolveMist + uEdgeBreak * 0.65, 0.0, 1.0);
      p += normalize(dissolveDirection * 0.72 + aNormal * 0.42 + aOffset * 0.36) *
        spray * dissolveSpread * 0.32;
      p += aOffset * dissolveMistMask * dissolveSpread * (0.035 + aSeed * 0.15);
      p.y += (sheetMask * 0.18 + dissolveMistMask * 0.22) * uDissolveLift;
      float silkDissolve = max(sheetMask, dissolve * strandMask * 0.55) *
        (strandMask + clamp(uDissolveCurl * 0.12, 0.0, 0.55));
      p += filamentDirection * silkDissolve * (uFilamentLength + uDissolveCurl * 0.35) * (0.16 + aSeed * 0.42);
      p += dissolveCurlField * silkDissolve * uDissolveCurl * (0.06 + spark * 0.14);

      float radius = length(p.xz);
      float angle = uSwirl * (0.22 * radius + 0.16 * sin(uTime * 0.65 + aSeed * 6.28318));
      p.xz = rotate2d(angle) * p.xz;
      p = mix(p, morphPosition, morphMode);
      float particleizeMotion = particleize >= 0.999
        ? 1.0
        : smoothstep(0.08, 0.96, particleize) * smoothstep(0.18, 0.98, particleizeReveal);
      p = mix(surfacePosition, p, particleizeMotion);

      vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
      float cameraDepth = max(-mvPosition.z, 0.001);
      float depthScale = clamp(pow(4.8 / cameraDepth, 0.45), 0.55, 3.0);
      float growthPointScale = 0.62 + arrive * 0.38 + growHead * 0.38;
      float randomSize = mix(1.0, 0.52 + aSeed * 1.28, uSizeRandom);
      float corePointSize = uPointSize * uPixelRatio * depthScale * randomSize * growthPointScale;
      corePointSize *= mix(0.36, 1.0, smoothstep(0.0, 0.72, particleizeReveal));
      corePointSize *= 1.0 + particleizeHead * 0.16;
      corePointSize *= mix(1.0, 0.56 + growHead * 0.32 + sheetMask * 0.22 + dissolveMistMask * 0.12, strandMask);
      corePointSize *= 1.0 + sheetMask * (0.08 + uDissolveMist * 0.12);
      corePointSize *= mix(1.0, 0.92 + morphRibbon * (0.18 + uMorphFlow * 0.06), morphMode);
      corePointSize = max(corePointSize, 1.05 * uPixelRatio);
      float glowSourceSize = corePointSize * 1.08 + min(uGlowRadius, 1400.0) * uPixelRatio * 0.018;
      gl_PointSize = mix(corePointSize, max(corePointSize, glowSourceSize), step(0.5, uGlowPass));
      vCoreRadius = clamp((corePointSize / max(gl_PointSize, 0.001)) * 0.48, 0.025, 0.48);
      gl_Position = projectionMatrix * mvPosition;

      vec3 gradientColor = mix(uColorA, uColorB, clamp(aMix + pulse * 0.08, 0.0, 1.0));
      vColor = mix(gradientColor, aParticleColor, clamp(uUseTexture * aTextureWeight, 0.0, 1.0));
      float textureColorWeight = clamp(uUseTexture * aTextureWeight, 0.0, 1.0);
      vec3 liftedTextureColor = pow(max(vColor, vec3(0.0)), vec3(0.72));
      vColor = mix(vColor, liftedTextureColor, textureColorWeight * 0.72);
      vColor = mix(vColor, vec3(1.0), growHead * 0.18);
      vec3 dissolveTint = mix(vec3(0.48, 0.68, 0.82), vec3(0.96, 0.985, 1.0), 0.45 + spark * 0.28);
      vColor = mix(vColor, dissolveTint, sheetMask * (0.35 + uDissolveMist * 0.22) + dissolveMistMask * 0.12);
      vColor += sheetMask * vec3(0.08, 0.12, 0.15);
      vec3 silkTint = mix(vColor, vec3(0.72, 0.88, 1.0), 0.2 + spark * 0.14);
      vColor = mix(vColor, silkTint, strandMask * (growHead * 0.42 + sheetMask * 0.52 + dissolveMistMask * 0.1 + uEdgeBreak * 0.08));
      vec3 morphTargetColor = mix(gradientColor, aMorphColor, clamp(uUseTexture * aMorphTextureWeight, 0.0, 1.0));
      morphTargetColor = mix(morphTargetColor, vec3(0.92, 0.88, 0.8), morphRibbon * 0.08);
      vColor = mix(vColor, morphTargetColor, morphMode * morphEase);
      vec3 worldPosition = (modelMatrix * vec4(p, 1.0)).xyz;
      vec3 worldNormal = normalize(mat3(modelMatrix) * normalize(aNormal + field * 0.06));
      float glowMix = (1.0 - exp(-max(uGlowExposure, 0.0) * 0.72)) *
        (1.0 - exp(-max(uGlowRadius, 0.0) * 0.008));
      vColor = applyParticleLights(vColor, worldPosition, worldNormal, glowMix);
      float growthAlpha = clamp(visible * (0.16 + arrive * 0.84) + growHead * 0.35, 0.0, 1.0);
      float lateErase = smoothstep(0.82, 1.0, dissolveAmount) * smoothstep(0.76, 1.0, dissolve);
      float dissolveFade = 1.0 - lateErase * (0.82 + clamp(uDissolveMist, 0.0, 1.0) * 0.12);
      float dissolveEdgeAlpha = max(
        dissolveEdge * (0.24 + uDissolveMist * 0.22) * (0.56 + spark * 0.44),
        sheetMask * (0.38 + uFilamentLength * 0.08)
      );
      vAlpha = (0.84 + aSeed * 0.14) * growthAlpha * max(dissolveFade, dissolveEdgeAlpha);
      vAlpha *= mix(1.0, 0.58 + growHead * 0.3 + sheetMask * 0.18, strandMask);
      vAlpha *= mix(1.0, 0.82, dissolveMistMask * (1.0 - dissolveEdge));
      vAlpha *= mix(1.0, 0.82 + morphRibbon * (0.24 + uMorphFlow * 0.05), morphMode);
      vAlpha *= particleizeAlpha * (0.55 + particleizeReveal * 0.45 + particleizeHead * 0.22);
      vAlpha *= 1.0 - smoothstep(0.965, 1.0, dissolveAmount);
      vAlpha *= clamp(uModelVisibility, 0.0, 1.0);
      vGlowSeed = aSeed;
    }
  `,
  fragmentShader: `
    uniform float uGlowRadius;
    uniform float uGlowExposure;
    uniform float uGlowPass;
    uniform float uEdgeFeather;

    varying vec3 vColor;
    varying float vAlpha;
    varying float vCoreRadius;
    varying float vGlowSeed;

    float coverageNoise(vec2 p) {
      return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
    }

    void main() {
      vec2 uv = gl_PointCoord - 0.5;
      float d = length(uv);
      if (uGlowPass < 0.5) {
        float feather = clamp(uEdgeFeather, 0.0, 1.0);
        float edgeWidth = mix(0.012, 0.16, feather);
        float innerEdge = 0.5 - edgeWidth;
        float coreAlpha = 1.0 - smoothstep(innerEdge, 0.5, d);
        coreAlpha = pow(coreAlpha, mix(1.0, 0.78, feather));
        float lifecycleCoverage = smoothstep(0.035, 0.72, clamp(vAlpha, 0.0, 1.0));
        float coverage = clamp(coreAlpha * lifecycleCoverage, 0.0, 1.0);
        if (coverage < 0.012) {
          discard;
        }
        float noise = coverageNoise(gl_FragCoord.xy + vec2(vGlowSeed * 173.0, vGlowSeed * 41.0));
        if (coverage < 0.985 && noise > coverage) {
          discard;
        }
        float exposure = max(uGlowExposure, 0.0);
        float exposureNorm = pow(1.0 - exp(-exposure * 0.55), 1.08);
        float coreGlow = exposureNorm * (1.0 - exp(-max(uGlowRadius, 0.0) * 0.004));
        vec3 litColor = vColor * (1.0 + coreGlow * 0.16);
        gl_FragColor = vec4(litColor, 1.0);
        return;
      }

      float exposure = max(uGlowExposure, 0.0);
      if (uGlowRadius <= 0.0 || exposure <= 0.0) {
        discard;
      }

      if (d > 0.5) {
        discard;
      }

      float exposureNorm = pow(1.0 - exp(-exposure * 0.55), 1.08);
      float radiusNorm = 1.0 - exp(-max(uGlowRadius, 0.0) * 0.0032);
      float glowStrength = exposureNorm * radiusNorm;
      if (glowStrength <= 0.0005) {
        discard;
      }
      float luminance = dot(vColor, vec3(0.2126, 0.7152, 0.0722));
      float colorEnergy = max(max(vColor.r, vColor.g), vColor.b);
      float glowWeight = mix(0.08, 1.0, smoothstep(0.32, 0.96, max(luminance, colorEnergy * 0.76)));
      float highlight = mix(0.28, 1.0, smoothstep(0.76, 0.99, vGlowSeed));
      float radiusSoftness = clamp(uGlowRadius / 500.0, 0.0, 1.0);
      float source = mix(exp(-d * d * 42.0), exp(-d * d * 12.0), radiusSoftness);
      float energy = source * vAlpha * glowWeight * highlight * glowStrength;
      float alpha = energy * 0.14;
      vec3 glowColor = mix(vColor, vec3(1.0), glowStrength * 0.08);
      vec3 color = glowColor * energy * (2.15 + exposureNorm * 2.35);
      gl_FragColor = vec4(color, clamp(alpha, 0.0, 0.18));
    }
  `
});

const glowMaterial = particleMaterial.clone();
glowMaterial.uniforms = glowUniforms;
glowMaterial.blending = THREE.AdditiveBlending;
glowMaterial.depthWrite = false;
glowMaterial.depthTest = false;
glowMaterial.transparent = true;

const emissionUniforms = {
  uTime: { value: 0 },
  uPixelRatio: { value: studioPixelRatio },
  uEmissionEnabled: { value: state.emissionEnabled ? 1 : 0 },
  uEmissionCountRatio: { value: 1 },
  uEmissionIntensity: { value: state.emissionIntensity },
  uEmissionDistance: { value: state.emissionDistance },
  uEmissionSpeed: { value: state.emissionSpeed },
  uEmissionWind: { value: new THREE.Vector3(state.emissionWindX, state.emissionWindY, state.emissionWindZ) },
  uEmissionTurbulence: { value: state.emissionTurbulence },
  uEmissionSize: { value: state.emissionSize },
  uEmissionOpacity: { value: state.emissionOpacity },
  uModelVisibility: { value: state.modelVisibility },
  uEmissionGlow: { value: state.emissionGlow },
  uModelWhite: { value: state.modelWhite },
  uUseTexture: { value: state.useTexture ? 1 : 0 },
  uColorA: { value: new THREE.Color(state.colorA) },
  uColorB: { value: new THREE.Color(state.colorB) },
  uBreakAmount: { value: state.breakAmount },
  uBreakProgress: { value: state.breakProgress },
  uBreakRadius: { value: state.breakRadius },
  uBreakFeather: { value: state.breakFeather },
  uBreakCenter: { value: new THREE.Vector3(state.breakCenterX, state.breakCenterY, state.breakCenterZ) },
  uBreakSpeed: { value: state.breakSpeed },
  uBreakSize: { value: state.breakSize },
  uGlowPass: { value: 0 },
  ...createParticleLightingUniforms()
};
const emissionGlowUniforms = { ...emissionUniforms, uGlowPass: { value: 1 } };
const modelBreakUniforms = {
  uBreakAmount: emissionUniforms.uBreakAmount,
  uBreakProgress: emissionUniforms.uBreakProgress,
  uBreakRadius: emissionUniforms.uBreakRadius,
  uBreakFeather: emissionUniforms.uBreakFeather,
  uBreakCenter: emissionUniforms.uBreakCenter,
  uParticleizeProgress: uniforms.uParticleizeProgress,
  uParticleizeEnabled: { value: 0 },
  uBreakRootInverse: { value: new THREE.Matrix4() }
};

const emissionMaterial = new THREE.ShaderMaterial({
  uniforms: emissionUniforms,
  transparent: true,
  depthWrite: true,
  depthTest: true,
  blending: THREE.NormalBlending,
  vertexShader: `
    attribute vec3 aNormal;
    attribute vec3 aOffset;
    attribute vec3 aParticleColor;
    attribute float aSeed;
    attribute float aLifeOffset;
    attribute float aIndexRatio;
    attribute float aTextureWeight;

    uniform float uTime;
    uniform float uPixelRatio;
    uniform float uEmissionEnabled;
    uniform float uEmissionCountRatio;
    uniform float uEmissionIntensity;
    uniform float uEmissionDistance;
    uniform float uEmissionSpeed;
    uniform vec3 uEmissionWind;
    uniform float uEmissionTurbulence;
    uniform float uEmissionSize;
    uniform float uEmissionOpacity;
    uniform float uModelVisibility;
    uniform float uEmissionGlow;
    uniform float uModelWhite;
    uniform float uUseTexture;
    uniform vec3 uColorA;
    uniform vec3 uColorB;
    uniform float uBreakAmount;
    uniform float uBreakProgress;
    uniform float uBreakRadius;
    uniform float uBreakFeather;
    uniform vec3 uBreakCenter;
    uniform float uBreakSpeed;
    uniform float uBreakSize;
    uniform float uGlowPass;
    #define MAX_PARTICLE_LIGHTS 8
    uniform float uParticleAmbient;
    uniform float uParticleLightCount;
    uniform float uParticleLightType[MAX_PARTICLE_LIGHTS];
    uniform vec3 uParticleLightPosition[MAX_PARTICLE_LIGHTS];
    uniform vec3 uParticleLightDirection[MAX_PARTICLE_LIGHTS];
    uniform vec3 uParticleLightColor[MAX_PARTICLE_LIGHTS];
    uniform float uParticleLightIntensity[MAX_PARTICLE_LIGHTS];
    uniform float uParticleLightSize[MAX_PARTICLE_LIGHTS];
    uniform float uParticleLightAngle[MAX_PARTICLE_LIGHTS];

    varying vec3 vColor;
    varying float vAlpha;
    varying float vGlow;

    float hash(vec3 p) {
      return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123);
    }

    vec3 flowField(vec3 p, float seed, float timeValue) {
      vec3 q = p * (1.35 + seed * 0.75) + vec3(timeValue * 0.16, -timeValue * 0.11, timeValue * 0.09);
      return normalize(vec3(
        sin(q.y * 2.1 + q.z * 0.8 + seed * 6.28318),
        cos(q.z * 1.7 + q.x * 0.9 + seed * 5.2),
        sin(q.x * 1.9 - q.y * 0.7 + seed * 4.4)
      ) + aOffset * 0.42);
    }

    vec3 applyParticleLights(vec3 baseColor, vec3 worldPosition, vec3 worldNormal, float emissiveMix) {
      vec3 n = normalize(worldNormal);
      vec3 lit = baseColor * max(uParticleAmbient * 0.78, 0.06);

      for (int i = 0; i < MAX_PARTICLE_LIGHTS; i++) {
        float lightEnabled = step(float(i) + 0.5, uParticleLightCount);
        float type = uParticleLightType[i];
        float intensity = max(uParticleLightIntensity[i], 0.0) * lightEnabled;
        vec3 lightColor = uParticleLightColor[i];
        float diffuse = 0.0;
        float attenuation = 1.0;

        if (type < 0.5) {
          vec3 delta = uParticleLightPosition[i] - worldPosition;
          float dist = max(length(delta), 0.001);
          vec3 l = delta / dist;
          diffuse = pow(max(dot(n, l) * 0.5 + 0.5, 0.0), 1.35);
          float range = max(1.0, 4.0 + uParticleLightSize[i] * 6.0);
          attenuation = 1.0 / (1.0 + (dist * dist) / (range * range));
        } else if (type < 1.5) {
          vec3 l = normalize(uParticleLightDirection[i]);
          diffuse = pow(max(dot(n, l) * 0.5 + 0.5, 0.0), 1.28);
        } else if (type < 2.5) {
          vec3 fromLight = worldPosition - uParticleLightPosition[i];
          float dist = max(length(fromLight), 0.001);
          vec3 coneDir = normalize(uParticleLightDirection[i]);
          float cone = dot(normalize(fromLight), coneDir);
          float outer = cos(max(uParticleLightAngle[i], 0.03));
          float inner = cos(max(uParticleLightAngle[i] * 0.72, 0.02));
          float spotMask = smoothstep(outer, inner, cone);
          vec3 l = -fromLight / dist;
          diffuse = pow(max(dot(n, l) * 0.5 + 0.5, 0.0), 1.34) * spotMask;
          float range = max(1.4, 4.0 + uParticleLightSize[i] * 5.0);
          attenuation = spotMask / (1.0 + (dist * dist) / (range * range));
        } else {
          vec3 delta = uParticleLightPosition[i] - worldPosition;
          float dist = max(length(delta), 0.001);
          vec3 l = delta / dist;
          diffuse = pow(max(dot(n, l) * 0.5 + 0.5, 0.0), 1.32);
          float range = max(1.6, 5.0 + uParticleLightSize[i] * 4.0);
          attenuation = 1.0 / (1.0 + (dist * dist) / (range * range));
        }

        float sunMask = step(0.5, type) * (1.0 - step(1.5, type));
        float lightScale = mix(0.13, 0.82, sunMask);
        lit += baseColor * lightColor * diffuse * attenuation * intensity * lightScale;
      }

      vec3 emissiveColor = baseColor * (0.95 + emissiveMix * 0.48);
      return mix(lit, emissiveColor, clamp(emissiveMix, 0.0, 0.86));
    }

    void main() {
      float activeMask = uEmissionEnabled * step(aIndexRatio, clamp(uEmissionCountRatio, 0.0, 1.0));
      float timeValue = uTime * max(uEmissionSpeed, 0.0);
      float age = fract(timeValue * (0.052 + aSeed * 0.028) + aLifeOffset);
      float fade = smoothstep(0.0, 0.13, age) * (1.0 - smoothstep(0.72, 1.0, age));
      float intensity = max(uEmissionIntensity, 0.0);
      float energy = fade * activeMask * intensity;

      vec3 normal = normalize(aNormal + aOffset * 0.08);
      vec3 wind = uEmissionWind;
      float windLength = length(wind);
      wind = mix(vec3(0.42, 0.12, -0.18), wind / max(windLength, 0.0001), step(0.0001, windLength));
      vec3 curl = flowField(position * 0.78 + normal * age * 0.75, aSeed, timeValue);
      vec3 tangent = normalize(vec3(-position.z, 0.18 + aSeed * 0.24, position.x) + curl * 0.22 + wind * 0.18);
      float ribbon = pow(0.5 + 0.5 * sin(position.y * 3.1 + position.x * 1.7 - position.z * 1.2 + aSeed * 9.4 + timeValue * 0.42), 2.2);
      float stream = mix(0.52, 1.38, ribbon);
      float breakDistance = length(position - uBreakCenter);
      float breakArea = 1.0 - smoothstep(uBreakRadius, uBreakRadius + max(uBreakFeather, 0.001), breakDistance);
      float breakGate = smoothstep(aSeed - 0.22, aSeed + 0.22, uBreakProgress);
      float breakMask = clamp(uBreakAmount, 0.0, 1.0) * breakArea * breakGate;
      vec3 drift = normalize(normal * 0.38 + tangent * 0.58 + wind * 0.42 + curl * uEmissionTurbulence * 0.72);
      float easedAge = age * age * (3.0 - 2.0 * age);
      float plume = smoothstep(0.18, 0.88, age);
      float distance = uEmissionDistance * (0.22 + aSeed * 1.15) * (0.42 + intensity * 0.72);
      vec3 p = position;
      p += normal * distance * 0.16 * smoothstep(0.0, 0.25, age);
      p += drift * distance * easedAge * stream;
      p += tangent * sin(age * 6.28318 + aSeed * 7.1) * uEmissionDistance * (0.045 + uEmissionTurbulence * 0.075) * plume;
      p += curl * uEmissionTurbulence * uEmissionDistance * age * (0.18 + aSeed * 0.28);
      p += normal * sin(age * 6.28318 + aSeed * 9.7) * uEmissionTurbulence * 0.026;
      float breakTime = uTime * max(uBreakSpeed, 0.0);
      vec3 breakFlow = flowField(position * 1.4 + aOffset * 0.8, aSeed + 0.37, breakTime);
      vec3 breakDirection = normalize(normal * 0.95 + aOffset * 0.75 + breakFlow * 0.55 + wind * 0.28);
      float breakTravel = breakMask * uBreakProgress * (0.55 + uEmissionDistance * 0.65) * (0.75 + aSeed * 1.35);
      p += breakDirection * breakTravel;
      p += breakFlow * breakMask * uBreakProgress * (0.08 + uEmissionTurbulence * 0.16);

      vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
      float cameraDepth = max(-mvPosition.z, 0.001);
      float depthScale = clamp(pow(4.8 / cameraDepth, 0.45), 0.52, 2.8);
      float sizeJitter = 0.62 + hash(position + vec3(aSeed)) * 0.72;
      float baseSize = max(uEmissionSize, 0.01) * uPixelRatio * depthScale * sizeJitter * (0.68 + plume * 0.42);
      baseSize *= 1.0 + breakMask * max(uBreakSize - 1.0, -0.75);
      baseSize = max(baseSize, 1.05 * uPixelRatio);
      float glowSize = baseSize * (1.55 + clamp(uEmissionGlow, 0.0, 4.0) * 1.12);
      gl_PointSize = mix(baseSize, max(baseSize, glowSize), step(0.5, uGlowPass));
      gl_Position = projectionMatrix * mvPosition;

      float gradientMix = clamp(
        0.5 + position.y * 0.34 + ribbon * 0.22 + sin(aSeed * 9.7 + position.x * 1.6) * 0.08,
        0.0,
        1.0
      );
      vec3 gradientColor = mix(uColorA, uColorB, gradientMix);
      vec3 textureColor = mix(gradientColor, aParticleColor, clamp(aTextureWeight, 0.0, 1.0));
      vec3 sourceColor = mix(gradientColor, textureColor, clamp(uUseTexture, 0.0, 1.0));
      float textureWeight = clamp(uUseTexture * aTextureWeight, 0.0, 1.0);
      vec3 faithfulTextureColor = mix(sourceColor, pow(max(sourceColor, vec3(0.0)), vec3(0.92)), textureWeight * 0.28);
      vColor = mix(faithfulTextureColor, vec3(0.9, 0.93, 0.95), clamp(uModelWhite, 0.0, 1.0));
      vec3 worldPosition = (modelMatrix * vec4(p, 1.0)).xyz;
      vec3 worldNormal = normalize(mat3(modelMatrix) * normal);
      float emissiveMix = 1.0 - exp(-max(uEmissionGlow, 0.0) * 0.72);
      vColor = applyParticleLights(vColor, worldPosition, worldNormal, emissiveMix);
      float breakAlpha = activeMask * breakMask * smoothstep(0.0, 0.08, uBreakProgress) *
        (1.0 - smoothstep(0.94, 1.0, uBreakProgress)) * (0.52 + aSeed * 0.46);
      vAlpha = max(energy * stream, breakAlpha) * clamp(uEmissionOpacity, 0.0, 1.0) * (0.28 + aSeed * 0.54);
      vAlpha *= clamp(uModelVisibility, 0.0, 1.0);
      vGlow = clamp(uEmissionGlow * (0.52 + ribbon * 0.42) + breakMask * 0.35, 0.0, 4.0);
    }
  `,
  fragmentShader: `
    uniform float uGlowPass;

    varying vec3 vColor;
    varying float vAlpha;
    varying float vGlow;

    void main() {
      vec2 uv = gl_PointCoord - 0.5;
      float d = length(uv);
      if (d > 0.5) {
        discard;
      }

      if (uGlowPass < 0.5) {
        float core = smoothstep(0.48, 0.06, d);
        float feather = smoothstep(0.5, 0.32, d);
      float glowLift = 1.0 - exp(-max(vGlow, 0.0) * 0.72);
        vec3 color = vColor * (0.92 + glowLift * 0.16);
        gl_FragColor = vec4(color, core * feather * vAlpha);
        return;
      }

      if (vGlow <= 0.001) {
        discard;
      }

      float glowStrength = 1.0 - exp(-max(vGlow, 0.0) * 0.72);
      if (glowStrength <= 0.0005) {
        discard;
      }

      float halo = exp(-d * d * 10.5);
      float alpha = halo * vAlpha * glowStrength * 0.22;
      vec3 glowColor = mix(vColor, vec3(1.0), glowStrength * 0.14);
      gl_FragColor = vec4(glowColor * alpha * (1.08 + glowStrength * 0.62), clamp(alpha, 0.0, 0.26));
    }
  `
});

const emissionGlowMaterial = emissionMaterial.clone();
emissionGlowMaterial.uniforms = emissionGlowUniforms;
emissionGlowMaterial.blending = THREE.AdditiveBlending;
emissionGlowMaterial.depthWrite = false;
emissionGlowMaterial.depthTest = true;
emissionGlowMaterial.transparent = true;

const imageSplatUniforms = {
  uTime: { value: 0 },
  uPixelRatio: { value: studioPixelRatio },
  uDepth: { value: state.imageSplatDepth },
  uScatter: { value: state.imageSplatScatter },
  uSpeed: { value: state.imageSplatSpeed },
  uScatterDirection: { value: new THREE.Vector3(state.imageSplatDirX, state.imageSplatDirY, state.imageSplatDirZ) },
  uTurbulence: { value: state.imageSplatTurbulence },
  uSize: { value: state.imageSplatSize },
  uFeather: { value: state.imageSplatFeather },
  uColorKeep: { value: state.imageSplatColorKeep },
  uOpacity: { value: state.imageSplatOpacity },
  uGlow: { value: state.imageSplatGlow },
  uCountRatio: { value: 1 },
  uColorA: { value: new THREE.Color(state.colorA) },
  uColorB: { value: new THREE.Color(state.colorB) },
  uMistPass: { value: 0 },
  uGlowPass: { value: 0 }
};
const imageSplatGlowUniforms = { ...imageSplatUniforms, uGlowPass: { value: 1 } };
const imageSplatMistUniforms = { ...imageSplatUniforms, uMistPass: { value: 1 } };

const imageSplatVertexShader = `
  attribute float aDepth;
  attribute vec3 aScatter;
  attribute vec3 aParticleColor;
  attribute float aSeed;
  attribute float aMix;
  attribute float aAlpha;
  attribute float aIndexRatio;

  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uDepth;
  uniform float uScatter;
  uniform float uSpeed;
  uniform vec3 uScatterDirection;
  uniform float uTurbulence;
  uniform float uSize;
  uniform float uGlow;
  uniform float uCountRatio;
  uniform float uMistPass;
  uniform float uGlowPass;

  varying vec3 vColor;
  varying float vMix;
  varying float vAlpha;

  float hash(float value) {
    return fract(sin(value * 127.1) * 43758.5453123);
  }

  void main() {
    float t = uTime * max(uSpeed, 0.0);
    float mist = clamp(uMistPass, 0.0, 1.0);
    float age = fract(aSeed + t * mix(0.09, 0.16, mist));
    float stream = smoothstep(0.02, 0.22, age) * (1.0 - smoothstep(0.72, 1.0, age));
    float pulse = sin(t * 2.4 + aSeed * 18.0) * 0.5 + 0.5;
    vec3 wind = uScatterDirection;
    if (length(wind) < 0.001) {
      wind = vec3(0.35, 0.12, 0.55);
    }
    wind = normalize(wind);
    vec3 curl = normalize(vec3(
      sin(position.y * 2.7 + t + aSeed * 5.1),
      cos(position.x * 2.1 - t * 0.8 + aSeed * 6.7),
      sin((position.x + position.y) * 1.4 + t * 1.2 + aSeed * 4.3)
    ));
    vec3 flow = normalize(wind * 0.78 + aScatter * 0.68 + curl * uTurbulence * 0.42);
    vec3 p = position;
    p.z += aDepth * uDepth;
    p += flow * uScatter * stream * (0.58 + aSeed * 1.92 + mist * 1.24);
    p += curl * uTurbulence * (0.14 + mist * 0.22) * (0.48 + pulse);
    p += aScatter * uScatter * (0.18 + mist * (0.62 + aSeed * 1.18));

    vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
    float perspectiveScale = clamp(pow(3.6 / max(0.8, -mvPosition.z), 0.45), 0.68, 2.0);
    float jitter = 0.82 + hash(aSeed + 1.9) * 0.36 + mist * 0.16;
    float glowPass = clamp(uGlowPass, 0.0, 1.0);
    float glowScale = mix(1.0, 1.16 + uGlow * 0.08, glowPass);
    gl_PointSize = max(0.42, uSize * uPixelRatio * perspectiveScale * jitter * glowScale * 2.2);
    gl_Position = projectionMatrix * mvPosition;

    vColor = aParticleColor;
    vMix = aMix;
    float activeMask = step(aIndexRatio, clamp(uCountRatio, 0.0, 1.0));
    vAlpha = aAlpha * activeMask * mix(1.0, 0.38, mist) * mix(1.0, 0.42, clamp(uGlowPass, 0.0, 1.0));
  }
`;

const imageSplatFragmentShader = `
  uniform float uFeather;
  uniform float uColorKeep;
  uniform float uOpacity;
  uniform float uGlow;
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform float uMistPass;
  uniform float uGlowPass;

  varying vec3 vColor;
  varying float vMix;
  varying float vAlpha;

  void main() {
    vec2 centered = gl_PointCoord.xy - vec2(0.5);
    float d = length(centered) * 2.0;
    if (d > 1.0) {
      discard;
    }

    float feather = clamp(uFeather, 0.0, 1.0);
    float gaussian = exp(-d * d * mix(12.0, 3.2, feather));
    float crisp = 1.0 - smoothstep(0.86 + feather * 0.1, 1.0, d);
    float soft = mix(crisp, gaussian, feather);
    vec3 gradient = mix(uColorA, uColorB, clamp(vMix, 0.0, 1.0));
    vec3 color = mix(gradient, vColor, clamp(uColorKeep, 0.0, 1.0));
    float mist = clamp(uMistPass, 0.0, 1.0);
    float glowPass = clamp(uGlowPass, 0.0, 1.0);
    float alpha = soft * vAlpha * clamp(uOpacity, 0.0, 1.0) * mix(1.0, 0.42, mist);
    color = mix(color, vec3(dot(color, vec3(0.299, 0.587, 0.114))), mist * 0.18);
    color *= 1.0 + uGlow * mix(0.04, 0.18, glowPass);
    gl_FragColor = vec4(color, alpha);
  }
`;

const imageSplatMaterial = new THREE.ShaderMaterial({
  uniforms: imageSplatUniforms,
  transparent: true,
  depthTest: true,
  depthWrite: false,
  toneMapped: false,
  vertexShader: imageSplatVertexShader,
  fragmentShader: imageSplatFragmentShader
});
const imageSplatGlowMaterial = imageSplatMaterial.clone();
imageSplatGlowMaterial.uniforms = imageSplatGlowUniforms;
imageSplatGlowMaterial.blending = THREE.AdditiveBlending;
const imageSplatMistMaterial = imageSplatMaterial.clone();
imageSplatMistMaterial.uniforms = imageSplatMistUniforms;

const realSplatPointUniforms = {
  uTime: { value: 0 },
  uPixelRatio: { value: studioPixelRatio },
  uPointSize: { value: 2.4 },
  uOpacity: { value: 1 },
  uScatter: { value: state.imageSplatScatter },
  uSpeed: { value: state.imageSplatSpeed },
  uScatterDirection: { value: new THREE.Vector3(state.imageSplatDirX, state.imageSplatDirY, state.imageSplatDirZ) },
  uTurbulence: { value: state.imageSplatTurbulence },
  uFeather: { value: state.imageSplatFeather },
  uColorKeep: { value: state.imageSplatColorKeep },
  uGlow: { value: state.imageSplatGlow },
  uColorA: { value: new THREE.Color(state.colorA) },
  uColorB: { value: new THREE.Color(state.colorB) }
};

const realSplatPointMaterial = new THREE.ShaderMaterial({
  uniforms: realSplatPointUniforms,
  transparent: true,
  depthTest: true,
  depthWrite: false,
  toneMapped: false,
  vertexShader: `
    attribute vec3 color;
    attribute float aAlpha;
    attribute float aScale;
    uniform float uTime;
    uniform float uPixelRatio;
    uniform float uPointSize;
    uniform float uScatter;
    uniform float uSpeed;
    uniform vec3 uScatterDirection;
    uniform float uTurbulence;
    uniform float uColorKeep;
    uniform float uGlow;
    uniform vec3 uColorA;
    uniform vec3 uColorB;
    varying vec3 vColor;
    varying float vAlpha;
    varying float vGlow;

    float hash(vec3 p) {
      return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123);
    }

    void main() {
      float seed = hash(position + color * 2.17);
      float t = uTime * max(uSpeed, 0.0);
      float age = fract(seed + t * (0.035 + seed * 0.045));
      float stream = smoothstep(0.02, 0.28, age) * (1.0 - smoothstep(0.76, 1.0, age));
      vec3 wind = uScatterDirection;
      if (length(wind) < 0.001) {
        wind = vec3(0.32, 0.08, 0.42);
      }
      wind = normalize(wind);
      vec3 curl = normalize(vec3(
        sin(position.y * 3.1 + t + seed * 6.1),
        cos(position.z * 2.3 - t * 0.7 + seed * 4.7),
        sin(position.x * 2.7 + t * 1.2 + seed * 5.3)
      ));
      vec3 flow = normalize(wind * 0.78 + curl * uTurbulence * 0.42 + normalize(position + 0.001) * 0.16);
      vec3 p = position;
      p += flow * uScatter * stream * (0.08 + seed * 0.52);
      p += curl * uTurbulence * (0.018 + seed * 0.035) * (0.35 + stream);

      vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
      float perspectiveScale = clamp(pow(4.8 / max(0.8, -mvPosition.z), 0.45), 0.7, 2.2);
      float glowScale = 1.0 + (1.0 - exp(-max(uGlow, 0.0) * 0.72)) * 0.18;
      gl_PointSize = max(0.85, uPointSize * uPixelRatio * perspectiveScale * aScale * glowScale);
      gl_Position = projectionMatrix * mvPosition;
      float mixValue = clamp(0.5 + p.y * 0.18 + seed * 0.22, 0.0, 1.0);
      vec3 gradient = mix(uColorA, uColorB, mixValue);
      vColor = mix(gradient, color, clamp(uColorKeep, 0.0, 1.0));
      vAlpha = aAlpha;
      vGlow = uGlow * (0.45 + seed * 0.55);
    }
  `,
  fragmentShader: `
    uniform float uOpacity;
    uniform float uFeather;
    varying vec3 vColor;
    varying float vAlpha;
    varying float vGlow;

    void main() {
      vec2 centered = gl_PointCoord.xy - vec2(0.5);
      float d = dot(centered, centered) * 4.0;
      if (d > 1.0) {
        discard;
      }
      float feather = clamp(uFeather, 0.0, 1.0);
      float crisp = 1.0 - smoothstep(0.72 + feather * 0.18, 1.0, sqrt(d));
      float soft = exp(-d * mix(7.2, 2.4, feather));
      float alpha = mix(crisp, soft, feather) * vAlpha * uOpacity;
      vec3 color = vColor * (1.0 + (1.0 - exp(-max(vGlow, 0.0) * 0.72)) * 0.18);
      gl_FragColor = vec4(color, alpha);
    }
  `
});

let particles = null;
let glowParticles = null;
let visibleModelRoot = null;
let emissionParticles = null;
let emissionGlowParticles = null;
let imageSplatRoot = null;
let imageSplatPlane = null;
let imageSplatParticles = null;
let imageSplatMistParticles = null;
let imageSplatGlowParticles = null;
let imageSplatTexture = null;
let imageSplatSource = null;
let realSplatRoot = null;
let realSplatObjectUrl = '';
let realSplatPointCount = 0;
let currentSource = createDefaultModel();
let currentLabel = '程序内置模型';
let currentModelPayload = null;
const modelAnimation = {
  source: null,
  mixer: null,
  visibleMixer: null,
  clips: [],
  clipIndex: 0,
  clip: null,
  action: null,
  visibleAction: null,
  duration: 0,
  poseVersion: 0,
  lastPoseTime: Number.NaN,
  lastGeometryMode: '',
  lastGeometryUpdateMs: -Infinity
};
let morphTargetSource = null;
let morphTargetLabel = '';
let currentMorphTargetPayload = null;
let currentImageSplatPayload = null;
let currentGaussianSplatPayload = null;
let currentWorldPayload = null;
let worldSourceTexture = null;
let worldPmremTarget = null;
let worldObjectUrl = '';
let rebuildTimer = null;
let buildToken = 0;
let initialModelReady = false;

resizeRenderer();
resetCamera();
importSceneLights();
syncUi();
syncUniforms();
refreshCameraTimeline();
updatePlayButton();
updateCameraViewButton();
setupParameterKeyframeButtons();
restorePanelCollapsedState();
restoreCameraPreviewVisibility();
initializeStartupModel();
animate();

function restorePanelCollapsedState() {
  let collapsed = false;
  try {
    collapsed = window.localStorage?.getItem(PANEL_COLLAPSED_STORAGE_KEY) === '1';
  } catch {
    collapsed = false;
  }
  setPanelCollapsed(collapsed, false);
}

function setPanelCollapsed(collapsed, persist = true) {
  document.body.classList.toggle('panel-collapsed', collapsed);
  if (panelToggle) {
    panelToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    panelToggle.setAttribute('title', collapsed ? '显示左侧面板' : '隐藏左侧面板');
    panelToggle.setAttribute('aria-label', collapsed ? '显示左侧面板' : '隐藏左侧面板');
  }

  if (persist) {
    try {
      window.localStorage?.setItem(PANEL_COLLAPSED_STORAGE_KEY, collapsed ? '1' : '0');
    } catch {
      // localStorage can be unavailable in some embedded export/test contexts.
    }
  }
  requestWorkspaceResize();
}

async function initializeStartupModel() {
  setStatus('Loading model');
  const loaded = exportSettings.modelUrl ? await loadBundledModel(exportSettings.modelUrl) : false;
  if (!loaded) {
    await buildParticles(currentSource, currentLabel, { resetView: true });
  }
  await initializeStartupMorphTarget();
  await initializeStartupWorld();
  initialModelReady = true;
}

async function initializeStartupMorphTarget() {
  if (!exportSettings.morphTargetUrl) {
    return false;
  }

  try {
    return await loadMorphTargetUrl(exportSettings.morphTargetUrl, {
      name: exportSettings.morphTargetUrl.split('/').pop()?.split('?')[0] || 'target.glb'
    });
  } catch (error) {
    console.warn('Could not load startup morph target.', error);
    return false;
  }
}

function createDefaultModel() {
  const group = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({ color: 0xffffff });

  const knot = new THREE.Mesh(new THREE.TorusKnotGeometry(1.08, 0.31, 260, 36), material);
  knot.rotation.set(0.7, 0.1, 0.35);
  group.add(knot);

  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.72, 4), material);
  core.scale.set(1.1, 0.82, 1.1);
  group.add(core);

  return group;
}

function getValidModelAnimationClips(root) {
  return (root?.animations || []).filter((clip) =>
    clip &&
    clip.duration > 0.0001 &&
    Array.isArray(clip.tracks) &&
    clip.tracks.length > 0
  );
}

function hasModelAnimation(root) {
  return getValidModelAnimationClips(root).length > 0;
}

function configureModelAnimation(source, options = {}) {
  const { reset = false } = options;
  const clips = getValidModelAnimationClips(source);
  const sourceChanged = modelAnimation.source !== source;
  modelAnimation.source = source;
  modelAnimation.visibleMixer = null;
  modelAnimation.visibleAction = null;
  modelAnimation.clips = clips;
  modelAnimation.lastPoseTime = Number.NaN;
  modelAnimation.lastGeometryMode = '';
  modelAnimation.lastGeometryUpdateMs = -Infinity;

  if (!clips.length) {
    modelAnimation.mixer = null;
    modelAnimation.clip = null;
    modelAnimation.action = null;
    modelAnimation.duration = 0;
    state.modelAnimEnabled = false;
    state.modelAnimPlaying = false;
    state.modelAnimProgress = 0;
    syncModelAnimationUi();
    return false;
  }

  if (reset || sourceChanged || modelAnimation.clipIndex >= clips.length) {
    modelAnimation.clipIndex = 0;
  }

  modelAnimation.clip = clips[modelAnimation.clipIndex];
  modelAnimation.duration = Math.max(modelAnimation.clip.duration || 0, 0.0001);
  modelAnimation.mixer = new THREE.AnimationMixer(source);
  modelAnimation.action = modelAnimation.mixer.clipAction(modelAnimation.clip);
  prepareModelAnimationAction(modelAnimation.action);

  if (reset || sourceChanged) {
    state.modelAnimEnabled = true;
    state.modelAnimPlaying = false;
    state.modelAnimProgress = 0;
    state.modelAnimSpeed = Math.max(Number(state.modelAnimSpeed) || 1, 0);
  }

  applyModelAnimationPose(getModelAnimationSeconds(0, false), { updateGeometry: false });
  syncModelAnimationUi();
  return true;
}

function prepareModelAnimationAction(action) {
  if (!action) {
    return;
  }
  action.reset();
  action.enabled = true;
  action.paused = false;
  action.setEffectiveWeight(1);
  action.setEffectiveTimeScale(1);
  action.setLoop(THREE.LoopRepeat, Infinity);
  action.play();
}

function setupVisibleModelAnimation(root) {
  modelAnimation.visibleMixer = null;
  modelAnimation.visibleAction = null;
  if (!root || !modelAnimation.clip) {
    return;
  }

  modelAnimation.visibleMixer = new THREE.AnimationMixer(root);
  modelAnimation.visibleAction = modelAnimation.visibleMixer.clipAction(modelAnimation.clip);
  prepareModelAnimationAction(modelAnimation.visibleAction);
  modelAnimation.visibleMixer.setTime(getModelAnimationSeconds(0, false));
  root.updateMatrixWorld(true);
}

function setModelAnimationClip(index) {
  if (!modelAnimation.clips.length) {
    return;
  }
  modelAnimation.clipIndex = THREE.MathUtils.clamp(
    Math.round(Number(index) || 0),
    0,
    modelAnimation.clips.length - 1
  );
  modelAnimation.clip = modelAnimation.clips[modelAnimation.clipIndex];
  modelAnimation.duration = Math.max(modelAnimation.clip.duration || 0, 0.0001);
  modelAnimation.lastPoseTime = Number.NaN;
  modelAnimation.lastGeometryMode = '';
  modelAnimation.lastGeometryUpdateMs = -Infinity;
  if (modelAnimation.source) {
    modelAnimation.mixer = new THREE.AnimationMixer(modelAnimation.source);
    modelAnimation.action = modelAnimation.mixer.clipAction(modelAnimation.clip);
    prepareModelAnimationAction(modelAnimation.action);
  }
  setupVisibleModelAnimation(visibleModelRoot?.children?.[0] || null);
  applyModelAnimationPose(getModelAnimationSeconds(0, false), { force: true });
  syncModelAnimationUi();
}

function getModelAnimationSeconds(baseTimeSeconds = 0, includePlayback = true) {
  if (!modelAnimation.clip || modelAnimation.duration <= 0) {
    return 0;
  }
  const progressSeconds = THREE.MathUtils.clamp(state.modelAnimProgress, 0, 1) * modelAnimation.duration;
  const playbackSeconds = includePlayback && state.modelAnimPlaying
    ? Math.max(Number(baseTimeSeconds) || 0, 0) * Math.max(Number(state.modelAnimSpeed) || 0, 0)
    : 0;
  return wrapAnimationTime(progressSeconds + playbackSeconds, modelAnimation.duration);
}

function wrapAnimationTime(timeSeconds, duration) {
  if (!duration || duration <= 0) {
    return 0;
  }
  return ((timeSeconds % duration) + duration) % duration;
}

function applyModelAnimationPose(timeSeconds = getModelAnimationSeconds(0, false), options = {}) {
  const { updateGeometry = true, force = false } = options;
  if (!modelAnimation.clip || !modelAnimation.source || !state.modelAnimEnabled) {
    return false;
  }

  const poseTime = wrapAnimationTime(timeSeconds, modelAnimation.duration);
  const geometryMode = state.effectMode === 'emission' ? 'emission' : 'particles';
  const now = performance.now();
  const geometryDue =
    !updateGeometry ||
    force ||
    exportSettings.hideUi ||
    modelAnimation.lastGeometryMode !== geometryMode ||
    now - modelAnimation.lastGeometryUpdateMs >= ANIMATED_PARTICLE_PREVIEW_INTERVAL_MS;
  if (updateGeometry && !geometryDue) {
    return false;
  }

  if (
    !force &&
    Math.abs(poseTime - modelAnimation.lastPoseTime) < 0.0001 &&
    (!updateGeometry || modelAnimation.lastGeometryMode === geometryMode)
  ) {
    return false;
  }

  modelAnimation.mixer?.setTime(poseTime);
  modelAnimation.visibleMixer?.setTime(poseTime);
  modelAnimation.source.updateMatrixWorld(true);
  visibleModelRoot?.updateMatrixWorld(true);
  modelAnimation.poseVersion += 1;
  if (updateGeometry) {
    updateAnimatedParticleGeometries(geometryMode, { forceNormals: force || exportSettings.hideUi });
    modelAnimation.lastGeometryMode = geometryMode;
    modelAnimation.lastGeometryUpdateMs = now;
  }
  modelAnimation.lastPoseTime = poseTime;
  return true;
}

function advanceModelAnimation(deltaSeconds) {
  if (!modelAnimation.clip || !state.modelAnimEnabled) {
    return;
  }

  let changed = false;
  if (state.modelAnimPlaying && modelAnimation.duration > 0) {
    const speed = Math.max(Number(state.modelAnimSpeed) || 0, 0);
    if (speed > 0) {
      state.modelAnimProgress = (state.modelAnimProgress + (deltaSeconds * speed) / modelAnimation.duration) % 1;
      changed = true;
      updateModelAnimationProgressUi();
    }
  }

  if (!changed && !Number.isNaN(modelAnimation.lastPoseTime)) {
    return;
  }

  applyModelAnimationPose(getModelAnimationSeconds(0, false));
}

function updateModelAnimationProgressUi(force = false) {
  const now = performance.now();
  if (!force && now - (updateModelAnimationProgressUi.lastWrite || 0) < 83) {
    return;
  }
  updateModelAnimationProgressUi.lastWrite = now;
  setRangeValue('modelAnimProgress', state.modelAnimProgress);
  setValueInput('modelAnimProgress', state.modelAnimProgress);
}

function syncModelAnimationUi() {
  if (!controlsUi.modelAnimClip) {
    return;
  }

  const clips = modelAnimation.clips;
  const enabled = clips.length > 0;
  const previousValue = controlsUi.modelAnimClip.value;
  controlsUi.modelAnimClip.innerHTML = '';

  if (enabled) {
    clips.forEach((clip, index) => {
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = `${clip.name || `Clip ${index + 1}`} (${clip.duration.toFixed(2)}s)`;
      controlsUi.modelAnimClip.append(option);
    });
  } else {
    const option = document.createElement('option');
    option.value = '0';
    option.textContent = 'No animation';
    controlsUi.modelAnimClip.append(option);
  }

  controlsUi.modelAnimClip.value = enabled ? String(modelAnimation.clipIndex) : previousValue || '0';
  controlsUi.modelAnimClip.disabled = !enabled;
  [
    controlsUi.modelAnimEnabled,
    controlsUi.modelAnimPlaying,
    controlsUi.modelAnimProgress,
    controlsUi.modelAnimSpeed,
    outputUi.modelAnimProgress,
    outputUi.modelAnimSpeed
  ].forEach((item) => {
    if (item) {
      item.disabled = !enabled;
    }
  });
  if (controlsUi.modelAnimEnabled) {
    controlsUi.modelAnimEnabled.checked = enabled && state.modelAnimEnabled;
  }
  if (controlsUi.modelAnimPlaying) {
    controlsUi.modelAnimPlaying.checked = enabled && state.modelAnimPlaying;
  }
  setRangeValue('modelAnimProgress', state.modelAnimProgress);
  setRangeValue('modelAnimSpeed', state.modelAnimSpeed);
  setValueInput('modelAnimProgress', state.modelAnimProgress);
  setValueInput('modelAnimSpeed', state.modelAnimSpeed);
}

async function buildParticles(source, label, options = {}) {
  const { resetView = false } = options;
  const buildStartedAt = performance.now();
  const token = ++buildToken;
  setStatus('Sampling');
  await nextFrame();

  try {
    configureModelAnimation(source, { reset: source !== modelAnimation.source });
    applyModelAnimationPose(getModelAnimationSeconds(0, false), { updateGeometry: false });
    const particleGeometry = createParticleGeometry(source, state.particleCount);
    const emissionGeometry = createEmissionGeometry(source, state.emissionCount);
    if (token !== buildToken) {
      particleGeometry.dispose();
      emissionGeometry.dispose();
      return false;
    }

    if (particles) {
      const previousGeometry = particles.geometry;
      particles.geometry = particleGeometry;
      if (glowParticles) {
        glowParticles.geometry = particleGeometry;
        glowParticles.visible = false;
      }
      previousGeometry.dispose();
      particles.rotation.set(0, 0, 0);
      glowParticles?.rotation.set(0, 0, 0);
    } else {
      glowParticles = new THREE.Points(particleGeometry, glowMaterial);
      glowParticles.renderOrder = 2;
      glowParticles.frustumCulled = false;
      glowParticles.visible = false;
      modelEffectRoot.add(glowParticles);
      particles = new THREE.Points(particleGeometry, particleMaterial);
      particles.renderOrder = 1;
      particles.frustumCulled = false;
      modelEffectRoot.add(particles);
    }

    if (emissionParticles) {
      const previousEmissionGeometry = emissionParticles.geometry;
      emissionParticles.geometry = emissionGeometry;
      if (emissionGlowParticles) {
        emissionGlowParticles.geometry = emissionGeometry;
        emissionGlowParticles.visible = false;
      }
      previousEmissionGeometry.dispose();
      emissionParticles.rotation.set(0, 0, 0);
      emissionGlowParticles?.rotation.set(0, 0, 0);
    } else {
      emissionGlowParticles = new THREE.Points(emissionGeometry, emissionGlowMaterial);
      emissionGlowParticles.renderOrder = 4;
      emissionGlowParticles.frustumCulled = false;
      emissionGlowParticles.visible = false;
      modelEffectRoot.add(emissionGlowParticles);
      emissionParticles = new THREE.Points(emissionGeometry, emissionMaterial);
      emissionParticles.renderOrder = 3;
      emissionParticles.frustumCulled = false;
      modelEffectRoot.add(emissionParticles);
    }

    if (resetView) {
      modelEffectRoot.rotation.set(0, 0, 0);
    }
    resetModelEffectChildRotations();
    rebuildVisibleModel(source);
    updateModelBreakRootInverse();
    applyModelAnimationPose(getModelAnimationSeconds(0, false), { force: true });
    currentSource = source;
    currentLabel = label;
    modelName.textContent = `当前：${label}`;
    syncActiveSceneModelAfterBuild(source, label);
    syncUniforms();
    syncEmissionUniforms();
    syncEffectVisibility();
    updateStats();
    perfStats.buildMs = performance.now() - buildStartedAt;
    perfStats.lastParticleCount = particleGeometry.userData?.capacity || state.particleCount;
    perfStats.lastEmissionCount = emissionGeometry.userData?.capacity || state.emissionCount;
    if (resetView) {
      resetCamera();
    }
    setStatus('Ready');
    window.dispatchEvent(new Event('particle-studio-ready'));
    return true;
  } catch (error) {
    console.error(error);
    setStatus('Load failed');
    modelName.textContent = '当前：无法读取模型';
    return false;
  }
}

function createSceneModelRecord(options = {}) {
  const name = options.name || options.label || 'Model';
  return {
    id: options.id || crypto.randomUUID(),
    name,
    source: options.source || currentSource,
    payload: options.payload || currentModelPayload,
    options: sanitizeSceneModelOptions(options.options || captureKeyframeOptions()),
    transform: normalizeSceneModelTransform(options.transform),
    effectRotation: normalizeVectorArray(options.effectRotation, [0, 0, 0]),
    hidden: Boolean(options.hidden),
    snapshotRoot: null
  };
}

function sanitizeSceneModelOptions(options = {}) {
  const snapshot = { ...captureKeyframeOptions(), ...options };
  if (!VALID_EFFECT_MODES.has(snapshot.effectMode) || snapshot.effectMode === 'image') {
    snapshot.effectMode = 'particles';
  }
  snapshot.particleCount = Math.max(MIN_PARTICLE_COUNT, Math.round(Number(snapshot.particleCount) || state.particleCount || MIN_PARTICLE_COUNT));
  NUMERIC_KEYFRAME_FIELDS.forEach((field) => {
    if (snapshot[field] !== undefined) {
      const value = Number(snapshot[field]);
      if (Number.isFinite(value)) {
        snapshot[field] = normalizeNumericStateValue(field, value);
      }
    }
  });
  BOOLEAN_KEYFRAME_FIELDS.forEach((field) => {
    if (snapshot[field] !== undefined) {
      snapshot[field] = Boolean(snapshot[field]);
    }
  });
  COLOR_KEYFRAME_FIELDS.forEach((field) => {
    if (typeof snapshot[field] !== 'string') {
      snapshot[field] = state[field];
    }
  });
  return snapshot;
}

function normalizeSceneModelTransform(transform = {}) {
  const position = normalizeVectorArray(transform.position, [0, 0, 0]);
  const rawScale = Array.isArray(transform.scale)
    ? transform.scale.map(Number).slice(0, 3)
    : [Number(transform.scale || 1), Number(transform.scale || 1), Number(transform.scale || 1)];
  const scale = rawScale.length === 3 && rawScale.every(Number.isFinite)
    ? rawScale.map((value) => Math.max(0.001, value))
    : [1, 1, 1];
  let quaternion = null;

  if (Array.isArray(transform.quaternion) && transform.quaternion.length >= 4) {
    const values = transform.quaternion.map(Number).slice(0, 4);
    const candidate = new THREE.Quaternion().fromArray(values);
    if (values.every(Number.isFinite) && candidate.lengthSq() > 0.000001) {
      quaternion = candidate.normalize();
    }
  }

  if (!quaternion) {
    const rotation = normalizeVectorArray(transform.rotation, [0, 0, 0]);
    quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(
      THREE.MathUtils.degToRad(rotation[0]),
      THREE.MathUtils.degToRad(rotation[1]),
      THREE.MathUtils.degToRad(rotation[2])
    ));
  }

  return {
    position,
    quaternion: quaternion.toArray(),
    scale
  };
}

function createDefaultSceneModelTransform(index = sceneModelObjects.length) {
  if (index <= 0) {
    return { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
  }

  const column = index % 5;
  const row = Math.floor(index / 5);
  return {
    position: [column * 1.35, 0, -row * 1.35],
    rotation: [0, 0, 0],
    scale: [1, 1, 1]
  };
}

function captureActiveSceneModelTransform() {
  return {
    position: activeModelTransformRoot.position.toArray(),
    quaternion: activeModelTransformRoot.quaternion.normalize().toArray(),
    scale: activeModelTransformRoot.scale.toArray()
  };
}

function applySceneModelTransformToObject(object, transform = {}) {
  const normalized = normalizeSceneModelTransform(transform);
  object.position.fromArray(normalized.position);
  object.quaternion.fromArray(normalized.quaternion).normalize();
  object.scale.fromArray(normalized.scale);
  object.updateMatrixWorld(true);
}

function applyActiveSceneModelTransform(transform = {}) {
  applySceneModelTransformToObject(activeModelTransformRoot, transform);
  updateModelBreakRootInverse();
}

function getSelectedSceneModel() {
  return sceneModelObjects.find((record) => record.id === selectedSceneModelId) || null;
}

function syncActiveSceneModelAfterBuild(source, label) {
  if (sceneModelSaveSuspended) {
    return;
  }

  let record = getSelectedSceneModel();
  if (!record) {
    record = createSceneModelRecord({
      name: label,
      source,
      payload: currentModelPayload,
      options: captureKeyframeOptions(),
      transform: captureActiveSceneModelTransform(),
      effectRotation: modelEffectRoot.rotation.toArray()
    });
    sceneModelObjects.push(record);
    selectedSceneModelId = record.id;
  } else {
    record.name = label || record.name;
    record.source = source || record.source;
    record.payload = currentModelPayload || record.payload;
    record.options = sanitizeSceneModelOptions(captureKeyframeOptions());
  }
  renderSceneModelList();
}

function saveActiveSceneModel(options = {}) {
  if (sceneModelSaveSuspended) {
    return null;
  }

  const record = getSelectedSceneModel();
  if (!record || !currentSource) {
    return record;
  }

  record.source = currentSource;
  record.name = currentLabel || record.name;
  record.payload = currentModelPayload || record.payload;
  record.options = sanitizeSceneModelOptions(captureKeyframeOptions());
  record.transform = captureActiveSceneModelTransform();
  record.effectRotation = modelEffectRoot.rotation.toArray();
  if (options.createSnapshot !== false) {
    buildSceneModelSnapshotFromActive(record);
  }
  renderSceneModelList();
  return record;
}

function syncSelectedSceneModelRecord(options = {}) {
  if (sceneModelSaveSuspended) {
    return null;
  }

  const record = getSelectedSceneModel();
  if (!record) {
    return null;
  }

  record.source = currentSource || record.source;
  record.name = currentLabel || record.name;
  record.payload = currentModelPayload || record.payload;
  record.options = sanitizeSceneModelOptions(captureKeyframeOptions());
  record.transform = captureActiveSceneModelTransform();
  record.effectRotation = modelEffectRoot.rotation.toArray();
  if (options.renderList) {
    renderSceneModelList();
  }
  return record;
}

function disposeAllSceneModels() {
  sceneModelObjects.forEach((record) => disposeSceneModelSnapshot(record));
  sceneModelObjects.length = 0;
  selectedSceneModelId = null;
}

function createImportedSceneModelRecord(source, label, payload, options = {}) {
  const append = options.importMode === 'append';
  if (append) {
    saveActiveSceneModel({ createSnapshot: true });
  } else {
    disposeAllSceneModels();
  }

  const record = createSceneModelRecord({
    name: label,
    source,
    payload,
    options: { ...captureKeyframeOptions(), effectMode: 'particles', ...(options.options || {}) },
    transform: createDefaultSceneModelTransform(append ? sceneModelObjects.length : 0),
    effectRotation: [0, 0, 0]
  });
  sceneModelObjects.push(record);
  selectedSceneModelId = record.id;
  return record;
}

async function activateImportedSceneModel(record, source, label, payload, options = {}) {
  applyActiveSceneModelTransform(record.transform);
  modelEffectRoot.rotation.set(0, 0, 0);
  currentModelPayload = payload;
  clearMorphTarget({ rebuild: false });
  currentImageSplatPayload = null;
  currentGaussianSplatPayload = null;
  selectedImageSplat = false;
  removeImageSplatObject();
  await removeRealSplatObject();
  state.effectMode = 'particles';
  transformControls.detach();
  transformControls.visible = false;
  await buildParticles(source, label, { resetView: options.resetView !== false });
  selectSceneModelTransform();
}

function disposeSceneModelSnapshot(record) {
  if (!record?.snapshotRoot) {
    return;
  }

  record.snapshotRoot.traverse((node) => {
    if ((node.isPoints || node.userData.disposeGeometry) && node.geometry?.dispose) {
      node.geometry.dispose();
    }
    if (node.material) {
      disposeDisplayMaterial(node.material);
    }
  });
  scene.remove(record.snapshotRoot);
  record.snapshotRoot = null;
}

function buildSceneModelSnapshotFromActive(record) {
  if (!record || !particles || record.id !== selectedSceneModelId) {
    return;
  }

  disposeSceneModelSnapshot(record);
  const options = sanitizeSceneModelOptions(record.options);
  const root = new THREE.Group();
  root.name = `${record.name || 'Model'} Scene Snapshot`;
  root.userData.sceneModelId = record.id;
  root.userData.sceneModelPickTarget = true;
  root.visible = !record.hidden;
  applySceneModelTransformToObject(root, record.transform);

  const effectRoot = new THREE.Group();
  effectRoot.rotation.fromArray(normalizeVectorArray(record.effectRotation, [0, 0, 0]));
  effectRoot.userData.sceneModelId = record.id;
  effectRoot.userData.sceneModelPickTarget = true;
  root.add(effectRoot);

  if (
    options.effectMode === 'emission' ||
    (options.effectMode === 'particles' && Number(options.particleizeProgress || 0) < 0.995)
  ) {
    const solid = createSceneModelVisibleSnapshot(record.source, options);
    if (solid) {
      effectRoot.add(solid);
    }
  }

  if (options.effectMode === 'emission' && emissionParticles?.geometry && options.emissionEnabled) {
    const geometry = emissionParticles.geometry.clone();
    const material = createSceneModelEmissionMaterial(options, geometry);
    const points = new THREE.Points(geometry, material);
    points.name = `${record.name || 'Model'} Emission Snapshot`;
    points.frustumCulled = false;
    points.renderOrder = 1;
    effectRoot.add(points);
  } else if (particles?.geometry) {
    const geometry = particles.geometry.clone();
    const material = createSceneModelParticleMaterial(options, geometry);
    const points = new THREE.Points(geometry, material);
    points.name = `${record.name || 'Model'} Particle Snapshot`;
    points.frustumCulled = false;
    points.renderOrder = 1;
    effectRoot.add(points);
  }

  scene.add(root);
  record.snapshotRoot = root;
}

function createSceneModelVisibleSnapshot(source, options = {}) {
  if (!source) {
    return null;
  }

  const { center, scale } = computeModelNormalization(source);
  const wrapper = new THREE.Group();
  wrapper.name = 'Scene Model Solid Snapshot';
  wrapper.userData.sceneModelPickTarget = true;
  wrapper.scale.setScalar(scale);
  wrapper.position.copy(center).multiplyScalar(-scale);
  const clone = hasModelAnimation(source) ? cloneSkeletonRoot(source) : source.clone(true);
  const visibility = THREE.MathUtils.clamp(Number(options.modelVisibility ?? 1), 0, 1) *
    getParticleDissolveSolidOpacity(options);
  const particleizeOpacity = options.effectMode === 'particles'
    ? 1 - THREE.MathUtils.clamp(Number(options.particleizeProgress) || 0, 0, 1)
    : 1;
  const solidOpacity = particleizeOpacity * visibility;
  clone.traverse((node) => {
    if (!node.isMesh || node.userData.generatedSolidCap) {
      return;
    }
    node.material = cloneSceneModelDisplayMaterial(node.material, options, solidOpacity);
    node.frustumCulled = false;
    node.renderOrder = 1;
  });
  wrapper.add(clone);
  return wrapper;
}

function cloneSceneModelDisplayMaterial(material, options = {}, opacity = 1) {
  if (Array.isArray(material)) {
    return material.map((item) => cloneSceneModelDisplayMaterial(item, options, opacity));
  }

  const source = material || new THREE.MeshBasicMaterial({ color: 0xffffff });
  const whiteColor = new THREE.Color(0xf1f3f1);
  const particleizeMode = options.effectMode === 'particles';
  const baseColor = source.userData?.baseColor?.clone?.() || (source.color ? source.color.clone() : new THREE.Color(1, 1, 1));
  const baseMap = source.userData?.baseMap || source.map || null;
  const safeMap = options.useTexture && baseMap ? acquireSafeDisplayTexture(baseMap) : null;
  const baseMetalness = source.userData?.baseMetalness ?? source.metalness ?? 0;
  const whiteAmount = options.effectMode === 'emission'
    ? THREE.MathUtils.clamp(Number(options.modelWhite) || 0, 0, 1)
    : 0;
  const displayMaterial = new THREE.MeshStandardMaterial({
    color: baseColor.clone().lerp(whiteColor, whiteAmount),
    map: safeMap && whiteAmount <= 0.42 ? safeMap : null,
    normalMap: null,
    roughnessMap: null,
    metalnessMap: null,
    emissiveMap: null,
    side: particleizeMode ? THREE.FrontSide : THREE.DoubleSide,
    vertexColors: Boolean(source.vertexColors),
    transparent: opacity < 0.999,
    opacity: THREE.MathUtils.clamp(opacity, 0, 1),
    roughness: particleizeMode ? 0.55 : THREE.MathUtils.clamp(Number(options.modelRoughness ?? 0.55), 0, 1),
    metalness: Math.min(baseMetalness, 0.25) * (1 - whiteAmount * 0.85),
    emissive: particleizeMode ? new THREE.Color(0x000000) : whiteColor,
    emissiveIntensity: particleizeMode ? 0 : 0.025 + whiteAmount * 0.08,
    depthTest: true,
    depthWrite: opacity >= 0.999,
    alphaTest: 0
  });
  displayMaterial.userData.baseColor = baseColor;
  displayMaterial.userData.baseMap = baseMap;
  displayMaterial.userData.safeDisplayTextureSource = safeMap ? baseMap : null;
  displayMaterial.userData.safeDisplayMap = safeMap;
  displayMaterial.userData.baseMetalness = baseMetalness;
  return displayMaterial;
}

function copyPointMaterialRenderState(target, source) {
  target.depthTest = source.depthTest;
  target.depthWrite = source.depthWrite;
  target.blending = source.blending;
  target.transparent = source.transparent;
  target.toneMapped = source.toneMapped;
  target.forceSinglePass = source.forceSinglePass;
}

function createSceneModelParticleMaterial(options = {}, geometry = null) {
  const material = particleMaterial.clone();
  material.uniforms = THREE.UniformsUtils.clone(uniforms);
  copyPointMaterialRenderState(material, particleMaterial);
  applySceneModelParticleUniforms(material.uniforms, options, geometry);
  return material;
}

function createSceneModelEmissionMaterial(options = {}, geometry = null) {
  const material = emissionMaterial.clone();
  material.uniforms = THREE.UniformsUtils.clone(emissionUniforms);
  copyPointMaterialRenderState(material, emissionMaterial);
  applySceneModelEmissionUniforms(material.uniforms, options, geometry);
  return material;
}

function optionNumber(options, key, fallback = 0) {
  const value = Number(options?.[key]);
  return Number.isFinite(value) ? value : fallback;
}

function applySceneModelParticleUniforms(targetUniforms, options = {}, geometry = null) {
  targetUniforms.uTime.value = uniforms.uTime.value;
  targetUniforms.uPixelRatio.value = studioPixelRatio;
  targetUniforms.uPointSize.value = optionNumber(options, 'pointSize', state.pointSize);
  targetUniforms.uEdgeFeather.value = optionNumber(options, 'edgeFeather', state.edgeFeather);
  targetUniforms.uSizeRandom.value = optionNumber(options, 'sizeRandom', state.sizeRandom);
  targetUniforms.uGlowRadius.value = optionNumber(options, 'glowRadius', state.glowRadius);
  targetUniforms.uGlowExposure.value = optionNumber(options, 'glowExposure', state.glowExposure);
  targetUniforms.uParticleizeProgress.value = optionNumber(options, 'particleizeProgress', state.particleizeProgress);
  targetUniforms.uModelVisibility.value = THREE.MathUtils.clamp(optionNumber(options, 'modelVisibility', state.modelVisibility), 0, 1);
  targetUniforms.uSpread.value = optionNumber(options, 'spread', state.spread);
  targetUniforms.uNoise.value = optionNumber(options, 'noise', state.noise);
  targetUniforms.uNoiseScale.value = optionNumber(options, 'noiseScale', state.noiseScale);
  targetUniforms.uSwirl.value = optionNumber(options, 'swirl', state.swirl);
  targetUniforms.uDissolve.value = optionNumber(options, 'dissolve', state.dissolve);
  targetUniforms.uDissolveSpread.value = optionNumber(options, 'dissolveSpread', state.dissolveSpread);
  targetUniforms.uDissolveEdgeWidth.value = optionNumber(options, 'dissolveEdgeWidth', state.dissolveEdgeWidth);
  targetUniforms.uDissolveTurbulence.value = optionNumber(options, 'dissolveTurbulence', state.dissolveTurbulence);
  targetUniforms.uDissolveCurl.value = optionNumber(options, 'dissolveCurl', state.dissolveCurl);
  targetUniforms.uDissolveMist.value = optionNumber(options, 'dissolveMist', state.dissolveMist);
  targetUniforms.uDissolveDirection.value.set(
    optionNumber(options, 'dissolveDirectionX', state.dissolveDirectionX),
    optionNumber(options, 'dissolveDirectionY', state.dissolveDirectionY),
    optionNumber(options, 'dissolveDirectionZ', state.dissolveDirectionZ)
  );
  targetUniforms.uDissolveLift.value = optionNumber(options, 'dissolveLift', state.dissolveLift);
  targetUniforms.uGrowth.value = optionNumber(options, 'growth', state.growth);
  targetUniforms.uGrowthFlow.value = optionNumber(options, 'growthFlow', state.growthFlow);
  targetUniforms.uGrowthWidth.value = optionNumber(options, 'growthWidth', state.growthWidth);
  targetUniforms.uGrowthTurbulence.value = optionNumber(options, 'growthTurbulence', state.growthTurbulence);
  targetUniforms.uOrganicFlow.value = optionNumber(options, 'organicFlow', state.organicFlow);
  targetUniforms.uEdgeBreak.value = optionNumber(options, 'edgeBreak', state.edgeBreak);
  targetUniforms.uFilamentLength.value = optionNumber(options, 'filamentLength', state.filamentLength);
  targetUniforms.uFilamentCurl.value = optionNumber(options, 'filamentCurl', state.filamentCurl);
  targetUniforms.uMorphMode.value = options.effectMode === 'morph' ? 1 : 0;
  targetUniforms.uMorphReady.value = options.effectMode === 'morph' && geometry?.userData?.hasMorphTarget ? 1 : 0;
  targetUniforms.uMorphProgress.value = optionNumber(options, 'morphProgress', state.morphProgress);
  targetUniforms.uMorphFlow.value = optionNumber(options, 'morphFlow', state.morphFlow);
  targetUniforms.uMorphScatter.value = optionNumber(options, 'morphScatter', state.morphScatter);
  targetUniforms.uMorphTurbulence.value = optionNumber(options, 'morphTurbulence', state.morphTurbulence);
  targetUniforms.uMorphTrail.value = optionNumber(options, 'morphTrail', state.morphTrail);
  targetUniforms.uMorphDirection.value.set(
    optionNumber(options, 'morphDirX', state.morphDirX),
    optionNumber(options, 'morphDirY', state.morphDirY),
    optionNumber(options, 'morphDirZ', state.morphDirZ)
  );
  targetUniforms.uUseTexture.value = options.useTexture ? 1 : 0;
  targetUniforms.uColorA.value.set(options.colorA || state.colorA);
  targetUniforms.uColorB.value.set(options.colorB || state.colorB);
  targetUniforms.uGlowPass.value = 0;
  syncParticleLightingUniformSet(targetUniforms);
}

function applySceneModelEmissionUniforms(targetUniforms, options = {}, geometry = null) {
  targetUniforms.uTime.value = emissionUniforms.uTime.value;
  targetUniforms.uPixelRatio.value = studioPixelRatio;
  targetUniforms.uEmissionEnabled.value = options.emissionEnabled ? 1 : 0;
  targetUniforms.uEmissionIntensity.value = optionNumber(options, 'emissionIntensity', state.emissionIntensity);
  targetUniforms.uEmissionDistance.value = optionNumber(options, 'emissionDistance', state.emissionDistance);
  targetUniforms.uEmissionSpeed.value = optionNumber(options, 'emissionSpeed', state.emissionSpeed);
  targetUniforms.uEmissionWind.value.set(
    optionNumber(options, 'emissionWindX', state.emissionWindX),
    optionNumber(options, 'emissionWindY', state.emissionWindY),
    optionNumber(options, 'emissionWindZ', state.emissionWindZ)
  );
  targetUniforms.uEmissionTurbulence.value = optionNumber(options, 'emissionTurbulence', state.emissionTurbulence);
  targetUniforms.uEmissionSize.value = optionNumber(options, 'emissionSize', state.emissionSize);
  targetUniforms.uEmissionOpacity.value = optionNumber(options, 'emissionOpacity', state.emissionOpacity);
  targetUniforms.uModelVisibility.value = THREE.MathUtils.clamp(optionNumber(options, 'modelVisibility', state.modelVisibility), 0, 1);
  targetUniforms.uEmissionGlow.value = optionNumber(options, 'emissionGlow', state.emissionGlow);
  targetUniforms.uModelWhite.value = optionNumber(options, 'modelWhite', state.modelWhite);
  targetUniforms.uUseTexture.value = options.useTexture ? 1 : 0;
  targetUniforms.uColorA.value.set(options.colorA || state.colorA);
  targetUniforms.uColorB.value.set(options.colorB || state.colorB);
  targetUniforms.uBreakAmount.value = optionNumber(options, 'breakAmount', state.breakAmount);
  targetUniforms.uBreakProgress.value = optionNumber(options, 'breakProgress', state.breakProgress);
  targetUniforms.uBreakRadius.value = optionNumber(options, 'breakRadius', state.breakRadius);
  targetUniforms.uBreakFeather.value = optionNumber(options, 'breakFeather', state.breakFeather);
  targetUniforms.uBreakCenter.value.set(
    optionNumber(options, 'breakCenterX', state.breakCenterX),
    optionNumber(options, 'breakCenterY', state.breakCenterY),
    optionNumber(options, 'breakCenterZ', state.breakCenterZ)
  );
  targetUniforms.uBreakSpeed.value = optionNumber(options, 'breakSpeed', state.breakSpeed);
  targetUniforms.uBreakSize.value = optionNumber(options, 'breakSize', state.breakSize);
  targetUniforms.uGlowPass.value = 0;
  const capacity = geometry?.userData?.capacity || optionNumber(options, 'emissionCount', state.emissionCount) || 1;
  targetUniforms.uEmissionCountRatio.value = THREE.MathUtils.clamp(
    optionNumber(options, 'emissionCount', state.emissionCount) / Math.max(capacity, 1),
    0,
    1
  );
  syncParticleLightingUniformSet(targetUniforms);
}

function updateSceneModelSnapshotUniforms() {
  sceneModelObjects.forEach((record) => {
    if (!record.snapshotRoot) {
      return;
    }
    record.snapshotRoot.visible = !record.hidden && THREE.MathUtils.clamp(Number(record.options?.modelVisibility ?? 1), 0, 1) > 0.001;
    const solidOpacity = THREE.MathUtils.clamp(Number(record.options?.modelVisibility ?? 1), 0, 1) *
      getParticleDissolveSolidOpacity(record.options);
    record.snapshotRoot.traverse((node) => {
      if (node.isMesh && node.material) {
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        materials.forEach((material) => {
          if (!material) {
            return;
          }
          material.opacity = solidOpacity;
          material.transparent = solidOpacity < 0.999;
          material.depthWrite = solidOpacity >= 0.999;
          material.needsUpdate = true;
        });
      }
      if (!node.isPoints || !node.material?.uniforms) {
        return;
      }
      if (node.material.uniforms.uEmissionEnabled) {
        applySceneModelEmissionUniforms(node.material.uniforms, record.options, node.geometry);
      } else if (node.material.uniforms.uPointSize) {
        applySceneModelParticleUniforms(node.material.uniforms, record.options, node.geometry);
      }
    });
  });
}

function sceneModelEffectLabel(mode) {
  if (mode === 'emission') {
    return '逸散';
  }
  if (mode === 'morph') {
    return '转换';
  }
  return '粒子';
}

function renderSceneModelList() {
  if (!controlsUi.sceneModelList) {
    return;
  }

  controlsUi.sceneModelList.innerHTML = '';
  sceneModelObjects.forEach((record, index) => {
    const row = document.createElement('div');
    row.className = `scene-model-row${record.id === selectedSceneModelId ? ' active' : ''}${record.hidden ? ' is-hidden' : ''}`;

    const button = document.createElement('button');
    button.className = `scene-model-item${record.id === selectedSceneModelId ? ' active' : ''}${record.hidden ? ' is-hidden' : ''}`;
    button.type = 'button';
    button.dataset.sceneModelId = record.id;
    button.innerHTML = `
      <span class="scene-model-index">${index + 1}</span>
      <span class="scene-model-name">${record.name || 'Model'}</span>
      <span class="scene-model-effect">${sceneModelEffectLabel(record.options?.effectMode)}</span>
    `;
    button.addEventListener('click', () => activateSceneModel(record.id));

    const visibilityButton = document.createElement('button');
    visibilityButton.className = 'scene-model-visibility';
    visibilityButton.type = 'button';
    visibilityButton.title = record.hidden ? '显示模型' : '隐藏模型';
    visibilityButton.setAttribute('aria-label', record.hidden ? '显示模型' : '隐藏模型');
    visibilityButton.textContent = record.hidden ? '○' : '●';
    visibilityButton.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleSceneModelHidden(record.id);
    });

    row.append(button, visibilityButton);
    controlsUi.sceneModelList.append(row);
  });
  updateSceneModelTransformButtons();
}

function toggleSceneModelHidden(recordId) {
  const record = sceneModelObjects.find((item) => item.id === recordId);
  if (!record) {
    return false;
  }

  recordUndoStep(record.hidden ? '显示模型' : '隐藏模型');
  record.hidden = !record.hidden;
  if (record.snapshotRoot) {
    record.snapshotRoot.visible = !record.hidden && THREE.MathUtils.clamp(Number(record.options?.modelVisibility ?? 1), 0, 1) > 0.001;
  }
  if (record.id === selectedSceneModelId) {
    syncEffectVisibility();
  }
  renderSceneModelList();
  setCameraPreviewDirty();
  setStatus(record.hidden ? 'Model hidden' : 'Model visible');
  return true;
}

function applySceneModelOptionsToState(options = {}) {
  const snapshot = sanitizeSceneModelOptions(options);
  state.particleCount = snapshot.particleCount;
  NUMERIC_KEYFRAME_FIELDS.forEach((field) => {
    if (snapshot[field] !== undefined) {
      state[field] = snapshot[field];
    }
  });
  COLOR_KEYFRAME_FIELDS.forEach((field) => {
    if (snapshot[field] !== undefined) {
      state[field] = snapshot[field];
    }
  });
  BOOLEAN_KEYFRAME_FIELDS.forEach((field) => {
    if (snapshot[field] !== undefined) {
      state[field] = Boolean(snapshot[field]);
    }
  });
  STRING_KEYFRAME_FIELDS.forEach((field) => {
    if (snapshot[field] !== undefined) {
      state[field] = VALID_EFFECT_MODES.has(snapshot[field]) ? snapshot[field] : 'particles';
    }
  });
}

async function activateSceneModel(recordId, options = {}) {
  const record = sceneModelObjects.find((item) => item.id === recordId);
  if (!record) {
    return false;
  }

  const alreadySelected = selectedSceneModelId === record.id;
  if (alreadySelected && !options.force) {
    selectSceneModelTransform();
    return true;
  }

  if (!options.skipSave) {
    saveActiveSceneModel({ createSnapshot: true });
  }

  selectedSceneModelId = record.id;
  selectedImageSplat = false;
  selectedVideoPlaneId = null;
  selectedLightId = null;
  selectedKeyframeId = null;
  selectedKeyframeObject = null;
  selectedCameraBezierHandle = null;
  disposeSceneModelSnapshot(record);
  removeImageSplatObject();
  await removeRealSplatObject();
  currentImageSplatPayload = null;
  currentGaussianSplatPayload = null;
  currentModelPayload = record.payload || null;
  applySceneModelOptionsToState(record.options);
  applyActiveSceneModelTransform(record.transform);
  modelEffectRoot.rotation.fromArray(normalizeVectorArray(record.effectRotation, [0, 0, 0]));
  sceneModelSaveSuspended = true;
  try {
    await buildParticles(record.source, record.name, { resetView: false });
  } finally {
    sceneModelSaveSuspended = false;
  }
  currentSource = record.source;
  currentLabel = record.name;
  syncUi();
  syncUniforms();
  selectSceneModelTransform();
  renderSceneModelList();
  return true;
}

function syncTransformProxyFromSceneModel() {
  selectedTransformProxy.position.copy(activeModelTransformRoot.position);
  selectedTransformProxy.quaternion.copy(activeModelTransformRoot.quaternion);
  selectedTransformProxy.scale.copy(activeModelTransformRoot.scale);
  selectedTransformProxy.updateMatrixWorld(true);
}

function commitSelectedSceneModelTransform() {
  const record = getSelectedSceneModel();
  if (!record) {
    return null;
  }

  activeModelTransformRoot.quaternion.normalize();
  activeModelTransformRoot.updateMatrixWorld(true);
  record.transform = captureActiveSceneModelTransform();
  updateModelBreakRootInverse();
  return record;
}

function selectSceneModelTransform() {
  if (!selectedSceneModelId || exportSettings.hideUi) {
    return;
  }

  selectedImageSplat = false;
  selectedVideoPlaneId = null;
  selectedLightId = null;
  selectedKeyframeId = null;
  selectedKeyframeObject = null;
  selectedCameraBezierHandle = null;
  resetTransformAxisConstraint(false);
  renderLightList();
  syncLightUi();
  transformControls.setMode(selectedSceneModelMode);
  transformControls.setSpace(selectedSceneModelMode === 'rotate' || selectedSceneModelMode === 'scale' ? 'local' : 'world');
  transformControls.attach(activeModelTransformRoot);
  transformControls.visible = true;
  transformControls.enabled = true;
  applyTransformAxisConstraint();
  updateSceneModelTransformButtons();
}

function setSelectedSceneModelMode(mode) {
  selectedSceneModelMode = ['translate', 'rotate', 'scale'].includes(mode) ? mode : 'translate';
  if (selectedSceneModelId) {
    selectSceneModelTransform();
    return;
  }
  updateSceneModelTransformButtons();
}

function updateSceneModelTransformButtons() {
  controlsUi.moveSceneModel?.classList.toggle('active', selectedSceneModelMode === 'translate');
  controlsUi.rotateSceneModel?.classList.toggle('active', selectedSceneModelMode === 'rotate');
  controlsUi.scaleSceneModel?.classList.toggle('active', selectedSceneModelMode === 'scale');
}

async function duplicateSelectedSceneModel() {
  const sourceRecord = saveActiveSceneModel({ createSnapshot: false }) || getSelectedSceneModel();
  if (!sourceRecord) {
    return;
  }

  const transform = normalizeSceneModelTransform(sourceRecord.transform);
  transform.position[0] += 0.75;
  const duplicate = createSceneModelRecord({
    name: `${sourceRecord.name || 'Model'} Copy`,
    source: sourceRecord.source,
    payload: sourceRecord.payload,
    options: { ...sourceRecord.options },
    transform,
    effectRotation: [...sourceRecord.effectRotation]
  });
  sceneModelObjects.push(duplicate);
  await activateSceneModel(duplicate.id);
}

async function deleteSelectedSceneModel() {
  const record = getSelectedSceneModel();
  if (!record) {
    return;
  }
  if (sceneModelObjects.length <= 1) {
    setStatus('Keep at least one model');
    return;
  }

  disposeSceneModelSnapshot(record);
  const index = sceneModelObjects.indexOf(record);
  sceneModelObjects.splice(index, 1);
  const next = sceneModelObjects[Math.min(index, sceneModelObjects.length - 1)];
  selectedSceneModelId = null;
  await activateSceneModel(next.id, { skipSave: true, force: true });
}

function getSelectedVideoPlane() {
  return videoPlaneObjects.find((record) => record.id === selectedVideoPlaneId) || null;
}

function normalizeVideoPlaneTransform(transform = {}) {
  return normalizeSceneModelTransform(transform);
}

function createDefaultVideoPlaneTransform(index = videoPlaneObjects.length) {
  return {
    position: [index * 0.35, 0.85, 0.65 + index * 0.08],
    rotation: [0, 180, 0],
    scale: [1, 1, 1]
  };
}

function getVideoPlaneDuration(record) {
  const duration = Number(record?.video?.duration);
  return Number.isFinite(duration) && duration > 0 ? duration : Math.max(0.001, Number(record?.duration) || 1);
}

function normalizeVideoPlaneDescriptor(descriptor = {}, index = 0) {
  const extension = String(descriptor.extension || descriptor.payload?.extension || '').toLowerCase();
  const playbackUrl = descriptor.playbackUrl || descriptor.proxyUrl || descriptor.url || descriptor.payload?.playbackUrl || descriptor.payload?.proxyUrl || descriptor.payload?.url;
  const width = Math.max(0.01, Number(descriptor.width) || 3);
  const rawHeight = Number(descriptor.height);
  const height = Math.max(0.01, Number.isFinite(rawHeight) && rawHeight > 0 ? rawHeight : width * 9 / 16);
  const payload = {
    ...(descriptor.payload || {}),
    name: descriptor.name || descriptor.payload?.name,
    extension,
    path: descriptor.path || descriptor.payload?.path,
    sourcePath: descriptor.sourcePath || descriptor.payload?.sourcePath,
    dataUrl: descriptor.dataUrl || descriptor.payload?.dataUrl || null,
    url: descriptor.payload?.url,
    size: descriptor.size || descriptor.payload?.size
  };
  return {
    id: typeof descriptor.id === 'string' && descriptor.id ? descriptor.id : `video-${index}-${crypto.randomUUID()}`,
    name: descriptor.name || payload.name || `Video ${index + 1}`,
    extension,
    playbackExtension: descriptor.playbackExtension || descriptor.payload?.playbackExtension || extension,
    sourceExtension: descriptor.sourceExtension || descriptor.payload?.sourceExtension || extension,
    payload,
    url: playbackUrl || payload.url || payload.dataUrl || '',
    proxyUrl: descriptor.proxyUrl || descriptor.payload?.proxyUrl || '',
    proxyPath: descriptor.proxyPath || descriptor.payload?.proxyPath || '',
    proxyCached: Boolean(descriptor.proxyCached || descriptor.payload?.proxyCached),
    proxyError: '',
    transform: normalizeVideoPlaneTransform(descriptor.transform || createDefaultVideoPlaneTransform(index)),
    width,
    height,
    opacity: THREE.MathUtils.clamp(Number(descriptor.opacity ?? 1), 0, 1),
    playbackRate: THREE.MathUtils.clamp(Number(descriptor.playbackRate ?? 1), 0, 4),
    timeOffset: Math.max(0, Number(descriptor.timeOffset ?? descriptor.currentTime ?? 0) || 0),
    loop: descriptor.loop !== false,
    muted: descriptor.muted !== false,
    duration: Math.max(0.001, Number(descriptor.duration) || 1)
  };
}

function createVideoPayload(file, extension) {
  const filePath = getLocalFilePath(file);
  if (filePath) {
    return Promise.resolve({
      name: file.name,
      extension,
      path: filePath,
      size: file.size
    });
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      resolve({
        name: file.name,
        extension,
        dataUrl: reader.result,
        size: file.size
      });
    });
    reader.addEventListener('error', () => reject(reader.error));
    reader.readAsDataURL(file);
  });
}

function waitForVideoMetadata(video) {
  if (video.readyState >= 1 && Number.isFinite(video.videoWidth) && video.videoWidth > 0) {
    return Promise.resolve(true);
  }

  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      resolve(false);
    }, 8000);
    const cleanup = () => {
      window.clearTimeout(timeout);
      video.removeEventListener('loadedmetadata', onLoaded);
      video.removeEventListener('error', onError);
    };
    const onLoaded = () => {
      cleanup();
      resolve(true);
    };
    const onError = () => {
      cleanup();
      reject(new Error('Video could not be decoded.'));
    };
    video.addEventListener('loadedmetadata', onLoaded, { once: true });
    video.addEventListener('error', onError, { once: true });
  });
}

function canPrepareMovProxy(descriptor) {
  if (!descriptor || descriptor.extension !== 'mov') {
    return false;
  }
  if (!window.electronAPI?.prepareVideoProxy) {
    return false;
  }
  return Boolean(
    descriptor.payload?.path ||
    descriptor.payload?.sourcePath ||
    descriptor.path ||
    descriptor.sourcePath ||
    descriptor.payload?.dataUrl ||
    descriptor.dataUrl
  );
}

async function prepareMovPlaybackProxy(descriptor) {
  if (!canPrepareMovProxy(descriptor)) {
    return null;
  }
  setStatus('Converting MOV');
  if (controlsUi.videoPlaneStatus) {
    controlsUi.videoPlaneStatus.value = 'MOV 正在生成透明预览代理，首次导入可能需要几秒；同一个文件下次会直接使用缓存。';
  }
  const result = await window.electronAPI.prepareVideoProxy({
    path: descriptor.payload?.path || descriptor.payload?.sourcePath || descriptor.path || descriptor.sourcePath || '',
    dataUrl: descriptor.payload?.dataUrl || descriptor.dataUrl || '',
    extension: descriptor.extension,
    name: descriptor.name || descriptor.payload?.name || 'video.mov'
  });
  if (!result?.ok || !result.url) {
    throw new Error(result?.error || 'MOV 代理转码失败。');
  }
  return result;
}

async function createVideoPlaneRecord(descriptor = {}, options = {}) {
  const normalized = normalizeVideoPlaneDescriptor(descriptor, videoPlaneObjects.length);
  let url = normalized.url || normalized.payload?.url || normalized.payload?.dataUrl;
  const originalUrl = url;
  if (normalized.extension === 'mov') {
    try {
      const proxy = await prepareMovPlaybackProxy(normalized);
      if (proxy?.url) {
        normalized.proxyUrl = proxy.url;
        normalized.proxyPath = proxy.path || '';
        normalized.proxyCached = Boolean(proxy.cached);
        normalized.playbackExtension = proxy.extension || 'webm';
        url = proxy.url;
      }
    } catch (error) {
      normalized.proxyError = error?.message || String(error);
      console.warn('MOV proxy preparation failed; trying direct playback.', error);
    }
  }
  if (!url) {
    throw new Error(normalized.proxyError || 'Video has no readable URL.');
  }

  const video = document.createElement('video');
  video.crossOrigin = 'anonymous';
  video.playsInline = true;
  video.muted = normalized.muted;
  video.loop = normalized.loop;
  video.preload = 'auto';
  video.src = url;
  video.playbackRate = Math.max(0.0625, normalized.playbackRate || 1);

  let metadataLoaded;
  try {
    metadataLoaded = await waitForVideoMetadata(video);
  } catch (error) {
    if (normalized.extension === 'mov' && normalized.proxyError) {
      throw new Error(`${normalized.proxyError}；直接播放也失败。`);
    }
    throw error;
  }
  const sourceWidth = Math.max(1, video.videoWidth || 16);
  const sourceHeight = Math.max(1, video.videoHeight || 9);
  const aspect = sourceWidth / sourceHeight;
  if (!descriptor.height) {
    normalized.height = Math.max(0.01, normalized.width / Math.max(aspect, 0.001));
  }
  normalized.duration = getVideoPlaneDuration({ video, duration: normalized.duration });

  const texture = new THREE.VideoTexture(video);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;

  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity: normalized.opacity,
    side: THREE.DoubleSide,
    depthWrite: false,
    toneMapped: false,
    alphaTest: 0.001
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  mesh.name = `${normalized.name} Plane`;
  mesh.renderOrder = 12;
  mesh.userData.videoPlaneId = normalized.id;
  mesh.userData.videoPlanePickTarget = true;
  mesh.frustumCulled = false;
  mesh.scale.set(normalized.width, normalized.height, 1);

  const root = new THREE.Group();
  root.name = normalized.name;
  root.userData.videoPlaneId = normalized.id;
  root.userData.videoPlanePickTarget = true;
  root.add(mesh);
  applySceneModelTransformToObject(root, normalized.transform);
  scene.add(root);

  const record = {
    ...normalized,
    url,
    originalUrl,
    ownsUrl: Boolean(options.ownsUrl),
    video,
    texture,
    material,
    mesh,
    root,
    proxyUrl: normalized.proxyUrl,
    proxyPath: normalized.proxyPath,
    proxyCached: normalized.proxyCached,
    proxyError: normalized.proxyError,
    playbackExtension: normalized.playbackExtension,
    sourceExtension: normalized.sourceExtension,
    metadataLoaded
  };

  video.addEventListener('error', () => {
    if (record.id === selectedVideoPlaneId && controlsUi.videoPlaneStatus) {
      controlsUi.videoPlaneStatus.value = '视频解码失败：请换用 Chromium 支持的编码，MOV 透明建议 ProRes/HEVC Alpha 或转 WebM Alpha。';
    }
  });

  const startTime = Math.min(normalized.timeOffset, Math.max(0, record.duration - 0.001));
  if (startTime > 0) {
    try {
      video.currentTime = startTime;
    } catch {
      // Some codecs reject early seeks before enough data is buffered.
    }
  }
  video.play().catch(() => {
    // Muted autoplay is normally allowed in Electron/Chrome, but a paused video
    // still works for export-time seeking and manual time controls.
  });
  return record;
}

async function loadVideoPlaneFile(file, explicitExtension) {
  const extension = explicitExtension || file.name.split('.').pop()?.toLowerCase();
  if (!extension || !VIDEO_EXTENSIONS.has(extension)) {
    setStatus('Video failed');
    return false;
  }

  setStatus('Loading video');
  const objectUrl = URL.createObjectURL(file);
  try {
    const payload = await createVideoPayload(file, extension);
    const record = await createVideoPlaneRecord({
      name: file.name,
      extension,
      payload,
      url: objectUrl
    }, { ownsUrl: true });
    videoPlaneObjects.push(record);
    selectedVideoPlaneId = record.id;
    selectVideoPlane(record.id);
    renderVideoPlaneList();
    syncVideoPlaneUi();
    if (controlsUi.videoPlaneStatus && extension === 'mov') {
      controlsUi.videoPlaneStatus.value = record.proxyUrl
        ? `${file.name} · MOV 已转为兼容透明代理预览${record.proxyCached ? '（已使用缓存）' : ''}`
        : `${file.name} · MOV 透明通道会在解码器支持时自动保留`;
    }
    setStatus('Ready');
    return true;
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    console.error(error);
    setStatus('Video failed');
    if (controlsUi.videoPlaneStatus) {
      controlsUi.videoPlaneStatus.value = `视频导入失败：${error.message || error}`;
    }
    return false;
  }
}

function disposeVideoPlaneRecord(record) {
  if (!record) {
    return;
  }
  if (record.root) {
    scene.remove(record.root);
  }
  try {
    record.video?.pause?.();
    record.video?.removeAttribute?.('src');
    record.video?.load?.();
  } catch {
    // Ignore media cleanup failures.
  }
  record.texture?.dispose?.();
  record.mesh?.geometry?.dispose?.();
  record.material?.dispose?.();
  if (record.ownsUrl && record.url) {
    URL.revokeObjectURL(record.originalUrl || record.url);
  }
}

function clearVideoPlanes() {
  videoPlaneObjects.forEach(disposeVideoPlaneRecord);
  videoPlaneObjects.length = 0;
  selectedVideoPlaneId = null;
  if (!selectedKeyframeId && !selectedLightId && !selectedImageSplat && !selectedVideoPlaneId && !selectedSceneModelId) {
    transformControls.detach();
    transformControls.visible = false;
  }
  renderVideoPlaneList();
  syncVideoPlaneUi();
}

function captureVideoPlaneTransform(record) {
  return {
    position: record.root.position.toArray(),
    quaternion: record.root.quaternion.normalize().toArray(),
    scale: record.root.scale.toArray()
  };
}

function commitSelectedVideoPlaneTransform() {
  const record = getSelectedVideoPlane();
  if (!record?.root) {
    return null;
  }
  record.root.quaternion.normalize();
  record.root.updateMatrixWorld(true);
  record.transform = captureVideoPlaneTransform(record);
  return record;
}

function updateVideoPlaneVisual(record) {
  if (!record) {
    return;
  }
  if (record.mesh) {
    record.mesh.scale.set(Math.max(0.01, record.width), Math.max(0.01, record.height), 1);
  }
  if (record.material) {
    record.material.opacity = THREE.MathUtils.clamp(record.opacity, 0, 1);
    record.material.transparent = true;
    record.material.needsUpdate = true;
  }
  if (record.video) {
    record.video.loop = record.loop;
    record.video.muted = record.muted;
    record.video.playbackRate = Math.max(0.0625, Number(record.playbackRate) || 1);
  }
}

function selectVideoPlane(recordId) {
  const record = videoPlaneObjects.find((item) => item.id === recordId);
  if (!record || exportSettings.hideUi) {
    return false;
  }
  selectedVideoPlaneId = record.id;
  selectedImageSplat = false;
  selectedLightId = null;
  selectedKeyframeId = null;
  selectedKeyframeObject = null;
  selectedCameraBezierHandle = null;
  resetTransformAxisConstraint(false);
  renderSceneModelList();
  renderLightList();
  syncLightUi();
  transformControls.setMode(selectedVideoPlaneMode);
  transformControls.setSpace(selectedVideoPlaneMode === 'rotate' || selectedVideoPlaneMode === 'scale' ? 'local' : 'world');
  transformControls.attach(record.root);
  transformControls.visible = true;
  transformControls.enabled = true;
  applyTransformAxisConstraint();
  renderVideoPlaneList();
  syncVideoPlaneUi();
  return true;
}

function setSelectedVideoPlaneMode(mode) {
  selectedVideoPlaneMode = ['translate', 'rotate', 'scale'].includes(mode) ? mode : 'translate';
  if (selectedVideoPlaneId) {
    selectVideoPlane(selectedVideoPlaneId);
    return;
  }
  updateVideoPlaneTransformButtons();
}

function updateVideoPlaneTransformButtons() {
  controlsUi.moveVideoPlane?.classList.toggle('active', selectedVideoPlaneMode === 'translate');
  controlsUi.rotateVideoPlane?.classList.toggle('active', selectedVideoPlaneMode === 'rotate');
  controlsUi.scaleVideoPlane?.classList.toggle('active', selectedVideoPlaneMode === 'scale');
}

function renderVideoPlaneList() {
  if (!controlsUi.videoPlaneList) {
    return;
  }
  controlsUi.videoPlaneList.innerHTML = '';
  videoPlaneObjects.forEach((record, index) => {
    const button = document.createElement('button');
    button.className = `video-plane-item${record.id === selectedVideoPlaneId ? ' active' : ''}`;
    button.type = 'button';
    button.dataset.videoPlaneId = record.id;
    button.innerHTML = `
      <span class="video-plane-index">${index + 1}</span>
      <span class="video-plane-name">${record.name || 'Video'}</span>
      <span class="video-plane-effect">${String(record.extension || 'video').toUpperCase()}</span>
    `;
    button.addEventListener('click', () => selectVideoPlane(record.id));
    controlsUi.videoPlaneList.append(button);
  });
  updateVideoPlaneTransformButtons();
}

function syncVideoPlaneUi() {
  const record = getSelectedVideoPlane();
  const hasRecord = Boolean(record);
  [
    controlsUi.duplicateVideoPlane,
    controlsUi.deleteVideoPlane,
    controlsUi.moveVideoPlane,
    controlsUi.rotateVideoPlane,
    controlsUi.scaleVideoPlane,
    controlsUi.videoPlaneWidth,
    controlsUi.videoPlaneHeight,
    controlsUi.videoPlaneOpacity,
    controlsUi.videoPlanePlaybackRate,
    controlsUi.videoPlaneTime,
    controlsUi.videoPlaneLoop,
    outputUi.videoPlaneWidth,
    outputUi.videoPlaneHeight,
    outputUi.videoPlaneOpacity,
    outputUi.videoPlanePlaybackRate,
    outputUi.videoPlaneTime
  ].forEach((control) => {
    if (control) {
      control.disabled = !hasRecord;
    }
  });
  if (!record) {
    if (controlsUi.videoPlaneStatus) {
      controlsUi.videoPlaneStatus.value = '未导入视频素材';
    }
    return;
  }

  const duration = getVideoPlaneDuration(record);
  if (controlsUi.videoPlaneTime) {
    controlsUi.videoPlaneTime.max = String(Math.max(0.001, duration));
  }
  setRangeValue('videoPlaneWidth', record.width);
  setRangeValue('videoPlaneHeight', record.height);
  setRangeValue('videoPlaneOpacity', record.opacity);
  setRangeValue('videoPlanePlaybackRate', record.playbackRate);
  setRangeValue('videoPlaneTime', record.timeOffset);
  setValueInput('videoPlaneWidth', record.width);
  setValueInput('videoPlaneHeight', record.height);
  setValueInput('videoPlaneOpacity', record.opacity);
  setValueInput('videoPlanePlaybackRate', record.playbackRate);
  setValueInput('videoPlaneTime', record.timeOffset);
  if (controlsUi.videoPlaneLoop) {
    controlsUi.videoPlaneLoop.checked = record.loop;
  }
  if (controlsUi.videoPlaneStatus) {
    const alphaHint = record.extension === 'mov'
      ? record.proxyUrl
        ? `；MOV 已转为兼容透明代理预览${record.proxyCached ? '（已使用缓存）' : ''}`
        : record.proxyError
          ? `；MOV 代理失败：${record.proxyError}`
          : '；MOV 透明通道会在解码器支持时自动保留'
      : '';
    controlsUi.videoPlaneStatus.value = `${record.name || 'Video'} · ${duration.toFixed(2)}s${alphaHint}`;
  }
}

function updateSelectedVideoPlaneProperty(key, value) {
  const record = getSelectedVideoPlane();
  if (!record) {
    syncVideoPlaneUi();
    return;
  }
  if (key === 'width') {
    record.width = THREE.MathUtils.clamp(Number(value) || record.width, 0.01, 100);
  } else if (key === 'height') {
    record.height = THREE.MathUtils.clamp(Number(value) || record.height, 0.01, 100);
  } else if (key === 'opacity') {
    record.opacity = THREE.MathUtils.clamp(Number(value), 0, 1);
  } else if (key === 'playbackRate') {
    record.playbackRate = THREE.MathUtils.clamp(Number(value), 0, 4);
  } else if (key === 'timeOffset') {
    const duration = getVideoPlaneDuration(record);
    record.timeOffset = THREE.MathUtils.clamp(Number(value) || 0, 0, Math.max(0, duration - 0.001));
    try {
      record.video.currentTime = record.timeOffset;
    } catch {
      // Ignore unsupported seeks.
    }
  } else if (key === 'loop') {
    record.loop = Boolean(value);
  }
  updateVideoPlaneVisual(record);
  syncVideoPlaneUi();
}

async function duplicateSelectedVideoPlane() {
  const record = getSelectedVideoPlane();
  if (!record) {
    return false;
  }
  commitSelectedVideoPlaneTransform();
  const descriptor = serializeVideoPlaneRecord(record);
  descriptor.id = crypto.randomUUID();
  descriptor.name = `${record.name || 'Video'} Copy`;
  descriptor.url = record.url;
  descriptor.transform.position[0] += 0.35;
  const duplicate = await createVideoPlaneRecord(descriptor, { ownsUrl: false });
  videoPlaneObjects.push(duplicate);
  selectVideoPlane(duplicate.id);
  renderVideoPlaneList();
  syncVideoPlaneUi();
  return true;
}

function deleteSelectedVideoPlane() {
  const record = getSelectedVideoPlane();
  if (!record) {
    return false;
  }
  const index = videoPlaneObjects.indexOf(record);
  disposeVideoPlaneRecord(record);
  videoPlaneObjects.splice(index, 1);
  selectedVideoPlaneId = videoPlaneObjects[Math.min(index, videoPlaneObjects.length - 1)]?.id || null;
  if (selectedVideoPlaneId) {
    selectVideoPlane(selectedVideoPlaneId);
  } else {
    transformControls.detach();
    transformControls.visible = false;
  }
  renderVideoPlaneList();
  syncVideoPlaneUi();
  return true;
}

function serializeVideoPlaneRecord(record) {
  const payload = record.payload || {};
  return {
    id: record.id,
    name: record.name,
    extension: record.extension || payload.extension,
    path: payload.path,
    sourcePath: payload.sourcePath,
    dataUrl: payload.dataUrl,
    url: payload.url,
    size: payload.size,
    width: record.width,
    height: record.height,
    opacity: record.opacity,
    playbackRate: record.playbackRate,
    timeOffset: record.timeOffset,
    loop: record.loop,
    muted: record.muted,
    duration: getVideoPlaneDuration(record),
    transform: record.root ? captureVideoPlaneTransform(record) : normalizeVideoPlaneTransform(record.transform)
  };
}

function serializeVideoPlanes() {
  if (!videoPlaneObjects.length) {
    return null;
  }
  videoPlaneObjects.forEach((record) => {
    if (record.id === selectedVideoPlaneId) {
      commitSelectedVideoPlaneTransform();
    }
  });
  return {
    activeId: selectedVideoPlaneId,
    items: videoPlaneObjects.map(serializeVideoPlaneRecord)
  };
}

async function importVideoPlanes(snapshot = {}, options = {}) {
  const items = Array.isArray(snapshot?.items)
    ? snapshot.items
    : Array.isArray(snapshot)
      ? snapshot
      : [];
  clearVideoPlanes();
  if (!items.length) {
    return false;
  }
  for (let index = 0; index < items.length; index += 1) {
    const descriptor = normalizeVideoPlaneDescriptor(items[index], index);
    const record = await createVideoPlaneRecord(descriptor);
    videoPlaneObjects.push(record);
  }
  const requestedId = options.selectId || snapshot.activeId;
  selectedVideoPlaneId = videoPlaneObjects.some((record) => record.id === requestedId)
    ? requestedId
    : videoPlaneObjects[0]?.id || null;
  if (selectedVideoPlaneId && !exportSettings.hideUi) {
    selectVideoPlane(selectedVideoPlaneId);
  }
  renderVideoPlaneList();
  syncVideoPlaneUi();
  return true;
}

function findVideoPlaneIdFromPointerHit() {
  const hit = raycaster
    .intersectObjects(videoPlaneObjects.map((record) => record.root).filter(Boolean), true)
    .find((item) => item.object.userData.videoPlanePickTarget || item.object.parent?.userData.videoPlanePickTarget);
  return hit?.object?.userData?.videoPlaneId || hit?.object?.parent?.userData?.videoPlaneId || null;
}

function waitForVideoSeek(record, targetTime) {
  const video = record?.video;
  if (!video || !Number.isFinite(targetTime)) {
    return Promise.resolve(false);
  }
  const duration = getVideoPlaneDuration(record);
  const safeTime = THREE.MathUtils.clamp(targetTime, 0, Math.max(0, duration - 0.001));
  if (Math.abs((video.currentTime || 0) - safeTime) < 0.016 && video.readyState >= 2) {
    record.texture.needsUpdate = true;
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      resolve(false);
    }, 1200);
    const cleanup = () => {
      window.clearTimeout(timeout);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('loadeddata', onSeeked);
      video.removeEventListener('error', onError);
    };
    const onSeeked = () => {
      cleanup();
      record.texture.needsUpdate = true;
      resolve(true);
    };
    const onError = () => {
      cleanup();
      resolve(false);
    };
    video.addEventListener('seeked', onSeeked, { once: true });
    video.addEventListener('loadeddata', onSeeked, { once: true });
    video.addEventListener('error', onError, { once: true });
    try {
      video.pause();
      video.currentTime = safeTime;
    } catch {
      cleanup();
      resolve(false);
    }
  });
}

async function syncVideoPlanesForRenderTime(timeSeconds = 0) {
  if (!videoPlaneObjects.length) {
    return;
  }
  await Promise.all(videoPlaneObjects.map((record) => {
    const duration = getVideoPlaneDuration(record);
    const playbackTime = Math.max(0, Number(record.timeOffset) || 0) + Math.max(0, Number(timeSeconds) || 0) * Math.max(0, Number(record.playbackRate) || 0);
    const targetTime = record.loop && duration > 0.001
      ? wrapAnimationTime(playbackTime, duration)
      : THREE.MathUtils.clamp(playbackTime, 0, Math.max(0, duration - 0.001));
    return waitForVideoSeek(record, targetTime);
  }));
}

async function renderStudioFrameAsync(timeSeconds = 0, dissolve, cameraTimeSeconds = timeSeconds) {
  await syncVideoPlanesForRenderTime(timeSeconds);
  return renderStudioFrame(timeSeconds, dissolve, cameraTimeSeconds);
}

async function buildImageSplatObject(source, label, options = {}) {
  const { resetView = false } = options;
  const token = ++buildToken;
  setStatus('Building image');
  await nextFrame();

  try {
    const requestedCount = Math.max(MIN_PARTICLE_COUNT, Math.round(Number(state.imageSplatCount) || MIN_PARTICLE_COUNT));
    const mistRatio = source.isPanorama ? 0.22 : 0.06;
    const mistCount = requestedCount > 1 ? Math.max(1, Math.round(requestedCount * mistRatio)) : 0;
    const mainCount = Math.max(MIN_PARTICLE_COUNT, requestedCount - mistCount);
    const imageGeometry = createImageSplatGeometry(source, mainCount, false);
    const mistGeometry = createImageSplatGeometry(source, mistCount, true);
    if (token !== buildToken) {
      imageGeometry.dispose();
      mistGeometry.dispose();
      return false;
    }

    removeImageSplatObject({ keepTexture: true });
    imageSplatSource = source;
    imageSplatRoot = new THREE.Group();
    imageSplatRoot.name = 'Image Gaussian Splat Object';
    imageSplatRoot.renderOrder = 5;
    imageSplatRoot.userData.capacity = mainCount + mistCount;

    const planeMaterial = new THREE.MeshBasicMaterial({
      map: imageSplatTexture,
      color: 0xffffff,
      transparent: source.isPanorama ? state.imageSplatPlaneOpacity < 0.999 : true,
      opacity: state.imageSplatPlaneOpacity,
      side: source.isPanorama ? THREE.BackSide : THREE.DoubleSide,
      depthTest: true,
      depthWrite: false,
      fog: false,
      toneMapped: false
    });
    imageSplatPlane = createImageSplatReferenceMesh(source, planeMaterial);
    imageSplatRoot.add(imageSplatPlane);

    imageSplatGlowParticles = new THREE.Points(imageGeometry, imageSplatGlowMaterial);
    imageSplatGlowParticles.name = 'Image Splat Glow';
    imageSplatGlowParticles.renderOrder = 6;
    imageSplatGlowParticles.visible = false;
    imageSplatRoot.add(imageSplatGlowParticles);

    imageSplatParticles = new THREE.Points(imageGeometry, imageSplatMaterial);
    imageSplatParticles.name = 'Image Splat Particles';
    imageSplatParticles.renderOrder = 5;
    imageSplatRoot.add(imageSplatParticles);

    imageSplatMistParticles = new THREE.Points(mistGeometry, imageSplatMistMaterial);
    imageSplatMistParticles.name = 'Image Splat Mist';
    imageSplatMistParticles.renderOrder = 4;
    imageSplatRoot.add(imageSplatMistParticles);

    scene.add(imageSplatRoot);
    applyImageSplatTransform();
    syncImageSplatUniforms();
    setEffectMode('image');
    modelName.textContent = `当前：${label}（图片破溅对象）`;
    currentLabel = label;
    currentModelPayload = null;
    updateStats();
    if (resetView) {
      frameImageSplatCamera(source);
    }
    if (!exportSettings.hideUi) {
      selectImageSplatObject();
    }
    setStatus('Ready');
    window.dispatchEvent(new Event('particle-studio-ready'));
    return true;
  } catch (error) {
    console.error(error);
    setStatus('Image failed');
    modelName.textContent = `当前：${label} 读取失败`;
    return false;
  }
}

async function buildRealSplatObject(url, label, options = {}) {
  const { extension = 'ply', resetView = false } = options;
  const token = ++buildToken;
  setStatus('Loading splat');
  await nextFrame();

  try {
    if (extension === 'ply') {
      const previewBuilt = await buildSharpPlyPreviewObject(url, label, {
        resetView,
        token
      });
      if (previewBuilt || token !== buildToken) {
        return previewBuilt;
      }
    }

    await removeRealSplatObject({ keepObjectUrl: true });
    realSplatRoot = new GaussianSplats3D.DropInViewer({
      gpuAcceleratedSort: true,
      sharedMemoryForWorkers: false,
      integerBasedSort: true,
      halfPrecisionCovariancesOnGPU: true,
      dynamicScene: false,
      renderMode: GaussianSplats3D.RenderMode.Always,
      sceneRevealMode: GaussianSplats3D.SceneRevealMode.Instant,
      sphericalHarmonicsDegree: 0,
      splatRenderMode: GaussianSplats3D.SplatRenderMode.ThreeD,
      logLevel: GaussianSplats3D.LogLevel.None
    });
    realSplatRoot.name = 'True Gaussian Splat Object';
    realSplatRoot.renderOrder = 5;
    realSplatRoot.visible = false;
    scene.add(realSplatRoot);

    await realSplatRoot.addSplatScene(url, {
      format: getGaussianSceneFormat(extension),
      splatAlphaRemovalThreshold: 4,
      showLoadingUI: false,
      progressiveLoad: extension === 'ply' || extension === 'splat',
      position: [0, 0, 0],
      rotation: [0, 0, 0, 1],
      scale: [1, 1, 1]
    });
    if (token !== buildToken) {
      await removeRealSplatObject({ keepObjectUrl: true });
      return false;
    }

    setEffectMode('image');
    applyImageSplatTransform();
    modelName.textContent = `当前：${label}（真实 Gaussian Splat）`;
    currentLabel = label;
    updateStats();
    if (resetView) {
      resetCamera();
    }
    if (!exportSettings.hideUi) {
      selectImageSplatObject();
    }
    setStatus('Ready');
    window.dispatchEvent(new Event('particle-studio-ready'));
    return true;
  } catch (error) {
    await removeRealSplatObject({ keepObjectUrl: true });
    console.error(error);
    setStatus('Splat failed');
    modelName.textContent = `当前：${label} 读取失败`;
    return false;
  }
}

async function buildSharpPlyPreviewObject(url, label, options = {}) {
  const { resetView = false, token = buildToken } = options;
  const requestedPointLimit = Math.max(MIN_PARTICLE_COUNT, Math.round(Number(state.imageSplatCount) || SHARP_PLY_PREVIEW_LIMIT));
  const previewPointLimit = exportSettings.hideUi
    ? Math.min(SHARP_PLY_EXPORT_LIMIT, Math.max(requestedPointLimit, SHARP_PLY_PREVIEW_LIMIT))
    : Math.min(SHARP_PLY_PREVIEW_LIMIT, requestedPointLimit);
  const parsed = await parseSharpPlyPreview(url, {
    pointLimit: previewPointLimit
  });
  if (!parsed) {
    return false;
  }
  if (token !== buildToken) {
    parsed.geometry.dispose();
    return false;
  }

  await removeRealSplatObject({ keepObjectUrl: true });
  const root = new THREE.Group();
  root.name = 'SHARP Colored Point Cloud';
  root.renderOrder = 5;
  root.userData.isSharpPreview = true;
  root.userData.pointCount = parsed.pointCount;
  root.userData.sourceVertexCount = parsed.sourceVertexCount;

  const points = new THREE.Points(parsed.geometry, realSplatPointMaterial);
  points.name = 'SHARP PLY Preview Points';
  points.frustumCulled = false;
  points.renderOrder = 5;
  root.add(points);

  realSplatRoot = root;
  realSplatPointCount = parsed.pointCount;
  scene.add(realSplatRoot);

  setEffectMode('image');
  applyImageSplatTransform();
  modelName.textContent = `当前：${label}（SHARP 彩色点云）`;
  currentLabel = label;
  updateStats();
  if (resetView) {
    frameSharpPointCloudCamera();
  }
  if (!exportSettings.hideUi) {
    selectImageSplatObject();
  }
  setStatus('Ready');
  window.dispatchEvent(new Event('particle-studio-ready'));
  return true;
}

async function parseSharpPlyPreview(url, options = {}) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`PLY could not be fetched: ${response.status}`);
  }

  const buffer = await response.arrayBuffer();
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const headerEnd = findPlyHeaderEnd(bytes);
  if (headerEnd <= 0) {
    return null;
  }

  const header = new TextDecoder('ascii').decode(bytes.slice(0, headerEnd));
  if (!/format\s+binary_little_endian\s+1\.0/i.test(header)) {
    return null;
  }

  const vertexInfo = readPlyVertexInfo(header);
  if (!vertexInfo || !vertexInfo.properties.some((property) => property.name === 'f_dc_0')) {
    return null;
  }

  const { vertexCount, properties, stride } = vertexInfo;
  const propertyOffsets = new Map();
  let propertyOffset = 0;
  properties.forEach((property) => {
    propertyOffsets.set(property.name, { offset: propertyOffset, type: property.type });
    propertyOffset += property.size;
  });

  const required = ['x', 'y', 'z', 'f_dc_0', 'f_dc_1', 'f_dc_2'];
  if (!required.every((name) => propertyOffsets.has(name))) {
    return null;
  }

  const pointLimit = Math.max(MIN_PARTICLE_COUNT, Math.round(options.pointLimit || SHARP_PLY_PREVIEW_LIMIT));
  const maxSamples = Math.min(vertexCount, pointLimit);
  const positions = new Float32Array(maxSamples * 3);
  const colors = new Float32Array(maxSamples * 3);
  const alphas = new Float32Array(maxSamples);
  const scales = new Float32Array(maxSamples);
  let writeIndex = 0;
  let candidateCount = 0;

  for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex += 1) {
    const vertexOffset = headerEnd + vertexIndex * stride;
    if (vertexOffset + stride > buffer.byteLength) {
      break;
    }

    const x = readPlyFloat(view, vertexOffset, propertyOffsets.get('x'));
    const y = readPlyFloat(view, vertexOffset, propertyOffsets.get('y'));
    const z = readPlyFloat(view, vertexOffset, propertyOffsets.get('z'));
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      continue;
    }

    const alphaInfo = propertyOffsets.get('opacity');
    const alpha = alphaInfo
      ? THREE.MathUtils.clamp(sigmoid(readPlyFloat(view, vertexOffset, alphaInfo)) * 1.55, 0.08, 0.96)
      : 0.86;
    if (alpha < 0.045) {
      continue;
    }

    const r = decodeSharpDcColor(readPlyFloat(view, vertexOffset, propertyOffsets.get('f_dc_0')));
    const g = decodeSharpDcColor(readPlyFloat(view, vertexOffset, propertyOffsets.get('f_dc_1')));
    const b = decodeSharpDcColor(readPlyFloat(view, vertexOffset, propertyOffsets.get('f_dc_2')));
    const scale0 = readOptionalPlyFloat(view, vertexOffset, propertyOffsets.get('scale_0'), -6);
    const scale1 = readOptionalPlyFloat(view, vertexOffset, propertyOffsets.get('scale_1'), scale0);
    const scale2 = readOptionalPlyFloat(view, vertexOffset, propertyOffsets.get('scale_2'), scale0);
    const rawScale = Math.exp((scale0 + scale1 + scale2) / 3);
    const pointScale = THREE.MathUtils.clamp(0.72 + Math.sqrt(Math.max(rawScale, 0.001)) * 2.15, 0.82, 3.2);

    candidateCount += 1;
    let targetIndex = writeIndex;
    if (writeIndex < maxSamples) {
      writeIndex += 1;
    } else {
      const replacementIndex = Math.floor(hashUintToUnit(vertexIndex + 0x85ebca6b) * candidateCount);
      if (replacementIndex >= maxSamples) {
        continue;
      }
      targetIndex = replacementIndex;
    }

    const posOffset = targetIndex * 3;
    positions[posOffset] = x;
    positions[posOffset + 1] = y;
    positions[posOffset + 2] = z;
    colors[posOffset] = r;
    colors[posOffset + 1] = g;
    colors[posOffset + 2] = b;
    alphas[targetIndex] = alpha;
    scales[targetIndex] = pointScale;
  }

  if (writeIndex <= 0) {
    return null;
  }

  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  for (let index = 0; index < writeIndex; index += 1) {
    const offset = index * 3;
    min.x = Math.min(min.x, positions[offset]);
    min.y = Math.min(min.y, positions[offset + 1]);
    min.z = Math.min(min.z, positions[offset + 2]);
    max.x = Math.max(max.x, positions[offset]);
    max.y = Math.max(max.y, positions[offset + 1]);
    max.z = Math.max(max.z, positions[offset + 2]);
  }

  const center = min.clone().add(max).multiplyScalar(0.5);
  const extent = max.clone().sub(min);
  const normalizeScale = 3.35 / Math.max(extent.x, extent.y, extent.z * 0.72, 0.0001);
  const degridJitter = THREE.MathUtils.clamp(0.0018 + (1 - writeIndex / Math.max(vertexCount, 1)) * 0.006, 0.0018, 0.008);
  const finalPositions = new Float32Array(writeIndex * 3);
  const finalColors = new Float32Array(writeIndex * 3);
  const finalAlphas = new Float32Array(writeIndex);
  const finalScales = new Float32Array(writeIndex);

  for (let index = 0; index < writeIndex; index += 1) {
    const offset = index * 3;
    finalPositions[offset] = (positions[offset] - center.x) * normalizeScale
      + (hashUintToUnit(index * 3 + 17) - 0.5) * degridJitter;
    finalPositions[offset + 1] = -(positions[offset + 1] - center.y) * normalizeScale
      + (hashUintToUnit(index * 3 + 29) - 0.5) * degridJitter;
    finalPositions[offset + 2] = -(positions[offset + 2] - center.z) * normalizeScale * 0.72
      + (hashUintToUnit(index * 3 + 43) - 0.5) * degridJitter * 0.55;
    finalColors[offset] = colors[offset];
    finalColors[offset + 1] = colors[offset + 1];
    finalColors[offset + 2] = colors[offset + 2];
    finalAlphas[index] = alphas[index];
    finalScales[index] = scales[index];
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(finalPositions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(finalColors, 3));
  geometry.setAttribute('aAlpha', new THREE.BufferAttribute(finalAlphas, 1));
  geometry.setAttribute('aScale', new THREE.BufferAttribute(finalScales, 1));
  geometry.computeBoundingSphere();
  geometry.userData.capacity = writeIndex;
  geometry.userData.sourceVertexCount = vertexCount;

  return {
    geometry,
    pointCount: writeIndex,
    sourceVertexCount: vertexCount
  };
}

function findPlyHeaderEnd(bytes) {
  const patterns = [
    [101, 110, 100, 95, 104, 101, 97, 100, 101, 114, 10],
    [101, 110, 100, 95, 104, 101, 97, 100, 101, 114, 13, 10]
  ];

  for (const pattern of patterns) {
    const scanLimit = Math.min(bytes.length - pattern.length, 1024 * 1024);
    for (let index = 0; index <= scanLimit; index += 1) {
      let matched = true;
      for (let offset = 0; offset < pattern.length; offset += 1) {
        if (bytes[index + offset] !== pattern[offset]) {
          matched = false;
          break;
        }
      }
      if (matched) {
        return index + pattern.length;
      }
    }
  }
  return -1;
}

function readPlyVertexInfo(header) {
  const lines = header.split(/\r?\n/);
  let vertexCount = 0;
  let inVertex = false;
  const properties = [];

  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts[0] === 'element') {
      inVertex = parts[1] === 'vertex';
      if (inVertex) {
        vertexCount = Math.max(0, Number(parts[2]) || 0);
      }
      continue;
    }
    if (!inVertex || parts[0] !== 'property') {
      continue;
    }
    const type = normalizePlyType(parts[1]);
    const size = getPlyTypeSize(type);
    if (size > 0 && parts[2]) {
      properties.push({ type, name: parts[2], size });
    }
  }

  const stride = properties.reduce((total, property) => total + property.size, 0);
  if (!vertexCount || !stride) {
    return null;
  }
  return { vertexCount, properties, stride };
}

function normalizePlyType(type = '') {
  return String(type).toLowerCase().replace('float32', 'float').replace('uint8', 'uchar').replace('int32', 'int');
}

function getPlyTypeSize(type) {
  return {
    char: 1,
    uchar: 1,
    short: 2,
    ushort: 2,
    int: 4,
    uint: 4,
    float: 4,
    double: 8
  }[type] || 0;
}

function readPlyFloat(view, baseOffset, property) {
  const offset = baseOffset + property.offset;
  switch (property.type) {
    case 'char': return view.getInt8(offset);
    case 'uchar': return view.getUint8(offset);
    case 'short': return view.getInt16(offset, true);
    case 'ushort': return view.getUint16(offset, true);
    case 'int': return view.getInt32(offset, true);
    case 'uint': return view.getUint32(offset, true);
    case 'double': return view.getFloat64(offset, true);
    case 'float':
    default:
      return view.getFloat32(offset, true);
  }
}

function readOptionalPlyFloat(view, baseOffset, property, fallback) {
  return property ? readPlyFloat(view, baseOffset, property) : fallback;
}

function decodeSharpDcColor(value) {
  const linear = THREE.MathUtils.clamp(value * SHARP_DC_COLOR_FACTOR + 0.5, 0, 1);
  return THREE.MathUtils.clamp(Math.pow(linear, 0.68) * 1.28, 0, 1);
}

function sigmoid(value) {
  return 1 / (1 + Math.exp(-value));
}

function hashUintToUnit(value) {
  let hash = Math.imul((value >>> 0) ^ 0x9e3779b9, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return (hash >>> 0) / 4294967296;
}

function frameSharpPointCloudCamera() {
  activeCameraQuaternion = null;
  orbit.minDistance = 0.02;
  orbit.maxDistance = CAMERA_ORBIT_MAX_DISTANCE;
  camera.position.set(0, 0.2, 5.0);
  orbit.target.set(0, 0, 0);
  camera.fov = 48;
  camera.updateProjectionMatrix();
  orbit.update();
}

function getGaussianSceneFormat(extension) {
  if (extension === 'splat') {
    return GaussianSplats3D.SceneFormat.Splat;
  }
  if (extension === 'ksplat') {
    return GaussianSplats3D.SceneFormat.KSplat;
  }
  if (extension === 'spz' && GaussianSplats3D.SceneFormat.Spz !== undefined) {
    return GaussianSplats3D.SceneFormat.Spz;
  }
  return GaussianSplats3D.SceneFormat.Ply;
}

async function removeRealSplatObject(options = {}) {
  const { keepObjectUrl = false } = options;
  if (selectedImageSplat && realSplatRoot) {
    selectedImageSplat = false;
    transformControls.detach();
    transformControls.visible = false;
  }
  if (realSplatRoot) {
    scene.remove(realSplatRoot);
    if (realSplatRoot.userData?.isSharpPreview) {
      realSplatRoot.traverse((node) => {
        if (node.geometry) {
          node.geometry.dispose();
        }
        if (node.material && node.material !== realSplatPointMaterial) {
          node.material.dispose?.();
        }
      });
    } else {
      await realSplatRoot.dispose?.();
    }
    realSplatRoot = null;
  }
  realSplatPointCount = 0;
  if (!keepObjectUrl && realSplatObjectUrl) {
    URL.revokeObjectURL(realSplatObjectUrl);
    realSplatObjectUrl = '';
  }
}

function createImageSplatReferenceMesh(source, material) {
  if (source.isPanorama) {
    const geometry = new THREE.SphereGeometry(source.radius || 16, 128, 64);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'Panorama Splat World';
    mesh.renderOrder = 0;
    mesh.frustumCulled = false;
    return mesh;
  }

  const mesh = new THREE.Mesh(
    createImageDepthPlaneGeometry(source),
    material
  );
  mesh.name = 'Image Reference Plane';
  mesh.position.z = -0.018;
  return mesh;
}

function createImageDepthPlaneGeometry(source) {
  const segmentsX = Math.min(180, Math.max(24, Math.round(source.worldWidth * 42)));
  const segmentsY = Math.min(130, Math.max(18, Math.round(source.worldHeight * 42)));
  const geometry = new THREE.PlaneGeometry(source.worldWidth, source.worldHeight, segmentsX, segmentsY);
  const position = geometry.attributes.position;

  if (!source.depthData) {
    return geometry;
  }

  for (let i = 0; i < position.count; i += 1) {
    const u = THREE.MathUtils.clamp(position.getX(i) / source.worldWidth + 0.5, 0, 1);
    const v = THREE.MathUtils.clamp(0.5 - position.getY(i) / source.worldHeight, 0, 1);
    const depth = sampleImageDepth(source, u, v);
    const edge = sampleImageEdge(source, u, v);
    const relief = (depth - 0.5) * 0.36 + edge * 0.035;
    position.setZ(i, relief);
  }

  position.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

function createImageSplatGeometry(source, count, mist = false) {
  const safeCount = Math.max(0, Math.round(Number(count) || 0));
  const positions = new Float32Array(safeCount * 3);
  const depths = new Float32Array(safeCount);
  const scatters = new Float32Array(safeCount * 3);
  const colors = new Float32Array(safeCount * 3);
  const seeds = new Float32Array(safeCount);
  const mixes = new Float32Array(safeCount);
  const alphas = new Float32Array(safeCount);
  const indexRatios = new Float32Array(safeCount);
  const color = new THREE.Color();
  const scatter = new THREE.Vector3();
  const tangentA = new THREE.Vector3();
  const tangentB = new THREE.Vector3();
  const direction = new THREE.Vector3();

  for (let i = 0; i < safeCount; i += 1) {
    const sample = sampleImageSplatPixel(source, mist);
    const offset = i * 3;
    const u = sample.x / Math.max(source.width - 1, 1);
    const v = sample.y / Math.max(source.height - 1, 1);
    const depth = (sample.luma - 0.5) * 0.58 + sample.edge * 0.5 + (sample.seed - 0.5) * 0.75;
    const angle = sample.seed * Math.PI * 2;
    const radial = Math.sqrt(sample.seed);

    color.setRGB(sample.r / 255, sample.g / 255, sample.b / 255).convertSRGBToLinear();

    if (source.isPanorama) {
      const theta = (u - 0.5) * Math.PI * 2;
      const phi = (0.5 - v) * Math.PI;
      const cosPhi = Math.cos(phi);
      direction.set(Math.sin(theta) * cosPhi, Math.sin(phi), -Math.cos(theta) * cosPhi).normalize();
      tangentA.set(Math.cos(theta), 0, Math.sin(theta)).normalize();
      tangentB.crossVectors(direction, tangentA).normalize();
      if (tangentB.lengthSq() < 0.00001) {
        tangentB.set(0, 1, 0);
      }

      const shellRadius = source.radius || 16;
      const inward = mist
        ? 0.42 + Math.random() * 1.25 + sample.edge * 0.42
        : 0.12 + Math.random() * 0.38 + sample.edge * 0.12;
      const tangentJitter = (mist ? 0.19 : 0.035) * shellRadius * (0.25 + sample.edge + sample.saturation * 0.45);
      positions[offset] = direction.x * (shellRadius - inward) +
        tangentA.x * Math.cos(angle) * tangentJitter +
        tangentB.x * Math.sin(angle * 1.31) * tangentJitter;
      positions[offset + 1] = direction.y * (shellRadius - inward) +
        tangentA.y * Math.cos(angle) * tangentJitter +
        tangentB.y * Math.sin(angle * 1.31) * tangentJitter;
      positions[offset + 2] = direction.z * (shellRadius - inward) +
        tangentA.z * Math.cos(angle) * tangentJitter +
        tangentB.z * Math.sin(angle * 1.31) * tangentJitter;

      scatter
        .copy(tangentA)
        .multiplyScalar(Math.cos(angle) * (0.2 + radial * 0.22))
        .addScaledVector(tangentB, Math.sin(angle * 1.73) * (0.18 + sample.edge * 0.42))
        .addScaledVector(direction, mist ? -0.2 - sample.edge * 0.18 : -0.04);
      if (mist) {
        scatter.multiplyScalar(1.65 + sample.edge * 0.85);
      }
      depths[i] = 0;
    } else {
      const centeredX = (u - 0.5) * source.worldWidth;
      const centeredY = (0.5 - v) * source.worldHeight;
      const skyDampen = 1 - (sample.sky || 0) * 0.82;
      const sceneDepth = THREE.MathUtils.lerp(
        Number.isFinite(sample.depth) ? sample.depth : 0.5,
        0.12,
        (sample.sky || 0) * 0.72
      );
      const depthRelief = (sceneDepth - 0.5) * 1.58 + (sample.seed - 0.5) * 0.09;
      const foregroundScale = 1 + (sceneDepth - 0.5) * 0.045;
      const localBreakup = (mist ? 0.06 : 0.012) * (0.22 + sample.edge * 0.95 + sceneDepth * 0.2) * skyDampen;
      scatter.set(
        Math.cos(angle) * (0.08 + radial * 0.2 + sample.edge * 0.18) * skyDampen,
        (Math.sin(angle * 1.37) * 0.12 + (0.5 - v) * 0.11) * skyDampen,
        ((sceneDepth - 0.5) * 0.52 + Math.sin(angle) * (0.08 + sample.edge * 0.32)) * skyDampen
      );
      if (mist) {
        scatter.multiplyScalar(1.05 + sample.edge * 0.42 + sceneDepth * 0.18);
      }
      positions[offset] = centeredX * foregroundScale + (mist ? (sample.seed - 0.5) * source.worldWidth * localBreakup : 0);
      positions[offset + 1] = centeredY * (1 + (sceneDepth - 0.5) * 0.025) +
        (mist ? (Math.random() - 0.5) * source.worldHeight * localBreakup * 0.86 : 0);
      positions[offset + 2] = (sceneDepth - 0.5) * 0.08;
      depths[i] = depthRelief * (mist ? 1.12 : 1);
    }

    scatters[offset] = scatter.x;
    scatters[offset + 1] = scatter.y;
    scatters[offset + 2] = scatter.z;
    colors[offset] = color.r;
    colors[offset + 1] = color.g;
    colors[offset + 2] = color.b;
    seeds[i] = sample.seed;
    mixes[i] = THREE.MathUtils.clamp(v + sample.luma * 0.18 + sample.seed * 0.08, 0, 1);
    alphas[i] = source.isPanorama
      ? sample.alpha * (mist ? 0.18 : 0.46) * (0.42 + sample.edge * 0.45 + sample.saturation * 0.18)
      : sample.alpha *
        (mist ? 0.12 : 0.62) *
        (0.82 + sample.edge * 0.2) *
        (1 - (sample.sky || 0) * (mist ? 0.9 : 0.52));
    indexRatios[i] = (i + 0.5) / safeCount;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aDepth', new THREE.BufferAttribute(depths, 1));
  geometry.setAttribute('aScatter', new THREE.BufferAttribute(scatters, 3));
  geometry.setAttribute('aParticleColor', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  geometry.setAttribute('aMix', new THREE.BufferAttribute(mixes, 1));
  geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
  geometry.setAttribute('aIndexRatio', new THREE.BufferAttribute(indexRatios, 1));
  if (safeCount > 0) {
    geometry.computeBoundingSphere();
  } else {
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 0);
  }
  geometry.userData.capacity = safeCount;
  return geometry;
}

function sampleImageSplatPixel(source, mist = false) {
  const maxAttempts = mist ? 12 : 18;
  let fallback = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const x = Math.floor(Math.random() * source.width);
    const y = Math.floor(Math.random() * source.height);
    const sample = readImageSplatPixel(source, x, y);
    if (!sample || sample.alpha <= 0.01) {
      continue;
    }
    fallback = sample;
    const weight = THREE.MathUtils.clamp(
      sample.alpha * (
        source.isPanorama
          ? 0.12 + sample.saturation * 0.34 + sample.luma * 0.18 + sample.edge * 0.78
          : 0.1 +
            sample.saturation * 0.22 +
            sample.luma * 0.1 +
            sample.edge * 0.95 +
            (sample.depth || 0.5) * 0.2 -
            (sample.sky || 0) * 0.36
      ),
      0.02,
      1
    );
    if (Math.random() < (mist ? Math.sqrt(weight) : weight)) {
      return sample;
    }
  }

  return fallback || readImageSplatPixel(source, Math.floor(source.width * 0.5), Math.floor(source.height * 0.5));
}

function readImageSplatPixel(source, x, y) {
  const safeX = THREE.MathUtils.clamp(x, 0, source.width - 1);
  const safeY = THREE.MathUtils.clamp(y, 0, source.height - 1);
  const index = (safeY * source.width + safeX) * 4;
  const data = source.data;
  const r = data[index];
  const g = data[index + 1];
  const b = data[index + 2];
  const alpha = data[index + 3] / 255;
  const maxChannel = Math.max(r, g, b);
  const minChannel = Math.min(r, g, b);
  const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  const saturation = maxChannel > 0 ? (maxChannel - minChannel) / maxChannel : 0;
  const mapIndex = safeY * source.width + safeX;
  const edge = source.edgeData?.[mapIndex] ?? computeFallbackImageEdge(source, safeX, safeY, r, g, b);
  const depth = source.depthData?.[mapIndex] ?? 0.5;
  const sky = source.skyData?.[mapIndex] ?? 0;

  return {
    x: safeX,
    y: safeY,
    r,
    g,
    b,
    alpha,
    luma,
    saturation,
    edge,
    depth,
    sky,
    seed: Math.random()
  };
}

function computeFallbackImageEdge(source, safeX, safeY, r, g, b) {
  const x2 = Math.min(source.width - 1, safeX + 1);
  const y2 = Math.min(source.height - 1, safeY + 1);
  const data = source.data;
  const right = ((safeY * source.width + x2) * 4);
  const down = ((y2 * source.width + safeX) * 4);
  return THREE.MathUtils.clamp(
    (Math.abs(r - data[right]) + Math.abs(g - data[right + 1]) + Math.abs(b - data[right + 2]) +
      Math.abs(r - data[down]) + Math.abs(g - data[down + 1]) + Math.abs(b - data[down + 2])) / 420,
    0,
    1
  );
}

function sampleImageDepth(source, u, v) {
  if (!source.depthData) {
    return 0.5;
  }
  const x = THREE.MathUtils.clamp(Math.round(u * (source.width - 1)), 0, source.width - 1);
  const y = THREE.MathUtils.clamp(Math.round(v * (source.height - 1)), 0, source.height - 1);
  return source.depthData[y * source.width + x] ?? 0.5;
}

function sampleImageEdge(source, u, v) {
  if (!source.edgeData) {
    return 0;
  }
  const x = THREE.MathUtils.clamp(Math.round(u * (source.width - 1)), 0, source.width - 1);
  const y = THREE.MathUtils.clamp(Math.round(v * (source.height - 1)), 0, source.height - 1);
  return source.edgeData[y * source.width + x] ?? 0;
}

function removeImageSplatObject(options = {}) {
  const { keepTexture = false } = options;
  if (selectedImageSplat) {
    selectedImageSplat = false;
    transformControls.detach();
    transformControls.visible = false;
  }
  if (imageSplatRoot) {
    scene.remove(imageSplatRoot);
    imageSplatRoot.traverse((node) => {
      if (node.isMesh || node.isPoints) {
        node.geometry?.dispose?.();
        if (node.material !== imageSplatMaterial &&
          node.material !== imageSplatGlowMaterial &&
          node.material !== imageSplatMistMaterial) {
          disposeDisplayMaterial(node.material);
        }
      }
    });
  }
  imageSplatRoot = null;
  imageSplatPlane = null;
  imageSplatParticles = null;
  imageSplatMistParticles = null;
  imageSplatGlowParticles = null;
  if (!keepTexture && imageSplatTexture) {
    imageSplatTexture.dispose();
    imageSplatTexture = null;
  }
}

function createParticleGeometry(root, count) {
  const targetCount = Math.max(1, Math.round(Number(count) || 1));
  const cleanupStrength = THREE.MathUtils.clamp(Number(state.sampleCleanup ?? 0), 0, 1);
  const candidateCount = getParticleCandidateCount(targetCount, cleanupStrength);
  const captureAnimationBindings = hasModelAnimation(root);
  const { meshes, box, sampleBox } = collectSampleMeshes(root, { cleanupStrength, captureAnimationBindings });
  if (!meshes.length || box.isEmpty()) {
    throw new Error('No mesh geometry found in model.');
  }

  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const scale = 4 / Math.max(size.x, size.y, size.z, 0.0001);
  const scaledMinY = (box.min.y - center.y) * scale;
  const scaledMaxY = (box.max.y - center.y) * scale;
  const scaledHeight = Math.max(scaledMaxY - scaledMinY, 0.0001);
  const radiusScale = Math.max(size.x, size.z) * scale * 0.5 || 1;
  const totalArea = meshes.reduce((sum, mesh) => sum + mesh.area, 0);
  let cumulative = 0;

  const weightedMeshes = meshes.map((mesh, index) => {
    cumulative += mesh.area / totalArea;
    return { ...mesh, cumulative, animationIndex: index };
  });

  const candidatePositions = new Float32Array(candidateCount * 3);
  const candidateFlowStarts = new Float32Array(candidateCount * 3);
  const candidateNormals = new Float32Array(candidateCount * 3);
  const candidateOffsets = new Float32Array(candidateCount * 3);
  const candidateParticleColors = new Float32Array(candidateCount * 3);
  const candidateSeeds = new Float32Array(candidateCount);
  const candidateMixes = new Float32Array(candidateCount);
  const candidateTextureWeights = new Float32Array(candidateCount);
  const candidateGrowthOrders = new Float32Array(candidateCount);
  const candidateFilaments = new Float32Array(candidateCount);
  const candidateCutoutWeights = new Float32Array(candidateCount);
  const candidateMeshIndices = captureAnimationBindings ? new Int32Array(candidateCount) : null;
  const candidateFaceIndices = captureAnimationBindings ? new Uint32Array(candidateCount) : null;
  const candidateBarycentrics = captureAnimationBindings ? new Float32Array(candidateCount * 3) : null;
  const candidateFlowOffsets = captureAnimationBindings ? new Float32Array(candidateCount * 3) : null;
  const samplePosition = new THREE.Vector3();
  const sampleNormal = new THREE.Vector3();
  const sampleColor = new THREE.Color();
  const sampleUV = createSamplerUvTarget();
  const particleColor = new THREE.Color();
  const randomDirection = new THREE.Vector3();
  const flowStart = new THREE.Vector3();
  const sampleBinding = captureAnimationBindings ? { barycentric: new THREE.Vector3(), meshIndex: 0, faceIndex: 0 } : null;

  for (let i = 0; i < candidateCount; i += 1) {
    const { hasOriginalColor, hasCutoutAlpha } = sampleRenderableSurface(
      weightedMeshes,
      sampleBox,
      samplePosition,
      sampleNormal,
      sampleColor,
      sampleUV,
      particleColor,
      sampleBinding
    );

    samplePosition.sub(center).multiplyScalar(scale);
    sampleNormal.normalize();
    if (sampleNormal.lengthSq() === 0) {
      sampleNormal.set(0, 1, 0);
    }
    const seed = Math.random();
    const verticalOrder = THREE.MathUtils.clamp((samplePosition.y - scaledMinY) / scaledHeight, 0, 1);
    const radialLength = Math.hypot(samplePosition.x, samplePosition.z);
    const radialOrder = THREE.MathUtils.clamp(radialLength / Math.max(radiusScale, 0.0001), 0, 1);
    const currentBand = Math.sin(samplePosition.x * 2.1 + samplePosition.z * 3.4 + seed * 6.28318) * 0.5 + 0.5;
    const radialDirection = new THREE.Vector3(samplePosition.x, 0, samplePosition.z);
    if (radialDirection.lengthSq() < 0.0001) {
      radialDirection.set(Math.cos(seed * 6.28318), 0, Math.sin(seed * 6.28318));
    } else {
      radialDirection.normalize();
    }
    const upstreamDistance = 0.18 + radialOrder * 0.52 + (1 - verticalOrder) * 0.12 + currentBand * 0.16;
    const upstreamDirection = radialDirection
      .clone()
      .multiplyScalar(0.58 + radialOrder * 0.4)
      .add(new THREE.Vector3(0, 0.74 + verticalOrder * 0.28, 0))
      .normalize();
    flowStart.set(
      samplePosition.x,
      samplePosition.y,
      samplePosition.z
    );
    flowStart.addScaledVector(upstreamDirection, -upstreamDistance);
    flowStart.y = Math.max(flowStart.y, scaledMinY - 0.18);

    randomDirection
      .set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)
      .normalize()
      .multiplyScalar(0.55 + Math.random() * 1.25);

    const offset = i * 3;
    candidatePositions[offset] = samplePosition.x;
    candidatePositions[offset + 1] = samplePosition.y;
    candidatePositions[offset + 2] = samplePosition.z;
    candidateFlowStarts[offset] = flowStart.x;
    candidateFlowStarts[offset + 1] = flowStart.y;
    candidateFlowStarts[offset + 2] = flowStart.z;
    if (captureAnimationBindings) {
      candidateMeshIndices[i] = sampleBinding.meshIndex;
      candidateFaceIndices[i] = sampleBinding.faceIndex;
      candidateBarycentrics[offset] = sampleBinding.barycentric.x;
      candidateBarycentrics[offset + 1] = sampleBinding.barycentric.y;
      candidateBarycentrics[offset + 2] = sampleBinding.barycentric.z;
      candidateFlowOffsets[offset] = flowStart.x - samplePosition.x;
      candidateFlowOffsets[offset + 1] = flowStart.y - samplePosition.y;
      candidateFlowOffsets[offset + 2] = flowStart.z - samplePosition.z;
    }
    candidateNormals[offset] = sampleNormal.x;
    candidateNormals[offset + 1] = sampleNormal.y;
    candidateNormals[offset + 2] = sampleNormal.z;
    candidateOffsets[offset] = randomDirection.x;
    candidateOffsets[offset + 1] = randomDirection.y;
    candidateOffsets[offset + 2] = randomDirection.z;
    candidateParticleColors[offset] = particleColor.r;
    candidateParticleColors[offset + 1] = particleColor.g;
    candidateParticleColors[offset + 2] = particleColor.b;
    candidateSeeds[i] = seed;
    candidateMixes[i] = THREE.MathUtils.clamp(verticalOrder + (seed - 0.5) * 0.18, 0, 1);
    candidateTextureWeights[i] = hasOriginalColor ? 1 : 0;
    candidateCutoutWeights[i] = hasCutoutAlpha ? 1 : 0;
    candidateFilaments[i] = THREE.MathUtils.clamp(
      radialOrder * 0.58 + currentBand * 0.22 + (hasCutoutAlpha ? 0.2 : 0) + seed * 0.18,
      0,
      1
    );
    const growthOrder = THREE.MathUtils.clamp(
      verticalOrder * 0.66 + radialOrder * 0.16 + currentBand * 0.1 + seed * 0.08 - 0.05,
      0,
      1
    );
    candidateGrowthOrders[i] = growthOrder;
  }

  meshes.forEach(({ geometry }) => geometry.dispose());

  const selectedIndices = selectDenseParticleIndices(
    candidatePositions,
    candidateCutoutWeights,
    candidateCount,
    targetCount,
    cleanupStrength
  );
  const finalCount = selectedIndices.length;
  const positions = new Float32Array(finalCount * 3);
  const flowStarts = new Float32Array(finalCount * 3);
  const normals = new Float32Array(finalCount * 3);
  const offsets = new Float32Array(finalCount * 3);
  const particleColors = new Float32Array(finalCount * 3);
  const seeds = new Float32Array(finalCount);
  const mixes = new Float32Array(finalCount);
  const textureWeights = new Float32Array(finalCount);
  const growthOrders = new Float32Array(finalCount);
  const filaments = new Float32Array(finalCount);
  const meshIndices = captureAnimationBindings ? new Int32Array(finalCount) : null;
  const faceIndices = captureAnimationBindings ? new Uint32Array(finalCount) : null;
  const barycentrics = captureAnimationBindings ? new Float32Array(finalCount * 3) : null;
  const flowOffsets = captureAnimationBindings ? new Float32Array(finalCount * 3) : null;

  selectedIndices.forEach((sourceIndex, outputIndex) => {
    const sourceOffset = sourceIndex * 3;
    const outputOffset = outputIndex * 3;
    positions[outputOffset] = candidatePositions[sourceOffset];
    positions[outputOffset + 1] = candidatePositions[sourceOffset + 1];
    positions[outputOffset + 2] = candidatePositions[sourceOffset + 2];
    flowStarts[outputOffset] = candidateFlowStarts[sourceOffset];
    flowStarts[outputOffset + 1] = candidateFlowStarts[sourceOffset + 1];
    flowStarts[outputOffset + 2] = candidateFlowStarts[sourceOffset + 2];
    normals[outputOffset] = candidateNormals[sourceOffset];
    normals[outputOffset + 1] = candidateNormals[sourceOffset + 1];
    normals[outputOffset + 2] = candidateNormals[sourceOffset + 2];
    offsets[outputOffset] = candidateOffsets[sourceOffset];
    offsets[outputOffset + 1] = candidateOffsets[sourceOffset + 1];
    offsets[outputOffset + 2] = candidateOffsets[sourceOffset + 2];
    particleColors[outputOffset] = candidateParticleColors[sourceOffset];
    particleColors[outputOffset + 1] = candidateParticleColors[sourceOffset + 1];
    particleColors[outputOffset + 2] = candidateParticleColors[sourceOffset + 2];
    seeds[outputIndex] = candidateSeeds[sourceIndex];
    mixes[outputIndex] = candidateMixes[sourceIndex];
    textureWeights[outputIndex] = candidateTextureWeights[sourceIndex];
    growthOrders[outputIndex] = candidateGrowthOrders[sourceIndex];
    filaments[outputIndex] = candidateFilaments[sourceIndex];
    if (captureAnimationBindings) {
      meshIndices[outputIndex] = candidateMeshIndices[sourceIndex];
      faceIndices[outputIndex] = candidateFaceIndices[sourceIndex];
      barycentrics[outputOffset] = candidateBarycentrics[sourceOffset];
      barycentrics[outputOffset + 1] = candidateBarycentrics[sourceOffset + 1];
      barycentrics[outputOffset + 2] = candidateBarycentrics[sourceOffset + 2];
      flowOffsets[outputOffset] = candidateFlowOffsets[sourceOffset];
      flowOffsets[outputOffset + 1] = candidateFlowOffsets[sourceOffset + 1];
      flowOffsets[outputOffset + 2] = candidateFlowOffsets[sourceOffset + 2];
    }
  });

  const morphTarget = createMorphTargetAttributes(
    morphTargetSource,
    finalCount,
    positions,
    particleColors,
    textureWeights
  );

  const particleGeometry = new THREE.BufferGeometry();
  particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  particleGeometry.setAttribute('aFlowStart', new THREE.BufferAttribute(flowStarts, 3));
  particleGeometry.setAttribute('aNormal', new THREE.BufferAttribute(normals, 3));
  particleGeometry.setAttribute('aOffset', new THREE.BufferAttribute(offsets, 3));
  particleGeometry.setAttribute('aParticleColor', new THREE.BufferAttribute(particleColors, 3));
  particleGeometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  particleGeometry.setAttribute('aMix', new THREE.BufferAttribute(mixes, 1));
  particleGeometry.setAttribute('aTextureWeight', new THREE.BufferAttribute(textureWeights, 1));
  particleGeometry.setAttribute('aGrowthOrder', new THREE.BufferAttribute(growthOrders, 1));
  particleGeometry.setAttribute('aFilament', new THREE.BufferAttribute(filaments, 1));
  particleGeometry.setAttribute('aMorphTarget', new THREE.BufferAttribute(morphTarget.positions, 3));
  particleGeometry.setAttribute('aMorphColor', new THREE.BufferAttribute(morphTarget.colors, 3));
  particleGeometry.setAttribute('aMorphTextureWeight', new THREE.BufferAttribute(morphTarget.textureWeights, 1));
  particleGeometry.userData.capacity = finalCount;
  particleGeometry.userData.hasMorphTarget = morphTarget.ready;
  if (captureAnimationBindings) {
    particleGeometry.userData.animationBindings = createAnimationBindings({
      meshes,
      center,
      scale,
      meshIndices,
      faceIndices,
      barycentrics,
      flowOffsets
    });
  }
  particleGeometry.computeBoundingSphere();
  particleGeometry.computeBoundingBox();
  return particleGeometry;
}

function createMorphTargetAttributes(root, count, fallbackPositions, fallbackColors, fallbackTextureWeights) {
  const safeCount = Math.max(0, Math.round(Number(count) || 0));
  const positions = new Float32Array(safeCount * 3);
  const colors = new Float32Array(safeCount * 3);
  const textureWeights = new Float32Array(safeCount);

  if (!root || safeCount <= 0) {
    positions.set(fallbackPositions.subarray(0, safeCount * 3));
    colors.set(fallbackColors.subarray(0, safeCount * 3));
    textureWeights.set(fallbackTextureWeights.subarray(0, safeCount));
    return { positions, colors, textureWeights, ready: false };
  }

  try {
    const target = createNormalizedModelParticleArrays(root, safeCount);
    return { ...target, ready: true };
  } catch (error) {
    console.warn('Could not sample morph target model.', error);
    positions.set(fallbackPositions.subarray(0, safeCount * 3));
    colors.set(fallbackColors.subarray(0, safeCount * 3));
    textureWeights.set(fallbackTextureWeights.subarray(0, safeCount));
    return { positions, colors, textureWeights, ready: false };
  }
}

function createNormalizedModelParticleArrays(root, count) {
  const safeCount = Math.max(0, Math.round(Number(count) || 0));
  const positions = new Float32Array(safeCount * 3);
  const colors = new Float32Array(safeCount * 3);
  const textureWeights = new Float32Array(safeCount);

  if (safeCount <= 0) {
    return { positions, colors, textureWeights };
  }

  const { meshes, box, sampleBox } = collectSampleMeshes(root, { captureAnimationBindings: hasModelAnimation(root) });
  if (!meshes.length || box.isEmpty()) {
    throw new Error('No mesh geometry found in morph target model.');
  }

  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const scale = 4 / Math.max(size.x, size.y, size.z, 0.0001);
  const totalArea = meshes.reduce((sum, mesh) => sum + mesh.area, 0);
  let cumulative = 0;
  const weightedMeshes = meshes.map((mesh, index) => {
    cumulative += mesh.area / totalArea;
    return { ...mesh, cumulative, animationIndex: index };
  });
  const samplePosition = new THREE.Vector3();
  const sampleNormal = new THREE.Vector3();
  const sampleColor = new THREE.Color();
  const sampleUV = createSamplerUvTarget();
  const particleColor = new THREE.Color();

  for (let index = 0; index < safeCount; index += 1) {
    const { hasOriginalColor } = sampleRenderableSurface(
      weightedMeshes,
      sampleBox,
      samplePosition,
      sampleNormal,
      sampleColor,
      sampleUV,
      particleColor
    );
    samplePosition.sub(center).multiplyScalar(scale);
    const offset = index * 3;
    positions[offset] = samplePosition.x;
    positions[offset + 1] = samplePosition.y;
    positions[offset + 2] = samplePosition.z;
    colors[offset] = particleColor.r;
    colors[offset + 1] = particleColor.g;
    colors[offset + 2] = particleColor.b;
    textureWeights[index] = hasOriginalColor ? 1 : 0;
  }

  meshes.forEach(({ geometry }) => geometry.dispose());
  return { positions, colors, textureWeights };
}

function createEmissionGeometry(root, count) {
  const safeCount = Math.max(MIN_PARTICLE_COUNT, Math.round(Number(count) || MIN_PARTICLE_COUNT));
  const captureAnimationBindings = hasModelAnimation(root);
  const { meshes, box, sampleBox } = collectSampleMeshes(root, { captureAnimationBindings });
  if (!meshes.length || box.isEmpty()) {
    throw new Error('No mesh geometry found in model.');
  }

  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const scale = 4 / Math.max(size.x, size.y, size.z, 0.0001);
  const totalArea = meshes.reduce((sum, mesh) => sum + mesh.area, 0);
  let cumulative = 0;
  const weightedMeshes = meshes.map((mesh, index) => {
    cumulative += mesh.area / totalArea;
    return { ...mesh, cumulative, animationIndex: index };
  });

  const positions = new Float32Array(safeCount * 3);
  const normals = new Float32Array(safeCount * 3);
  const offsets = new Float32Array(safeCount * 3);
  const particleColors = new Float32Array(safeCount * 3);
  const seeds = new Float32Array(safeCount);
  const lifeOffsets = new Float32Array(safeCount);
  const indexRatios = new Float32Array(safeCount);
  const textureWeights = new Float32Array(safeCount);
  const meshIndices = captureAnimationBindings ? new Int32Array(safeCount) : null;
  const faceIndices = captureAnimationBindings ? new Uint32Array(safeCount) : null;
  const barycentrics = captureAnimationBindings ? new Float32Array(safeCount * 3) : null;
  const samplePosition = new THREE.Vector3();
  const sampleNormal = new THREE.Vector3();
  const sampleColor = new THREE.Color();
  const sampleUV = createSamplerUvTarget();
  const particleColor = new THREE.Color();
  const randomDirection = new THREE.Vector3();
  const sampleBinding = captureAnimationBindings ? { barycentric: new THREE.Vector3(), meshIndex: 0, faceIndex: 0 } : null;

  for (let i = 0; i < safeCount; i += 1) {
    const { hasOriginalColor } = sampleRenderableSurface(
      weightedMeshes,
      sampleBox,
      samplePosition,
      sampleNormal,
      sampleColor,
      sampleUV,
      particleColor,
      sampleBinding
    );

    samplePosition.sub(center).multiplyScalar(scale);
    sampleNormal.normalize();
    if (sampleNormal.lengthSq() === 0) {
      sampleNormal.set(0, 1, 0);
    }

    randomDirection
      .set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)
      .normalize();
    if (randomDirection.lengthSq() === 0) {
      randomDirection.set(0, 1, 0);
    }

    const offset = i * 3;
    positions[offset] = samplePosition.x;
    positions[offset + 1] = samplePosition.y;
    positions[offset + 2] = samplePosition.z;
    normals[offset] = sampleNormal.x;
    normals[offset + 1] = sampleNormal.y;
    normals[offset + 2] = sampleNormal.z;
    offsets[offset] = randomDirection.x;
    offsets[offset + 1] = randomDirection.y;
    offsets[offset + 2] = randomDirection.z;
    particleColors[offset] = particleColor.r;
    particleColors[offset + 1] = particleColor.g;
    particleColors[offset + 2] = particleColor.b;
    seeds[i] = Math.random();
    lifeOffsets[i] = Math.random();
    indexRatios[i] = (i + 0.5) / safeCount;
    textureWeights[i] = hasOriginalColor ? 1 : 0;
    if (captureAnimationBindings) {
      meshIndices[i] = sampleBinding.meshIndex;
      faceIndices[i] = sampleBinding.faceIndex;
      barycentrics[offset] = sampleBinding.barycentric.x;
      barycentrics[offset + 1] = sampleBinding.barycentric.y;
      barycentrics[offset + 2] = sampleBinding.barycentric.z;
    }
  }

  meshes.forEach(({ geometry }) => geometry.dispose());

  const emissionGeometry = new THREE.BufferGeometry();
  emissionGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  emissionGeometry.setAttribute('aNormal', new THREE.BufferAttribute(normals, 3));
  emissionGeometry.setAttribute('aOffset', new THREE.BufferAttribute(offsets, 3));
  emissionGeometry.setAttribute('aParticleColor', new THREE.BufferAttribute(particleColors, 3));
  emissionGeometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  emissionGeometry.setAttribute('aLifeOffset', new THREE.BufferAttribute(lifeOffsets, 1));
  emissionGeometry.setAttribute('aIndexRatio', new THREE.BufferAttribute(indexRatios, 1));
  emissionGeometry.setAttribute('aTextureWeight', new THREE.BufferAttribute(textureWeights, 1));
  emissionGeometry.userData.capacity = safeCount;
  if (captureAnimationBindings) {
    emissionGeometry.userData.animationBindings = createAnimationBindings({
      meshes,
      center,
      scale,
      meshIndices,
      faceIndices,
      barycentrics
    });
  }
  emissionGeometry.computeBoundingSphere();
  emissionGeometry.computeBoundingBox();
  return emissionGeometry;
}

function createAnimationBindings({ meshes, center, scale, meshIndices, faceIndices, barycentrics, flowOffsets = null }) {
  return {
    center: center.clone(),
    scale,
    meshIndices,
    faceIndices,
    barycentrics,
    flowOffsets,
    meshRecords: meshes.map((mesh) => {
      const sourceMesh = mesh.sourceMesh;
      const sourcePositionCount = sourceMesh?.geometry?.attributes?.position?.count || 0;
      return {
        sourceMesh,
        sourceVertexIndices: mesh.sourceVertexIndices,
        vertexPositions: new Float32Array(sourcePositionCount * 3),
        cacheVersion: -1
      };
    })
  };
}

function updateAnimatedParticleGeometries(activeMode = null, options = {}) {
  if (!state.modelAnimEnabled || !modelAnimation.clip) {
    return;
  }
  const mode = activeMode || (state.effectMode === 'emission' ? 'emission' : 'particles');
  if (mode === 'emission') {
    updateAnimatedPointGeometry(emissionParticles?.geometry, options);
    return;
  }
  updateAnimatedPointGeometry(particles?.geometry, options);
}

function updateAnimatedPointGeometry(geometry, options = {}) {
  const bindings = geometry?.userData?.animationBindings;
  if (!bindings?.meshRecords?.length) {
    return;
  }

  bindings.meshRecords.forEach((record) => refreshAnimationMeshRecord(record, bindings.center, bindings.scale));
  const position = geometry.attributes.position;
  const normal = geometry.attributes.aNormal;
  const flowStart = bindings.flowOffsets ? geometry.attributes.aFlowStart : null;
  const positionArray = position.array;
  const normalArray = normal?.array || null;
  const flowStartArray = flowStart?.array || null;
  const count = position.count;
  const normalInterval = exportSettings.hideUi || options.forceNormals || count <= 30000
    ? 1
    : count > 80000
      ? 4
      : 2;
  bindings.normalUpdateFrame = (bindings.normalUpdateFrame || 0) + 1;
  const updateNormals = Boolean(normalArray) && bindings.normalUpdateFrame % normalInterval === 0;

  for (let index = 0; index < count; index += 1) {
    const meshIndex = bindings.meshIndices[index];
    const record = bindings.meshRecords[meshIndex];
    if (!record) {
      continue;
    }
    const faceOffset = bindings.faceIndices[index] * 3;
    const sourceVertexIndices = record.sourceVertexIndices;
    const aIndex = sourceVertexIndices[faceOffset];
    const bIndex = sourceVertexIndices[faceOffset + 1];
    const cIndex = sourceVertexIndices[faceOffset + 2];
    const aOffset = aIndex * 3;
    const bOffset = bIndex * 3;
    const cOffset = cIndex * 3;
    const outputOffset = index * 3;
    const baryA = bindings.barycentrics[outputOffset];
    const baryB = bindings.barycentrics[outputOffset + 1];
    const baryC = bindings.barycentrics[outputOffset + 2];
    const vertices = record.vertexPositions;
    const x = vertices[aOffset] * baryA + vertices[bOffset] * baryB + vertices[cOffset] * baryC;
    const y = vertices[aOffset + 1] * baryA + vertices[bOffset + 1] * baryB + vertices[cOffset + 1] * baryC;
    const z = vertices[aOffset + 2] * baryA + vertices[bOffset + 2] * baryB + vertices[cOffset + 2] * baryC;
    positionArray[outputOffset] = x;
    positionArray[outputOffset + 1] = y;
    positionArray[outputOffset + 2] = z;

    if (flowStartArray) {
      flowStartArray[outputOffset] = x + bindings.flowOffsets[outputOffset];
      flowStartArray[outputOffset + 1] = y + bindings.flowOffsets[outputOffset + 1];
      flowStartArray[outputOffset + 2] = z + bindings.flowOffsets[outputOffset + 2];
    }

    if (updateNormals) {
      const abx = vertices[bOffset] - vertices[aOffset];
      const aby = vertices[bOffset + 1] - vertices[aOffset + 1];
      const abz = vertices[bOffset + 2] - vertices[aOffset + 2];
      const acx = vertices[cOffset] - vertices[aOffset];
      const acy = vertices[cOffset + 1] - vertices[aOffset + 1];
      const acz = vertices[cOffset + 2] - vertices[aOffset + 2];
      let nx = aby * acz - abz * acy;
      let ny = abz * acx - abx * acz;
      let nz = abx * acy - aby * acx;
      const normalLength = Math.hypot(nx, ny, nz) || 1;
      nx /= normalLength;
      ny /= normalLength;
      nz /= normalLength;
      normalArray[outputOffset] = nx;
      normalArray[outputOffset + 1] = ny;
      normalArray[outputOffset + 2] = nz;
    }
  }

  position.needsUpdate = true;
  if (updateNormals) {
    normal.needsUpdate = true;
  }
  if (flowStart) {
    flowStart.needsUpdate = true;
  }
}

function refreshAnimationMeshRecord(record, center, scale) {
  if (!record?.sourceMesh || record.cacheVersion === modelAnimation.poseVersion) {
    return;
  }

  const mesh = record.sourceMesh;
  const positionCount = mesh.geometry?.attributes?.position?.count || 0;
  const vertex = new THREE.Vector3();
  mesh.updateWorldMatrix(true, false);
  mesh.skeleton?.update?.();
  for (let index = 0; index < positionCount; index += 1) {
    getSourceVertexWorldPosition(mesh, index, vertex);
    vertex.sub(center).multiplyScalar(scale);
    const offset = index * 3;
    record.vertexPositions[offset] = vertex.x;
    record.vertexPositions[offset + 1] = vertex.y;
    record.vertexPositions[offset + 2] = vertex.z;
  }
  record.cacheVersion = modelAnimation.poseVersion;
}

function computeModelNormalization(root) {
  root.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) {
    return {
      center: new THREE.Vector3(),
      scale: 1
    };
  }

  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  return {
    center,
    scale: 4 / Math.max(size.x, size.y, size.z, 0.0001)
  };
}

function rebuildVisibleModel(source) {
  removeVisibleModel();
  const { center, scale } = computeModelNormalization(source);
  const wrapper = new THREE.Group();
  wrapper.name = 'Visible Emission Model';
  wrapper.renderOrder = 8;
  wrapper.scale.setScalar(scale);
  wrapper.position.copy(center).multiplyScalar(-scale);

  const clone = hasModelAnimation(source) ? cloneSkeletonRoot(source) : source.clone(true);
  clone.traverse((node) => {
    if (!node.isMesh || node.userData.generatedSolidCap) {
      return;
    }
    const sourceMaterial = node.material;
    node.material = cloneDisplayMaterial(sourceMaterial);
    node.frustumCulled = false;
    node.renderOrder = 8;
    if (!node.isSkinnedMesh) {
      addSolidCapsToMesh(node, sourceMaterial);
    }
  });

  wrapper.add(clone);
  visibleModelRoot = wrapper;
  modelEffectRoot.add(visibleModelRoot);
  setupVisibleModelAnimation(clone);
  updateVisibleModelMaterials();
}

function addSolidCapsToMesh(mesh, sourceMaterial) {
  const capGeometry = createBoundaryCapGeometry(mesh.geometry);
  if (!capGeometry) {
    return;
  }

  const capMaterial = cloneDisplayMaterial(Array.isArray(sourceMaterial) ? sourceMaterial[0] : sourceMaterial);
  capMaterial.userData.isSolidCap = true;
  const capMesh = new THREE.Mesh(capGeometry, capMaterial);
  capMesh.name = `${mesh.name || 'Mesh'} Solid Caps`;
  capMesh.renderOrder = 9;
  capMesh.frustumCulled = false;
  capMesh.userData.generatedSolidCap = true;
  mesh.add(capMesh);
}

function removeVisibleModel() {
  if (!visibleModelRoot) {
    return;
  }

  visibleModelRoot.traverse((node) => {
    if (!node.isMesh) {
      return;
    }
    if (node.userData.generatedSolidCap && node.geometry?.dispose) {
      node.geometry.dispose();
    }
    disposeDisplayMaterial(node.material);
  });
  modelEffectRoot.remove(visibleModelRoot);
  visibleModelRoot = null;
  modelAnimation.visibleMixer = null;
  modelAnimation.visibleAction = null;
}

function acquireSafeDisplayTexture(sourceTexture) {
  if (!sourceTexture) {
    return null;
  }

  const cached = safeDisplayTextureCache.get(sourceTexture);
  if (cached) {
    cached.references += 1;
    return cached.texture;
  }

  const image = sourceTexture.image;
  const sourceWidth = image?.videoWidth || image?.naturalWidth || image?.width || 0;
  const sourceHeight = image?.videoHeight || image?.naturalHeight || image?.height || 0;
  if (!image || !sourceWidth || !sourceHeight) {
    return null;
  }

  try {
    const scale = Math.min(1, MAX_TEXTURE_SAMPLER_SIZE / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const previewCanvas = document.createElement('canvas');
    previewCanvas.width = width;
    previewCanvas.height = height;
    const context = previewCanvas.getContext('2d');
    context.drawImage(image, 0, 0, width, height);

    const texture = new THREE.CanvasTexture(previewCanvas);
    texture.name = `${sourceTexture.name || 'Model texture'} Preview`;
    texture.colorSpace = sourceTexture.colorSpace;
    texture.wrapS = sourceTexture.wrapS;
    texture.wrapT = sourceTexture.wrapT;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.flipY = sourceTexture.flipY;
    texture.channel = sourceTexture.channel;
    texture.repeat.copy(sourceTexture.repeat);
    texture.offset.copy(sourceTexture.offset);
    texture.center.copy(sourceTexture.center);
    texture.rotation = sourceTexture.rotation;
    texture.matrixAutoUpdate = sourceTexture.matrixAutoUpdate;
    texture.matrix.copy(sourceTexture.matrix);
    texture.needsUpdate = true;
    safeDisplayTextureCache.set(sourceTexture, { texture, references: 1 });
    return texture;
  } catch (error) {
    console.warn('Could not create lightweight display texture.', error);
    return null;
  }
}

function releaseSafeDisplayTexture(sourceTexture) {
  if (!sourceTexture) {
    return;
  }

  const cached = safeDisplayTextureCache.get(sourceTexture);
  if (!cached) {
    return;
  }

  cached.references -= 1;
  if (cached.references <= 0) {
    cached.texture.dispose();
    safeDisplayTextureCache.delete(sourceTexture);
  }
}

function cloneDisplayMaterial(material) {
  if (Array.isArray(material)) {
    return material.map((item) => cloneDisplayMaterial(item));
  }

  const source = material || new THREE.MeshBasicMaterial({ color: 0xffffff });
  const baseColor = source.color ? source.color.clone() : new THREE.Color(1, 1, 1);
  const baseMap = source.userData?.baseMap || source.map || null;
  const safeMap = baseMap ? acquireSafeDisplayTexture(baseMap) : null;
  const displayMaterial = new THREE.MeshStandardMaterial({
    color: baseColor,
    map: state.useTexture ? safeMap : null,
    normalMap: null,
    roughnessMap: null,
    metalnessMap: null,
    alphaMap: null,
    emissiveMap: null,
    side: THREE.FrontSide,
    vertexColors: Boolean(source.vertexColors),
    transparent: false,
    opacity: 1,
    roughness: state.modelRoughness,
    metalness: Math.min(source.metalness ?? 0, 0.25),
    emissive: new THREE.Color(0x000000),
    emissiveIntensity: 0,
    alphaTest: 0
  });
  displayMaterial.userData.baseColor = baseColor;
  displayMaterial.userData.baseAlphaTest = Number(source.alphaTest) > 0.001 ? Number(source.alphaTest) : 0;
  displayMaterial.userData.baseMap = baseMap;
  displayMaterial.userData.safeDisplayTextureSource = safeMap ? baseMap : null;
  displayMaterial.userData.safeDisplayMap = safeMap;
  displayMaterial.userData.baseMetalness = source.metalness ?? 0;
  applyBreakShader(displayMaterial);
  return displayMaterial;
}

function createBoundaryCapGeometry(geometry) {
  if (!geometry?.attributes?.position || geometry.attributes.position.count < 12) {
    return null;
  }

  if (geometry.attributes.position.count > 120000) {
    return null;
  }

  let merged = null;
  try {
    merged = mergeVertices(geometry.clone(), 1e-4);
  } catch (error) {
    console.warn('Could not merge geometry for solid caps.', error);
    return null;
  }

  const position = merged.attributes.position;
  const index = merged.index;
  const indices = index ? index.array : [...Array(position.count).keys()];
  const edgeMap = new Map();

  for (let i = 0; i < indices.length; i += 3) {
    registerBoundaryEdge(edgeMap, indices[i], indices[i + 1]);
    registerBoundaryEdge(edgeMap, indices[i + 1], indices[i + 2]);
    registerBoundaryEdge(edgeMap, indices[i + 2], indices[i]);
  }

  const boundaryEdges = [...edgeMap.values()]
    .filter((edge) => edge.count === 1)
    .map((edge) => [edge.a, edge.b]);

  if (!boundaryEdges.length || boundaryEdges.length > 24000) {
    merged.dispose();
    return null;
  }

  const loops = buildBoundaryLoops(boundaryEdges);
  const capPositions = [];
  const capNormals = [];
  const capUvs = [];
  const point = new THREE.Vector3();
  const loopPoints = [];
  const capNormal = new THREE.Vector3();
  const axisX = new THREE.Vector3();
  const axisY = new THREE.Vector3();
  const center = new THREE.Vector3();
  const projected = [];
  const bbox = new THREE.Box3().setFromBufferAttribute(position);
  const bboxSize = bbox.getSize(new THREE.Vector3());
  const minArea = Math.max(bboxSize.lengthSq() * 0.00002, 1e-8);
  const maxCapRadius = Math.max(bboxSize.length() * 0.32, 0.001);

  loops.forEach((loop) => {
    if (loop.length < 8 || loop.length > 96) {
      return;
    }

    loopPoints.length = 0;
    loop.forEach((vertexIndex) => {
      loopPoints.push(new THREE.Vector3().fromBufferAttribute(position, vertexIndex));
    });

    computeLoopNormal(loopPoints, capNormal);
    if (capNormal.lengthSq() < 1e-8) {
      return;
    }
    capNormal.normalize();

    center.set(0, 0, 0);
    loopPoints.forEach((item) => center.add(item));
    center.divideScalar(loopPoints.length);

    axisX.subVectors(loopPoints[0], center);
    axisX.addScaledVector(capNormal, -axisX.dot(capNormal));
    if (axisX.lengthSq() < 1e-8) {
      axisX.crossVectors(capNormal, new THREE.Vector3(0, 1, 0));
      if (axisX.lengthSq() < 1e-8) {
        axisX.crossVectors(capNormal, new THREE.Vector3(1, 0, 0));
      }
    }
    axisX.normalize();
    axisY.crossVectors(capNormal, axisX).normalize();

    projected.length = 0;
    let maxPlaneDistance = 0;
    let maxRadius = 0;
    loopPoints.forEach((item) => {
      point.subVectors(item, center);
      projected.push(new THREE.Vector2(point.dot(axisX), point.dot(axisY)));
      maxPlaneDistance = Math.max(maxPlaneDistance, Math.abs(point.dot(capNormal)));
      maxRadius = Math.max(maxRadius, point.length());
    });

    const area = Math.abs(THREE.ShapeUtils.area(projected));
    if (area < minArea) {
      return;
    }

    const perimeter = projectedPerimeter(projected);
    const compactness = perimeter > 0 ? (4 * Math.PI * area) / (perimeter * perimeter) : 0;
    if (
      compactness < 0.24 ||
      maxRadius > maxCapRadius ||
      maxPlaneDistance > Math.max(maxRadius * 0.08, 0.002) ||
      !isSimplePolygon(projected) ||
      !isConvexPolygon(projected)
    ) {
      return;
    }

    appendFanCap(capPositions, capNormals, capUvs, loopPoints, projected, center, capNormal);
  });

  merged.dispose();

  if (!capPositions.length) {
    return null;
  }

  const capGeometry = new THREE.BufferGeometry();
  capGeometry.setAttribute('position', new THREE.Float32BufferAttribute(capPositions, 3));
  capGeometry.setAttribute('normal', new THREE.Float32BufferAttribute(capNormals, 3));
  capGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(capUvs, 2));
  capGeometry.computeBoundingSphere();
  return capGeometry;
}

function projectedPerimeter(points) {
  let perimeter = 0;
  for (let i = 0; i < points.length; i += 1) {
    perimeter += points[i].distanceTo(points[(i + 1) % points.length]);
  }
  return perimeter;
}

function isSimplePolygon(points) {
  for (let i = 0; i < points.length; i += 1) {
    const a1 = points[i];
    const a2 = points[(i + 1) % points.length];
    for (let j = i + 1; j < points.length; j += 1) {
      if (Math.abs(i - j) <= 1 || (i === 0 && j === points.length - 1)) {
        continue;
      }
      const b1 = points[j];
      const b2 = points[(j + 1) % points.length];
      if (segmentsIntersect(a1, a2, b1, b2)) {
        return false;
      }
    }
  }
  return true;
}

function isConvexPolygon(points) {
  let sign = 0;
  for (let i = 0; i < points.length; i += 1) {
    const cross = orientation2d(points[i], points[(i + 1) % points.length], points[(i + 2) % points.length]);
    if (Math.abs(cross) < 1e-7) {
      continue;
    }
    const nextSign = Math.sign(cross);
    if (sign && nextSign !== sign) {
      return false;
    }
    sign = nextSign;
  }
  return true;
}

function segmentsIntersect(a1, a2, b1, b2) {
  const d1 = orientation2d(a1, a2, b1);
  const d2 = orientation2d(a1, a2, b2);
  const d3 = orientation2d(b1, b2, a1);
  const d4 = orientation2d(b1, b2, a2);
  return d1 * d2 < -1e-10 && d3 * d4 < -1e-10;
}

function orientation2d(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function appendFanCap(capPositions, capNormals, capUvs, loopPoints, projected, center, capNormal) {
  if (loopPoints.length < 3) {
    return;
  }

  const centerUv = new THREE.Vector2(0, 0);
  const clockwise = THREE.ShapeUtils.area(projected) < 0;
  for (let i = 0; i < loopPoints.length; i += 1) {
    const next = (i + 1) % loopPoints.length;
    const a = clockwise ? loopPoints[next] : loopPoints[i];
    const b = clockwise ? loopPoints[i] : loopPoints[next];
    const uvA = clockwise ? projected[next] : projected[i];
    const uvB = clockwise ? projected[i] : projected[next];
    pushCapTriangle(capPositions, capNormals, capUvs, center, a, b, centerUv, uvA, uvB, capNormal);
  }
}

function pushCapTriangle(capPositions, capNormals, capUvs, a, b, c, uvA, uvB, uvC, normal) {
  [a, b, c].forEach((point) => {
    capPositions.push(point.x, point.y, point.z);
    capNormals.push(normal.x, normal.y, normal.z);
  });
  [uvA, uvB, uvC].forEach((uv) => {
    capUvs.push(uv.x, uv.y);
  });
}

function registerBoundaryEdge(edgeMap, a, b) {
  const min = Math.min(a, b);
  const max = Math.max(a, b);
  const key = `${min}:${max}`;
  const edge = edgeMap.get(key);
  if (edge) {
    edge.count += 1;
    return;
  }

  edgeMap.set(key, { a, b, count: 1 });
}

function buildBoundaryLoops(edges) {
  const unused = new Set(edges.map((_, index) => index));
  const adjacency = new Map();
  edges.forEach(([a, b], index) => {
    if (!adjacency.has(a)) {
      adjacency.set(a, []);
    }
    if (!adjacency.has(b)) {
      adjacency.set(b, []);
    }
    adjacency.get(a).push(index);
    adjacency.get(b).push(index);
  });
  const loops = [];

  while (unused.size) {
    const startIndex = unused.values().next().value;
    const startEdge = edges[startIndex];
    unused.delete(startIndex);
    const loop = [startEdge[0], startEdge[1]];
    let previous = startEdge[0];
    let current = startEdge[1];

    let closed = false;
    for (let guard = 0; guard < edges.length; guard += 1) {
      if (current === loop[0]) {
        loop.pop();
        closed = true;
        break;
      }

      const candidateIndex = (adjacency.get(current) || []).find((index) => unused.has(index));
      if (candidateIndex === undefined) {
        break;
      }

      unused.delete(candidateIndex);
      const [a, b] = edges[candidateIndex];
      const next = a === current ? b : a;
      if (next === previous) {
        break;
      }

      loop.push(next);
      previous = current;
      current = next;
    }

    if (closed && loop.length >= 3) {
      loops.push(loop);
    }
  }

  return loops;
}

function computeLoopNormal(points, target) {
  target.set(0, 0, 0);
  for (let i = 0; i < points.length; i += 1) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    target.x += (current.y - next.y) * (current.z + next.z);
    target.y += (current.z - next.z) * (current.x + next.x);
    target.z += (current.x - next.x) * (current.y + next.y);
  }
  return target;
}

function applyBreakShader(material) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uBreakAmount = modelBreakUniforms.uBreakAmount;
    shader.uniforms.uBreakProgress = modelBreakUniforms.uBreakProgress;
    shader.uniforms.uBreakRadius = modelBreakUniforms.uBreakRadius;
    shader.uniforms.uBreakFeather = modelBreakUniforms.uBreakFeather;
    shader.uniforms.uBreakCenter = modelBreakUniforms.uBreakCenter;
    shader.uniforms.uParticleizeProgress = modelBreakUniforms.uParticleizeProgress;
    shader.uniforms.uParticleizeEnabled = modelBreakUniforms.uParticleizeEnabled;
    shader.uniforms.uBreakRootInverse = modelBreakUniforms.uBreakRootInverse;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
uniform mat4 uBreakRootInverse;
varying vec3 vBreakModelPosition;`
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
vec4 breakWorldPosition = modelMatrix * vec4(transformed, 1.0);
vBreakModelPosition = (uBreakRootInverse * breakWorldPosition).xyz;`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uBreakAmount;
uniform float uBreakProgress;
uniform float uBreakRadius;
uniform float uBreakFeather;
uniform vec3 uBreakCenter;
uniform float uParticleizeProgress;
uniform float uParticleizeEnabled;
varying vec3 vBreakModelPosition;

float breakHash(vec3 p) {
  return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
}

float particleizeModelOrder(vec3 p) {
  float verticalOrder = clamp(p.y * 0.24 + 0.5, 0.0, 1.0);
  float radial = clamp(length(p.xz) * 0.18, 0.0, 1.0);
  float band = breakHash(floor(p * 7.0));
  return clamp(verticalOrder * 0.7 + radial * 0.12 + band * 0.18 - 0.04, 0.0, 1.0);
}`
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
diffuseColor.a = opacity;`
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
float breakDistance = length(vBreakModelPosition - uBreakCenter);
float breakArea = 1.0 - smoothstep(uBreakRadius, uBreakRadius + max(uBreakFeather, 0.001), breakDistance);
float breakNoise = breakHash(floor(vBreakModelPosition * 18.0) + vec3(breakHash(vBreakModelPosition * 3.0)));
float breakCut = clamp(uBreakAmount, 0.0, 1.0) * breakArea *
  smoothstep(breakNoise - 0.18, breakNoise + 0.18, clamp(uBreakProgress, 0.0, 1.0));
if (breakCut > 0.52) {
  discard;
}
float particleizeProgress = clamp(uParticleizeProgress, 0.0, 1.0);
if (uParticleizeEnabled > 0.5 && particleizeProgress > 0.0001) {
  float order = particleizeModelOrder(vBreakModelPosition);
  float local = (particleizeProgress - order + 0.16) / 0.32;
  float converted = particleizeProgress >= 0.999 ? 1.0 : smoothstep(0.0, 1.0, clamp(local, 0.0, 1.0));
  float dither = breakHash(floor(vBreakModelPosition * 32.0) + vec3(breakHash(vBreakModelPosition * 5.0)));
  if (converted > dither) {
    discard;
  }
}`
      );
  };
}

function disposeDisplayMaterial(material) {
  const materials = Array.isArray(material) ? material : [material];
  materials.forEach((item) => {
    releaseSafeDisplayTexture(item?.userData?.safeDisplayTextureSource);
    if (item?.dispose) {
      item.dispose();
    }
  });
}

function updateVisibleModelMaterials() {
  if (!visibleModelRoot) {
    return;
  }

  const whiteColor = new THREE.Color(0xf1f3f1);
  const particleizeMode = state.effectMode === 'particles';
  const modelVisibility = THREE.MathUtils.clamp(state.modelVisibility, 0, 1) *
    getParticleDissolveSolidOpacity(state);
  modelBreakUniforms.uParticleizeEnabled.value = particleizeMode ? 1 : 0;
  modelBreakUniforms.uParticleizeProgress.value = state.particleizeProgress;
  const whiteAmount = particleizeMode ? 0 : THREE.MathUtils.clamp(state.modelWhite, 0, 1);
  const roughness = particleizeMode ? 0.55 : THREE.MathUtils.clamp(state.modelRoughness, 0, 1);
  visibleModelRoot.traverse((node) => {
    if (!node.isMesh) {
      return;
    }

    const materials = Array.isArray(node.material) ? node.material : [node.material];
    materials.forEach((material) => {
      if (!material) {
        return;
      }
      const baseColor = material.userData.baseColor || whiteColor;
      material.color.copy(baseColor).lerp(whiteColor, whiteAmount);
      material.opacity = modelVisibility;
      material.transparent = modelVisibility < 0.999;
      material.blending = modelVisibility < 0.999 ? THREE.NormalBlending : THREE.NoBlending;
      material.depthTest = true;
      material.depthWrite = modelVisibility >= 0.999;
      material.side = particleizeMode ? THREE.FrontSide : THREE.DoubleSide;
      material.forceSinglePass = false;
      material.alphaMap = null;
      material.alphaTest = 0;
      material.roughness = roughness;
      material.metalness = Math.min(material.userData.baseMetalness ?? 0, 0.25) * (1 - whiteAmount * 0.85);
      material.emissive.copy(particleizeMode ? new THREE.Color(0x000000) : whiteColor);
      material.emissiveIntensity = particleizeMode ? 0 : 0.025 + whiteAmount * 0.08;
      const nextMap = state.useTexture && whiteAmount <= 0.42
        ? material.userData.safeDisplayMap || null
        : null;
      if (material.map !== nextMap) {
        material.map = nextMap;
        material.needsUpdate = true;
      }
      material.needsUpdate = true;
    });
  });
}

function smoothstep(edge0, edge1, value) {
  const t = THREE.MathUtils.clamp((value - edge0) / Math.max(edge1 - edge0, 0.0001), 0, 1);
  return t * t * (3 - 2 * t);
}

function getParticleDissolveSolidOpacity(options = state) {
  if ((options?.effectMode || state.effectMode) !== 'particles') {
    return 1;
  }
  const dissolveAmount = THREE.MathUtils.clamp(Number(options?.dissolve ?? state.dissolve) || 0, 0, 1);
  return 1 - smoothstep(0.86, 1, dissolveAmount);
}

function createSamplingGeometryForMesh(mesh, useCurrentPose = false) {
  const sourceGeometry = mesh.geometry;
  const sourcePosition = sourceGeometry?.attributes?.position;
  if (!sourcePosition) {
    return null;
  }

  const sourceVertexIndices = sourceGeometry.index
    ? new Uint32Array(sourceGeometry.index.count)
    : new Uint32Array(sourcePosition.count);

  if (sourceGeometry.index) {
    for (let index = 0; index < sourceGeometry.index.count; index += 1) {
      sourceVertexIndices[index] = sourceGeometry.index.getX(index);
    }
  } else {
    for (let index = 0; index < sourcePosition.count; index += 1) {
      sourceVertexIndices[index] = index;
    }
  }

  const geometry = sourceGeometry.index ? sourceGeometry.toNonIndexed() : sourceGeometry.clone();
  if (useCurrentPose) {
    const position = geometry.attributes.position;
    const vertex = new THREE.Vector3();
    const morphInfluences = Array.isArray(mesh.morphTargetInfluences) ? mesh.morphTargetInfluences : null;
    const previousMorphInfluences = morphInfluences &&
      sourceGeometry.morphAttributes?.position?.length
      ? morphInfluences.slice()
      : null;

    if (previousMorphInfluences) {
      morphInfluences.fill(1);
    }

    mesh.skeleton?.update?.();
    try {
      for (let index = 0; index < position.count; index += 1) {
        getSourceVertexWorldPosition(mesh, sourceVertexIndices[index], vertex);
        position.setXYZ(index, vertex.x, vertex.y, vertex.z);
      }
    } finally {
      if (previousMorphInfluences) {
        previousMorphInfluences.forEach((value, index) => {
          morphInfluences[index] = value;
        });
      }
    }
    position.needsUpdate = true;
  } else {
    geometry.applyMatrix4(mesh.matrixWorld);
  }

  return { geometry, sourceVertexIndices };
}

function getSourceVertexWorldPosition(mesh, vertexIndex, target) {
  if (typeof mesh.getVertexPosition === 'function') {
    mesh.getVertexPosition(vertexIndex, target);
  } else {
    target.fromBufferAttribute(mesh.geometry.attributes.position, vertexIndex);
  }
  target.applyMatrix4(mesh.matrixWorld);
  return target;
}

function collectSampleMeshes(root, options = {}) {
  const cleanupStrength = THREE.MathUtils.clamp(Number(options.cleanupStrength ?? 0), 0, 1);
  const captureAnimationBindings = Boolean(options.captureAnimationBindings);
  root.updateWorldMatrix(true, true);
  const meshes = [];
  const box = new THREE.Box3();

  root.traverse((node) => {
    if (!node.isMesh || !node.geometry?.attributes?.position) {
      return;
    }

    const sampling = createSamplingGeometryForMesh(node, captureAnimationBindings || node.isSkinnedMesh);
    if (!sampling) {
      return;
    }
    const { geometry, sourceVertexIndices } = sampling;

    geometry.computeVertexNormals();
    geometry.computeBoundingBox();

    const area = triangleArea(geometry);
    if (area <= 0 || !Number.isFinite(area)) {
      geometry.dispose();
      return;
    }

    const meshBox = geometry.boundingBox.clone();
    box.union(meshBox);
    const samplingMesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
    const sampler = new MeshSurfaceSampler(samplingMesh).build();
    meshes.push({
      geometry,
      sampler,
      area,
      box: meshBox,
      center: meshBox.getCenter(new THREE.Vector3()),
      sourceMesh: node,
      sourceVertexIndices,
      faceMaterialIndices: createFaceMaterialIndices(geometry),
      hasVertexColors: Boolean(geometry.attributes.color),
      materialSources: createMaterialSources(node.material)
    });
  });

  if (cleanupStrength <= 0.01) {
    return { meshes, box, sampleBox: box };
  }

  return filterSampleMeshesForOutliers(meshes, box, cleanupStrength);
}

function filterSampleMeshesForOutliers(meshes, rawBox, cleanupStrength = 0) {
  if (!meshes.length || rawBox.isEmpty()) {
    return { meshes, box: rawBox, sampleBox: rawBox };
  }

  const sampleBox = computeRobustSampleBox(meshes, rawBox, cleanupStrength);
  const totalArea = meshes.reduce((sum, mesh) => sum + mesh.area, 0) || 1;
  const minArea = totalArea * 0.00002;
  const kept = [];
  const rejected = [];

  meshes.forEach((mesh) => {
    const areaRatio = mesh.area / totalArea;
    const keep =
      areaRatio > 0.018 ||
      mesh.box.intersectsBox(sampleBox) ||
      sampleBox.containsPoint(mesh.center);

    if (keep && mesh.area >= minArea) {
      kept.push(mesh);
    } else {
      rejected.push(mesh);
    }
  });

  if (!kept.length) {
    return { meshes, box: rawBox, sampleBox: rawBox };
  }

  rejected.forEach((mesh) => mesh.geometry.dispose());

  return {
    meshes: kept,
    box: sampleBox,
    sampleBox
  };
}

function computeRobustSampleBox(meshes, rawBox, cleanupStrength = 0) {
  const totalArea = meshes.reduce((sum, mesh) => sum + mesh.area, 0) || 1;
  const sorted = [...meshes].sort((a, b) => b.area - a.area);
  const coreBox = new THREE.Box3();
  let coveredArea = 0;
  const coverageTarget = THREE.MathUtils.lerp(0.9995, 0.982, cleanupStrength);
  const smallAreaThreshold = THREE.MathUtils.lerp(0.0006, 0.012, cleanupStrength);

  for (const mesh of sorted) {
    const areaRatio = mesh.area / totalArea;
    if (coveredArea / totalArea > coverageTarget && areaRatio < smallAreaThreshold) {
      continue;
    }
    coreBox.union(mesh.box);
    coveredArea += mesh.area;
  }

  if (coreBox.isEmpty()) {
    return rawBox.clone();
  }

  const rawSize = rawBox.getSize(new THREE.Vector3());
  const coreSize = coreBox.getSize(new THREE.Vector3());
  const rawMax = Math.max(rawSize.x, rawSize.y, rawSize.z, 0.0001);
  const coreMax = Math.max(coreSize.x, coreSize.y, coreSize.z, 0.0001);

  if (coreMax < rawMax * 0.08) {
    return rawBox.clone();
  }

  const vertexBox = computeVertexPercentileBox(meshes, rawBox, cleanupStrength);
  const expandedCore = coreBox.clone().expandByScalar(Math.max(coreMax * THREE.MathUtils.lerp(0.32, 0.18, cleanupStrength), rawMax * 0.018));
  expandedCore.intersect(rawBox);

  if (vertexBox && !vertexBox.isEmpty()) {
    const intersection = expandedCore.clone().intersect(vertexBox);
    const intersectionSize = intersection.getSize(new THREE.Vector3());
    if (!intersection.isEmpty() && Math.max(intersectionSize.x, intersectionSize.y, intersectionSize.z) > coreMax * 0.35) {
      return intersection.expandByScalar(rawMax * 0.012).intersect(rawBox);
    }
  }

  return expandedCore;
}

function computeVertexPercentileBox(meshes, rawBox, cleanupStrength = 0) {
  const totalVertices = meshes.reduce((sum, mesh) => sum + mesh.geometry.attributes.position.count, 0);
  if (totalVertices < 128) {
    return null;
  }

  const stride = Math.max(1, Math.ceil(totalVertices / 60000));
  const xs = [];
  const ys = [];
  const zs = [];

  meshes.forEach((mesh) => {
    const position = mesh.geometry.attributes.position;
    for (let index = 0; index < position.count; index += stride) {
      xs.push(position.getX(index));
      ys.push(position.getY(index));
      zs.push(position.getZ(index));
    }
  });

  if (xs.length < 64) {
    return null;
  }

  xs.sort((a, b) => a - b);
  ys.sort((a, b) => a - b);
  zs.sort((a, b) => a - b);

  const lower = THREE.MathUtils.lerp(0.0005, 0.006, cleanupStrength);
  const upper = THREE.MathUtils.lerp(0.9995, 0.994, cleanupStrength);
  const rawSize = rawBox.getSize(new THREE.Vector3());
  const margin = Math.max(Math.max(rawSize.x, rawSize.y, rawSize.z) * 0.04, 0.0001);
  const box = new THREE.Box3(
    new THREE.Vector3(pickQuantile(xs, lower), pickQuantile(ys, lower), pickQuantile(zs, lower)),
    new THREE.Vector3(pickQuantile(xs, upper), pickQuantile(ys, upper), pickQuantile(zs, upper))
  );

  return box.expandByScalar(margin).intersect(rawBox);
}

function pickQuantile(sortedValues, ratio) {
  const index = THREE.MathUtils.clamp(
    Math.round((sortedValues.length - 1) * ratio),
    0,
    sortedValues.length - 1
  );
  return sortedValues[index];
}

function sampleRenderableSurface(
  weightedMeshes,
  sampleBox,
  samplePosition,
  sampleNormal,
  sampleColor,
  sampleUV,
  particleColor,
  sampleBinding = null
) {
  let selected = weightedMeshes[weightedMeshes.length - 1];
  let faceIndex = 0;
  let hasOriginalColor = false;
  let hasCutoutAlpha = false;
  let fallback = null;

  for (let attempt = 0; attempt < 72; attempt += 1) {
    selected = pickWeightedMesh(weightedMeshes, Math.random());
    faceIndex = selected.sampler.sampleFaceIndex();
    sampleColor.set(1, 1, 1);
    sampleUV.set(0, 0);
    selected.sampler.sampleFace(faceIndex, samplePosition, sampleNormal, sampleColor, sampleUV);
    if (sampleBinding) {
      writeSurfaceSampleBinding(selected, faceIndex, samplePosition, sampleBinding);
    }

    if (sampleBox && !sampleBox.containsPoint(samplePosition)) {
      continue;
    }

    const materialSource = getFaceMaterialSource(selected, faceIndex);
    const materialSample = sampleOriginalColor(
      materialSource,
      sampleUV,
      sampleColor,
      selected.hasVertexColors,
      particleColor
    );
    hasOriginalColor = materialSample.hasOriginalColor;
    hasCutoutAlpha = Boolean(materialSource?.hasCutoutAlpha);

    if (materialSample.alpha > 0.08) {
      return { selected, faceIndex, hasOriginalColor, hasCutoutAlpha };
    }

    fallback ||= {
      selected,
      faceIndex,
      hasOriginalColor,
      hasCutoutAlpha,
      binding: sampleBinding
        ? {
            meshIndex: sampleBinding.meshIndex,
            faceIndex: sampleBinding.faceIndex,
            barycentric: sampleBinding.barycentric.clone()
          }
        : null,
      position: samplePosition.clone(),
      normal: sampleNormal.clone(),
      color: particleColor.clone()
    };
  }

  if (fallback) {
    selected = fallback.selected;
    faceIndex = fallback.faceIndex;
    hasOriginalColor = fallback.hasOriginalColor;
    hasCutoutAlpha = fallback.hasCutoutAlpha;
    samplePosition.copy(fallback.position);
    sampleNormal.copy(fallback.normal);
    particleColor.copy(fallback.color);
    if (sampleBinding && fallback.binding) {
      sampleBinding.meshIndex = fallback.binding.meshIndex;
      sampleBinding.faceIndex = fallback.binding.faceIndex;
      sampleBinding.barycentric.copy(fallback.binding.barycentric);
    }
  } else {
    selected = pickWeightedMesh(weightedMeshes, Math.random());
    faceIndex = selected.sampler.sampleFaceIndex();
    selected.sampler.sampleFace(faceIndex, samplePosition, sampleNormal, sampleColor, sampleUV);
    if (sampleBinding) {
      writeSurfaceSampleBinding(selected, faceIndex, samplePosition, sampleBinding);
    }
    const materialSource = getFaceMaterialSource(selected, faceIndex);
    const materialSample = sampleOriginalColor(
      materialSource,
      sampleUV,
      sampleColor,
      selected.hasVertexColors,
      particleColor
    );
    hasOriginalColor = materialSample.hasOriginalColor;
    hasCutoutAlpha = Boolean(materialSource?.hasCutoutAlpha);
    if (sampleBox && !sampleBox.containsPoint(samplePosition)) {
      sampleBox.clampPoint(samplePosition, samplePosition);
    }
  }

  return { selected, faceIndex, hasOriginalColor, hasCutoutAlpha };
}

function writeSurfaceSampleBinding(meshInfo, faceIndex, samplePosition, sampleBinding) {
  const position = meshInfo.geometry.attributes.position;
  const faceOffset = faceIndex * 3;
  const a = (sampleBinding._a ||= new THREE.Vector3()).fromBufferAttribute(position, faceOffset);
  const b = (sampleBinding._b ||= new THREE.Vector3()).fromBufferAttribute(position, faceOffset + 1);
  const c = (sampleBinding._c ||= new THREE.Vector3()).fromBufferAttribute(position, faceOffset + 2);
  sampleBinding.meshIndex = meshInfo.animationIndex ?? 0;
  sampleBinding.faceIndex = faceIndex;
  sampleBinding.barycentric ||= new THREE.Vector3();
  THREE.Triangle.getBarycoord(samplePosition, a, b, c, sampleBinding.barycentric);
  if (
    !Number.isFinite(sampleBinding.barycentric.x) ||
    !Number.isFinite(sampleBinding.barycentric.y) ||
    !Number.isFinite(sampleBinding.barycentric.z)
  ) {
    sampleBinding.barycentric.set(1, 0, 0);
  }
}

function getParticleCandidateCount(targetCount, cleanupStrength = 0.78) {
  if (targetCount < 12000 || cleanupStrength <= 0.01) {
    return targetCount;
  }

  const extraRatio = 0.22 + cleanupStrength * 0.82;
  const maxExtra = Math.round(60000 + cleanupStrength * 180000);
  const extra = Math.min(Math.round(targetCount * extraRatio), maxExtra);
  return targetCount + extra;
}

function selectDenseParticleIndices(positions, cutoutWeights, candidateCount, targetCount, cleanupStrength = 0.78) {
  if (cleanupStrength <= 0.01 || candidateCount <= targetCount || candidateCount < 12000) {
    return Array.from({ length: Math.min(candidateCount, targetCount) }, (_, index) => index);
  }

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (let index = 0; index < candidateCount; index += 1) {
    const offset = index * 3;
    const x = positions[offset];
    const y = positions[offset + 1];
    const z = positions[offset + 2];
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  }

  const maxSpan = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 0.0001);
  const cellSize = THREE.MathUtils.clamp(maxSpan / 48, 0.07, 0.16);
  const grid = new Map();
  const cellXs = new Int16Array(candidateCount);
  const cellYs = new Int16Array(candidateCount);
  const cellZs = new Int16Array(candidateCount);

  const cellKey = (x, y, z) => `${x}|${y}|${z}`;

  for (let index = 0; index < candidateCount; index += 1) {
    const offset = index * 3;
    const cx = Math.floor((positions[offset] - minX) / cellSize);
    const cy = Math.floor((positions[offset + 1] - minY) / cellSize);
    const cz = Math.floor((positions[offset + 2] - minZ) / cellSize);
    const key = cellKey(cx, cy, cz);
    cellXs[index] = cx;
    cellYs[index] = cy;
    cellZs[index] = cz;
    grid.set(key, (grid.get(key) || 0) + 1);
  }

  const structuralCellMin = Math.max(1, Math.round(THREE.MathUtils.lerp(1, 7, cleanupStrength)));
  const componentSizesByCell = computeStructuralComponentSizes(grid, structuralCellMin, cellKey);
  const componentSizes = new Float32Array(candidateCount);
  const densities = new Float32Array(candidateCount);
  const scores = new Float32Array(candidateCount);
  const cleanupCurve = cleanupStrength * cleanupStrength;
  for (let index = 0; index < candidateCount; index += 1) {
    const cx = cellXs[index];
    const cy = cellYs[index];
    const cz = cellZs[index];
    let neighborCount = 0;

    for (let dz = -1; dz <= 1; dz += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          neighborCount += grid.get(cellKey(cx + dx, cy + dy, cz + dz)) || 0;
        }
      }
    }

    componentSizes[index] = componentSizesByCell.get(cellKey(cx, cy, cz)) || 0;
    const solidBoost = cutoutWeights[index] > 0.5 ? 0 : 18 * (1 - cleanupCurve);
    densities[index] = neighborCount;
    scores[index] = neighborCount + solidBoost;
  }

  const passesDensity = (index) => {
    const isCutout = cutoutWeights[index] > 0.5;
    const threshold = isCutout
      ? THREE.MathUtils.lerp(2, 34, cleanupCurve)
      : THREE.MathUtils.lerp(0, 16, cleanupCurve);
    const componentThreshold = isCutout
      ? Math.max(24, targetCount * THREE.MathUtils.lerp(0.0002, 0.012, cleanupCurve))
      : targetCount * THREE.MathUtils.lerp(0, 0.004, cleanupCurve);
    return densities[index] >= threshold && componentSizes[index] >= componentThreshold;
  };
  const selected = [];
  const rejectedBase = [];
  const extras = [];

  for (let index = 0; index < candidateCount; index += 1) {
    if (index < targetCount) {
      if (passesDensity(index)) {
        selected.push(index);
      } else {
        rejectedBase.push(index);
      }
    } else {
      extras.push(index);
    }
  }

  extras.sort((a, b) => scores[b] - scores[a] || a - b);
  for (const index of extras) {
    if (selected.length >= targetCount) {
      break;
    }
    if (passesDensity(index)) {
      selected.push(index);
    }
  }

  const minimumOutput = Math.round(targetCount * THREE.MathUtils.lerp(1, 0.86, cleanupCurve));
  if (selected.length < minimumOutput) {
    rejectedBase.sort((a, b) => scores[b] - scores[a] || a - b);
    for (const index of rejectedBase) {
      selected.push(index);
      if (selected.length >= minimumOutput) {
        break;
      }
    }
  }

  if (cleanupStrength < 0.92 && selected.length < targetCount) {
    const selectedSet = new Set(selected);
    const fallback = [...rejectedBase, ...extras]
      .filter((index) => !selectedSet.has(index))
      .sort((a, b) => scores[b] - scores[a] || a - b);
    for (const index of fallback) {
      selected.push(index);
      if (selected.length >= targetCount) {
        break;
      }
    }
  }

  return selected.slice(0, targetCount).sort((a, b) => a - b);
}

function computeStructuralComponentSizes(grid, minCellCount, cellKey) {
  const structuralCells = new Set();
  const componentSizes = new Map();

  grid.forEach((count, key) => {
    if (count >= minCellCount) {
      structuralCells.add(key);
    }
  });

  const visited = new Set();
  const parseKey = (key) => key.split('|').map((value) => Number(value));

  structuralCells.forEach((startKey) => {
    if (visited.has(startKey)) {
      return;
    }

    const queue = [startKey];
    const cells = [];
    let pointCount = 0;
    visited.add(startKey);

    while (queue.length) {
      const key = queue.pop();
      cells.push(key);
      pointCount += grid.get(key) || 0;
      const [cx, cy, cz] = parseKey(key);

      for (let dz = -1; dz <= 1; dz += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (dx === 0 && dy === 0 && dz === 0) {
              continue;
            }
            const neighborKey = cellKey(cx + dx, cy + dy, cz + dz);
            if (!structuralCells.has(neighborKey) || visited.has(neighborKey)) {
              continue;
            }
            visited.add(neighborKey);
            queue.push(neighborKey);
          }
        }
      }
    }

    cells.forEach((key) => componentSizes.set(key, pointCount));
  });

  return componentSizes;
}

function createFaceMaterialIndices(geometry) {
  const faceCount = geometry.attributes.position.count / 3;
  const materialIndices = new Uint16Array(faceCount);

  if (!geometry.groups.length) {
    return materialIndices;
  }

  geometry.groups.forEach((group) => {
    const startFace = Math.floor(group.start / 3);
    const endFace = Math.min(faceCount, Math.ceil((group.start + group.count) / 3));
    materialIndices.fill(group.materialIndex || 0, startFace, endFace);
  });

  return materialIndices;
}

function createMaterialSources(material) {
  const materials = Array.isArray(material) ? material : [material];
  return materials.map((item) => {
    const color = item?.color ? item.color.clone() : new THREE.Color(1, 1, 1);
    const mapSampler = item?.map ? createTextureSampler(item.map) : null;
    const alphaMapSampler = item?.alphaMap ? createTextureSampler(item.alphaMap) : null;
    const opacity = Number.isFinite(item?.opacity) ? item.opacity : 1;
    const alphaTest = Number.isFinite(item?.alphaTest) ? item.alphaTest : 0;
    const hasExplicitAlphaCutout = Boolean(alphaMapSampler || alphaTest > 0);
    const hasTransparentTextureAlpha = Boolean(item?.transparent && mapSampler?.hasAlpha);

    return {
      color,
      mapSampler,
      alphaMapSampler,
      opacity,
      alphaTest,
      hasExplicitAlphaCutout,
      hasTransparentTextureAlpha,
      hasCutoutAlpha: hasExplicitAlphaCutout || hasTransparentTextureAlpha,
      hasMaterialColor: !isWhiteColor(color),
      hasTextureColor: Boolean(mapSampler)
    };
  });
}

function getFaceMaterialSource(meshInfo, faceIndex) {
  const materialIndex = meshInfo.faceMaterialIndices[faceIndex] || 0;
  return meshInfo.materialSources[materialIndex] || meshInfo.materialSources[0] || null;
}

function sampleOriginalColor(materialSource, uv, vertexColor, hasVertexColors, target) {
  target.set(1, 1, 1);

  if (!materialSource) {
    return { hasOriginalColor: false, alpha: 1 };
  }

  target.copy(materialSource.color);
  let hasOriginalColor = materialSource.hasMaterialColor;
  let alpha = THREE.MathUtils.clamp(materialSource.opacity ?? 1, 0, 1);

  if (materialSource.mapSampler) {
    target.multiply(materialSource.mapSampler.sample(uv));
    alpha *= materialSource.mapSampler.sampleAlpha(uv);
    hasOriginalColor = true;
  }

  if (materialSource.alphaMapSampler) {
    alpha *= materialSource.alphaMapSampler.sampleAlpha(uv);
  }

  const cleanupStrength = THREE.MathUtils.clamp(Number(state.sampleCleanup ?? 0), 0, 1);
  const alphaThreshold = materialSource.alphaTest > 0
    ? THREE.MathUtils.clamp(materialSource.alphaTest, 0, 0.95)
    : materialSource.alphaMapSampler
      ? THREE.MathUtils.lerp(0.02, 0.7, cleanupStrength)
      : materialSource.hasTransparentTextureAlpha
        ? THREE.MathUtils.lerp(0.001, 0.55, cleanupStrength)
        : 0.001;
  if (alpha < alphaThreshold) {
    alpha = 0;
  }

  if (hasVertexColors) {
    target.multiply(vertexColor);
    hasOriginalColor = true;
  }

  return { hasOriginalColor, alpha };
}

function createTextureSampler(texture) {
  const image = texture.image;
  const sourceWidth = image?.videoWidth || image?.naturalWidth || image?.width || 0;
  const sourceHeight = image?.videoHeight || image?.naturalHeight || image?.height || 0;

  if (!image || !sourceWidth || !sourceHeight) {
    return null;
  }

  try {
    const scale = Math.min(1, MAX_TEXTURE_SAMPLER_SIZE / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const canvasElement = document.createElement('canvas');
    canvasElement.width = width;
    canvasElement.height = height;
    const context = canvasElement.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height).data;
    const uvBuffer = new THREE.Vector2();
    const sampled = new THREE.Color();
    let hasAlpha = false;
    const alphaStride = Math.max(4, Math.floor((width * height) / 12000) * 4);
    for (let index = 3; index < pixels.length; index += alphaStride) {
      if (pixels[index] < 250) {
        hasAlpha = true;
        break;
      }
    }

    const getPixelIndex = (uv) => {
      uvBuffer.copy(uv);
      texture.updateMatrix();
      texture.transformUv(uvBuffer);

      const x = Math.round(THREE.MathUtils.clamp(uvBuffer.x, 0, 1) * (width - 1));
      const y = Math.round(THREE.MathUtils.clamp(uvBuffer.y, 0, 1) * (height - 1));
      return (y * width + x) * 4;
    };

    return {
      sample(uv) {
        const pixelIndex = getPixelIndex(uv);
        sampled.setRGB(
          pixels[pixelIndex] / 255,
          pixels[pixelIndex + 1] / 255,
          pixels[pixelIndex + 2] / 255
        );

        if (texture.colorSpace === THREE.SRGBColorSpace) {
          sampled.convertSRGBToLinear();
        }

        return sampled;
      },
      sampleAlpha(uv) {
        return pixels[getPixelIndex(uv) + 3] / 255;
      },
      hasAlpha
    };
  } catch (error) {
    console.warn('Could not sample texture pixels.', error);
    return null;
  }
}

function isWhiteColor(color) {
  return Math.abs(color.r - 1) < 0.001 && Math.abs(color.g - 1) < 0.001 && Math.abs(color.b - 1) < 0.001;
}

function triangleArea(geometry) {
  const position = geometry.attributes.position;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  let area = 0;

  for (let i = 0; i < position.count; i += 3) {
    a.fromBufferAttribute(position, i);
    b.fromBufferAttribute(position, i + 1);
    c.fromBufferAttribute(position, i + 2);
    area += b.sub(a).cross(c.sub(a)).length() * 0.5;
  }

  return area;
}

function pickWeightedMesh(meshes, value) {
  for (const mesh of meshes) {
    if (value <= mesh.cumulative) {
      return mesh;
    }
  }
  return meshes[meshes.length - 1];
}

function createSamplerUvTarget() {
  return {
    x: 0,
    y: 0,
    set(x = 0, y = 0) {
      this.x = x;
      this.y = y;
      return this;
    },
    addScaledVector(vector, scale) {
      this.x += vector.x * scale;
      this.y += vector.y * scale;
      return this;
    }
  };
}

async function loadAssetFile(file, options = {}) {
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (!extension) {
    return;
  }

  if (IMAGE_EXTENSIONS.has(extension)) {
    await loadImageSplatFile(file, extension);
    return;
  }

  if (GAUSSIAN_SPLAT_EXTENSIONS.has(extension)) {
    await loadGaussianSplatFile(file, extension);
    return;
  }

  if (VIDEO_EXTENSIONS.has(extension)) {
    await loadVideoPlaneFile(file, extension);
    return;
  }

  await loadModelFile(file, extension, options);
}

async function loadModelFile(file, explicitExtension, options = {}) {
  const extension = explicitExtension || file.name.split('.').pop()?.toLowerCase();
  if (!extension || !MODEL_EXTENSIONS.has(extension)) {
    setStatus('Load failed');
    modelName.textContent = `当前：${file.name} 格式不支持`;
    return;
  }

  if (extension === 'blend') {
    await loadBlendModelFile(file, options);
    return;
  }

  setStatus('Loading');

  try {
    const [source, payload] = await Promise.all([parseModel(file, extension), createModelPayload(file, extension)]);
    const record = createImportedSceneModelRecord(source, file.name, payload, options);
    await activateImportedSceneModel(record, source, file.name, payload, { resetView: true });
  } catch (error) {
    console.error(error);
    setStatus('Load failed');
    modelName.textContent = `当前：${file.name} 读取失败`;
  }
}

async function loadMorphTargetFile(file, explicitExtension) {
  const extension = explicitExtension || file.name.split('.').pop()?.toLowerCase();
  if (!extension || !MODEL_EXTENSIONS.has(extension)) {
    setStatus('Target failed');
    if (morphUi.name) {
      morphUi.name.textContent = `当前：${file.name} 格式不支持`;
    }
    return false;
  }

  if (extension === 'blend') {
    return await loadBlendMorphTargetFile(file);
  }

  setStatus('Loading target');
  try {
    const [source, payload] = await Promise.all([parseModel(file, extension), createModelPayload(file, extension)]);
    morphTargetSource = source;
    morphTargetLabel = file.name;
    currentMorphTargetPayload = payload;
    if (morphUi.name) {
      morphUi.name.textContent = `当前：${file.name}`;
    }
    state.effectMode = 'morph';
    await buildParticles(currentSource, currentLabel, { resetView: false });
    syncUi();
    setStatus('Ready');
    return true;
  } catch (error) {
    console.error(error);
    setStatus('Target failed');
    if (morphUi.name) {
      morphUi.name.textContent = `当前：${file.name} 读取失败`;
    }
    return false;
  }
}

async function convertBlendFile(file) {
  const filePath = getLocalFilePath(file);
  if (!filePath) {
    throw new Error('浏览器无法读取 .blend 的完整路径，请使用桌面版，或先在 Blender 中导出 GLB/FBX。');
  }
  if (!window.electronAPI?.convertBlendToGlb) {
    throw new Error('当前环境不能转换 .blend，请使用桌面版。');
  }
  const result = await window.electronAPI.convertBlendToGlb({
    path: filePath,
    name: file.name
  });
  if (!result?.ok) {
    throw new Error(result?.error || 'Blender 转换失败。');
  }
  if (!result.url || !result.path) {
    throw new Error('Blender 没有返回可读取的临时 GLB。');
  }
  return {
    ...result,
    sourcePath: filePath
  };
}

async function loadConvertedBlendSource(file, converted) {
  const response = await fetch(converted.url, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`转换后的 GLB 读取失败：${response.status}`);
  }
  const buffer = await response.arrayBuffer();
  const convertedName = converted.name || file.name.replace(/\.blend$/i, '.glb');
  const convertedFile = new File([buffer], convertedName, { type: 'model/gltf-binary' });
  const source = await parseModel(convertedFile, 'glb');
  const payload = {
    name: file.name,
    extension: 'glb',
    path: converted.path,
    size: converted.size || convertedFile.size || buffer.byteLength,
    sourceExtension: 'blend',
    sourcePath: converted.sourcePath
  };
  return {
    source,
    payload,
    label: `${file.name} (Blender)`
  };
}

async function loadBlendModelFile(file, options = {}) {
  setStatus('Converting BLEND');
  modelName.textContent = `当前：${file.name} 正在用 Blender 读取`;

  try {
    const converted = await convertBlendFile(file);
    const { source, payload, label } = await loadConvertedBlendSource(file, converted);
    const record = createImportedSceneModelRecord(source, label, payload, options);
    await activateImportedSceneModel(record, source, label, payload, { resetView: true });
  } catch (error) {
    console.error(error);
    setStatus('Load failed');
    modelName.textContent = `当前：${file.name} 读取失败：${error.message || error}`;
  }
}

async function loadBlendMorphTargetFile(file) {
  setStatus('Converting target');
  if (morphUi.name) {
    morphUi.name.textContent = `当前：${file.name} 正在用 Blender 读取`;
  }

  try {
    const converted = await convertBlendFile(file);
    const { source, payload, label } = await loadConvertedBlendSource(file, converted);
    morphTargetSource = source;
    morphTargetLabel = label;
    currentMorphTargetPayload = payload;
    if (morphUi.name) {
      morphUi.name.textContent = `当前：${label}`;
    }
    state.effectMode = 'morph';
    await buildParticles(currentSource, currentLabel, { resetView: false });
    syncUi();
    setStatus('Ready');
    return true;
  } catch (error) {
    console.error(error);
    setStatus('Target failed');
    if (morphUi.name) {
      morphUi.name.textContent = `当前：${file.name} 读取失败：${error.message || error}`;
    }
    return false;
  }
}

function clearMorphTarget(options = {}) {
  const { rebuild = false } = options;
  morphTargetSource = null;
  morphTargetLabel = '';
  currentMorphTargetPayload = null;
  if (morphUi.name) {
    morphUi.name.textContent = '当前：未导入目标模型';
  }
  if (rebuild && particles) {
    scheduleRebuild();
  } else {
    syncUniforms();
  }
}

async function loadImageSplatFile(file, explicitExtension) {
  const extension = explicitExtension || file.name.split('.').pop()?.toLowerCase();
  if (!extension || !IMAGE_EXTENSIONS.has(extension)) {
    setStatus('Image failed');
    modelName.textContent = `当前：${file.name} 格式不支持`;
    return;
  }

  setStatus('Loading image');

  try {
    const payload = await createImageSplatPayload(file, extension);
    const source = await decodeImageSplatSource(payload.dataUrl, { extension });
    applyImageSplatImportPreset(source);
    currentImageSplatPayload = payload;
    currentGaussianSplatPayload = null;
    clearMorphTarget({ rebuild: false });
    await removeRealSplatObject();
    resetImageSplatTransform();
    setLocalSharpStatus('已导入图片：内置图片点云已可用；可选用本地 SHARP 生成真实 Gaussian Splat。');
    await buildImageSplatObject(source, file.name, { resetView: true });
  } catch (error) {
    console.error(error);
    setStatus('Image failed');
    modelName.textContent = `当前：${file.name} 读取失败`;
  }
}

async function loadGaussianSplatFile(file, explicitExtension) {
  const extension = explicitExtension || file.name.split('.').pop()?.toLowerCase();
  if (!extension || !GAUSSIAN_SPLAT_EXTENSIONS.has(extension)) {
    setStatus('Splat failed');
    modelName.textContent = `当前：${file.name} 格式不支持`;
    return;
  }

  setStatus('Loading splat');
  const nextUrl = URL.createObjectURL(file);

  try {
    const payload = await createGaussianSplatPayload(file, extension);
    currentGaussianSplatPayload = payload;
    currentImageSplatPayload = null;
    currentModelPayload = null;
    setLocalSharpStatus('已导入真实 Gaussian Splat。');
    clearMorphTarget({ rebuild: false });
    removeImageSplatObject();
    resetImageSplatTransform();
    await buildRealSplatObject(nextUrl, file.name, { extension, resetView: true });
    if (realSplatObjectUrl) {
      URL.revokeObjectURL(realSplatObjectUrl);
    }
    realSplatObjectUrl = nextUrl;
  } catch (error) {
    URL.revokeObjectURL(nextUrl);
    console.error(error);
    setStatus('Splat failed');
    modelName.textContent = `当前：${file.name} 读取失败`;
  }
}

async function loadGaussianSplatUrl(url, options = {}) {
  if (!url) {
    return false;
  }

  const extension = (options.extension || url.split('?')[0].split('.').pop() || 'ply').toLowerCase();
  const name = options.name || url.split('/').pop()?.split('?')[0] || `scene.${extension}`;
  if (options.params) {
    await applyOptionsSnapshot({ ...options.params, effectMode: 'image' }, false);
  } else {
    state.effectMode = 'image';
  }
  if (options.transform) {
    applyImageSplatTransformSnapshot(options.transform);
  } else {
    resetImageSplatTransform();
  }
  currentGaussianSplatPayload = {
    name,
    extension,
    path: options.path || undefined,
    url: options.url || (options.dataUrl ? undefined : url),
    dataUrl: options.dataUrl || null
  };
  currentImageSplatPayload = null;
  removeImageSplatObject();
  return buildRealSplatObject(url, name, { extension, resetView: Boolean(options.resetView) });
}

function createGaussianSplatPayload(file, extension) {
  return new Promise((resolve, reject) => {
    const filePath = getLocalFilePath(file);
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      resolve({
        name: file.name,
        extension,
        path: filePath || undefined,
        dataUrl: reader.result
      });
    });
    reader.addEventListener('error', () => reject(reader.error));
    reader.readAsDataURL(file);
  });
}

async function loadImageSplatUrl(url, options = {}) {
  if (!url) {
    return false;
  }

  const extension = (options.extension || url.split('?')[0].split('.').pop() || 'png').toLowerCase();
  const name = options.name || url.split('/').pop()?.split('?')[0] || `image.${extension}`;
  const source = await decodeImageSplatSource(url, { extension });
  currentImageSplatPayload = options.dataUrl
    ? { name, extension, path: options.path || undefined, dataUrl: options.dataUrl }
    : { name, extension, path: options.path || undefined, url, dataUrl: null };
  if (options.transform) {
    applyImageSplatTransformSnapshot(options.transform);
  } else {
    resetImageSplatTransform();
  }
  if (options.resetView) {
    applyImageSplatImportPreset(source);
  }
  return buildImageSplatObject(source, name, { resetView: Boolean(options.resetView) });
}

function setLocalSharpStatus(message, log = '') {
  if (localSharpUi.status) {
    localSharpUi.status.value = message || '';
  }
  if (localSharpUi.log) {
    localSharpUi.log.textContent = log || '';
  }
}

function setLocalSharpBusy(busy) {
  [localSharpUi.check, localSharpUi.install, localSharpUi.run].forEach((button) => {
    if (button) {
      button.disabled = Boolean(busy);
    }
  });
}

function summarizeLocalSharpCheck(result) {
  if (!result) {
    return '未检测到 SHARP。图片导入后仍可使用内置点云；真实 Gaussian Splat 需要安装或随 exe 打包完整运行时。';
  }

  if (result.available) {
    return `SHARP 已就绪：${result.label || result.command || 'sharp'}，checkpoint 已找到。`;
  }

  return `${result.checkpointProblem || result.error || 'SHARP 运行时不完整。'} 内置图片点云仍可直接使用。安装位置：${result.installDir || '用户数据目录'}`;
}

async function checkLocalSharpStatus(options = {}) {
  if (!window.electronAPI?.checkLocalSharp) {
    if (!options.silent) {
      setLocalSharpStatus('桌面版才支持本地 SHARP 检测；当前仍可使用内置图片点云。');
      setStatus('SHARP unavailable');
    }
    return null;
  }

  if (!options.silent) {
    setLocalSharpStatus('正在检测本地 SHARP 运行时...');
  }

  try {
    const result = await window.electronAPI.checkLocalSharp();
    setLocalSharpStatus(
      summarizeLocalSharpCheck(result),
      result?.log || result?.error || ''
    );
    return result;
  } catch (error) {
    const message = error?.message || String(error);
    setLocalSharpStatus(`SHARP 检测失败：${message}`, message);
    return { ok: false, available: false, error: message };
  }
}

async function installLocalSharpRuntime() {
  if (!window.electronAPI?.installLocalSharp) {
    setLocalSharpStatus('桌面版才支持安装本地 SHARP；当前仍可使用内置图片点云。');
    setStatus('SHARP unavailable');
    return;
  }

  if (!localSharpUi.acceptLicense?.checked) {
    setLocalSharpStatus('请先确认 apple/ml-sharp 模型许可；真实 SHARP 模型目前仅适合按其许可在本机使用。');
    return;
  }

  setLocalSharpBusy(true);
  setLocalSharpStatus('正在安装/修复 SHARP 运行时。会下载 Python、依赖和模型文件，时间可能较长...');
  setStatus('Installing SHARP');

  try {
    const result = await window.electronAPI.installLocalSharp({
      acceptResearchLicense: true,
      downloadCheckpoint: true
    });
    setLocalSharpStatus(
      result?.available
        ? `SHARP 运行时已就绪。安装位置：${result.installDir || ''}`
        : `SHARP 安装未完成：${result?.error || '未知错误'}`,
      result?.log || result?.error || ''
    );
    setStatus(result?.available ? 'SHARP ready' : 'SHARP install failed');
  } catch (error) {
    const message = error?.message || String(error);
    setLocalSharpStatus(`SHARP 安装失败：${message}`, message);
    setStatus('SHARP install failed');
  } finally {
    setLocalSharpBusy(false);
  }
}

async function runLocalSharpFromCurrentImage() {
  if (!window.electronAPI?.runLocalSharp) {
    setLocalSharpStatus('桌面版才支持本地 SHARP 生成；当前仍可使用内置图片点云。');
    setStatus('SHARP unavailable');
    return;
  }

  if (!currentImageSplatPayload?.dataUrl && !currentImageSplatPayload?.path) {
    setLocalSharpStatus('请先导入 JPG / PNG / WebP / HDR 图片。');
    setStatus('Import image first');
    return;
  }

  if (!window.electronAPI?.runLocalSharp) {
    setLocalSharpStatus('桌面版才支持本地 SHARP 生成。');
    setStatus('SHARP unavailable');
    return;
  }

  if (!currentImageSplatPayload?.dataUrl && !currentImageSplatPayload?.path) {
    setLocalSharpStatus('请先导入 JPG / PNG / WebP / HDR 图片。');
    setStatus('Import image first');
    return;
  }

  const check = await checkLocalSharpStatus({ silent: true });
  if (!check?.available) {
    setLocalSharpStatus(
      '未检测到 SHARP 运行时。内置图片点云已经可用；若要生成真实 Gaussian Splat，请先安装/修复环境，或把运行时打包进 exe。',
      check?.error || ''
    );
    setStatus('SHARP unavailable');
    return;
  }

  const source = {
    name: currentImageSplatPayload.name || currentLabel || 'sharp-source',
    extension: currentImageSplatPayload.extension || 'png',
    path: currentImageSplatPayload.path,
    dataUrl: currentImageSplatPayload.dataUrl
  };

  setLocalSharpBusy(true);
  if (localSharpUi.output) {
    localSharpUi.output.value = '';
  }
  setLocalSharpStatus('正在调用本地 SHARP，这一步可能需要几分钟。');
  setStatus('Running SHARP');

  try {
    const result = await window.electronAPI.runLocalSharp({
      source,
      params: captureKeyframeOptions()
    });

    if (!result?.ok) {
      throw new Error(result?.error || 'SHARP failed');
    }

    if (localSharpUi.output) {
      localSharpUi.output.value = result.name || result.path || '';
    }
    setLocalSharpStatus('已生成真实 Gaussian Splat。', result.log || '');
    currentGaussianSplatPayload = {
      name: result.name,
      extension: result.extension || 'ply',
      path: result.path,
      url: result.url,
      dataUrl: null,
      sourceKind: 'ml-sharp'
    };
    await loadGaussianSplatUrl(result.url, {
      name: result.name,
      extension: result.extension || 'ply',
      path: result.path,
      url: result.url,
      resetView: true
    });
  } catch (error) {
    console.error(error);
    setLocalSharpStatus(error.message || String(error), error.log || '');
    setStatus('SHARP failed');
  } finally {
    setLocalSharpBusy(false);
  }
}

function createImageSplatPayload(file, extension) {
  return new Promise((resolve, reject) => {
    const filePath = getLocalFilePath(file);
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      resolve({
        name: file.name,
        extension,
        path: filePath || undefined,
        dataUrl: reader.result
      });
    });
    reader.addEventListener('error', () => reject(reader.error));
    reader.readAsDataURL(file);
  });
}

async function decodeImageSplatSource(url, options = {}) {
  const extension = (options.extension || '').toLowerCase();
  if (PANORAMA_TEXTURE_EXTENSIONS.has(extension)) {
    return decodePanoramaTextureSource(url, extension);
  }

  const image = await loadHtmlImage(url);
  const maxSide = 1600;
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height));
  const width = Math.max(2, Math.round((image.naturalWidth || image.width) * scale));
  const height = Math.max(2, Math.round((image.naturalHeight || image.height) * scale));
  const canvas2d = document.createElement('canvas');
  canvas2d.width = width;
  canvas2d.height = height;
  const context = canvas2d.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, 0, 0, width, height);
  const imageData = context.getImageData(0, 0, width, height);
  const analysis = analyzeImageSplatImageData(imageData, width, height);
  if (imageSplatTexture) {
    imageSplatTexture.dispose();
  }
  imageSplatTexture = new THREE.CanvasTexture(canvas2d);
  imageSplatTexture.colorSpace = THREE.SRGBColorSpace;
  imageSplatTexture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  imageSplatTexture.wrapS = THREE.RepeatWrapping;
  imageSplatTexture.wrapT = THREE.ClampToEdgeWrapping;
  imageSplatTexture.needsUpdate = true;
  const aspect = width / Math.max(height, 1);
  const isPanorama = isLikelyPanoramaSource(width, height, extension);
  const worldWidth = aspect >= 1 ? 4 : 4 * aspect;
  const worldHeight = aspect >= 1 ? 4 / aspect : 4;

  return {
    mode: isPanorama ? 'panorama' : 'image',
    isPanorama,
    width,
    height,
    data: imageData.data,
    depthData: analysis.depthData,
    edgeData: analysis.edgeData,
    skyData: analysis.skyData,
    skyRatio: analysis.skyRatio,
    worldWidth,
    worldHeight,
    radius: isPanorama ? 16 : 0
  };
}

function analyzeImageSplatImageData(imageData, width, height) {
  const data = imageData.data;
  const total = width * height;
  const lumaData = new Float32Array(total);
  const edgeData = new Float32Array(total);
  const rawDepth = new Float32Array(total);
  const skyData = new Float32Array(total);

  for (let index = 0; index < total; index += 1) {
    const offset = index * 4;
    lumaData[index] = (0.2126 * data[offset] + 0.7152 * data[offset + 1] + 0.0722 * data[offset + 2]) / 255;
  }

  for (let y = 0; y < height; y += 1) {
    const v = y / Math.max(height - 1, 1);
    const top = 1 - v;
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const offset = index * 4;
      const r = data[offset] / 255;
      const g = data[offset + 1] / 255;
      const b = data[offset + 2] / 255;
      const maxChannel = Math.max(r, g, b);
      const minChannel = Math.min(r, g, b);
      const saturation = maxChannel > 0 ? (maxChannel - minChannel) / maxChannel : 0;
      const luma = lumaData[index];
      const left = lumaData[y * width + Math.max(0, x - 1)];
      const right = lumaData[y * width + Math.min(width - 1, x + 1)];
      const up = lumaData[Math.max(0, y - 1) * width + x];
      const down = lumaData[Math.min(height - 1, y + 1) * width + x];
      const edge = THREE.MathUtils.clamp((Math.abs(right - left) + Math.abs(down - up)) * 2.2, 0, 1);
      const blueBias = b - Math.max(r, g) * 0.88;
      const greenBias = g - Math.max(r, b) * 0.74;
      const skyBlue = smooth01(0.025, 0.2, blueBias) *
        smooth01(0.32, 0.86, luma) *
        (1 - smooth01(0.05, 0.42, edge)) *
        smooth01(0.14, 0.92, top);
      const brightLowDetailSky = smooth01(0.62, 0.94, luma) *
        (1 - smooth01(0.1, 0.42, saturation)) *
        (1 - smooth01(0.04, 0.3, edge)) *
        smooth01(0.34, 0.95, top) * 0.68;
      const sky = THREE.MathUtils.clamp(Math.max(skyBlue, brightLowDetailSky), 0, 1);
      const verticalNear = Math.pow(smooth01(0.06, 1, v), 1.45);
      const detailNear = smooth01(0.035, 0.28, edge);
      const saturationNear = smooth01(0.12, 0.68, saturation);
      const darkObject = 1 - smooth01(0.18, 0.74, luma);
      const greenObject = smooth01(0.035, 0.24, greenBias) * (0.35 + detailNear * 0.65);
      const centerWeight = 1 - Math.abs((x / Math.max(width - 1, 1)) - 0.5) * 0.28;
      const raw = THREE.MathUtils.clamp(
        0.1 +
          verticalNear * 0.58 +
          detailNear * 0.25 +
          saturationNear * 0.12 +
          darkObject * 0.08 +
          greenObject * 0.12 -
          sky * 0.72,
        0,
        1
      ) * centerWeight;
      edgeData[index] = edge;
      skyData[index] = sky;
      rawDepth[index] = THREE.MathUtils.clamp(raw, 0, 1);
    }
  }

  const blurredDepth = blurScalarMap(rawDepth, width, height);
  const depthData = new Float32Array(total);
  let skySum = 0;
  for (let index = 0; index < total; index += 1) {
    skySum += skyData[index];
    depthData[index] = THREE.MathUtils.clamp(
      blurredDepth[index] * 0.72 + rawDepth[index] * 0.28 + edgeData[index] * 0.08 - skyData[index] * 0.1,
      0,
      1
    );
  }

  return {
    depthData,
    edgeData,
    skyData,
    skyRatio: skySum / Math.max(total, 1)
  };
}

function blurScalarMap(input, width, height) {
  const total = width * height;
  const temp = new Float32Array(total);
  const output = new Float32Array(total);
  const radius = 3;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      let count = 0;
      for (let dx = -radius; dx <= radius; dx += 1) {
        const sx = THREE.MathUtils.clamp(x + dx, 0, width - 1);
        sum += input[y * width + sx];
        count += 1;
      }
      temp[y * width + x] = sum / count;
    }
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      let count = 0;
      for (let dy = -radius; dy <= radius; dy += 1) {
        const sy = THREE.MathUtils.clamp(y + dy, 0, height - 1);
        sum += temp[sy * width + x];
        count += 1;
      }
      output[y * width + x] = sum / count;
    }
  }

  return output;
}

function smooth01(edge0, edge1, value) {
  if (Math.abs(edge1 - edge0) < 0.000001) {
    return value >= edge1 ? 1 : 0;
  }
  const t = THREE.MathUtils.clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

async function decodePanoramaTextureSource(url, extension = 'hdr') {
  const loader = extension === 'exr' ? new EXRLoader() : new RGBELoader();
  const hdrTexture = await loader.loadAsync(url);
  const preview = createPanoramaPreviewCanvas(hdrTexture);
  if (imageSplatTexture) {
    imageSplatTexture.dispose();
  }
  imageSplatTexture = new THREE.CanvasTexture(preview.canvas);
  imageSplatTexture.colorSpace = THREE.SRGBColorSpace;
  imageSplatTexture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  imageSplatTexture.wrapS = THREE.RepeatWrapping;
  imageSplatTexture.wrapT = THREE.ClampToEdgeWrapping;
  imageSplatTexture.needsUpdate = true;
  hdrTexture.dispose();

  return {
    mode: 'panorama',
    isPanorama: true,
    width: preview.width,
    height: preview.height,
    data: preview.imageData.data,
    depthData: null,
    edgeData: null,
    skyRatio: 0,
    worldWidth: 4,
    worldHeight: 2,
    radius: 16
  };
}

function createPanoramaPreviewCanvas(texture) {
  const sourceImage = texture.image || {};
  const sourceWidth = Math.max(2, sourceImage.width || 2);
  const sourceHeight = Math.max(2, sourceImage.height || 2);
  const maxSide = 2048;
  const scale = Math.min(1, maxSide / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(2, Math.round(sourceWidth * scale));
  const height = Math.max(2, Math.round(sourceHeight * scale));
  const canvas2d = document.createElement('canvas');
  canvas2d.width = width;
  canvas2d.height = height;
  const context = canvas2d.getContext('2d', { willReadFrequently: true });
  const imageData = context.createImageData(width, height);
  const autoExposure = computeHdrPreviewExposure(texture);

  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(sourceHeight - 1, Math.floor((y / Math.max(height - 1, 1)) * (sourceHeight - 1)));
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(sourceWidth - 1, Math.floor((x / Math.max(width - 1, 1)) * (sourceWidth - 1)));
      const color = readHdrTexturePixel(texture, sourceX, sourceY);
      const offset = (y * width + x) * 4;
      imageData.data[offset] = linearHdrToPreviewByte(color.r, autoExposure);
      imageData.data[offset + 1] = linearHdrToPreviewByte(color.g, autoExposure);
      imageData.data[offset + 2] = linearHdrToPreviewByte(color.b, autoExposure);
      imageData.data[offset + 3] = 255;
    }
  }

  context.putImageData(imageData, 0, 0);
  return { canvas: canvas2d, imageData, width, height };
}

function computeHdrPreviewExposure(texture) {
  const sourceImage = texture.image || {};
  const width = Math.max(2, sourceImage.width || 2);
  const height = Math.max(2, sourceImage.height || 2);
  let luminanceSum = 0;
  let samples = 0;
  const strideX = Math.max(1, Math.floor(width / 48));
  const strideY = Math.max(1, Math.floor(height / 24));

  for (let y = 0; y < height; y += strideY) {
    for (let x = 0; x < width; x += strideX) {
      const color = readHdrTexturePixel(texture, x, y);
      luminanceSum += 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
      samples += 1;
    }
  }

  const averageLuminance = luminanceSum / Math.max(samples, 1);
  return THREE.MathUtils.clamp(0.44 / Math.max(averageLuminance, 0.025), 0.08, 1.65);
}

function readHdrTexturePixel(texture, x, y) {
  const sourceImage = texture.image || {};
  const data = sourceImage.data;
  const width = Math.max(1, sourceImage.width || 1);
  const height = Math.max(1, sourceImage.height || 1);
  if (!data || !data.length) {
    return { r: 0, g: 0, b: 0 };
  }

  const components = Math.max(1, Math.round(data.length / Math.max(width * height, 1)));
  const safeX = THREE.MathUtils.clamp(Math.round(x), 0, width - 1);
  const safeY = THREE.MathUtils.clamp(Math.round(y), 0, height - 1);
  const offset = (safeY * width + safeX) * components;
  const read = (channel) => readHdrComponent(data, offset + Math.min(channel, components - 1), texture.type);
  const r = read(0);
  const g = components > 1 ? read(1) : r;
  const b = components > 2 ? read(2) : r;
  return { r, g, b };
}

function readHdrComponent(data, index, textureType) {
  const value = data[index] ?? 0;
  if (textureType === THREE.HalfFloatType && data instanceof Uint16Array) {
    return Math.max(0, THREE.DataUtils.fromHalfFloat(value));
  }
  return Math.max(0, Number(value) || 0);
}

function linearHdrToPreviewByte(value, exposure) {
  const mapped = 1 - Math.exp(-Math.max(0, value) * exposure);
  const srgb = mapped <= 0.0031308
    ? mapped * 12.92
    : 1.055 * Math.pow(mapped, 1 / 2.4) - 0.055;
  return Math.round(THREE.MathUtils.clamp(srgb, 0, 1) * 255);
}

function isLikelyPanoramaSource(width, height, extension = '') {
  if (PANORAMA_TEXTURE_EXTENSIONS.has(extension)) {
    return true;
  }
  const aspect = width / Math.max(height, 1);
  return width >= 1024 && aspect >= 1.75 && aspect <= 2.25;
}

function loadHtmlImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.crossOrigin = 'anonymous';
    image.addEventListener('load', () => resolve(image), { once: true });
    image.addEventListener('error', () => reject(new Error('Image could not be decoded.')), { once: true });
    image.src = url;
  });
}

async function loadBundledModel(url) {
  try {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) {
      return false;
    }

    const buffer = await response.arrayBuffer();
    const extension = url.split('?')[0].split('.').pop()?.toLowerCase();
    if (!extension) {
      return false;
    }

    setStatus('Loading model');
    const file = new File([buffer], url.split('/').pop()?.split('?')[0] || `model.${extension}`, {
      type: extension === 'glb' ? 'model/gltf-binary' : 'application/octet-stream'
    });
    const source = await parseModel(file, extension);
    currentModelPayload = await createModelPayload(file, extension);
    return await buildParticles(source, file.name, { resetView: true });
  } catch (error) {
    console.info('No bundled model loaded.', error);
    return false;
  }
}

async function loadMorphTargetUrl(url, options = {}) {
  if (!url) {
    clearMorphTarget({ rebuild: true });
    return false;
  }

  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Morph target request failed: ${response.status}`);
  }

  const buffer = await response.arrayBuffer();
  const extension = (options.extension || url.split('?')[0].split('.').pop() || 'glb').toLowerCase();
  if (!MODEL_EXTENSIONS.has(extension)) {
    throw new Error(`Unsupported morph target extension: ${extension}`);
  }

  const name = options.name || url.split('/').pop()?.split('?')[0] || `target.${extension}`;
  const file = new File([buffer], name, {
    type: extension === 'glb' ? 'model/gltf-binary' : 'application/octet-stream'
  });
  const source = await parseModel(file, extension);
  morphTargetSource = source;
  morphTargetLabel = name;
  currentMorphTargetPayload = options.dataUrl
    ? { name, extension, dataUrl: options.dataUrl }
    : await createModelPayload(file, extension);
  if (morphUi.name) {
    morphUi.name.textContent = `当前：${name}`;
  }
  await buildParticles(currentSource, currentLabel, { resetView: false });
  return true;
}

async function createModelPayload(file, extension) {
  const filePath = getLocalFilePath(file);
  const payload = {
    name: file.name,
    extension,
    path: filePath || undefined,
    size: file.size || 0
  };

  if (filePath && file.size > INLINE_MODEL_PAYLOAD_LIMIT) {
    return payload;
  }

  const dataUrl = await readFileAsDataUrl(file);
  return {
    ...payload,
    dataUrl
  };
}

function getLocalFilePath(file) {
  try {
    return window.electronAPI?.getPathForFile?.(file) || file?.path || '';
  } catch {
    return file?.path || '';
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(reader.result));
    reader.addEventListener('error', () => reject(reader.error));
    reader.readAsDataURL(file);
  });
}

async function initializeStartupWorld() {
  if (!exportSettings.worldUrl) {
    syncWorldEnvironment();
    return;
  }

  try {
    await loadWorldEnvironmentUrl(exportSettings.worldUrl, {
      name: exportSettings.worldUrl.split('/').pop()?.split('?')[0] || 'HDR Environment',
      enabled: true,
      preservePayload: true
    });
  } catch (error) {
    console.warn('Could not load startup world environment.', error);
    syncWorldEnvironment();
  }
}

async function loadWorldFile(file) {
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (!['hdr', 'exr'].includes(extension)) {
    setStatus('HDR failed');
    if (worldUi.name) {
      worldUi.name.textContent = `当前：${file.name} 格式不支持`;
    }
    return;
  }

  setStatus('Loading HDR');
  const nextObjectUrl = URL.createObjectURL(file);

  try {
    const [payload] = await Promise.all([
      createWorldPayload(file, extension),
      loadWorldEnvironmentUrl(nextObjectUrl, { name: file.name, enabled: true, revokePreviousObjectUrl: false })
    ]);
    currentWorldPayload = payload;
    if (worldObjectUrl) {
      URL.revokeObjectURL(worldObjectUrl);
    }
    worldObjectUrl = nextObjectUrl;
    setStatus('Ready');
  } catch (error) {
    URL.revokeObjectURL(nextObjectUrl);
    console.error(error);
    setStatus('HDR failed');
    if (worldUi.name) {
      worldUi.name.textContent = `当前：${file.name} 读取失败`;
    }
  }
}

function createWorldPayload(file, extension) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      resolve({
        name: file.name,
        extension,
        dataUrl: reader.result
      });
    });
    reader.addEventListener('error', () => reject(reader.error));
    reader.readAsDataURL(file);
  });
}

async function loadWorldEnvironmentUrl(url, options = {}) {
  if (!url) {
    disposeWorldEnvironment();
    syncWorldEnvironment();
    return false;
  }

  const extension = (options.extension || url.split('?')[0].split('.').pop() || 'hdr').toLowerCase();
  const loader = extension === 'exr' ? new EXRLoader() : new RGBELoader();
  const texture = await loader.loadAsync(url);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.needsUpdate = true;

  const pmremTarget = pmremGenerator.fromEquirectangular(texture);
  disposeWorldEnvironment();
  worldSourceTexture = texture;
  worldPmremTarget = pmremTarget;
  if (options.name && worldUi.name) {
    worldUi.name.textContent = `当前：${options.name}`;
  }
  if (options.enabled !== undefined) {
    state.worldEnabled = Boolean(options.enabled);
  } else {
    state.worldEnabled = true;
  }
  syncUi();
  syncWorldEnvironment();
  return true;
}

function disposeWorldEnvironment() {
  if (worldSourceTexture) {
    worldSourceTexture.dispose();
    worldSourceTexture = null;
  }
  if (worldPmremTarget) {
    worldPmremTarget.dispose();
    worldPmremTarget = null;
  }
  scene.environment = null;
  scene.background = null;
}

function syncWorldEnvironment() {
  const hasWorld = Boolean(worldPmremTarget?.texture);
  const enabled = hasWorld && state.worldEnabled;
  const rotationY = THREE.MathUtils.degToRad(Number(state.worldRotation) || 0);
  const hdrStrength = Math.max(0, Number(state.worldIntensity) || 0);
  scene.environment = enabled ? worldPmremTarget.texture : null;
  scene.background = enabled && state.worldVisible ? worldSourceTexture : null;
  scene.environmentIntensity = enabled ? hdrStrength : 1;
  scene.backgroundIntensity = enabled ? hdrStrength : 1;
  scene.backgroundBlurriness = enabled ? THREE.MathUtils.clamp(state.worldBlur, 0, 1) : 0;
  scene.environmentRotation.set(0, rotationY, 0);
  scene.backgroundRotation.set(0, rotationY, 0);
  syncBaseLightRig(enabled);
  sceneLights.forEach((light) => applyLightRecord(light));
}

function syncBaseLightRig(worldEnabled) {
  const scale = worldEnabled ? 0 : 1;
  ambientLight.intensity = baseLightIntensities.ambient * scale;
  keyLight.intensity = baseLightIntensities.key * scale;
  rimLight.intensity = baseLightIntensities.rim * scale;
}

function serializeWorldEnvironment() {
  if (!state.worldExport || !currentWorldPayload?.dataUrl || !currentWorldPayload?.extension) {
    return null;
  }

  return {
    ...currentWorldPayload,
    enabled: state.worldEnabled,
    visible: state.worldVisible,
    intensity: state.worldIntensity,
    backgroundIntensity: state.worldIntensity,
    blur: state.worldBlur,
    rotation: state.worldRotation
  };
}

function serializeImageSplatObject() {
  if (currentGaussianSplatPayload?.dataUrl || realSplatRoot) {
    return {
      ...(currentGaussianSplatPayload || {}),
      kind: 'gaussian',
      params: captureKeyframeOptions(),
      transform: captureImageSplatTransform()
    };
  }

  if (!currentImageSplatPayload && !imageSplatSource) {
    return null;
  }

  return {
    ...(currentImageSplatPayload || {}),
    kind: 'image-preview',
    params: captureKeyframeOptions(),
    transform: captureImageSplatTransform()
  };
}

function serializeMorphTargetModel() {
  if (!currentMorphTargetPayload?.extension || (!currentMorphTargetPayload.path && !currentMorphTargetPayload.dataUrl)) {
    return null;
  }

  return {
    ...currentMorphTargetPayload,
    label: morphTargetLabel
  };
}

function serializeSceneModels() {
  saveActiveSceneModel({ createSnapshot: false });
  if (!sceneModelObjects.length) {
    return null;
  }

  return {
    activeId: selectedSceneModelId,
    models: sceneModelObjects
      .filter((record) => record.payload?.extension && (record.payload.path || record.payload.dataUrl))
      .map((record) => ({
        id: record.id,
        name: record.name,
        label: record.name,
        ...record.payload,
        options: sanitizeSceneModelOptions(record.options),
        transform: normalizeSceneModelTransform(record.transform),
        effectRotation: normalizeVectorArray(record.effectRotation, [0, 0, 0]),
        hidden: Boolean(record.hidden)
      }))
  };
}

async function loadSceneModelSourceFromDescriptor(descriptor = {}) {
  const url = descriptor.url || descriptor.dataUrl;
  if (!url) {
    throw new Error('Scene model has no readable URL.');
  }

  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Scene model request failed: ${response.status}`);
  }

  const buffer = await response.arrayBuffer();
  const extension = (descriptor.extension || url.split('?')[0].split('.').pop() || 'glb').toLowerCase();
  if (!MODEL_EXTENSIONS.has(extension)) {
    throw new Error(`Unsupported scene model extension: ${extension}`);
  }

  const name = descriptor.name || descriptor.label || url.split('/').pop()?.split('?')[0] || `model.${extension}`;
  const file = new File([buffer], name, {
    type: extension === 'glb' ? 'model/gltf-binary' : 'application/octet-stream'
  });
  return parseModel(file, extension);
}

async function importSceneModels(snapshot = {}) {
  const models = Array.isArray(snapshot.models) ? snapshot.models : [];
  if (!models.length) {
    return false;
  }

  saveActiveSceneModel({ createSnapshot: true });
  sceneModelObjects.forEach((record) => disposeSceneModelSnapshot(record));
  sceneModelObjects.length = 0;
  selectedSceneModelId = null;

  for (const descriptor of models) {
    const source = await loadSceneModelSourceFromDescriptor(descriptor);
    sceneModelObjects.push(createSceneModelRecord({
      id: descriptor.id,
      name: descriptor.name || descriptor.label,
      source,
      payload: {
        name: descriptor.name,
        extension: descriptor.extension,
        path: descriptor.path,
        dataUrl: descriptor.dataUrl,
        size: descriptor.size
      },
      options: descriptor.options,
      transform: descriptor.transform,
      effectRotation: descriptor.effectRotation,
      hidden: descriptor.hidden
    }));
  }

  const activeId = snapshot.activeId && sceneModelObjects.some((record) => record.id === snapshot.activeId)
    ? snapshot.activeId
    : sceneModelObjects[0].id;

  sceneModelSaveSuspended = true;
  try {
    for (const record of sceneModelObjects) {
      selectedSceneModelId = record.id;
      currentModelPayload = record.payload || null;
      applySceneModelOptionsToState(record.options);
      applyActiveSceneModelTransform(record.transform);
      modelEffectRoot.rotation.fromArray(normalizeVectorArray(record.effectRotation, [0, 0, 0]));
      await buildParticles(record.source, record.name, { resetView: false });
      buildSceneModelSnapshotFromActive(record);
    }

    const activeRecord = sceneModelObjects.find((record) => record.id === activeId) || sceneModelObjects[0];
    selectedSceneModelId = activeRecord.id;
    disposeSceneModelSnapshot(activeRecord);
    currentModelPayload = activeRecord.payload || null;
    applySceneModelOptionsToState(activeRecord.options);
    applyActiveSceneModelTransform(activeRecord.transform);
    modelEffectRoot.rotation.fromArray(normalizeVectorArray(activeRecord.effectRotation, [0, 0, 0]));
    await buildParticles(activeRecord.source, activeRecord.name, { resetView: false });
    currentSource = activeRecord.source;
    currentLabel = activeRecord.name;
  } finally {
    sceneModelSaveSuspended = false;
  }

  syncUi();
  syncUniforms();
  renderSceneModelList();
  if (!exportSettings.hideUi) {
    selectSceneModelTransform();
  }
  return true;
}

async function parseModel(file, extension) {
  if (extension === 'blend') {
    throw new Error('BLEND 需要先通过 Blender 转换为临时 GLB。');
  }

  if (extension === 'glb') {
    const buffer = await file.arrayBuffer();
    const loader = new GLTFLoader();
    const gltf = await new Promise((resolve, reject) => {
      loader.parse(buffer, '', resolve, reject);
    });
    gltf.scene.animations = gltf.animations || [];
    return gltf.scene;
  }

  if (extension === 'gltf') {
    const text = await file.text();
    const loader = new GLTFLoader();
    const gltf = await new Promise((resolve, reject) => {
      loader.parse(text, '', resolve, reject);
    });
    gltf.scene.animations = gltf.animations || [];
    return gltf.scene;
  }

  if (extension === 'obj') {
    const text = await file.text();
    return new OBJLoader().parse(text);
  }

  if (extension === 'stl') {
    const buffer = await file.arrayBuffer();
    const geometry = new STLLoader().parse(buffer);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: 0xffffff }));
    const group = new THREE.Group();
    group.add(mesh);
    return group;
  }

  if (extension === 'fbx') {
    const buffer = await file.arrayBuffer();
    return new FBXLoader().parse(buffer, '');
  }

  throw new Error(`Unsupported extension: ${extension}`);
}

function syncUniforms() {
  uniforms.uPointSize.value = state.pointSize;
  uniforms.uEdgeFeather.value = state.edgeFeather;
  uniforms.uSizeRandom.value = state.sizeRandom;
  uniforms.uGlowRadius.value = state.glowRadius;
  uniforms.uGlowExposure.value = state.glowExposure;
  uniforms.uParticleizeProgress.value = state.particleizeProgress;
  uniforms.uModelVisibility.value = state.modelVisibility;
  uniforms.uSpread.value = state.spread;
  uniforms.uNoise.value = state.noise;
  uniforms.uNoiseScale.value = state.noiseScale;
  uniforms.uSwirl.value = state.swirl;
  uniforms.uDissolve.value = state.dissolve;
  uniforms.uDissolveSpread.value = state.dissolveSpread;
  uniforms.uDissolveEdgeWidth.value = state.dissolveEdgeWidth;
  uniforms.uDissolveTurbulence.value = state.dissolveTurbulence;
  uniforms.uDissolveCurl.value = state.dissolveCurl;
  uniforms.uDissolveMist.value = state.dissolveMist;
  uniforms.uDissolveDirection.value.set(state.dissolveDirectionX, state.dissolveDirectionY, state.dissolveDirectionZ);
  uniforms.uDissolveLift.value = state.dissolveLift;
  uniforms.uGrowth.value = state.growth;
  uniforms.uGrowthFlow.value = state.growthFlow;
  uniforms.uGrowthWidth.value = state.growthWidth;
  uniforms.uGrowthTurbulence.value = state.growthTurbulence;
  uniforms.uOrganicFlow.value = state.organicFlow;
  uniforms.uEdgeBreak.value = state.edgeBreak;
  uniforms.uFilamentLength.value = state.filamentLength;
  uniforms.uFilamentCurl.value = state.filamentCurl;
  uniforms.uMorphMode.value = state.effectMode === 'morph' ? 1 : 0;
  uniforms.uMorphReady.value = morphTargetSource && particles?.geometry?.userData?.hasMorphTarget ? 1 : 0;
  uniforms.uMorphProgress.value = state.morphProgress;
  uniforms.uMorphFlow.value = state.morphFlow;
  uniforms.uMorphScatter.value = state.morphScatter;
  uniforms.uMorphTurbulence.value = state.morphTurbulence;
  uniforms.uMorphTrail.value = state.morphTrail;
  uniforms.uMorphDirection.value.set(state.morphDirX, state.morphDirY, state.morphDirZ);
  uniforms.uUseTexture.value = state.useTexture ? 1 : 0;
  uniforms.uColorA.value.set(state.colorA);
  uniforms.uColorB.value.set(state.colorB);
  syncEmissionUniforms();
  syncImageSplatUniforms();
  updateVisibleModelMaterials();
  syncEffectVisibility();
  syncWorldEnvironment();
  syncParticleLightingUniforms();
}

function serializeProjectWorldEnvironment() {
  if (!currentWorldPayload?.extension || (!currentWorldPayload.dataUrl && !currentWorldPayload.path)) {
    return null;
  }

  return {
    ...currentWorldPayload,
    enabled: state.worldEnabled,
    visible: state.worldVisible,
    export: state.worldExport,
    intensity: state.worldIntensity,
    backgroundIntensity: state.worldIntensity,
    blur: state.worldBlur,
    rotation: state.worldRotation
  };
}

function syncEmissionUniforms() {
  emissionUniforms.uEmissionEnabled.value = state.emissionEnabled ? 1 : 0;
  emissionUniforms.uEmissionIntensity.value = state.emissionIntensity;
  emissionUniforms.uEmissionDistance.value = state.emissionDistance;
  emissionUniforms.uEmissionSpeed.value = state.emissionSpeed;
  emissionUniforms.uEmissionWind.value.set(state.emissionWindX, state.emissionWindY, state.emissionWindZ);
  emissionUniforms.uEmissionTurbulence.value = state.emissionTurbulence;
  emissionUniforms.uEmissionSize.value = state.emissionSize;
  emissionUniforms.uEmissionOpacity.value = state.emissionOpacity;
  emissionUniforms.uModelVisibility.value = state.modelVisibility;
  emissionUniforms.uEmissionGlow.value = state.emissionGlow;
  emissionUniforms.uModelWhite.value = state.modelWhite;
  emissionUniforms.uUseTexture.value = state.useTexture ? 1 : 0;
  emissionUniforms.uColorA.value.set(state.colorA);
  emissionUniforms.uColorB.value.set(state.colorB);
  emissionUniforms.uBreakAmount.value = state.breakAmount;
  emissionUniforms.uBreakProgress.value = state.breakProgress;
  emissionUniforms.uBreakRadius.value = state.breakRadius;
  emissionUniforms.uBreakFeather.value = state.breakFeather;
  emissionUniforms.uBreakCenter.value.set(state.breakCenterX, state.breakCenterY, state.breakCenterZ);
  emissionUniforms.uBreakSpeed.value = state.breakSpeed;
  emissionUniforms.uBreakSize.value = state.breakSize;
  const capacity = emissionParticles?.geometry?.userData?.capacity || state.emissionCount || 1;
  emissionUniforms.uEmissionCountRatio.value = THREE.MathUtils.clamp(state.emissionCount / Math.max(capacity, 1), 0, 1);
}

function syncImageSplatUniforms() {
  imageSplatUniforms.uDepth.value = state.imageSplatDepth;
  imageSplatUniforms.uScatter.value = state.imageSplatScatter;
  imageSplatUniforms.uSpeed.value = state.imageSplatSpeed;
  imageSplatUniforms.uScatterDirection.value.set(state.imageSplatDirX, state.imageSplatDirY, state.imageSplatDirZ);
  imageSplatUniforms.uTurbulence.value = state.imageSplatTurbulence;
  imageSplatUniforms.uSize.value = state.imageSplatSize;
  imageSplatUniforms.uFeather.value = state.imageSplatFeather;
  imageSplatUniforms.uColorKeep.value = state.imageSplatColorKeep;
  imageSplatUniforms.uOpacity.value = state.imageSplatOpacity;
  imageSplatUniforms.uGlow.value = state.imageSplatGlow;
  imageSplatUniforms.uCountRatio.value = THREE.MathUtils.clamp(
    state.imageSplatCount / Math.max(imageSplatRoot?.userData?.capacity || state.imageSplatCount || 1, 1),
    0,
    1
  );
  imageSplatUniforms.uColorA.value.set(state.colorA);
  imageSplatUniforms.uColorB.value.set(state.colorB);
  realSplatPointUniforms.uPointSize.value = THREE.MathUtils.clamp(state.imageSplatSize * 2.35, 0.8, 18);
  realSplatPointUniforms.uOpacity.value = THREE.MathUtils.clamp(state.imageSplatOpacity, 0.05, 1);
  realSplatPointUniforms.uScatter.value = state.imageSplatScatter;
  realSplatPointUniforms.uSpeed.value = state.imageSplatSpeed;
  realSplatPointUniforms.uScatterDirection.value.set(state.imageSplatDirX, state.imageSplatDirY, state.imageSplatDirZ);
  realSplatPointUniforms.uTurbulence.value = state.imageSplatTurbulence;
  realSplatPointUniforms.uFeather.value = state.imageSplatFeather;
  realSplatPointUniforms.uColorKeep.value = state.imageSplatColorKeep;
  realSplatPointUniforms.uGlow.value = state.imageSplatGlow;
  realSplatPointUniforms.uColorA.value.set(state.colorA);
  realSplatPointUniforms.uColorB.value.set(state.colorB);
  if (imageSplatPlane) {
    imageSplatPlane.visible = state.imageSplatPlaneVisible && state.effectMode === 'image';
    imageSplatPlane.material.opacity = state.imageSplatPlaneOpacity;
    imageSplatPlane.material.transparent = imageSplatSource?.isPanorama
      ? state.imageSplatPlaneOpacity < 0.999
      : true;
    imageSplatPlane.material.needsUpdate = true;
  }
  applyImageSplatTransform();
}

function syncEffectVisibility() {
  const emissionMode = state.effectMode === 'emission';
  const imageMode = state.effectMode === 'image';
  const morphMode = state.effectMode === 'morph';
  const particleizeMode = state.effectMode === 'particles' && state.particleizeProgress < 0.995;
  const selectedSceneModel = getSelectedSceneModel();
  const modelVisible = state.modelVisibility > 0.001 && !selectedSceneModel?.hidden;
  panel?.classList.toggle('emission-mode', emissionMode);
  panel?.classList.toggle('image-mode', imageMode);
  panel?.classList.toggle('morph-mode', morphMode);
  effectModeButtons.forEach((button) => {
    button.classList.toggle('active', button.dataset.effectMode === state.effectMode);
  });

  if (particles) {
    const hiddenSolidParticleize =
      state.effectMode === 'particles' && state.particleizeProgress <= 0.0001;
    particles.visible = modelVisible && !emissionMode && !imageMode && !hiddenSolidParticleize;
  }
  if (glowParticles) {
    glowParticles.visible = false;
  }
  if (visibleModelRoot) {
    visibleModelRoot.visible = modelVisible && (emissionMode || particleizeMode);
  }
  if (emissionParticles) {
    emissionParticles.visible = modelVisible && emissionMode && state.emissionEnabled;
  }
  if (emissionGlowParticles) {
    emissionGlowParticles.visible = false;
  }
  if (imageSplatRoot) {
    imageSplatRoot.visible = imageMode && !realSplatRoot;
  }
  if (realSplatRoot) {
    realSplatRoot.visible = imageMode;
  }
  if (imageSplatPlane) {
    imageSplatPlane.visible = imageMode && state.imageSplatPlaneVisible;
  }
  if (imageSplatParticles) {
    imageSplatParticles.visible = imageMode;
  }
  if (imageSplatMistParticles) {
    imageSplatMistParticles.visible = imageMode;
  }
  if (imageSplatGlowParticles) {
    imageSplatGlowParticles.visible = false;
  }
  syncActiveEffectRotation();
  updateStats();
}

function syncActiveEffectRotation() {
  if (state.effectMode === 'particles' || state.effectMode === 'morph') {
    setParticleModeRotation(modelEffectRoot.rotation.x, modelEffectRoot.rotation.y, modelEffectRoot.rotation.z);
    return;
  }

  if (state.effectMode === 'emission') {
    setEmissionModeRotation(modelEffectRoot.rotation.x, modelEffectRoot.rotation.y, modelEffectRoot.rotation.z);
  }
}

const handRuntime = {
  landmarker: null,
  visionTasks: null,
  loading: null,
  stream: null,
  active: false,
  startToken: 0,
  lastDetectMs: -Infinity,
  lastVideoTime: -1,
  lastFrameMs: 0,
  smoothed: null,
  previousRaw: null,
  baseState: null,
  changedKeys: new Set(),
  lastUiSyncMs: -Infinity,
  mockMetrics: null,
  lastStatus: ''
};

function setHandStatus(value) {
  const text = value || '';
  handRuntime.lastStatus = text;
  if (controlsUi.handStatus) {
    controlsUi.handStatus.value = text;
  }
}

function syncHandControlUi() {
  if (controlsUi.handControlEnabled) {
    controlsUi.handControlEnabled.checked = Boolean(state.handControlEnabled);
  }
  if (controlsUi.handControlMode) {
    controlsUi.handControlMode.value = HAND_CONTROL_MODES.has(state.handControlMode)
      ? state.handControlMode
      : 'fluid';
  }
  if (controlsUi.handControlMirror) {
    controlsUi.handControlMirror.checked = Boolean(state.handControlMirror);
  }
  HAND_CONTROL_NUMERIC_FIELDS.forEach((key) => {
    setRangeValue(key, state[key]);
    setValueInput(key, state[key]);
  });
  controlsUi.handVideo?.parentElement?.classList.toggle('no-mirror', !state.handControlMirror);
}

function normalizeHandControlNumeric(key, value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return state[key];
  }
  if (key === 'handControlSmoothing') {
    return THREE.MathUtils.clamp(number, 0, 0.95);
  }
  if (key === 'handControlFps') {
    return Math.max(1, Math.min(60, Math.round(number)));
  }
  return Math.max(0, number);
}

function updateHandControlOption(key, value) {
  state[key] = normalizeHandControlNumeric(key, value);
  setRangeValue(key, state[key]);
  setValueInput(key, state[key]);
}

function captureHandDrivenBaseState() {
  const fields = [
    'spread', 'noise', 'noiseScale', 'swirl', 'speed',
    'growth', 'growthFlow', 'growthWidth', 'growthTurbulence', 'organicFlow', 'edgeBreak',
    'filamentLength', 'filamentCurl',
    'dissolve', 'dissolveSpread', 'dissolveTurbulence', 'dissolveCurl', 'dissolveMist',
    'dissolveDirectionX', 'dissolveDirectionY', 'dissolveDirectionZ', 'dissolveLift',
    'emissionIntensity', 'emissionDistance', 'emissionSpeed', 'emissionWindX', 'emissionWindY',
    'emissionWindZ', 'emissionTurbulence', 'emissionSize', 'emissionGlow',
    'imageSplatScatter', 'imageSplatSpeed', 'imageSplatDirX', 'imageSplatDirY', 'imageSplatDirZ',
    'imageSplatTurbulence', 'imageSplatSize', 'imageSplatGlow',
    'particleizeProgress', 'morphProgress', 'morphFlow', 'morphScatter', 'morphTurbulence',
    'morphTrail', 'morphDirX', 'morphDirY', 'morphDirZ'
  ];
  return Object.fromEntries(fields.map((field) => [field, Number(state[field] || 0)]));
}

async function ensureHandLandmarker() {
  if (handRuntime.landmarker) {
    return handRuntime.landmarker;
  }
  if (handRuntime.loading) {
    return handRuntime.loading;
  }

  const wasmPath = new URL(HAND_WASM_BASE, window.location.href).href;
  const modelPath = new URL(HAND_MODEL_URL, window.location.href).href;
  handRuntime.loading = (async () => {
    handRuntime.visionTasks ||= await import('@mediapipe/tasks-vision');
    const { FilesetResolver, HandLandmarker } = handRuntime.visionTasks;
    const fileset = await FilesetResolver.forVisionTasks(wasmPath);
    try {
      handRuntime.landmarker = await HandLandmarker.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: modelPath,
          delegate: 'GPU'
        },
        numHands: 1,
        runningMode: 'VIDEO'
      });
    } catch (error) {
      console.warn('GPU hand tracking failed, falling back to CPU.', error);
      handRuntime.landmarker = await HandLandmarker.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: modelPath,
          delegate: 'CPU'
        },
        numHands: 1,
        runningMode: 'VIDEO'
      });
    }
    return handRuntime.landmarker;
  })().finally(() => {
    handRuntime.loading = null;
  });

  return handRuntime.loading;
}

async function startHandControl() {
  if (exportSettings.hideUi || !controlsUi.handVideo || !navigator.mediaDevices?.getUserMedia) {
    state.handControlEnabled = false;
    syncHandControlUi();
    setHandStatus('摄像头不可用');
    return false;
  }

  const token = ++handRuntime.startToken;
  state.handControlEnabled = true;
  handRuntime.baseState = captureHandDrivenBaseState();
  handRuntime.smoothed = null;
  handRuntime.previousRaw = null;
  syncHandControlUi();
  setHandStatus('加载手势模型');

  try {
    const landmarkerPromise = ensureHandLandmarker();
    const streamPromise = navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        width: { ideal: 640 },
        height: { ideal: 360 },
        facingMode: 'user'
      }
    });
    const [, stream] = await Promise.all([landmarkerPromise, streamPromise]);
    if (token !== handRuntime.startToken || !state.handControlEnabled) {
      stream.getTracks().forEach((track) => track.stop());
      return false;
    }
    handRuntime.stream = stream;
    controlsUi.handVideo.srcObject = stream;
    await controlsUi.handVideo.play();
    handRuntime.active = true;
    setHandStatus('寻找手');
    return true;
  } catch (error) {
    console.error('Could not start hand control.', error);
    state.handControlEnabled = false;
    handRuntime.active = false;
    syncHandControlUi();
    setHandStatus('摄像头启动失败');
    return false;
  }
}

function stopHandControl() {
  state.handControlEnabled = false;
  handRuntime.startToken += 1;
  handRuntime.active = false;
  handRuntime.mockMetrics = null;
  handRuntime.stream?.getTracks().forEach((track) => track.stop());
  handRuntime.stream = null;
  if (controlsUi.handVideo) {
    controlsUi.handVideo.pause();
    controlsUi.handVideo.srcObject = null;
  }
  drawHandOverlay(null, null);
  syncHandControlUi();
  setHandStatus('未启用');
}

function getHandLandmarkPoint(landmark) {
  return {
    x: THREE.MathUtils.clamp(Number(landmark?.x) || 0, 0, 1),
    y: THREE.MathUtils.clamp(Number(landmark?.y) || 0, 0, 1),
    z: Number(landmark?.z) || 0
  };
}

function handDistance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = (a.z || 0) - (b.z || 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function computeHandMetrics(landmarks, nowMs) {
  if (!landmarks?.length) {
    return null;
  }

  const points = landmarks.map(getHandLandmarkPoint);
  const wrist = points[0];
  const indexMcp = points[5];
  const middleMcp = points[9];
  const pinkyMcp = points[17];
  const palmSize = Math.max(0.001, handDistance(indexMcp, pinkyMcp));
  const palm = {
    x: (wrist.x + indexMcp.x + middleMcp.x + pinkyMcp.x) / 4,
    y: (wrist.y + indexMcp.y + middleMcp.y + pinkyMcp.y) / 4,
    z: (wrist.z + indexMcp.z + middleMcp.z + pinkyMcp.z) / 4
  };
  const fingerTips = [points[4], points[8], points[12], points[16], points[20]];
  const openRaw = fingerTips.reduce((sum, point) => sum + handDistance(point, wrist), 0) / fingerTips.length / palmSize;
  const pinchRaw = handDistance(points[4], points[8]) / palmSize;
  const x = state.handControlMirror ? 1 - palm.x : palm.x;
  const y = palm.y;
  const raw = {
    x: THREE.MathUtils.clamp(x, 0, 1),
    y: THREE.MathUtils.clamp(y, 0, 1),
    z: palm.z,
    open: THREE.MathUtils.clamp((openRaw - 1.15) / 1.45, 0, 1),
    pinch: THREE.MathUtils.clamp((pinchRaw - 0.16) / 0.72, 0, 1),
    velocity: 0,
    vx: 0,
    vy: 0
  };

  if (handRuntime.previousRaw) {
    const dt = Math.max(0.001, (nowMs - handRuntime.previousRaw.timeMs) / 1000);
    raw.vx = (raw.x - handRuntime.previousRaw.x) / dt;
    raw.vy = (raw.y - handRuntime.previousRaw.y) / dt;
    const motionSpeed = Math.sqrt(raw.vx * raw.vx + raw.vy * raw.vy);
    raw.velocity = THREE.MathUtils.clamp(Math.max(0, motionSpeed - 0.08) * 0.32, 0, 1.6);
    if (raw.velocity < 0.01) {
      raw.vx = 0;
      raw.vy = 0;
    }
  }
  handRuntime.previousRaw = { ...raw, timeMs: nowMs };

  const smoothing = THREE.MathUtils.clamp(state.handControlSmoothing, 0, 0.95);
  const mix = 1 - smoothing;
  if (!handRuntime.smoothed) {
    handRuntime.smoothed = raw;
  } else {
    Object.keys(raw).forEach((key) => {
      handRuntime.smoothed[key] = THREE.MathUtils.lerp(handRuntime.smoothed[key], raw[key], mix);
    });
  }
  return { ...handRuntime.smoothed, landmarks: points };
}

function setHandDrivenNumeric(key, value) {
  if (!Number.isFinite(Number(value))) {
    return false;
  }
  const nextValue = normalizeNumericStateValue(key, value);
  if (Math.abs((state[key] || 0) - nextValue) < 0.0001) {
    return false;
  }
  state[key] = nextValue;
  handRuntime.changedKeys.add(key);
  return true;
}

function applyHandToModelParticles(metrics, base, influence) {
  const side = (metrics.x - 0.5) * 2;
  const lift = (0.5 - metrics.y) * 2;
  const energy = THREE.MathUtils.clamp(metrics.open * 0.65 + metrics.velocity * 0.8, 0, 1.8);

  if (state.handControlMode === 'growth') {
    const progress = THREE.MathUtils.clamp(1 - metrics.y + metrics.open * 0.16, 0, 1);
    setHandDrivenNumeric('growth', progress);
    setHandDrivenNumeric('growthFlow', base.growthFlow + influence * (0.18 + metrics.velocity * 1.15));
    setHandDrivenNumeric('growthTurbulence', base.growthTurbulence + influence * (metrics.open * 0.9 + metrics.velocity * 0.7));
    setHandDrivenNumeric('growthWidth', base.growthWidth + influence * (0.1 + (1 - metrics.open) * 0.24));
    setHandDrivenNumeric('organicFlow', Math.max(base.organicFlow, metrics.open * 0.85));
    setHandDrivenNumeric('edgeBreak', Math.max(base.edgeBreak, metrics.velocity * 0.65));
    return;
  }

  if (state.handControlMode === 'dissolve') {
    const closed = 1 - metrics.open;
    setHandDrivenNumeric('dissolve', THREE.MathUtils.clamp(closed * 0.74 + metrics.velocity * 0.34, 0, 1));
    setHandDrivenNumeric('dissolveSpread', base.dissolveSpread + influence * (closed * 1.6 + metrics.velocity * 1.1));
    setHandDrivenNumeric('dissolveTurbulence', base.dissolveTurbulence + influence * (0.2 + metrics.velocity * 1.2));
    setHandDrivenNumeric('dissolveCurl', base.dissolveCurl + influence * Math.abs(side) * 1.2);
    setHandDrivenNumeric('dissolveMist', THREE.MathUtils.clamp(base.dissolveMist + influence * energy * 0.45, 0, 1));
    setHandDrivenNumeric('dissolveDirectionX', side * 1.8);
    setHandDrivenNumeric('dissolveDirectionY', lift * 1.3);
    setHandDrivenNumeric('dissolveDirectionZ', (metrics.open - 0.5) * 1.1);
    setHandDrivenNumeric('dissolveLift', base.dissolveLift + lift * influence * 0.9);
    return;
  }

  if (state.handControlMode === 'morph') {
    const progress = THREE.MathUtils.clamp(metrics.x, 0, 1);
    if (state.effectMode === 'morph') {
      setHandDrivenNumeric('morphProgress', progress);
      setHandDrivenNumeric('morphScatter', base.morphScatter + influence * energy * 1.7);
      setHandDrivenNumeric('morphTurbulence', base.morphTurbulence + influence * (0.2 + metrics.velocity * 1.4));
      setHandDrivenNumeric('morphFlow', base.morphFlow + influence * (0.18 + metrics.velocity * 0.95));
      setHandDrivenNumeric('morphTrail', THREE.MathUtils.clamp(base.morphTrail + influence * metrics.open * 0.35, 0, 1));
      setHandDrivenNumeric('morphDirX', side * 1.6);
      setHandDrivenNumeric('morphDirY', lift * 1.2);
      setHandDrivenNumeric('morphDirZ', (metrics.open - 0.5) * 1.4);
    } else {
      setHandDrivenNumeric('particleizeProgress', progress);
      setHandDrivenNumeric('spread', base.spread + influence * energy * 1.2);
      setHandDrivenNumeric('noise', base.noise + influence * metrics.velocity * 0.95);
    }
    return;
  }

  setHandDrivenNumeric('spread', base.spread + influence * (metrics.open * 1.65 + metrics.velocity * 0.85));
  setHandDrivenNumeric('noise', base.noise + influence * (0.08 + metrics.velocity * 1.05));
  setHandDrivenNumeric('swirl', base.swirl + influence * (side * 1.45 + metrics.vx * 0.12));
  setHandDrivenNumeric('speed', base.speed + influence * (0.1 + metrics.velocity * 1.25));
  setHandDrivenNumeric('organicFlow', Math.max(base.organicFlow, metrics.open * 0.7));
  setHandDrivenNumeric('filamentCurl', base.filamentCurl + influence * Math.abs(side) * 0.8);
}

function applyHandToEmission(metrics, base, influence) {
  const side = (metrics.x - 0.5) * 2;
  const lift = (0.5 - metrics.y) * 2;
  const energy = THREE.MathUtils.clamp(metrics.open * 0.75 + metrics.velocity * 0.85, 0, 1.9);
  setHandDrivenNumeric('emissionIntensity', base.emissionIntensity + influence * (0.22 + energy * 1.3));
  setHandDrivenNumeric('emissionDistance', base.emissionDistance + influence * (metrics.open * 1.4 + metrics.velocity * 0.8));
  setHandDrivenNumeric('emissionSpeed', base.emissionSpeed + influence * (0.12 + metrics.velocity * 1.2));
  setHandDrivenNumeric('emissionWindX', base.emissionWindX + side * influence * 1.4);
  setHandDrivenNumeric('emissionWindY', base.emissionWindY + lift * influence * 1.2);
  setHandDrivenNumeric('emissionWindZ', base.emissionWindZ + (metrics.open - 0.5) * influence * 1.2);
  setHandDrivenNumeric('emissionTurbulence', base.emissionTurbulence + influence * (0.18 + metrics.velocity * 1.15));
  setHandDrivenNumeric('emissionGlow', base.emissionGlow + influence * metrics.velocity * 0.45);
}

function applyHandToImageSplat(metrics, base, influence) {
  const side = (metrics.x - 0.5) * 2;
  const lift = (0.5 - metrics.y) * 2;
  const energy = THREE.MathUtils.clamp(metrics.open * 0.7 + metrics.velocity * 1.05, 0, 2);
  setHandDrivenNumeric('imageSplatScatter', base.imageSplatScatter + influence * energy * 1.35);
  setHandDrivenNumeric('imageSplatSpeed', base.imageSplatSpeed + influence * (0.06 + metrics.velocity * 1.15));
  setHandDrivenNumeric('imageSplatTurbulence', base.imageSplatTurbulence + influence * (0.18 + energy * 0.85));
  setHandDrivenNumeric('imageSplatDirX', side * 1.8);
  setHandDrivenNumeric('imageSplatDirY', lift * 1.2);
  setHandDrivenNumeric('imageSplatDirZ', (metrics.open - 0.5) * 1.5);
  setHandDrivenNumeric('imageSplatGlow', base.imageSplatGlow + influence * metrics.velocity * 0.4);
}

function syncHandDrivenUniforms(changedKeys) {
  const changed = changedKeys instanceof Set ? changedKeys : new Set(changedKeys || []);
  const hasAny = (...keys) => keys.some((key) => changed.has(key));

  if ([...changed].some((key) => key.startsWith('emission'))) {
    syncEmissionUniforms();
    return;
  }

  if ([...changed].some((key) => key.startsWith('imageSplat'))) {
    syncImageSplatUniforms();
    return;
  }

  const scalarUniforms = {
    particleizeProgress: 'uParticleizeProgress',
    spread: 'uSpread',
    noise: 'uNoise',
    noiseScale: 'uNoiseScale',
    swirl: 'uSwirl',
    dissolve: 'uDissolve',
    dissolveSpread: 'uDissolveSpread',
    dissolveEdgeWidth: 'uDissolveEdgeWidth',
    dissolveTurbulence: 'uDissolveTurbulence',
    dissolveCurl: 'uDissolveCurl',
    dissolveMist: 'uDissolveMist',
    growth: 'uGrowth',
    growthFlow: 'uGrowthFlow',
    growthWidth: 'uGrowthWidth',
    growthTurbulence: 'uGrowthTurbulence',
    organicFlow: 'uOrganicFlow',
    edgeBreak: 'uEdgeBreak',
    filamentLength: 'uFilamentLength',
    filamentCurl: 'uFilamentCurl',
    morphProgress: 'uMorphProgress',
    morphFlow: 'uMorphFlow',
    morphScatter: 'uMorphScatter',
    morphTurbulence: 'uMorphTurbulence',
    morphTrail: 'uMorphTrail'
  };

  Object.entries(scalarUniforms).forEach(([stateKey, uniformKey]) => {
    if (changed.has(stateKey) && uniforms[uniformKey]) {
      uniforms[uniformKey].value = state[stateKey];
    }
  });

  if (hasAny('dissolveDirectionX', 'dissolveDirectionY', 'dissolveDirectionZ')) {
    uniforms.uDissolveDirection.value.set(state.dissolveDirectionX, state.dissolveDirectionY, state.dissolveDirectionZ);
  }
  if (hasAny('morphDirX', 'morphDirY', 'morphDirZ')) {
    uniforms.uMorphDirection.value.set(state.morphDirX, state.morphDirY, state.morphDirZ);
  }
  if (changed.has('particleizeProgress')) {
    updateVisibleModelMaterials();
    syncEffectVisibility();
  }
}

function applyHandControlMetrics(metrics) {
  const base = handRuntime.baseState || captureHandDrivenBaseState();
  const influence = THREE.MathUtils.clamp(state.handControlInfluence, 0, 3);
  handRuntime.changedKeys.clear();

  if (state.effectMode === 'emission') {
    applyHandToEmission(metrics, base, influence);
  } else if (state.effectMode === 'image') {
    applyHandToImageSplat(metrics, base, influence);
  } else {
    applyHandToModelParticles(metrics, base, influence);
  }

  if (handRuntime.changedKeys.size) {
    syncHandDrivenUniforms(handRuntime.changedKeys);
    updateHandDrivenControlUi();
  }
}

function updateHandDrivenControlUi(force = false) {
  const now = performance.now();
  if (!force && now - handRuntime.lastUiSyncMs < 110) {
    return;
  }
  handRuntime.lastUiSyncMs = now;
  handRuntime.changedKeys.forEach((key) => {
    setRangeValue(key, state[key]);
    setValueInput(key, state[key]);
  });
}

function drawHandOverlay(landmarks, metrics) {
  const canvasElement = controlsUi.handOverlay;
  if (!canvasElement) {
    return;
  }
  const context = canvasElement.getContext('2d');
  if (!context) {
    return;
  }
  const width = canvasElement.width;
  const height = canvasElement.height;
  context.clearRect(0, 0, width, height);
  if (!landmarks?.length) {
    return;
  }

  const toCanvasPoint = (point) => ({
    x: (state.handControlMirror ? 1 - point.x : point.x) * width,
    y: point.y * height
  });

  context.lineWidth = 2;
  context.strokeStyle = 'rgba(0, 240, 255, 0.82)';
  HAND_CONNECTIONS.forEach(([a, b]) => {
    const p0 = toCanvasPoint(landmarks[a]);
    const p1 = toCanvasPoint(landmarks[b]);
    context.beginPath();
    context.moveTo(p0.x, p0.y);
    context.lineTo(p1.x, p1.y);
    context.stroke();
  });

  context.fillStyle = 'rgba(255, 191, 54, 0.92)';
  landmarks.forEach((point, index) => {
    const p = toCanvasPoint(point);
    context.beginPath();
    context.arc(p.x, p.y, index === 0 ? 4 : 2.4, 0, Math.PI * 2);
    context.fill();
  });

  if (metrics) {
    const x = metrics.x * width;
    const y = metrics.y * height;
    context.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    context.lineWidth = 1.5;
    context.beginPath();
    context.arc(x, y, 10 + metrics.open * 14, 0, Math.PI * 2);
    context.stroke();
  }
}

function updateHandControl() {
  if (!state.handControlEnabled) {
    return;
  }

  const now = performance.now();
  const frameInterval = 1000 / Math.max(1, state.handControlFps);
  if (now - handRuntime.lastDetectMs < frameInterval) {
    return;
  }
  handRuntime.lastDetectMs = now;

  if (handRuntime.mockMetrics) {
    const metrics = { ...handRuntime.mockMetrics };
    drawHandOverlay(null, metrics);
    applyHandControlMetrics(metrics);
    setHandStatus('测试手势');
    return;
  }

  const video = controlsUi.handVideo;
  if (!handRuntime.active || !handRuntime.landmarker || !video || video.readyState < 2) {
    return;
  }

  if (video.currentTime === handRuntime.lastVideoTime) {
    return;
  }
  handRuntime.lastVideoTime = video.currentTime;

  let result;
  try {
    result = handRuntime.landmarker.detectForVideo(video, now);
  } catch (error) {
    console.warn('Hand detection frame failed.', error);
    setHandStatus('识别中断');
    return;
  }

  const landmarks = result?.landmarks?.[0] || null;
  const metrics = computeHandMetrics(landmarks, now);
  drawHandOverlay(metrics?.landmarks || null, metrics);
  if (!metrics) {
    setHandStatus('寻找手');
    return;
  }

  const openPct = Math.round(metrics.open * 100);
  const velocityPct = Math.round(THREE.MathUtils.clamp(metrics.velocity / 1.6, 0, 1) * 100);
  setHandStatus(`张开 ${openPct}% / 速度 ${velocityPct}%`);
  applyHandControlMetrics(metrics);
}

function setParticleModeRotation(x = 0, y = 0, z = 0) {
  modelEffectRoot.rotation.set(x, y, z);
  resetModelEffectChildRotations();
  updateModelBreakRootInverse();
}

function setEmissionModeRotation(x = 0, y = 0, z = 0) {
  modelEffectRoot.rotation.set(x, y, z);
  resetModelEffectChildRotations();
  updateModelBreakRootInverse();
}

function resetModelEffectChildRotations() {
  [particles, glowParticles, visibleModelRoot, emissionParticles, emissionGlowParticles].forEach((item) => {
    if (item) {
      item.rotation.set(0, 0, 0);
    }
  });
}

function updateModelBreakRootInverse() {
  modelEffectRoot.updateMatrixWorld(true);
  modelBreakUniforms.uBreakRootInverse.value.copy(modelEffectRoot.matrixWorld).invert();
}

function updateStats() {
  if (state.effectMode === 'image') {
    statsText.textContent = realSplatRoot
      ? realSplatRoot.userData?.isSharpPreview
        ? `${formatCount(realSplatPointCount || realSplatRoot.userData.pointCount || 0)} SHARP preview points`
        : 'true Gaussian splat scene'
      : imageSplatSource?.isPanorama
        ? `${formatCount(state.imageSplatCount)} panorama splats`
        : `${formatCount(state.imageSplatCount)} image preview splats`;
    return;
  }

  if (state.effectMode === 'emission') {
    statsText.textContent = `${formatCount(state.emissionCount)} emission particles`;
    return;
  }

  const actualParticleCount = particles?.geometry?.userData?.capacity || state.particleCount;
  statsText.textContent = state.effectMode === 'morph'
    ? `${formatCount(actualParticleCount)} morph particles`
    : `${formatCount(actualParticleCount)} particles`;
}

function resetImageSplatTransform() {
  state.imageSplatPositionX = 0;
  state.imageSplatPositionY = 0;
  state.imageSplatPositionZ = 0;
  state.imageSplatRotationX = 0;
  state.imageSplatRotationY = 0;
  state.imageSplatRotationZ = 0;
  state.imageSplatScale = 1;
}

function applyImageSplatImportPreset(source) {
  if (source?.isPanorama) {
    Object.assign(state, {
      imageSplatCount: Math.max(state.imageSplatCount, 260000),
      imageSplatDepth: 0.72,
      imageSplatScatter: 0.18,
      imageSplatSpeed: 0.01,
      imageSplatDirX: 0.08,
      imageSplatDirY: 0.02,
      imageSplatDirZ: -0.08,
      imageSplatTurbulence: 0.1,
      imageSplatSize: 0.72,
      imageSplatFeather: 0.16,
      imageSplatColorKeep: 1,
      imageSplatOpacity: 0.82,
      imageSplatGlow: 0,
      imageSplatPlaneVisible: false,
      imageSplatPlaneOpacity: 0.22
    });
  } else {
    Object.assign(state, {
      imageSplatCount: Math.max(state.imageSplatCount, 220000),
      imageSplatDepth: 2.8,
      imageSplatScatter: 0.12,
      imageSplatSpeed: 0,
      imageSplatDirX: 0.02,
      imageSplatDirY: 0.01,
      imageSplatDirZ: 0.2,
      imageSplatTurbulence: 0.06,
      imageSplatSize: 0.82,
      imageSplatFeather: 0.16,
      imageSplatColorKeep: 1,
      imageSplatOpacity: 0.88,
      imageSplatGlow: 0,
      imageSplatPlaneVisible: false,
      imageSplatPlaneOpacity: 0.28
    });
  }
  syncUi();
}

function applyImageSplatTransform() {
  const root = realSplatRoot || imageSplatRoot;
  if (!root) {
    return;
  }

  root.position.set(state.imageSplatPositionX, state.imageSplatPositionY, state.imageSplatPositionZ);
  root.rotation.set(
    THREE.MathUtils.degToRad(state.imageSplatRotationX),
    THREE.MathUtils.degToRad(state.imageSplatRotationY),
    THREE.MathUtils.degToRad(state.imageSplatRotationZ)
  );
  root.scale.setScalar(Math.max(0.01, state.imageSplatScale));
}

function captureImageSplatTransform() {
  return {
    position: [state.imageSplatPositionX, state.imageSplatPositionY, state.imageSplatPositionZ],
    rotation: [state.imageSplatRotationX, state.imageSplatRotationY, state.imageSplatRotationZ],
    scale: state.imageSplatScale
  };
}

function applyImageSplatTransformSnapshot(transform = {}) {
  const position = normalizeVectorArray(transform.position, [0, 0, 0]);
  const rotation = normalizeVectorArray(transform.rotation, [0, 0, 0]);
  state.imageSplatPositionX = position[0];
  state.imageSplatPositionY = position[1];
  state.imageSplatPositionZ = position[2];
  state.imageSplatRotationX = rotation[0];
  state.imageSplatRotationY = rotation[1];
  state.imageSplatRotationZ = rotation[2];
  state.imageSplatScale = Math.max(0.01, Number(transform.scale) || 1);
  applyImageSplatTransform();
}

function syncTransformProxyFromImageSplat() {
  selectedTransformProxy.position.set(state.imageSplatPositionX, state.imageSplatPositionY, state.imageSplatPositionZ);
  selectedTransformProxy.rotation.set(
    THREE.MathUtils.degToRad(state.imageSplatRotationX),
    THREE.MathUtils.degToRad(state.imageSplatRotationY),
    THREE.MathUtils.degToRad(state.imageSplatRotationZ)
  );
  selectedTransformProxy.scale.setScalar(Math.max(0.01, state.imageSplatScale));
  selectedTransformProxy.updateMatrixWorld(true);
}

function commitSelectedImageSplatTransform() {
  if (!selectedImageSplat || (!imageSplatRoot && !realSplatRoot)) {
    return;
  }

  state.imageSplatPositionX = selectedTransformProxy.position.x;
  state.imageSplatPositionY = selectedTransformProxy.position.y;
  state.imageSplatPositionZ = selectedTransformProxy.position.z;
  state.imageSplatRotationX = THREE.MathUtils.radToDeg(selectedTransformProxy.rotation.x);
  state.imageSplatRotationY = THREE.MathUtils.radToDeg(selectedTransformProxy.rotation.y);
  state.imageSplatRotationZ = THREE.MathUtils.radToDeg(selectedTransformProxy.rotation.z);
  state.imageSplatScale = Math.max(0.01, (selectedTransformProxy.scale.x + selectedTransformProxy.scale.y + selectedTransformProxy.scale.z) / 3);
  applyImageSplatTransform();
  syncUi();
}

function selectImageSplatObject() {
  if ((!imageSplatRoot && !realSplatRoot) || exportSettings.hideUi) {
    return;
  }

  selectedImageSplat = true;
  selectedVideoPlaneId = null;
  selectedLightId = null;
  selectedKeyframeId = null;
  selectedKeyframeObject = null;
  selectedCameraBezierHandle = null;
  resetTransformAxisConstraint(false);
  renderLightList();
  syncLightUi();
  syncTransformProxyFromImageSplat();
  transformControls.setMode(selectedImageSplatMode);
  transformControls.setSpace(selectedImageSplatMode === 'rotate' || selectedImageSplatMode === 'scale' ? 'local' : 'world');
  transformControls.attach(selectedTransformProxy);
  transformControls.visible = true;
  transformControls.enabled = true;
  applyTransformAxisConstraint();
  syncImageSplatTransformButtons();
}

function setSelectedImageSplatMode(mode) {
  selectedImageSplatMode = ['translate', 'rotate', 'scale'].includes(mode) ? mode : 'translate';
  if (selectedImageSplat) {
    transformControls.setMode(selectedImageSplatMode);
    transformControls.setSpace(selectedImageSplatMode === 'rotate' || selectedImageSplatMode === 'scale' ? 'local' : 'world');
    transformControls.attach(selectedTransformProxy);
    transformControls.visible = true;
  }
  syncImageSplatTransformButtons();
}

function syncImageSplatTransformButtons() {
  controlsUi.moveImageSplat?.classList.toggle('active', selectedImageSplatMode === 'translate');
  controlsUi.rotateImageSplat?.classList.toggle('active', selectedImageSplatMode === 'rotate');
  controlsUi.scaleImageSplat?.classList.toggle('active', selectedImageSplatMode === 'scale');
}

function createSceneLight(type = 'point', options = {}, selectAfterCreate = true) {
  const normalizedType = LIGHT_TYPES[type] ? type : 'point';
  const defaults = LIGHT_DEFAULTS[normalizedType];
  const record = {
    id: options.id || crypto.randomUUID(),
    isDefault: Boolean(options.isDefault || options.id === 'default-sun'),
    type: normalizedType,
    name: options.name || nextLightName(normalizedType),
    color: options.color || defaults.color,
    intensity: Number.isFinite(Number(options.intensity)) ? Number(options.intensity) : defaults.intensity,
    size: Math.max(0.01, Number.isFinite(Number(options.size)) ? Number(options.size) : Math.max(defaults.size, 0.01)),
    position: normalizeVectorArray(options.position, defaults.position),
    quaternion: normalizeQuaternionArray(options.quaternion, defaults.rotation),
    object: null,
    target: null,
    handle: null
  };

  sceneLights.push(record);
  rebuildLightObject(record);
  rebuildLightHandle(record);
  renderLightList();

  if (selectAfterCreate && !exportSettings.hideUi) {
    selectLightHandle(record.id);
  } else {
    syncLightUi();
  }

  return record;
}

function nextLightName(type) {
  const label = LIGHT_TYPES[type] || LIGHT_TYPES.point;
  const count = sceneLights.filter((light) => light.type === type).length + 1;
  return `${label} ${count}`;
}

function normalizeVectorArray(value, fallback) {
  const values = Array.isArray(value) ? value.map(Number).slice(0, 3) : [];
  return values.length === 3 && values.every(Number.isFinite) ? values : [...fallback];
}

function normalizeQuaternionArray(value, fallbackEuler) {
  if (Array.isArray(value) && value.length >= 4) {
    const values = value.map(Number).slice(0, 4);
    const quaternion = new THREE.Quaternion().fromArray(values);
    if (values.every(Number.isFinite) && quaternion.lengthSq() > 0.000001) {
      return quaternion.normalize().toArray();
    }
  }

  const eulerValues = Array.isArray(fallbackEuler) ? fallbackEuler : [0, 0, 0];
  return new THREE.Quaternion()
    .setFromEuler(new THREE.Euler(eulerValues[0], eulerValues[1], eulerValues[2]))
    .toArray();
}

function rebuildLightObject(record) {
  removeLightObject(record);

  const color = new THREE.Color(record.color);
  if (record.type === 'sun') {
    record.object = new THREE.DirectionalLight(color, record.intensity);
    record.target = new THREE.Object3D();
    sceneLightGroup.add(record.target);
    record.object.target = record.target;
  } else if (record.type === 'spot') {
    record.object = new THREE.SpotLight(color, record.intensity, 0, spotSizeToAngle(record.size), 0.36, 2);
    record.target = new THREE.Object3D();
    sceneLightGroup.add(record.target);
    record.object.target = record.target;
  } else if (record.type === 'area') {
    record.object = new THREE.RectAreaLight(color, record.intensity, record.size, record.size);
  } else {
    record.object = new THREE.PointLight(color, record.intensity, pointSizeToDistance(record.size), 2);
    record.object.shadow.radius = record.size;
  }

  record.object.name = record.name;
  sceneLightGroup.add(record.object);
  applyLightRecord(record);
}

function removeLightObject(record) {
  if (record.object) {
    sceneLightGroup.remove(record.object);
    record.object.dispose?.();
    record.object = null;
  }
  if (record.target) {
    sceneLightGroup.remove(record.target);
    record.target = null;
  }
}

function rebuildLightHandle(record) {
  if (record.handle) {
    lightHandleGroup.remove(record.handle);
    disposeObject3D(record.handle);
    record.handle = null;
  }

  const color = new THREE.Color(record.color);
  const material = new THREE.MeshBasicMaterial({
    color,
    wireframe: true,
    transparent: true,
    opacity: selectedLightId === record.id ? 1 : 0.72,
    depthTest: false
  });
  const lineMaterial = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity: selectedLightId === record.id ? 0.98 : 0.62,
    depthTest: false
  });
  const group = new THREE.Group();
  group.userData.lightId = record.id;
  group.userData.lightHandle = true;

  if (record.type === 'sun') {
    group.add(new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 16), material));
    group.add(new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.01, 6, 32), material));
  } else if (record.type === 'spot') {
    const coneHeight = 0.86;
    const coneRadius = Math.max(0.18, record.size * 0.32);
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(coneRadius, coneHeight, 28, 1, true),
      material
    );
    cone.rotation.x = Math.PI / 2;
    cone.position.z = -coneHeight / 2;
    group.add(cone);
    const aperture = new THREE.Mesh(new THREE.TorusGeometry(coneRadius, 0.008, 6, 36), material);
    aperture.rotation.x = Math.PI / 2;
    aperture.position.z = -coneHeight;
    group.add(aperture);
  } else if (record.type === 'area') {
    group.add(new THREE.Mesh(new THREE.PlaneGeometry(record.size, record.size), material));
  } else {
    group.add(new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.11, record.size * 0.17), 18, 12), material));
  }

  if (record.type !== 'point') {
    const forward = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -0.85)]),
      lineMaterial
    );
    group.add(forward);
  }

  markLightHandle(group, record.id);
  record.handle = group;
  lightHandleGroup.add(group);
  applyLightRecord(record);
}

function markLightHandle(root, lightId) {
  root.traverse((node) => {
    node.userData.lightId = lightId;
    node.userData.lightHandle = true;
  });
}

function disposeObject3D(root) {
  root.traverse((node) => {
    node.geometry?.dispose?.();
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    materials.forEach((material) => material?.dispose?.());
  });
}

function applyLightRecord(record) {
  const position = new THREE.Vector3().fromArray(record.position);
  const quaternion = new THREE.Quaternion().fromArray(record.quaternion).normalize();
  const color = new THREE.Color(record.color);

  if (record.object) {
    record.object.name = record.name;
    record.object.color.copy(color);
    record.object.intensity = getEffectiveLightIntensity(record);
    record.object.position.copy(position);
    record.object.quaternion.copy(quaternion);

    if (record.object.isPointLight) {
      record.object.distance = pointSizeToDistance(record.size);
      record.object.shadow.radius = record.size;
    }
    if (record.object.isSpotLight) {
      record.object.angle = spotSizeToAngle(record.size);
      record.object.penumbra = 0.36;
    }
    if (record.object.isRectAreaLight) {
      record.object.width = record.size;
      record.object.height = record.size;
    }
  }

  if (record.target) {
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(quaternion).normalize();
    record.target.position.copy(position).addScaledVector(forward, 1);
    record.target.updateMatrixWorld(true);
  }

  if (record.handle) {
    record.handle.position.copy(position);
    record.handle.quaternion.copy(quaternion);
    record.handle.traverse((node) => {
      if (node.material?.color) {
        node.material.color.copy(color);
        node.material.opacity = selectedLightId === record.id ? 1 : 0.68;
      }
    });
  }
}

function getEffectiveLightIntensity(record) {
  if (record.isDefault && state.worldEnabled && worldPmremTarget?.texture) {
    return 0;
  }

  return record.intensity;
}

function pointSizeToDistance(size) {
  return THREE.MathUtils.clamp(8 + size * 8, 2, 120);
}

function spotSizeToAngle(size) {
  return THREE.MathUtils.clamp(size, 0.08, 1.35);
}

function syncParticleLightingUniformSet(targetUniforms) {
  if (!targetUniforms?.uParticleLightCount) {
    return;
  }

  const worldAmbient = state.worldEnabled && worldPmremTarget?.texture
    ? THREE.MathUtils.clamp(state.worldIntensity * 0.22, 0, 0.5)
    : 0;
  targetUniforms.uParticleAmbient.value = Math.max(0.08, ambientLight.intensity + worldAmbient);

  const entries = [];
  if (keyLight.intensity > 0.0001) {
    entries.push({
      type: 'sun',
      position: keyLight.position,
      direction: keyLight.position.clone().normalize(),
      color: keyLight.color,
      intensity: keyLight.intensity,
      size: 1,
      angle: 0.8
    });
  }
  if (rimLight.intensity > 0.0001) {
    entries.push({
      type: 'sun',
      position: rimLight.position,
      direction: rimLight.position.clone().normalize(),
      color: rimLight.color,
      intensity: rimLight.intensity,
      size: 1,
      angle: 0.8
    });
  }

  sceneLights.forEach((record) => {
    if (!record.object || entries.length >= MAX_PARTICLE_SHADER_LIGHTS) {
      return;
    }

    const position = new THREE.Vector3().fromArray(record.position);
    const quaternion = new THREE.Quaternion().fromArray(record.quaternion).normalize();
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(quaternion).normalize();
    const direction = record.type === 'sun' ? forward.clone().multiplyScalar(-1) : forward;
    entries.push({
      type: record.type,
      position,
      direction,
      color: new THREE.Color(record.color),
      intensity: getEffectiveLightIntensity(record),
      size: Math.max(0.01, record.size || 1),
      angle: spotSizeToAngle(record.size || 0.72)
    });
  });

  targetUniforms.uParticleLightCount.value = Math.min(entries.length, MAX_PARTICLE_SHADER_LIGHTS);
  for (let i = 0; i < MAX_PARTICLE_SHADER_LIGHTS; i += 1) {
    const entry = entries[i];
    if (entry) {
      targetUniforms.uParticleLightType.value[i] = PARTICLE_LIGHT_TYPE_IDS[entry.type] ?? 0;
      targetUniforms.uParticleLightPosition.value[i].copy(entry.position);
      targetUniforms.uParticleLightDirection.value[i].copy(entry.direction).normalize();
      targetUniforms.uParticleLightColor.value[i].copy(entry.color);
      targetUniforms.uParticleLightIntensity.value[i] = entry.intensity;
      targetUniforms.uParticleLightSize.value[i] = entry.size;
      targetUniforms.uParticleLightAngle.value[i] = entry.angle;
    } else {
      targetUniforms.uParticleLightType.value[i] = 0;
      targetUniforms.uParticleLightPosition.value[i].set(0, 0, 0);
      targetUniforms.uParticleLightDirection.value[i].set(0, 0, -1);
      targetUniforms.uParticleLightColor.value[i].setRGB(0, 0, 0);
      targetUniforms.uParticleLightIntensity.value[i] = 0;
      targetUniforms.uParticleLightSize.value[i] = 1;
      targetUniforms.uParticleLightAngle.value[i] = 0.8;
    }
  }
}

function syncParticleLightingUniforms() {
  syncParticleLightingUniformSet(uniforms);
  syncParticleLightingUniformSet(emissionUniforms);
}

function renderLightList() {
  if (!lightsUi.list) {
    return;
  }

  lightsUi.list.innerHTML = '';
  sceneLights.forEach((light) => {
    const button = document.createElement('button');
    button.className = `light-item${light.id === selectedLightId ? ' active' : ''}`;
    button.type = 'button';
    button.dataset.lightId = light.id;
    button.innerHTML = `
      <span class="light-swatch" style="background:${light.color}"></span>
      <span>${light.name}</span>
      <span class="light-kind">${LIGHT_TYPES[light.type]}</span>
    `;
    button.addEventListener('click', () => selectLightHandle(light.id));
    lightsUi.list.append(button);
  });
}

function getSelectedLight() {
  return sceneLights.find((light) => light.id === selectedLightId) || null;
}

function selectLightHandle(lightId) {
  const light = sceneLights.find((item) => item.id === lightId);
  if (!light || exportSettings.hideUi) {
    return;
  }

  selectedImageSplat = false;
  selectedVideoPlaneId = null;
  selectedLightId = light.id;
  selectedKeyframeId = null;
  selectedKeyframeObject = null;
  selectedCameraBezierHandle = null;
  resetTransformAxisConstraint(false);
  activeCameraQuaternion = null;
  rebuildCameraPath();
  syncTransformProxyFromLight(light);
  transformControls.setMode(selectedLightMode);
  transformControls.setSpace(selectedLightMode === 'rotate' ? 'local' : 'world');
  transformControls.attach(selectedTransformProxy);
  transformControls.visible = true;
  transformControls.enabled = true;
  applyTransformAxisConstraint();
  renderLightList();
  syncLightUi();
  updateLightModeButtons();
}

function syncTransformProxyFromLight(light) {
  selectedTransformProxy.position.fromArray(light.position);
  selectedTransformProxy.quaternion.fromArray(light.quaternion);
  selectedTransformProxy.updateMatrixWorld(true);
}

function commitSelectedLightTransform() {
  const light = getSelectedLight();
  if (!light) {
    return null;
  }

  light.position = selectedTransformProxy.position.toArray();
  light.quaternion = selectedTransformProxy.quaternion.normalize().toArray();
  applyLightRecord(light);
  return light;
}

function syncLightUi() {
  const light = getSelectedLight();
  const hasLight = Boolean(light);
  [lightsUi.type, lightsUi.color, lightsUi.intensity, lightsUi.intensityValue, lightsUi.size, lightsUi.sizeValue, lightsUi.delete, lightsUi.move, lightsUi.rotate]
    .forEach((control) => {
      if (control) {
        control.disabled = !hasLight;
      }
    });

  if (!light) {
    lightsUi.colorValue.value = '无';
    return;
  }

  lightsUi.type.value = light.type;
  lightsUi.color.value = light.color;
  lightsUi.colorValue.value = light.color;
  lightsUi.intensity.value = light.intensity;
  lightsUi.intensityValue.value = light.intensity.toFixed(2);
  lightsUi.size.value = light.size;
  lightsUi.sizeValue.value = light.size.toFixed(2);

  const hasSize = light.type !== 'sun';
  lightsUi.size.disabled = !hasSize;
  lightsUi.sizeValue.disabled = !hasSize;
  lightsUi.sizeLabel.textContent = light.type === 'spot' ? '大小/角度' : '大小';
}

function updateSelectedLightProperty(key, value) {
  const light = getSelectedLight();
  if (!light) {
    syncLightUi();
    return;
  }

  if (key === 'type') {
    light.type = LIGHT_TYPES[value] ? value : 'point';
    light.size = light.type === 'sun' ? 0.01 : Math.max(0.01, light.size || LIGHT_DEFAULTS[light.type].size);
    light.name = `${LIGHT_TYPES[light.type]} ${
      sceneLights.filter((item) => item !== light && item.type === light.type).length + 1
    }`;
    rebuildLightObject(light);
    rebuildLightHandle(light);
    syncTransformProxyFromLight(light);
  } else if (key === 'color') {
    light.color = String(value);
    applyLightRecord(light);
  } else if (key === 'intensity') {
    light.intensity = Math.max(0, Number(value) || 0);
    applyLightRecord(light);
  } else if (key === 'size') {
    light.size = Math.max(0.01, Number(value) || 0.01);
    rebuildLightHandle(light);
    applyLightRecord(light);
  }

  renderLightList();
  syncLightUi();
}

function deleteSelectedLight() {
  const light = getSelectedLight();
  if (!light) {
    return;
  }

  removeLightObject(light);
  if (light.handle) {
    lightHandleGroup.remove(light.handle);
    disposeObject3D(light.handle);
  }
  const index = sceneLights.indexOf(light);
  if (index >= 0) {
    sceneLights.splice(index, 1);
  }
  selectedLightId = sceneLights[0]?.id || null;
  if (selectedLightId) {
    selectLightHandle(selectedLightId);
  } else {
    transformControls.detach();
    transformControls.visible = false;
    renderLightList();
    syncLightUi();
  }
}

function setSelectedLightMode(mode) {
  selectedLightMode = mode === 'rotate' ? 'rotate' : 'translate';
  if (selectedLightId) {
    resetTransformAxisConstraint(false);
    transformControls.setMode(selectedLightMode);
    transformControls.setSpace(selectedLightMode === 'rotate' ? 'local' : 'world');
    transformControls.attach(selectedTransformProxy);
    transformControls.visible = true;
    applyTransformAxisConstraint();
  }
  updateLightModeButtons();
}

function updateLightModeButtons() {
  lightsUi.move?.classList.toggle('active', selectedLightMode === 'translate');
  lightsUi.rotate?.classList.toggle('active', selectedLightMode === 'rotate');
}

function serializeSceneLights() {
  return sceneLights.map(cloneLightSnapshot);
}

function cloneLightSnapshot(light) {
  return {
    id: light.id,
    isDefault: Boolean(light.isDefault),
    type: LIGHT_TYPES[light.type] ? light.type : 'point',
    name: light.name,
    color: light.color,
    intensity: Number(light.intensity) || 0,
    size: Math.max(0.01, Number(light.size) || 0.01),
    position: Array.isArray(light.position) ? light.position.map(Number).slice(0, 3) : [0, 0, 0],
    quaternion: Array.isArray(light.quaternion)
      ? light.quaternion.map(Number).slice(0, 4)
      : [0, 0, 0, 1]
  };
}

function normalizeLightSnapshot(light, index = 0) {
  const type = LIGHT_TYPES[light?.type] ? light.type : 'point';
  const defaults = LIGHT_DEFAULTS[type];
  const color = typeof light?.color === 'string' && /^#[0-9a-f]{6}$/i.test(light.color)
    ? light.color
    : defaults.color;

  return {
    id: typeof light?.id === 'string' && light.id ? light.id : `light-${index}`,
    isDefault: Boolean(light?.isDefault),
    type,
    name: typeof light?.name === 'string' && light.name ? light.name : `${LIGHT_TYPES[type]} ${index + 1}`,
    color,
    intensity: Number.isFinite(Number(light?.intensity)) ? Math.max(0, Number(light.intensity)) : defaults.intensity,
    size: Math.max(0.01, Number.isFinite(Number(light?.size)) ? Number(light.size) : Math.max(defaults.size, 0.01)),
    position: normalizeVectorArray(light?.position, defaults.position),
    quaternion: normalizeQuaternionArray(light?.quaternion, defaults.rotation)
  };
}

function importSceneLights(lights, selectFirst = false) {
  clearSceneLights();
  const source = Array.isArray(lights) ? lights : [];
  source.forEach((light, index) => createSceneLight(light.type, normalizeLightSnapshot(light, index), false));
  selectedLightId = !exportSettings.hideUi && selectFirst ? sceneLights[0]?.id || null : null;
  renderLightList();
  if (selectedLightId) {
    selectLightHandle(selectedLightId);
  } else {
    syncLightUi();
  }
}

function applySceneLightSnapshots(lights, options = {}) {
  const { updateUi = true } = options;
  const source = Array.isArray(lights) ? lights : [];
  const snapshots = source.map((light, index) => normalizeLightSnapshot(light, index));
  const snapshotIds = new Set(snapshots.map((light) => light.id));
  const previousSelection = selectedLightId;

  sceneLights.slice().forEach((light) => {
    if (!snapshotIds.has(light.id)) {
      removeLightObject(light);
      if (light.handle) {
        lightHandleGroup.remove(light.handle);
        disposeObject3D(light.handle);
      }
      const index = sceneLights.indexOf(light);
      if (index >= 0) {
        sceneLights.splice(index, 1);
      }
    }
  });

  snapshots.forEach((snapshot) => {
    const existing = sceneLights.find((light) => light.id === snapshot.id);
    if (!existing) {
      createSceneLight(snapshot.type, snapshot, false);
      return;
    }

    const typeChanged = existing.type !== snapshot.type;
    const sizeChanged = Math.abs((existing.size || 0) - snapshot.size) > 0.0001;
    Object.assign(existing, cloneLightSnapshot(snapshot));
    if (typeChanged) {
      rebuildLightObject(existing);
      rebuildLightHandle(existing);
    } else {
      applyLightRecord(existing);
      if (sizeChanged) {
        rebuildLightHandle(existing);
      }
    }
  });

  sceneLights.sort((a, b) => snapshots.findIndex((light) => light.id === a.id) - snapshots.findIndex((light) => light.id === b.id));
  selectedLightId = !exportSettings.hideUi && sceneLights.some((light) => light.id === previousSelection)
    ? previousSelection
    : null;
  if (selectedLightId && updateUi) {
    const selected = getSelectedLight();
    syncTransformProxyFromLight(selected);
  }
  if (updateUi) {
    renderLightList();
    syncLightUi();
  }
  syncParticleLightingUniforms();
}

function clearSceneLights() {
  sceneLights.forEach((light) => {
    removeLightObject(light);
    if (light.handle) {
      lightHandleGroup.remove(light.handle);
      disposeObject3D(light.handle);
    }
  });
  sceneLights.length = 0;
  selectedLightId = null;
  if (!selectedKeyframeId) {
    transformControls.detach();
    transformControls.visible = false;
  }
}

function createDefaultLightConfig() {
  const defaults = LIGHT_DEFAULTS.sun;
  return {
    id: 'default-sun',
    type: 'sun',
    name: '日光 1',
    color: defaults.color,
    intensity: defaults.intensity,
    size: 0.01,
    position: defaults.position,
    quaternion: normalizeQuaternionArray(null, defaults.rotation)
  };
}

function syncUi() {
  setRangeValue('particleCount', state.particleCount);
  NUMERIC_KEYFRAME_FIELDS.forEach((field) => setRangeValue(field, state[field]));
  controlsUi.emissionEnabled.checked = state.emissionEnabled;
  controlsUi.colorA.value = state.colorA;
  controlsUi.colorB.value = state.colorB;
  controlsUi.useTexture.checked = state.useTexture;
  controlsUi.autoRotate.checked = state.autoRotate;
  controlsUi.imageSplatPlaneVisible.checked = state.imageSplatPlaneVisible;
  controlsUi.worldEnabled.checked = state.worldEnabled;
  controlsUi.worldVisible.checked = state.worldVisible;
  controlsUi.worldExport.checked = state.worldExport;
  syncHandControlUi();
  syncModelAnimationUi();
  controlsUi.duration.value = cameraAnimation.duration;
  controlsUi.timeline.max = cameraAnimation.duration;
  controlsUi.timeline.value = cameraAnimation.time;
  syncCameraCurveUi();
  syncCameraSettingsFromState(true);

  setValueInput('particleCount', state.particleCount);
  NUMERIC_KEYFRAME_FIELDS.forEach((field) => setValueInput(field, state[field]));
  outputUi.timeline.value = `${cameraAnimation.time.toFixed(2)}s`;
  controlsUi.keyframeCount.value = String(cameraAnimation.keyframes.length + parameterKeyframes.length);
  syncEffectVisibility();
  renderSceneModelList();
  renderVideoPlaneList();
  syncVideoPlaneUi();
  updateParameterKeyframeButtons();
}

function setRangeValue(key, value) {
  const control = controlsUi[key];
  if (!control) {
    return;
  }

  const min = Number(control.min);
  const max = Number(control.max);
  const numericValue = Number(value);
  control.value = Number.isFinite(min) && Number.isFinite(max)
    ? THREE.MathUtils.clamp(numericValue, min, max)
    : numericValue;
}

function setValueInput(key, value) {
  const input = outputUi[key];
  if (!input) {
    return;
  }

  input.value = formatControlValue(key, value);
}

function formatControlValue(key, value) {
  if (key === 'particleCount' || key === 'emissionCount' || key === 'imageSplatCount') {
    return String(Math.max(MIN_PARTICLE_COUNT, Math.round(Number(value) || 0)));
  }

  if (key === 'pointSize' || key === 'emissionSize' || key === 'imageSplatSize') {
    return Number(value).toFixed(2);
  }

  if (key === 'glowRadius') {
    return String(Math.round(Number(value) || 0));
  }

  if (key === 'worldRotation') {
    return String(Math.round(Number(value) || 0));
  }

  if (key === 'handControlFps') {
    return String(Math.max(1, Math.round(Number(value) || 1)));
  }

  if (key === 'modelAnimProgress') {
    return Number(value).toFixed(3);
  }

  if (key === 'cameraSensorWidth' || key === 'cameraAperture') {
    return Number(value).toFixed(1);
  }

  if (key === 'cameraFocalLength' || key === 'cameraFocusDistance') {
    return Number(value).toFixed(2);
  }

  return Number(value).toFixed(2);
}

function setupParameterKeyframeButtons() {
  PARAMETER_KEYFRAME_FIELDS.forEach((field) => {
    const control = controlsUi[field];
    if (!control || (control.type !== 'range' && control.type !== 'checkbox')) {
      return;
    }

    const label = control.closest('label');
    if (!label || !label.closest('.control-grid')) {
      return;
    }
    if (label.classList.contains('wide-toggle') && !CAMERA_KEYFRAME_FIELDS.has(field)) {
      return;
    }

    if (parameterKeyframeButtons.has(field)) {
      return;
    }

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'keyframe-dot';
    button.title = '添加/更新此参数关键帧';
    button.setAttribute('aria-label', '添加/更新此参数关键帧');
    button.dataset.parameterKeyframe = field;
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      addParameterKeyframe(field);
    });

    label.classList.add('keyable-control');
    label.append(button);
    parameterKeyframeButtons.set(field, button);
  });
  updateParameterKeyframeButtons();
}

function updateParameterKeyframeButtons() {
  const currentTime = Number(cameraAnimation.time) || 0;
  parameterKeyframeButtons.forEach((button, field) => {
    const keyframes = getSortedParameterKeyframes(field);
    const atCurrentTime = keyframes.some((keyframe) => Math.abs(keyframe.time - currentTime) < 0.035);
    button.classList.toggle('has-keyframe', keyframes.length > 0);
    button.classList.toggle('at-keyframe', atCurrentTime);
  });
}

function scheduleRebuild() {
  clearTimeout(rebuildTimer);
  setStatus('Resampling');
  rebuildTimer = window.setTimeout(() => {
    if (state.effectMode === 'image' && imageSplatSource) {
      buildImageSplatObject(imageSplatSource, currentLabel);
    } else {
      buildParticles(currentSource, currentLabel);
    }
  }, 180);
}

function setEffectMode(mode) {
  if (mode === 'image' && !imageSplatRoot && !realSplatRoot) {
    setStatus('Import image first');
    return;
  }

  state.effectMode = VALID_EFFECT_MODES.has(mode) ? mode : 'particles';
  if (state.effectMode === 'morph' && !morphTargetSource) {
    setStatus('Import target model 2');
  }
  if (state.effectMode === 'image' && imageSplatRoot && !exportSettings.hideUi) {
    selectImageSplatObject();
  } else if (selectedImageSplat) {
    selectedImageSplat = false;
    transformControls.detach();
    transformControls.visible = false;
  }
  syncEffectVisibility();
  syncUniforms();
}

function setPreset(name) {
  const preset = presets[name];
  if (!preset) {
    return;
  }
  presetButtons.forEach((button) => {
    button.classList.toggle('active', button.dataset.preset === name);
  });
  applyOptionsSnapshot(preset, true).catch((error) => {
    console.error(error);
    setStatus('Preset failed');
  });
}

function resetCamera() {
  if (state.effectMode === 'image' && imageSplatSource?.isPanorama) {
    frameImageSplatCamera(imageSplatSource);
    return;
  }

  activeCameraQuaternion = null;
  orbit.minDistance = 0.02;
  orbit.maxDistance = CAMERA_ORBIT_MAX_DISTANCE;
  camera.position.set(0, 0.7, 7.2);
  orbit.target.set(0, 0.05, 0);
  state.cameraFocusDistance = camera.position.distanceTo(orbit.target);
  syncCameraSettingsFromState(true);
  orbit.update();
}

function frameImageSplatCamera(source) {
  activeCameraQuaternion = null;
  if (source?.isPanorama) {
    const scale = Math.max(0.01, state.imageSplatScale || 1);
    const radius = (source.radius || 16) * scale;
    orbit.minDistance = 0.001;
    orbit.maxDistance = Math.max(1, radius * 0.92);
    const center = new THREE.Vector3(
      state.imageSplatPositionX,
      state.imageSplatPositionY,
      state.imageSplatPositionZ
    );
    camera.position.copy(center).add(new THREE.Vector3(0, 0, 0.05));
    orbit.target.copy(center).add(new THREE.Vector3(0, -0.04, -1.2));
    camera.fov = 54;
    camera.updateProjectionMatrix();
    orbit.update();
    return;
  }

  orbit.minDistance = 0.02;
  orbit.maxDistance = CAMERA_ORBIT_MAX_DISTANCE;
  camera.position.set(0, 0.25, 5.2);
  orbit.target.set(0, 0, 0);
  camera.fov = 48;
  camera.updateProjectionMatrix();
  orbit.update();
}

function normalizeCameraType(value) {
  return value === 'panorama' ? 'panorama' : 'perspective';
}

function syncCameraSettingsFromState(updateUi = false) {
  state.cameraType = normalizeCameraType(state.cameraType);
  state.cameraSensorWidth = THREE.MathUtils.clamp(Number(state.cameraSensorWidth) || 36, 12, 70);
  state.cameraFocalLength = THREE.MathUtils.clamp(Number(state.cameraFocalLength) || 22.74, 8, 300);
  state.cameraDisplaySize = THREE.MathUtils.clamp(Number(state.cameraDisplaySize) || 1, 0.2, 5);
  state.cameraAperture = THREE.MathUtils.clamp(Number(state.cameraAperture) || 5.6, 1.2, 22);
  state.cameraFocusDistance = THREE.MathUtils.clamp(Number(state.cameraFocusDistance) || 7.18, 0.05, CAMERA_FOCUS_DISTANCE_MAX);
  state.cameraDofEnabled = Boolean(state.cameraDofEnabled) && state.cameraType === 'perspective';

  camera.filmGauge = state.cameraSensorWidth;
  camera.setFocalLength(state.cameraFocalLength);
  camera.near = THREE.MathUtils.clamp(Number(camera.near) || CAMERA_DEFAULT_NEAR, CAMERA_DEFAULT_NEAR, 1);
  camera.far = Math.max(Number(camera.far) || CAMERA_DEFAULT_FAR, CAMERA_DEFAULT_FAR);
  camera.updateProjectionMatrix();

  if (updateUi) {
    controlsUi.cameraType.value = state.cameraType;
    controlsUi.cameraDofEnabled.checked = state.cameraDofEnabled;
    setRangeValue('cameraDisplaySize', state.cameraDisplaySize);
    setRangeValue('cameraFocalLength', state.cameraFocalLength);
    setRangeValue('cameraAperture', state.cameraAperture);
    setRangeValue('cameraFocusDistance', state.cameraFocusDistance);
    setValueInput('cameraDisplaySize', state.cameraDisplaySize);
    setValueInput('cameraFocalLength', state.cameraFocalLength);
    setValueInput('cameraAperture', state.cameraAperture);
    setValueInput('cameraFocusDistance', state.cameraFocusDistance);
  }

  const perspective = state.cameraType === 'perspective';
  const dofControlsEnabled = perspective && state.cameraDofEnabled;
  controlsUi.cameraDofEnabled.disabled = !perspective;
  controlsUi.cameraAperture.disabled = !dofControlsEnabled;
  controlsUi.cameraFocusDistance.disabled = !dofControlsEnabled;
  outputUi.cameraAperture.disabled = !dofControlsEnabled;
  outputUi.cameraFocusDistance.disabled = !dofControlsEnabled;
  if (controlsUi.cameraModeHint) {
    controlsUi.cameraModeHint.textContent = perspective
      ? '相机大小调整场景中的相机线框和手柄；焦段控制最终取景，景深参数可独立 K 帧。'
      : '相机大小调整场景中的相机线框；360° 模式输出 2:1 全景且关闭景深。';
  }
  updateCameraMarkerDisplaySize();
  setCameraPreviewDirty();
}

function setCameraType(value, options = {}) {
  state.cameraType = normalizeCameraType(value);
  if (state.cameraType === 'panorama' && options.preserveResolution !== true) {
    const width = Math.max(256, Math.round(Number(controlsUi.exportWidth.value) || 3840));
    controlsUi.exportWidth.value = width;
    controlsUi.exportHeight.value = Math.max(128, Math.round(width / 2));
    updateCameraPreviewLayout(true);
  }
  syncCameraSettingsFromState(true);
}

function setCameraSettings(settings = {}, updateUi = true) {
  if (settings.type !== undefined || settings.cameraType !== undefined) {
    state.cameraType = normalizeCameraType(settings.type ?? settings.cameraType);
  }
  if (settings.sensorWidth !== undefined || settings.cameraSensorWidth !== undefined) {
    state.cameraSensorWidth = Number(settings.sensorWidth ?? settings.cameraSensorWidth);
  }
  if (settings.focalLength !== undefined || settings.cameraFocalLength !== undefined) {
    state.cameraFocalLength = Number(settings.focalLength ?? settings.cameraFocalLength);
  }
  if (settings.displaySize !== undefined || settings.cameraDisplaySize !== undefined) {
    state.cameraDisplaySize = Number(settings.displaySize ?? settings.cameraDisplaySize);
  }
  if (settings.dofEnabled !== undefined || settings.cameraDofEnabled !== undefined) {
    state.cameraDofEnabled = Boolean(settings.dofEnabled ?? settings.cameraDofEnabled);
  }
  if (settings.aperture !== undefined || settings.cameraAperture !== undefined) {
    state.cameraAperture = Number(settings.aperture ?? settings.cameraAperture);
  }
  if (settings.focusDistance !== undefined || settings.cameraFocusDistance !== undefined) {
    state.cameraFocusDistance = Number(settings.focusDistance ?? settings.cameraFocusDistance);
  }
  syncCameraSettingsFromState(updateUi);
  return getCameraSettings();
}

function getCameraSettings() {
  return {
    type: normalizeCameraType(state.cameraType),
    sensorWidth: state.cameraSensorWidth,
    focalLength: state.cameraFocalLength,
    displaySize: state.cameraDisplaySize,
    fov: camera.fov,
    dofEnabled: Boolean(state.cameraDofEnabled),
    aperture: state.cameraAperture,
    focusDistance: state.cameraFocusDistance
  };
}

function getExportResolution() {
  const width = Math.max(1, Math.round(Number(controlsUi.exportWidth?.value) || 1920));
  const height = Math.max(1, Math.round(Number(controlsUi.exportHeight?.value) || 1080));
  return {
    width,
    height,
    aspect: width / height
  };
}

function updateCameraPreviewLayout(force = false) {
  if (!cameraPreviewRenderer || !cameraPreviewUi.canvas || !cameraPreviewUi.root) {
    return null;
  }

  const { width, height, aspect } = getExportResolution();
  cameraPreviewUi.root.style.setProperty('--camera-preview-aspect', `${width} / ${height}`);
  if (cameraPreviewUi.info) {
    cameraPreviewUi.info.textContent = state.cameraType === 'panorama'
      ? `${width} x ${height} · 360°`
      : `${width} x ${height}`;
  }

  const viewWidth = Math.max(2, Math.round(cameraPreviewUi.canvas.clientWidth || 0));
  const viewHeight = Math.max(2, Math.round(cameraPreviewUi.canvas.clientHeight || viewWidth / aspect));
  const renderWidth = Math.max(2, Math.round(width));
  const renderHeight = Math.max(2, Math.round(height));
  const pixelRatio = 1;
  if (
    !force &&
    cameraPreviewLayoutCache &&
    cameraPreviewLayoutCache.width === viewWidth &&
    cameraPreviewLayoutCache.height === viewHeight &&
    cameraPreviewLayoutCache.renderWidth === renderWidth &&
    cameraPreviewLayoutCache.renderHeight === renderHeight &&
    cameraPreviewLayoutCache.aspect === aspect &&
    cameraPreviewLayoutCache.pixelRatio === pixelRatio
  ) {
    return cameraPreviewLayoutCache;
  }

  cameraPreviewRenderer.setPixelRatio(pixelRatio);
  cameraPreviewRenderer.setSize(renderWidth, renderHeight, false);
  resizePostTargetSet(cameraPreviewPostTargets, renderWidth, renderHeight);
  cameraPreviewLayoutCache = { width: viewWidth, height: viewHeight, renderWidth, renderHeight, aspect, pixelRatio };
  return cameraPreviewLayoutCache;
}

function setExportResolution(width, height, fps) {
  const safeWidth = THREE.MathUtils.clamp(Math.round(Number(width) || 1920), 128, 7680);
  const safeHeight = THREE.MathUtils.clamp(Math.round(Number(height) || 1080), 128, 4320);
  controlsUi.exportWidth.value = safeWidth;
  controlsUi.exportHeight.value = safeHeight;
  if (Number.isFinite(Number(fps))) {
    controlsUi.exportFps.value = THREE.MathUtils.clamp(Math.round(Number(fps)), 1, 60);
  }
  updateCameraPreviewLayout(true);
  setCameraPreviewDirty();
  return getExportResolution();
}

function getMainCameraViewLayout() {
  const { width: renderWidth, height: renderHeight, aspect } = getExportResolution();
  renderer.getSize(mainRendererSize);
  const canvasWidth = Math.max(2, Math.round(mainRendererSize.x || window.innerWidth || 2));
  const canvasHeight = Math.max(2, Math.round(mainRendererSize.y || window.innerHeight || 2));
  const canvasAspect = canvasWidth / Math.max(canvasHeight, 1);
  let width = canvasWidth;
  let height = canvasHeight;

  if (canvasAspect > aspect) {
    width = Math.max(2, Math.round(canvasHeight * aspect));
  } else {
    height = Math.max(2, Math.round(canvasWidth / aspect));
  }

  const x = Math.floor((canvasWidth - width) / 2);
  const y = Math.floor((canvasHeight - height) / 2);

  return {
    x,
    y,
    width,
    height,
    aspect,
    renderWidth: Math.max(2, Math.round(renderWidth)),
    renderHeight: Math.max(2, Math.round(renderHeight)),
    canvasWidth,
    canvasHeight
  };
}

function setCameraPreviewDirty() {
  cameraPreviewLastRender = -Infinity;
}

function readCameraPreviewVisible() {
  try {
    return window.localStorage?.getItem(CAMERA_PREVIEW_VISIBLE_STORAGE_KEY) !== '0';
  } catch {
    return true;
  }
}

function setCameraPreviewVisible(visible, persist = true) {
  cameraPreviewVisible = Boolean(visible);
  document.body.classList.toggle('camera-preview-hidden', !cameraPreviewVisible);
  if (cameraPreviewUi.root) {
    cameraPreviewUi.root.setAttribute('aria-hidden', cameraPreviewVisible ? 'false' : 'true');
  }
  if (cameraPreviewUi.hide) {
    cameraPreviewUi.hide.textContent = cameraPreviewVisible ? '隐藏' : '已隐藏';
    cameraPreviewUi.hide.setAttribute('aria-pressed', cameraPreviewVisible ? 'false' : 'true');
  }
  if (cameraPreviewUi.restore) {
    cameraPreviewUi.restore.setAttribute('aria-hidden', cameraPreviewVisible ? 'true' : 'false');
  }
  if (persist) {
    try {
      window.localStorage?.setItem(CAMERA_PREVIEW_VISIBLE_STORAGE_KEY, cameraPreviewVisible ? '1' : '0');
    } catch {
      // Preview visibility is a preference only.
    }
  }
  if (cameraPreviewVisible) {
    updateCameraPreviewLayout(true);
    setCameraPreviewDirty();
    renderCameraPreview(true);
  }
}

function restoreCameraPreviewVisibility() {
  setCameraPreviewVisible(readCameraPreviewVisible(), false);
}

function updateCameraViewButton() {
  cameraViewUi.toggle?.classList.toggle('active', cameraViewLocked);
  const label = cameraViewUi.toggle?.querySelector('span');
  if (label) {
    label.textContent = cameraViewLocked ? '退出视图' : '相机视图';
  }
  document.body.classList.toggle('camera-view-locked', cameraViewLocked);
}

function setCameraViewLocked(value) {
  cameraViewLocked = Boolean(value) && !exportSettings.hideUi;
  if (cameraViewLocked && cameraAnimation.keyframes.length) {
    applyTimelineAtTime(cameraAnimation.time, { updateUi: false });
  }
  updateCameraViewButton();
  setCameraPreviewDirty();
}

function copyCameraProjection(source, target, aspect) {
  target.zoom = source.zoom;
  target.filmGauge = state.cameraSensorWidth;
  target.filmOffset = source.filmOffset;
  target.focus = source.focus;
  target.near = THREE.MathUtils.clamp(Number(source.near) || CAMERA_DEFAULT_NEAR, CAMERA_DEFAULT_NEAR, 1);
  target.far = Math.max(Number(source.far) || CAMERA_DEFAULT_FAR, CAMERA_DEFAULT_FAR);
  target.aspect = Math.max(0.01, aspect);
  target.up.copy(source.up);
  target.setFocalLength(state.cameraFocalLength);
  target.updateProjectionMatrix();
}

function getTimelineCameraPose(time = cameraAnimation.time) {
  const keyframes = getSortedCameraKeyframes();
  if (!keyframes.length) {
    return null;
  }

  if (keyframes.length === 1) {
    return {
      position: new THREE.Vector3().fromArray(keyframes[0].position),
      quaternion: getKeyframeQuaternion(keyframes[0]),
      distance: getKeyframeDistance(keyframes[0])
    };
  }

  return {
    position: interpolateKeyframeVector(keyframes, time, 'position'),
    quaternion: interpolateKeyframeQuaternion(keyframes, time),
    distance: interpolateKeyframeDistance(keyframes, time)
  };
}

function configureOutputCamera(targetCamera, aspect, time = cameraAnimation.time) {
  copyCameraProjection(camera, targetCamera, aspect);
  const pose = getTimelineCameraPose(time);

  if (pose) {
    targetCamera.position.copy(pose.position);
    targetCamera.quaternion.copy(pose.quaternion).normalize();
  } else {
    targetCamera.position.copy(camera.position);
    targetCamera.quaternion.copy(camera.quaternion);
  }

  targetCamera.updateMatrixWorld(true);
  return targetCamera;
}

function configureCameraPreviewCamera(aspect) {
  return configureOutputCamera(cameraPreviewCamera, aspect, cameraAnimation.time);
}

function getCurrentCameraFocusDistance() {
  const timelinePose = getTimelineCameraPose(cameraAnimation.time);
  if (timelinePose?.distance && Number.isFinite(timelinePose.distance)) {
    return THREE.MathUtils.clamp(timelinePose.distance, 0.05, CAMERA_FOCUS_DISTANCE_MAX);
  }
  return THREE.MathUtils.clamp(camera.position.distanceTo(orbit.target), 0.05, CAMERA_FOCUS_DISTANCE_MAX);
}

function setEditorHelpersVisible(visible) {
  const previous = {
    path: cameraPathGroup.visible,
    lights: lightHandleGroup.visible,
    transform: transformControls.visible
  };

  cameraPathGroup.visible = visible && previous.path;
  lightHandleGroup.visible = visible && previous.lights;
  transformControls.visible = visible && previous.transform;

  return () => {
    cameraPathGroup.visible = previous.path;
    lightHandleGroup.visible = previous.lights;
    transformControls.visible = previous.transform;
  };
}

function renderCameraPreview(force = false) {
  if (!cameraPreviewRenderer || !cameraPreviewPostTargets || cameraPreviewContextLost) {
    return false;
  }
  if (!force && !cameraPreviewVisible) {
    return false;
  }

  const now = performance.now();
  if (!force && (orbitInteracting || now < cameraPreviewResumeAt)) {
    return false;
  }
  if (!force && now - cameraPreviewLastRender < CAMERA_PREVIEW_INTERVAL_MS) {
    return false;
  }
  cameraPreviewLastRender = now;

  const layout = updateCameraPreviewLayout(force);
  if (!layout) {
    return false;
  }

  const restoreHelpers = setEditorHelpersVisible(false);
  const previousTarget = renderer.getRenderTarget();
  const previousAutoClear = cameraPreviewRenderer.autoClear;
  const previousPreviewBackground = scene.background;
  const previousPreviewBackgroundIntensity = scene.backgroundIntensity;
  cameraPreviewRenderer.autoClear = true;
  cameraPreviewRenderer.toneMapping = renderer.toneMapping;
  cameraPreviewRenderer.toneMappingExposure = renderer.toneMappingExposure;

  try {
    const previewCamera = configureCameraPreviewCamera(layout.aspect);
    if (state.cameraType === 'panorama') {
      renderPanoramaFor(cameraPreviewRenderer, previewCamera, {
        outputTarget: null,
        transparent: false,
        width: layout.renderWidth,
        height: layout.renderHeight
      });
    } else {
      renderSceneWithGlowFor(
        cameraPreviewRenderer,
        previewCamera,
        cameraPreviewPostTargets,
        { outputTarget: null, transparent: false, dofEnabled: true }
      );
    }
  } finally {
    scene.background = previousPreviewBackground;
    scene.backgroundIntensity = previousPreviewBackgroundIntensity;
    cameraPreviewRenderer.autoClear = previousAutoClear;
    renderer.setRenderTarget(previousTarget);
    restoreHelpers();
  }
  return true;
}

function captureCameraSnapshot() {
  const drawing = currentDrawingBufferSize();
  const viewport = getMainCanvasCssSize();
  const exportResolution = getExportResolution();
  const snapshotCamera = configureCameraPreviewCamera(exportResolution.aspect);
  const timelinePose = getTimelineCameraPose(cameraAnimation.time);
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(snapshotCamera.quaternion).normalize();
  const target = timelinePose
    ? snapshotCamera.position.clone().addScaledVector(forward, timelinePose.distance)
    : orbit.target.clone();

  return {
    position: snapshotCamera.position.toArray(),
    target: target.toArray(),
    quaternion: snapshotCamera.quaternion.toArray(),
    fov: snapshotCamera.fov,
    focalLength: state.cameraFocalLength,
    filmGauge: state.cameraSensorWidth,
    displaySize: state.cameraDisplaySize,
    cameraType: state.cameraType,
    dofEnabled: state.cameraDofEnabled,
    aperture: state.cameraAperture,
    focusDistance: state.cameraFocusDistance,
    zoom: snapshotCamera.zoom,
    near: snapshotCamera.near,
    far: snapshotCamera.far,
    aspect: snapshotCamera.aspect,
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    drawingWidth: drawing.width,
    drawingHeight: drawing.height,
    exportWidth: exportResolution.width,
    exportHeight: exportResolution.height,
    exportAspect: exportResolution.aspect,
    cameraCurve: cameraAnimation.curve,
    cameraCurveStrength: cameraAnimation.curveStrength,
    time: cameraAnimation.time
  };
}

function applyCameraSnapshot(snapshot = {}, options = {}) {
  applyCameraProjectionSnapshot(snapshot);

  if (options.pose === false) {
    return;
  }

  if (!Array.isArray(snapshot.position) || snapshot.position.length < 3) {
    return;
  }

  const position = new THREE.Vector3().fromArray(snapshot.position.map(Number).slice(0, 3));
  const target = Array.isArray(snapshot.target) && snapshot.target.length >= 3
    ? new THREE.Vector3().fromArray(snapshot.target.map(Number).slice(0, 3))
    : orbit.target.clone();
  const quaternion = Array.isArray(snapshot.quaternion) && snapshot.quaternion.length >= 4
    ? new THREE.Quaternion().fromArray(snapshot.quaternion.map(Number).slice(0, 4))
    : getLookQuaternion(position, target);

  camera.position.copy(position);
  orbit.target.copy(target);
  orbit.update();

  if (quaternion.lengthSq() > 0.000001) {
    activeCameraQuaternion = quaternion.normalize();
    restoreActiveCameraQuaternion();
  } else {
    activeCameraQuaternion = null;
  }

  updateCameraPathVisibility();
}

function applyCameraProjectionSnapshot(snapshot = {}) {
  const sourceFov = Number(snapshot.fov);
  const sourceFocalLength = Number(snapshot.focalLength);
  const sourceFilmGauge = Number(snapshot.filmGauge ?? snapshot.sensorWidth);
  const sourceZoom = Number(snapshot.zoom);
  const sourceNear = Number(snapshot.near);
  const sourceFar = Number(snapshot.far);
  const outputAspect = getMainCanvasCssSize().aspect;

  if (Number.isFinite(sourceFilmGauge)) {
    state.cameraSensorWidth = THREE.MathUtils.clamp(sourceFilmGauge, 12, 70);
  }
  if (Number.isFinite(sourceFocalLength)) {
    state.cameraFocalLength = THREE.MathUtils.clamp(sourceFocalLength, 8, 300);
  } else if (Number.isFinite(sourceFov) && sourceFov > 1 && sourceFov < 160) {
    camera.fov = sourceFov;
    state.cameraFocalLength = camera.getFocalLength();
  }
  if (Number.isFinite(sourceZoom) && sourceZoom > 0.001 && sourceZoom < 1000) {
    camera.zoom = sourceZoom;
  }
  if (Number.isFinite(sourceNear) && sourceNear > 0 && sourceNear < camera.far) {
    camera.near = THREE.MathUtils.clamp(sourceNear, CAMERA_DEFAULT_NEAR, 1);
  }
  if (Number.isFinite(sourceFar) && sourceFar > camera.near) {
    camera.far = Math.max(sourceFar, CAMERA_DEFAULT_FAR);
  }

  if (snapshot.cameraType !== undefined || snapshot.type !== undefined) {
    state.cameraType = normalizeCameraType(snapshot.cameraType ?? snapshot.type);
  }
  if (snapshot.dofEnabled !== undefined) {
    state.cameraDofEnabled = Boolean(snapshot.dofEnabled);
  }
  if (Number.isFinite(Number(snapshot.aperture))) {
    state.cameraAperture = Number(snapshot.aperture);
  }
  if (Number.isFinite(Number(snapshot.focusDistance))) {
    state.cameraFocusDistance = Number(snapshot.focusDistance);
  } else if (Array.isArray(snapshot.position) && snapshot.position.length >= 3 && Array.isArray(snapshot.target) && snapshot.target.length >= 3) {
    const focusPosition = new THREE.Vector3().fromArray(snapshot.position.map(Number).slice(0, 3));
    const focusTarget = new THREE.Vector3().fromArray(snapshot.target.map(Number).slice(0, 3));
    state.cameraFocusDistance = focusPosition.distanceTo(focusTarget);
  }
  if (Number.isFinite(Number(snapshot.displaySize ?? snapshot.cameraDisplaySize))) {
    state.cameraDisplaySize = Number(snapshot.displaySize ?? snapshot.cameraDisplaySize);
  }

  camera.aspect = outputAspect;
  syncCameraSettingsFromState(true);
}

function addCameraKeyframe() {
  commitSelectedImageSplatTransform();
  commitSelectedLightTransform();
  const keyframe = {
    id: crypto.randomUUID(),
    time: Number(cameraAnimation.time.toFixed(3)),
    position: camera.position.toArray(),
    target: orbit.target.toArray(),
    quaternion: camera.quaternion.toArray()
  };
  const existingIndex = cameraAnimation.keyframes.findIndex(
    (item) => Math.abs(item.time - keyframe.time) < 0.035
  );

  if (existingIndex >= 0) {
    cameraAnimation.keyframes[existingIndex] = keyframe;
  } else {
    cameraAnimation.keyframes.push(keyframe);
  }

  cameraAnimation.keyframes.sort((a, b) => a.time - b.time);
  refreshCameraTimeline();
  selectCameraKeyframeHandle(keyframe.id, { frameIfTooClose: true });
  setCameraPreviewDirty();
}

function captureKeyframeOptions() {
  return {
    particleCount: state.particleCount,
    ...Object.fromEntries(NUMERIC_KEYFRAME_FIELDS.filter((field) => !CAMERA_KEYFRAME_FIELDS.has(field)).map((field) => [field, state[field]])),
    ...Object.fromEntries(COLOR_KEYFRAME_FIELDS.map((field) => [field, state[field]])),
    ...Object.fromEntries(BOOLEAN_KEYFRAME_FIELDS.filter((field) => !CAMERA_KEYFRAME_FIELDS.has(field)).map((field) => [field, state[field]])),
    effectMode: state.effectMode
  };
}

function captureParameterValue(field) {
  if (NUMERIC_KEYFRAME_FIELDS.includes(field)) {
    return Number(state[field]);
  }
  if (COLOR_KEYFRAME_FIELDS.includes(field)) {
    return state[field];
  }
  if (BOOLEAN_KEYFRAME_FIELDS.includes(field)) {
    return Boolean(state[field]);
  }
  if (STRING_KEYFRAME_FIELDS.includes(field)) {
    return String(state[field] ?? '');
  }
  return undefined;
}

function serializeParameterKeyframes() {
  return parameterKeyframes.map((keyframe) => ({
    id: keyframe.id,
    field: keyframe.field,
    time: Number(keyframe.time),
    value: keyframe.value
  }));
}

function normalizeParameterKeyframe(keyframe, index = 0) {
  if (!keyframe || !PARAMETER_KEYFRAME_FIELDS.includes(keyframe.field)) {
    return null;
  }

  const time = THREE.MathUtils.clamp(Number(keyframe.time) || 0, 0, cameraAnimation.duration);
  const value = keyframe.value;
  if (NUMERIC_KEYFRAME_FIELDS.includes(keyframe.field)) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
      return null;
    }
    return {
      id: keyframe.id || `param-${index}`,
      field: keyframe.field,
      time,
      value: normalizeNumericStateValue(keyframe.field, numericValue)
    };
  }

  if (COLOR_KEYFRAME_FIELDS.includes(keyframe.field) && typeof value === 'string') {
    return { id: keyframe.id || `param-${index}`, field: keyframe.field, time, value };
  }

  if (BOOLEAN_KEYFRAME_FIELDS.includes(keyframe.field)) {
    return { id: keyframe.id || `param-${index}`, field: keyframe.field, time, value: Boolean(value) };
  }

  return null;
}

function importParameterKeyframes(keyframes = []) {
  parameterKeyframes.length = 0;
  keyframes
    .map((keyframe, index) => normalizeParameterKeyframe(keyframe, index))
    .filter(Boolean)
    .sort((a, b) => a.time - b.time)
    .forEach((keyframe) => parameterKeyframes.push(keyframe));
  refreshCameraTimeline();
  updateParameterKeyframeButtons();
}

function addParameterKeyframe(field) {
  if (!PARAMETER_KEYFRAME_FIELDS.includes(field)) {
    return;
  }

  const value = captureParameterValue(field);
  if (value === undefined) {
    return;
  }

  const keyframe = {
    id: crypto.randomUUID(),
    field,
    time: Number(cameraAnimation.time.toFixed(3)),
    value
  };
  const existingIndex = parameterKeyframes.findIndex(
    (item) => item.field === field && Math.abs(item.time - keyframe.time) < 0.035
  );

  if (existingIndex >= 0) {
    parameterKeyframes[existingIndex] = { ...parameterKeyframes[existingIndex], ...keyframe };
  } else {
    parameterKeyframes.push(keyframe);
  }

  parameterKeyframes.sort((a, b) => a.time - b.time);
  refreshCameraTimeline();
  updateParameterKeyframeButtons();
  setStatus('Parameter keyed');
}

function getSortedParameterKeyframes(field = '') {
  return parameterKeyframes
    .filter((keyframe) => !field || keyframe.field === field)
    .sort((a, b) => a.time - b.time);
}

function getOptionKeyframesForField(field) {
  const parameterOptionKeyframes = getSortedParameterKeyframes(field).map((keyframe) => ({
    id: keyframe.id,
    time: keyframe.time,
    options: { [field]: keyframe.value },
    curve: cameraAnimation.curve,
    curveStrength: cameraAnimation.curveStrength
  }));

  return parameterOptionKeyframes.sort((a, b) => a.time - b.time);
}

function hasKeyframedOptions() {
  return parameterKeyframes.length > 0;
}

async function applyOptionsSnapshot(options = {}, updateUi = false) {
  if (options.glow !== undefined && options.glowExposure === undefined) {
    options.glowExposure = Number(options.glow);
  }

  let shouldRebuild = false;
  let animationStateChanged = false;
  let visibleModelNeedsSync = false;
  if (options.particleCount !== undefined) {
    const particleCount = Math.max(MIN_PARTICLE_COUNT, Math.round(Number(options.particleCount) || state.particleCount));
    shouldRebuild = particleCount !== state.particleCount;
    state.particleCount = particleCount;
  }

  NUMERIC_KEYFRAME_FIELDS.forEach((field) => {
    if (options[field] !== undefined) {
      const value = Number(options[field]);
      if (Number.isFinite(value)) {
        const previousValue = state[field];
        if (field === 'emissionCount' || field === 'imageSplatCount') {
          const count = Math.max(MIN_PARTICLE_COUNT, Math.round(value));
          shouldRebuild = shouldRebuild || count !== state[field];
          state[field] = count;
        } else {
          state[field] = normalizeNumericStateValue(field, value);
        }
        if (field.startsWith('modelAnim')) {
          animationStateChanged = true;
        }
        if (VISIBLE_MODEL_MATERIAL_FIELDS.has(field)) {
          visibleModelNeedsSync = true;
        }
        if (REBUILD_NUMERIC_FIELDS.has(field) && state[field] !== previousValue) {
          shouldRebuild = true;
        }
      }
    }
  });

  COLOR_KEYFRAME_FIELDS.forEach((field) => {
    if (typeof options[field] === 'string') {
      state[field] = options[field];
    }
  });

  BOOLEAN_KEYFRAME_FIELDS.forEach((field) => {
    if (options[field] !== undefined) {
      state[field] = Boolean(options[field]);
      if (field.startsWith('modelAnim')) {
        animationStateChanged = true;
      }
      if (field === 'useTexture') {
        visibleModelNeedsSync = true;
      }
    }
  });

  STRING_KEYFRAME_FIELDS.forEach((field) => {
    if (typeof options[field] === 'string') {
      const nextValue = field === 'effectMode'
        ? (VALID_EFFECT_MODES.has(options[field]) ? options[field] : 'particles')
        : normalizeCameraType(options[field]);
      visibleModelNeedsSync = visibleModelNeedsSync || state[field] !== nextValue;
      state[field] = nextValue;
    }
  });

  syncUniforms();
  syncCameraSettingsFromState(updateUi);
  if (visibleModelNeedsSync) {
    updateVisibleModelMaterials();
    syncEffectVisibility();
  }
  if (animationStateChanged) {
    modelAnimation.lastPoseTime = Number.NaN;
    modelAnimation.lastGeometryMode = '';
  }
  applyModelAnimationPose(getModelAnimationSeconds(0, false), { force: animationStateChanged });
  if (selectedImageSplat) {
    syncTransformProxyFromImageSplat();
  }
  if (updateUi) {
    syncUi();
  }

  if (shouldRebuild) {
    if (state.effectMode === 'image' && imageSplatSource) {
      await buildImageSplatObject(imageSplatSource, currentLabel);
    } else if (state.effectMode !== 'image') {
      await buildParticles(currentSource, currentLabel);
    }
    syncEffectVisibility();
  }
  syncSelectedSceneModelRecord({ renderList: options.effectMode !== undefined });
}

function clearCameraKeyframes() {
  cameraAnimation.keyframes = [];
  parameterKeyframes.length = 0;
  selectedKeyframeId = null;
  selectedKeyframeObject = null;
  selectedCameraBezierHandle = null;
  if (selectedImageSplat) {
    selectImageSplatObject();
  } else {
    transformControls.detach();
    transformControls.visible = false;
  }
  cameraAnimation.playing = false;
  activeCameraQuaternion = null;
  updatePlayButton();
  syncCameraCurveUi();
  refreshCameraTimeline();
  setCameraPreviewDirty();
}

function setCameraTime(value, applyCamera = true) {
  cameraAnimation.time = THREE.MathUtils.clamp(value, 0, cameraAnimation.duration);
  controlsUi.timeline.value = cameraAnimation.time;
  outputUi.timeline.value = `${cameraAnimation.time.toFixed(2)}s`;

  if (applyCamera && (cameraAnimation.keyframes.length || parameterKeyframes.length)) {
    applyTimelineAtTime(cameraAnimation.time, { updateUi: true });
  }
  setCameraPreviewDirty();
  updateParameterKeyframeButtons();
}

function setCameraDuration(value) {
  cameraAnimation.duration = THREE.MathUtils.clamp(Number(value) || 5, 0.25, 120);
  controlsUi.duration.value = cameraAnimation.duration;
  controlsUi.timeline.max = cameraAnimation.duration;
  cameraAnimation.keyframes.forEach((keyframe) => {
    keyframe.time = THREE.MathUtils.clamp(keyframe.time, 0, cameraAnimation.duration);
  });
  setCameraTime(Math.min(cameraAnimation.time, cameraAnimation.duration), false);
  refreshCameraTimeline();
}

function normalizeCameraCurve(value) {
  return VALID_CAMERA_CURVES.has(value) ? value : 'easeInOut';
}

function normalizeCameraCurveStrength(value) {
  const number = Number(value);
  return THREE.MathUtils.clamp(Number.isFinite(number) ? number : 2, 0.25, 6);
}

function normalizeCameraPathMode(value) {
  return VALID_CAMERA_PATH_MODES.has(value) ? value : 'linear';
}

function getSelectedCameraKeyframe() {
  return selectedKeyframeId
    ? cameraAnimation.keyframes.find((item) => item.id === selectedKeyframeId) || null
    : null;
}

function syncCameraCurveUi() {
  const selectedKeyframe = getSelectedCameraKeyframe();
  const curve = normalizeCameraCurve(selectedKeyframe?.curve ?? cameraAnimation.curve);
  const strength = normalizeCameraCurveStrength(selectedKeyframe?.curveStrength ?? cameraAnimation.curveStrength);
  if (controlsUi.cameraPathMode) {
    controlsUi.cameraPathMode.value = normalizeCameraPathMode(cameraAnimation.pathMode);
  }
  if (controlsUi.cameraCurve) {
    controlsUi.cameraCurve.value = curve;
  }
  if (controlsUi.cameraCurveStrength) {
    controlsUi.cameraCurveStrength.value = strength.toFixed(2);
  }
}

function setCameraPathMode(value) {
  cameraAnimation.pathMode = normalizeCameraPathMode(value);
  syncCameraCurveUi();
  rebuildCameraPath();
  if (cameraAnimation.keyframes.length) {
    applyTimelineAtTime(cameraAnimation.time, { updateUi: false });
  }
  setCameraPreviewDirty();
  return cameraAnimation.pathMode;
}

function setCameraCurve(curveValue, strengthValue, options = {}) {
  const curve = normalizeCameraCurve(curveValue);
  const strength = normalizeCameraCurveStrength(strengthValue);
  cameraAnimation.curve = curve;
  cameraAnimation.curveStrength = strength;

  const selectedKeyframe = getSelectedCameraKeyframe();
  if (selectedKeyframe && options.applyToSelected !== false) {
    selectedKeyframe.curve = curve;
    selectedKeyframe.curveStrength = strength;
  }

  syncCameraCurveUi();
  rebuildCameraPath();
  if (cameraAnimation.keyframes.length) {
    applyTimelineAtTime(cameraAnimation.time, { updateUi: false });
  }
}

function toggleTimelinePlayback() {
  cameraAnimation.playing = !cameraAnimation.playing;
  updatePlayButton();
}

function updatePlayButton() {
  controlsUi.playTimeline.querySelector('span').textContent = cameraAnimation.playing ? '暂停' : '播放';
}

function applyTimelineAtTime(time, options = {}) {
  const { updateUi = false } = options;
  applyCameraAtTime(time);
  applyKeyframedOptionsAtTime(time, updateUi);
  applyKeyframedLightsAtTime(time, updateUi);
}

function applyCameraAtTime(time) {
  const keyframes = getSortedCameraKeyframes();

  if (!keyframes.length) {
    return;
  }

  if (keyframes.length === 1) {
    applyCameraPose(
      new THREE.Vector3().fromArray(keyframes[0].position),
      getKeyframeQuaternion(keyframes[0]),
      getKeyframeDistance(keyframes[0])
    );
    return;
  }

  const position = interpolateKeyframeVector(keyframes, time, 'position');
  const quaternion = interpolateKeyframeQuaternion(keyframes, time);
  const distance = interpolateKeyframeDistance(keyframes, time);
  applyCameraPose(position, quaternion, distance);
}

function applyCameraPose(position, quaternion, distance = 4) {
  camera.position.copy(position);
  activeCameraQuaternion = quaternion.clone().normalize();
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(activeCameraQuaternion).normalize();
  orbit.target.copy(position.clone().addScaledVector(forward, Math.max(distance, 0.05)));
  orbit.update();
  restoreActiveCameraQuaternion();
  updateCameraPathVisibility();
}

function restoreActiveCameraQuaternion() {
  if (!activeCameraQuaternion) {
    return;
  }

  camera.quaternion.copy(activeCameraQuaternion);
  camera.updateMatrixWorld(true);
}

function applyKeyframedOptionsAtTime(time, updateUi = false) {
  if (!hasKeyframedOptions()) {
    return;
  }

  const previousAnimProgress = state.modelAnimProgress;
  const previousAnimEnabled = state.modelAnimEnabled;
  const previousAnimPlaying = state.modelAnimPlaying;
  const previousParticleize = state.particleizeProgress;
  const previousDissolve = state.dissolve;
  const previousModelWhite = state.modelWhite;
  const previousModelRoughness = state.modelRoughness;
  const previousEffectMode = state.effectMode;
  const previousUseTexture = state.useTexture;

  NUMERIC_KEYFRAME_FIELDS.forEach((field) => {
    const keyframes = getOptionKeyframesForField(field);
    if (!keyframes.length) {
      return;
    }
    state[field] = interpolateOptionNumber(keyframes, time, field);
  });

  COLOR_KEYFRAME_FIELDS.forEach((field) => {
    const keyframes = getOptionKeyframesForField(field);
    if (!keyframes.length) {
      return;
    }
    state[field] = interpolateOptionColor(keyframes, time, field);
  });

  BOOLEAN_KEYFRAME_FIELDS.forEach((field) => {
    const keyframes = getOptionKeyframesForField(field);
    if (!keyframes.length) {
      return;
    }
    state[field] = pickOptionValue(keyframes, time, field);
  });

  STRING_KEYFRAME_FIELDS.forEach((field) => {
    const keyframes = getOptionKeyframesForField(field);
    if (!keyframes.length) {
      return;
    }
    const value = pickOptionValue(keyframes, time, field);
    if (value !== undefined) {
      state[field] = field === 'effectMode'
        ? (VALID_EFFECT_MODES.has(value) ? value : 'particles')
        : normalizeCameraType(value);
    }
  });

  syncUniforms();
  syncCameraSettingsFromState(updateUi);
  const animationStateChanged =
    previousAnimProgress !== state.modelAnimProgress ||
    previousAnimEnabled !== state.modelAnimEnabled ||
    previousAnimPlaying !== state.modelAnimPlaying;
  if (animationStateChanged) {
    modelAnimation.lastPoseTime = Number.NaN;
    modelAnimation.lastGeometryMode = '';
    applyModelAnimationPose(getModelAnimationSeconds(0, false), { force: true });
  }
  const visibleModelStateChanged =
    previousParticleize !== state.particleizeProgress ||
    previousDissolve !== state.dissolve ||
    previousModelWhite !== state.modelWhite ||
    previousModelRoughness !== state.modelRoughness ||
    previousEffectMode !== state.effectMode ||
    previousUseTexture !== state.useTexture;
  if (visibleModelStateChanged) {
    updateVisibleModelMaterials();
    syncEffectVisibility();
  }
  if (updateUi) {
    syncUi();
  }
}

function applyKeyframedLightsAtTime(time, updateUi = false) {
  const keyframes = getSortedCameraKeyframes().filter((keyframe) => Array.isArray(keyframe.lights));
  if (!keyframes.length) {
    return;
  }

  const lights = interpolateLightKeyframes(keyframes, time);
  applySceneLightSnapshots(lights, { updateUi });
  if (updateUi) {
    syncUi();
  }
}

function interpolateLightKeyframes(keyframes, time) {
  if (time <= keyframes[0].time) {
    return keyframes[0].lights.map(cloneLightSnapshot);
  }

  const last = keyframes[keyframes.length - 1];
  if (time >= last.time) {
    return last.lights.map(cloneLightSnapshot);
  }

  const [start, end] = getOptionSegment(keyframes, time);
  const t = getCameraSegmentT(start, end, time);
  const startLights = Array.isArray(start.lights) ? start.lights : [];
  const endLights = Array.isArray(end.lights) ? end.lights : [];
  const orderedIds = [
    ...startLights.map((light) => light.id),
    ...endLights.map((light) => light.id).filter((id) => !startLights.some((light) => light.id === id))
  ];

  return orderedIds
    .map((id, index) => {
      const startLight = startLights.find((light) => light.id === id);
      const endLight = endLights.find((light) => light.id === id);
      if (!startLight || !endLight) {
        return cloneLightSnapshot(t < 0.5 ? startLight || endLight : endLight || startLight);
      }
      return interpolateLightSnapshot(startLight, endLight, t, index);
    })
    .filter(Boolean);
}

function interpolateLightSnapshot(startLight, endLight, t, index = 0) {
  const start = normalizeLightSnapshot(startLight, index);
  const end = normalizeLightSnapshot(endLight, index);
  const sameType = start.type === end.type;
  const color = new THREE.Color(start.color).lerp(new THREE.Color(end.color), t);
  const position = new THREE.Vector3().fromArray(start.position).lerp(new THREE.Vector3().fromArray(end.position), t);
  const quaternion = new THREE.Quaternion()
    .fromArray(start.quaternion)
    .slerp(new THREE.Quaternion().fromArray(end.quaternion).normalize(), t)
    .normalize();

  return {
    id: start.id,
    isDefault: t < 0.5 ? start.isDefault : end.isDefault,
    type: sameType ? start.type : t < 0.5 ? start.type : end.type,
    name: t < 0.5 ? start.name : end.name,
    color: `#${color.getHexString()}`,
    intensity: THREE.MathUtils.lerp(start.intensity, end.intensity, t),
    size: THREE.MathUtils.lerp(start.size, end.size, t),
    position: position.toArray(),
    quaternion: quaternion.toArray()
  };
}

function interpolateOptionNumber(keyframes, time, field) {
  const firstValue = keyframes[0].options[field] ?? state[field] ?? 0;
  if (time <= keyframes[0].time) {
    return Number(firstValue);
  }

  const last = keyframes[keyframes.length - 1];
  if (time >= last.time) {
    return Number(last.options[field] ?? firstValue);
  }

  const [start, end] = getOptionSegment(keyframes, time);
  const t = THREE.MathUtils.smoothstep((time - start.time) / Math.max(end.time - start.time, 0.0001), 0, 1);
  const startValue = Number(start.options[field] ?? firstValue);
  const endValue = Number(end.options[field] ?? startValue);
  return THREE.MathUtils.lerp(startValue, endValue, t);
}

function interpolateOptionColor(keyframes, time, field) {
  const startColor = new THREE.Color(pickOptionValue(keyframes, time, field) || state[field] || '#ffffff');

  if (time <= keyframes[0].time || time >= keyframes[keyframes.length - 1].time) {
    return `#${startColor.getHexString()}`;
  }

  const [start, end] = getOptionSegment(keyframes, time);
  const t = THREE.MathUtils.smoothstep((time - start.time) / Math.max(end.time - start.time, 0.0001), 0, 1);
  const color = new THREE.Color(start.options[field] || state[field] || '#ffffff')
    .lerp(new THREE.Color(end.options[field] || start.options[field] || state[field] || '#ffffff'), t);
  return `#${color.getHexString()}`;
}

function pickOptionValue(keyframes, time, field) {
  let value = keyframes[0].options[field] ?? state[field];
  for (const keyframe of keyframes) {
    if (time >= keyframe.time && keyframe.options[field] !== undefined) {
      value = keyframe.options[field];
    }
  }
  return value;
}

function getOptionSegment(keyframes, time) {
  for (let index = 0; index < keyframes.length - 1; index += 1) {
    if (time >= keyframes[index].time && time <= keyframes[index + 1].time) {
      return [keyframes[index], keyframes[index + 1]];
    }
  }
  return [keyframes[0], keyframes[keyframes.length - 1]];
}

function getCameraSegmentT(start, end, time) {
  const rawT = (time - start.time) / Math.max(end.time - start.time, 0.0001);
  return applyCameraCurve(rawT, start);
}

function applyCameraCurve(rawT, startKeyframe = null) {
  const t = THREE.MathUtils.clamp(rawT, 0, 1);
  const curve = normalizeCameraCurve(startKeyframe?.curve ?? cameraAnimation.curve);
  const power = normalizeCameraCurveStrength(startKeyframe?.curveStrength ?? cameraAnimation.curveStrength);

  if (curve === 'linear') {
    return t;
  }
  if (curve === 'hold') {
    return t >= 1 ? 1 : 0;
  }
  if (curve === 'easeIn') {
    return Math.pow(t, power);
  }
  if (curve === 'easeOut') {
    return 1 - Math.pow(1 - t, power);
  }

  if (t < 0.5) {
    return 0.5 * Math.pow(t * 2, power);
  }
  return 1 - 0.5 * Math.pow((1 - t) * 2, power);
}

function interpolateKeyframeVector(keyframes, time, property) {
  if (time <= keyframes[0].time) {
    return new THREE.Vector3().fromArray(keyframes[0][property]);
  }

  const last = keyframes[keyframes.length - 1];
  if (time >= last.time) {
    return new THREE.Vector3().fromArray(last[property]);
  }

  let segmentIndex = 0;
  for (let index = 0; index < keyframes.length - 1; index += 1) {
    if (time >= keyframes[index].time && time <= keyframes[index + 1].time) {
      segmentIndex = index;
      break;
    }
  }

  const p1 = new THREE.Vector3().fromArray(keyframes[segmentIndex][property]);
  const p2 = new THREE.Vector3().fromArray(keyframes[segmentIndex + 1][property]);
  const startTime = keyframes[segmentIndex].time;
  const endTime = keyframes[segmentIndex + 1].time;
  const t = applyCameraCurve((time - startTime) / Math.max(endTime - startTime, 0.0001), keyframes[segmentIndex]);
  const pathMode = normalizeCameraPathMode(cameraAnimation.pathMode);
  if (property === 'position' && pathMode === 'bezier') {
    const c1 = p1.clone().add(getCameraBezierHandleOffset(keyframes, segmentIndex, 'out'));
    const c2 = p2.clone().add(getCameraBezierHandleOffset(keyframes, segmentIndex + 1, 'in'));
    return cubicBezier(p1, c1, c2, p2, t);
  }
  if (property === 'position' && pathMode === 'smooth') {
    const p0 = new THREE.Vector3().fromArray(keyframes[Math.max(0, segmentIndex - 1)][property]);
    const p3 = new THREE.Vector3().fromArray(keyframes[Math.min(keyframes.length - 1, segmentIndex + 2)][property]);
    return catmullRom(p0, p1, p2, p3, t);
  }
  return p1.lerp(p2, t);
}

function interpolateKeyframeQuaternion(keyframes, time) {
  if (time <= keyframes[0].time) {
    return getKeyframeQuaternion(keyframes[0]);
  }

  const last = keyframes[keyframes.length - 1];
  if (time >= last.time) {
    return getKeyframeQuaternion(last);
  }

  const [start, end] = getOptionSegment(keyframes, time);
  const t = getCameraSegmentT(start, end, time);
  return getKeyframeQuaternion(start).slerp(getKeyframeQuaternion(end), t).normalize();
}

function interpolateKeyframeDistance(keyframes, time) {
  if (time <= keyframes[0].time) {
    return getKeyframeDistance(keyframes[0]);
  }

  const last = keyframes[keyframes.length - 1];
  if (time >= last.time) {
    return getKeyframeDistance(last);
  }

  const [start, end] = getOptionSegment(keyframes, time);
  const t = getCameraSegmentT(start, end, time);
  return THREE.MathUtils.lerp(getKeyframeDistance(start), getKeyframeDistance(end), t);
}

function getKeyframeQuaternion(keyframe) {
  if (Array.isArray(keyframe.quaternion) && keyframe.quaternion.length >= 4) {
    const values = keyframe.quaternion.slice(0, 4).map(Number);
    if (values.every(Number.isFinite)) {
      const quaternion = new THREE.Quaternion().fromArray(values);
      if (quaternion.lengthSq() > 0.000001) {
        return quaternion.normalize();
      }
    }
  }

  const position = new THREE.Vector3().fromArray(keyframe.position);
  const target = new THREE.Vector3().fromArray(keyframe.target);
  return getLookQuaternion(position, target);
}

function getKeyframeDistance(keyframe) {
  const position = new THREE.Vector3().fromArray(keyframe.position);
  const target = new THREE.Vector3().fromArray(keyframe.target);
  const distance = position.distanceTo(target);
  return Number.isFinite(distance) && distance > 0.05 ? distance : 4;
}

function getKeyframeForward(keyframe) {
  return new THREE.Vector3(0, 0, -1).applyQuaternion(getKeyframeQuaternion(keyframe)).normalize();
}

function getVector3Array(value) {
  if (!Array.isArray(value) || value.length < 3) {
    return null;
  }
  const values = value.slice(0, 3).map(Number);
  return values.every(Number.isFinite) ? values : null;
}

function getCameraBezierHandleOffset(keyframes, index, type) {
  const keyframe = keyframes[index];
  const saved = getVector3Array(type === 'in' ? keyframe?.handleIn : keyframe?.handleOut);
  if (saved) {
    return new THREE.Vector3().fromArray(saved);
  }

  const position = new THREE.Vector3().fromArray(keyframe.position);
  if (type === 'out') {
    const next = keyframes[index + 1];
    const previous = keyframes[index - 1];
    if (next) {
      return new THREE.Vector3().fromArray(next.position).sub(position).multiplyScalar(1 / 3);
    }
    if (previous) {
      return position.clone().sub(new THREE.Vector3().fromArray(previous.position)).multiplyScalar(1 / 3);
    }
  } else {
    const previous = keyframes[index - 1];
    const next = keyframes[index + 1];
    if (previous) {
      return new THREE.Vector3().fromArray(previous.position).sub(position).multiplyScalar(1 / 3);
    }
    if (next) {
      return position.clone().sub(new THREE.Vector3().fromArray(next.position)).multiplyScalar(1 / 3);
    }
  }
  return new THREE.Vector3();
}

function cubicBezier(p0, c1, c2, p3, t) {
  const u = 1 - t;
  return new THREE.Vector3()
    .addScaledVector(p0, u * u * u)
    .addScaledVector(c1, 3 * u * u * t)
    .addScaledVector(c2, 3 * u * t * t)
    .addScaledVector(p3, t * t * t);
}

function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return new THREE.Vector3(
    0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
    0.5 * (2 * p1.z + (-p0.z + p2.z) * t + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3)
  );
}

function refreshCameraTimeline() {
  controlsUi.keyframeCount.value = String(cameraAnimation.keyframes.length + parameterKeyframes.length);
  controlsUi.timelineMarkers.innerHTML = '';

  getSortedCameraKeyframes().forEach((keyframe) => {
    const marker = document.createElement('span');
    marker.className = 'timeline-marker';
    marker.style.left = `${(keyframe.time / cameraAnimation.duration) * 100}%`;
    controlsUi.timelineMarkers.append(marker);
  });
  [...new Set(parameterKeyframes.map((keyframe) => Number(keyframe.time.toFixed(3))))].forEach((time) => {
    const nearCameraMarker = cameraAnimation.keyframes.some((keyframe) => Math.abs(keyframe.time - time) < 0.035);
    if (nearCameraMarker) {
      return;
    }
    const marker = document.createElement('span');
    marker.className = 'timeline-marker parameter-marker';
    marker.style.left = `${(time / cameraAnimation.duration) * 100}%`;
    controlsUi.timelineMarkers.append(marker);
  });
  updateParameterKeyframeButtons();

  rebuildCameraPath();
}

function rebuildCameraPath() {
  cameraPathGroup.clear();
  const keyframes = getSortedCameraKeyframes();

  if (!keyframes.length) {
    transformControls.detach();
    transformControls.visible = false;
    updateCameraPathVisibility();
    return;
  }

  if (keyframes.length >= 2) {
    const samples = [];
    const sampleCount = 96;
    for (let index = 0; index <= sampleCount; index += 1) {
      const time = (index / sampleCount) * cameraAnimation.duration;
      samples.push(interpolateKeyframeVector(keyframes, time, 'position'));
    }

    const pathGeometry = new THREE.BufferGeometry().setFromPoints(samples);
    const pathMaterial = new THREE.LineBasicMaterial({
      color: 0xffbf36,
      transparent: true,
      opacity: 0.95,
      depthTest: false
    });
    const pathLine = new THREE.Line(pathGeometry, pathMaterial);
    pathLine.userData.cameraPathLine = true;
    cameraPathGroup.add(pathLine);
  }

  keyframes.forEach((keyframe, index) => {
    const position = new THREE.Vector3().fromArray(keyframe.position);
    const target = new THREE.Vector3().fromArray(keyframe.target);
    const marker = createCameraMarker(index, keyframe, position, target);
    cameraPathGroup.add(marker);
  });
  if (normalizeCameraPathMode(cameraAnimation.pathMode) === 'bezier' && keyframes.length >= 2) {
    keyframes.forEach((keyframe, index) => {
      const handles = createCameraBezierHandles(index, keyframe, keyframes);
      if (handles) {
        cameraPathGroup.add(handles);
      }
    });
  }
  if (selectedKeyframeId) {
    if (
      selectedCameraBezierHandle &&
      normalizeCameraPathMode(cameraAnimation.pathMode) === 'bezier' &&
      selectCameraBezierHandle(selectedCameraBezierHandle.keyframeId, selectedCameraBezierHandle.type)
    ) {
      updateCameraPathVisibility();
      return;
    }
    selectedCameraBezierHandle = null;
    selectCameraKeyframeHandle(selectedKeyframeId, { preserveTimeline: true });
  }
  updateCameraPathVisibility();
}

function updateCameraPathVisibility() {
  if (exportSettings.hideUi) {
    cameraPathGroup.visible = false;
    return;
  }

  if (activeCameraQuaternion) {
    restoreActiveCameraQuaternion();
  }

  const keyframes = getSortedCameraKeyframes();
  if (!keyframes.length) {
    cameraPathGroup.visible = false;
    return;
  }
  cameraPathGroup.visible = true;
}

function createCameraMarker(index, keyframe, position, target) {
  const group = new THREE.Group();
  group.name = `Camera Keyframe ${index + 1}`;
  group.position.copy(position);
  group.quaternion.copy(getKeyframeQuaternion(keyframe));
  group.userData.keyframeId = keyframe.id;
  group.userData.keyframeHandle = true;
  group.scale.setScalar(state.cameraDisplaySize);

  const color = selectedKeyframeId === keyframe.id ? 0xffffff : index === 0 ? 0x00f0ff : 0xffbf36;
  const lineMaterial = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity: 0.96,
    depthTest: false
  });
  const bodyMaterial = new THREE.MeshBasicMaterial({
    color,
    wireframe: true,
    transparent: true,
    opacity: 0.9,
    depthTest: false
  });

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.23, 0.26), bodyMaterial);
  body.userData.keyframeId = keyframe.id;
  body.userData.keyframeHandle = true;
  group.add(body);

  const lens = new THREE.Mesh(
    new THREE.SphereGeometry(0.13, 16, 16),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.68,
      depthTest: false
    })
  );
  lens.userData.keyframeId = keyframe.id;
  lens.userData.keyframeHandle = true;
  group.add(lens);

  const pickVolume = new THREE.Mesh(
    new THREE.SphereGeometry(0.52, 18, 12),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false
    })
  );
  pickVolume.name = 'Camera Keyframe Pick Volume';
  pickVolume.userData.keyframeId = keyframe.id;
  pickVolume.userData.keyframeHandle = true;
  pickVolume.userData.editorPickVolume = true;
  group.add(pickVolume);

  const z = -0.78;
  const halfW = 0.55;
  const halfH = 0.36;
  const corners = [
    new THREE.Vector3(-halfW, -halfH, z),
    new THREE.Vector3(halfW, -halfH, z),
    new THREE.Vector3(halfW, halfH, z),
    new THREE.Vector3(-halfW, halfH, z)
  ];
  const framePoints = [
    corners[0],
    corners[1],
    corners[1],
    corners[2],
    corners[2],
    corners[3],
    corners[3],
    corners[0],
    new THREE.Vector3(0, 0, 0),
    corners[0],
    new THREE.Vector3(0, 0, 0),
    corners[1],
    new THREE.Vector3(0, 0, 0),
    corners[2],
    new THREE.Vector3(0, 0, 0),
    corners[3]
  ];
  const frame = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(framePoints), lineMaterial);
  frame.userData.keyframeId = keyframe.id;
  frame.userData.keyframeHandle = true;
  group.add(frame);

  const viewLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -0.9)]),
    new THREE.LineDashedMaterial({
      color: 0x6ffcf6,
      dashSize: 0.07,
      gapSize: 0.06,
      transparent: true,
      opacity: 0.62,
      depthTest: false
    })
  );
  viewLine.computeLineDistances();
  viewLine.userData.keyframeId = keyframe.id;
  viewLine.userData.keyframeHandle = true;
  group.add(viewLine);

  const upShape = new THREE.Shape([
    new THREE.Vector2(0, 0.14),
    new THREE.Vector2(-0.11, -0.08),
    new THREE.Vector2(0.11, -0.08)
  ]);
  const upArrow = new THREE.Mesh(
    new THREE.ShapeGeometry(upShape),
    new THREE.MeshBasicMaterial({
      color: 0xffa629,
      transparent: true,
      opacity: 0.95,
      side: THREE.DoubleSide,
      depthTest: false
    })
  );
  upArrow.position.set(0, halfH + 0.18, z + 0.28);
  upArrow.userData.keyframeId = keyframe.id;
  upArrow.userData.keyframeHandle = true;
  group.add(upArrow);

  return group;
}

function createCameraBezierHandles(index, keyframe, keyframes) {
  const position = new THREE.Vector3().fromArray(keyframe.position);
  const group = new THREE.Group();
  group.name = `Camera Bezier Handles ${index + 1}`;
  group.userData.cameraBezierHandleGroup = true;
  group.userData.keyframeId = keyframe.id;

  if (index > 0) {
    group.add(createCameraBezierHandle(keyframe, position, getCameraBezierHandleOffset(keyframes, index, 'in'), 'in'));
  }
  if (index < keyframes.length - 1) {
    group.add(createCameraBezierHandle(keyframe, position, getCameraBezierHandleOffset(keyframes, index, 'out'), 'out'));
  }

  return group.children.length ? group : null;
}

function createCameraBezierHandle(keyframe, position, offset, type) {
  const world = position.clone().add(offset);
  const color = type === 'out' ? 0x2de1ea : 0xffbf36;
  const selected = selectedCameraBezierHandle?.keyframeId === keyframe.id && selectedCameraBezierHandle?.type === type;
  const group = new THREE.Group();
  group.name = `Camera ${type === 'out' ? 'Out' : 'In'} Bezier Handle`;
  group.userData.cameraBezierHandleGroup = true;
  group.userData.keyframeId = keyframe.id;
  group.userData.handleType = type;

  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([position, world]),
    new THREE.LineDashedMaterial({
      color,
      dashSize: 0.08,
      gapSize: 0.06,
      transparent: true,
      opacity: selected ? 0.98 : 0.74,
      depthTest: false
    })
  );
  line.computeLineDistances();
  line.userData.cameraBezierTangent = true;
  line.userData.keyframeId = keyframe.id;
  line.userData.handleType = type;
  group.add(line);

  const handle = new THREE.Mesh(
    new THREE.SphereGeometry(selected ? 0.2 : 0.16, 24, 16),
    new THREE.MeshBasicMaterial({
      color: selected ? 0xffffff : color,
      transparent: true,
      opacity: 0.96,
      depthTest: false
    })
  );
  handle.position.copy(world);
  handle.userData.cameraBezierHandle = true;
  handle.userData.keyframeId = keyframe.id;
  handle.userData.handleType = type;
  group.add(handle);

  const pickProxy = new THREE.Mesh(
    new THREE.SphereGeometry(selected ? 0.52 : 0.44, 16, 12),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false
    })
  );
  pickProxy.position.copy(world);
  pickProxy.renderOrder = 999;
  pickProxy.userData.cameraBezierHandle = true;
  pickProxy.userData.cameraBezierPickProxy = true;
  pickProxy.userData.keyframeId = keyframe.id;
  pickProxy.userData.handleType = type;
  group.add(pickProxy);

  return group;
}

function updateCameraMarkerDisplaySize() {
  if (!cameraPathGroup) {
    return;
  }
  const size = THREE.MathUtils.clamp(Number(state.cameraDisplaySize) || 1, 0.2, 5);
  cameraPathGroup.children.forEach((child) => {
    if (child.userData.keyframeHandle) {
      child.scale.setScalar(size);
    }
  });
  if (selectedKeyframeId && selectedTransformProxy) {
    selectedTransformProxy.scale.setScalar(size);
    selectedTransformProxy.updateMatrixWorld(true);
  }
}

function handlePathPointerDown(event) {
  if (exportSettings.hideUi || event.button !== 0 || transformControls.dragging) {
    return;
  }

  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const transformHit = isTransformControlPointerHit();
  if (transformHit) {
    // A camera/light gizmo can project across the model and otherwise trap the
    // selection on the gizmo. When another object type is active, let a real
    // model surface hit switch the selection; the gizmo still wins everywhere
    // else and always wins while a model transform is already active.
    const canSwitchToModel = Boolean(selectedKeyframeId || selectedLightId || selectedImageSplat || selectedVideoPlaneId);
    const modelIdBehindTransform = canSwitchToModel
      ? findSceneModelIdFromPointerHit({ includeActive: true })
      : null;
    if (modelIdBehindTransform) {
      consumePointerEvent(event);
      cameraAnimation.playing = false;
      activeCameraQuaternion = null;
      updatePlayButton();
      activateSceneModel(modelIdBehindTransform).catch((error) => {
        console.error(error);
        setStatus('Model select failed');
      });
    }
    return;
  }

  const lightIntersects = lightHandleGroup.visible
    ? raycaster.intersectObjects(lightHandleGroup.children, true)
    : [];
  const lightHit = lightIntersects.find((item) => item.object.userData.lightHandle);
  if (lightHit) {
    consumePointerEvent(event);
    cameraAnimation.playing = false;
    updatePlayButton();
    selectLightHandle(lightHit.object.userData.lightId);
    return;
  }

  const videoPlaneIdFromPointer = findVideoPlaneIdFromPointerHit();
  if (videoPlaneIdFromPointer) {
    consumePointerEvent(event);
    cameraAnimation.playing = false;
    activeCameraQuaternion = null;
    updatePlayButton();
    selectVideoPlane(videoPlaneIdFromPointer);
    return;
  }

  if (state.effectMode === 'image' && imageSplatRoot?.visible) {
    raycaster.params.Points.threshold = Math.max(0.08, state.imageSplatSize * 0.025);
    const imageIntersects = raycaster.intersectObjects(imageSplatRoot.children, true);
    if (imageIntersects.length) {
      consumePointerEvent(event);
      cameraAnimation.playing = false;
      updatePlayButton();
      selectImageSplatObject();
      return;
    }
  }

  const shouldCheckActiveModel = Boolean(selectedKeyframeId || selectedLightId || selectedImageSplat || selectedVideoPlaneId || !selectedSceneModelId);
  const modelRecordIdUnderPointer = findSceneModelIdFromPointerHit({ includeActive: shouldCheckActiveModel });
  if (modelRecordIdUnderPointer) {
    consumePointerEvent(event);
    cameraAnimation.playing = false;
    activeCameraQuaternion = null;
    updatePlayButton();
    activateSceneModel(modelRecordIdUnderPointer).catch((error) => {
      console.error(error);
      setStatus('Model select failed');
    });
    return;
  }

  const cameraPathHit = findCameraPathPointerHit();
  if (cameraPathHit) {
    consumePointerEvent(event);
    cameraAnimation.playing = false;
    activeCameraQuaternion = null;
    updatePlayButton();
    if (cameraPathHit.type === 'bezier') {
      const keyframe = cameraAnimation.keyframes.find((item) => item.id === cameraPathHit.keyframeId);
      if (keyframe) {
        setCameraTime(keyframe.time, false);
      }
      selectCameraBezierHandle(cameraPathHit.keyframeId, cameraPathHit.handleType, { frameIfTooClose: true });
    } else {
      const keyframe = cameraAnimation.keyframes.find((item) => item.id === cameraPathHit.keyframeId);
      if (keyframe) {
        setCameraTime(keyframe.time, false);
        selectCameraKeyframeHandle(cameraPathHit.keyframeId, { frameIfTooClose: true });
      }
    }
    return;
  }
}

function consumePointerEvent(event) {
  event.preventDefault();
  if (typeof event.stopImmediatePropagation === 'function') {
    event.stopImmediatePropagation();
    return;
  }
  event.stopPropagation();
}

function isTransformControlPointerHit() {
  if (!transformControls.visible || !transformControls.enabled) {
    return false;
  }

  return raycaster
    .intersectObject(transformControls, true)
    .some((item) => isRaycastHitVisible(item.object));
}

function isRaycastHitVisible(object) {
  let current = object;
  while (current) {
    if (!current.visible) {
      return false;
    }
    current = current.parent;
  }

  const materials = Array.isArray(object.material) ? object.material : [object.material];
  return materials.every((material) => !material || material.visible !== false);
}

function findCameraPathPointerHit() {
  if (!cameraPathGroup.visible) {
    return null;
  }

  const previousLineThreshold = raycaster.params.Line?.threshold ?? 1;
  raycaster.params.Line = raycaster.params.Line || {};
  raycaster.params.Line.threshold = 0.24;
  const hit = raycaster
    .intersectObjects(cameraPathGroup.children, true)
    .find((item) => item.object.userData.cameraBezierHandle || item.object.userData.keyframeHandle);
  raycaster.params.Line.threshold = previousLineThreshold;

  if (hit?.object?.userData?.cameraBezierHandle) {
    return {
      type: 'bezier',
      keyframeId: hit.object.userData.keyframeId,
      handleType: hit.object.userData.handleType
    };
  }

  if (hit?.object?.userData?.keyframeId) {
    return {
      type: 'keyframe',
      keyframeId: hit.object.userData.keyframeId
    };
  }

  const keyframeId = findCameraKeyframeIdFromPointer();
  return keyframeId ? { type: 'keyframe', keyframeId } : null;
}

function findCameraKeyframeIdFromPointer() {
  if (!cameraPathGroup.visible) {
    return null;
  }

  const previousLineThreshold = raycaster.params.Line?.threshold ?? 1;
  raycaster.params.Line = raycaster.params.Line || {};
  raycaster.params.Line.threshold = 0.14;
  const hit = raycaster
    .intersectObjects(cameraPathGroup.children, true)
    .find((item) => item.object.userData.keyframeHandle);
  raycaster.params.Line.threshold = previousLineThreshold;

  if (hit?.object?.userData?.keyframeId) {
    return hit.object.userData.keyframeId;
  }

  const rect = renderer.domElement.getBoundingClientRect();
  const maxPixels = 46;
  let nearestId = null;
  let nearestDistance = Infinity;
  getSortedCameraKeyframes().forEach((keyframe) => {
    const marker = findCameraMarkerObject(keyframe.id);
    if (!marker) {
      return;
    }
    const screen = marker.getWorldPosition(new THREE.Vector3()).project(camera);
    if (!Number.isFinite(screen.x) || !Number.isFinite(screen.y) || screen.z < -1 || screen.z > 1) {
      return;
    }
    const dx = ((screen.x - pointer.x) * rect.width) / 2;
    const dy = ((screen.y - pointer.y) * rect.height) / 2;
    const distance = Math.hypot(dx, dy);
    if (distance < maxPixels && distance < nearestDistance) {
      nearestDistance = distance;
      nearestId = keyframe.id;
    }
  });
  return nearestId;
}

function findSceneModelIdFromPointerHit(options = {}) {
  const { includeActive = true } = options;
  if (state.effectMode === 'image') {
    return null;
  }

  const selectedRecord = getSelectedSceneModel();
  if (
    includeActive &&
    selectedRecord &&
    isPointerInsideProjectedWorldBox(getActiveSceneModelPickBox(), MODEL_PICK_BOX_PADDING_PX) &&
    isActiveSceneModelPointerHit()
  ) {
    return selectedRecord.id;
  }

  for (const record of sceneModelObjects) {
    if (!record.snapshotRoot?.visible) {
      continue;
    }
    if (!isPointerInsideProjectedWorldBox(getVisibleObjectWorldBox(record.snapshotRoot), MODEL_PICK_BOX_PADDING_PX)) {
      continue;
    }
    if (isSceneModelSnapshotPointerHit(record.snapshotRoot)) {
      return record.id;
    }
  }

  return null;
}

function isActiveSceneModelPointerHit() {
  const previousPointThreshold = raycaster.params.Points?.threshold ?? 1;
  raycaster.params.Points = raycaster.params.Points || {};
  raycaster.params.Points.threshold = getWorldPointPickThreshold();

  try {
    if (isPointerRayHitVisibleSolid(visibleModelRoot)) {
      return true;
    }
  } finally {
    raycaster.params.Points.threshold = previousPointThreshold;
  }

  return isPointerNearRenderedPoints([particles, emissionParticles], getScreenPointPickThreshold());
}

function isSceneModelSnapshotPointerHit(root) {
  const previousPointThreshold = raycaster.params.Points?.threshold ?? 1;
  raycaster.params.Points = raycaster.params.Points || {};
  raycaster.params.Points.threshold = getWorldPointPickThreshold();

  try {
    if (isPointerRayHitVisibleSolid(root)) {
      return true;
    }
  } finally {
    raycaster.params.Points.threshold = previousPointThreshold;
  }

  const pointObjects = [];
  root.traverse((node) => {
    if (node.isPoints) {
      pointObjects.push(node);
    }
  });
  return isPointerNearRenderedPoints(pointObjects, getScreenPointPickThreshold());
}

function isPointerRayHitVisibleObject(object) {
  if (!object || !isObjectVisibleInWorld(object)) {
    return false;
  }

  return raycaster
    .intersectObject(object, true)
    .some((item) => isRaycastHitVisible(item.object));
}

function isPointerRayHitVisibleSolid(object) {
  if (!object || !isObjectVisibleInWorld(object)) {
    return false;
  }

  const targets = [];
  object.traverse((node) => {
    if (!isObjectVisibleInWorld(node) || !(node.isMesh || node.isLine || node.isLineSegments)) {
      return;
    }
    targets.push(node);
  });
  if (!targets.length) {
    return false;
  }

  return raycaster
    .intersectObjects(targets, false)
    .some((item) => isRaycastHitVisible(item.object));
}

function getWorldPointPickThreshold() {
  const size = state.effectMode === 'emission' ? state.emissionSize : state.pointSize;
  return THREE.MathUtils.clamp(Number(size) * 0.012, 0.025, 0.22);
}

function getScreenPointPickThreshold() {
  const size = state.effectMode === 'emission' ? state.emissionSize : state.pointSize;
  return THREE.MathUtils.clamp(Number(size) * 3.6, 16, 42);
}

function isPointerNearRenderedPoints(objects, thresholdPixels) {
  const rect = renderer.domElement.getBoundingClientRect();
  if (!rect.width || !rect.height) {
    return false;
  }

  const thresholdSq = thresholdPixels * thresholdPixels;
  const local = new THREE.Vector3();
  const projected = new THREE.Vector3();
  for (const object of objects) {
    if (!object?.isPoints || !isObjectVisibleInWorld(object)) {
      continue;
    }

    object.updateMatrixWorld(true);
    const position = object.geometry?.getAttribute('position');
    const count = position?.count || 0;
    if (!count) {
      continue;
    }

    const stride = Math.max(1, Math.ceil(count / PICK_POINT_SAMPLE_LIMIT));
    for (let index = 0; index < count; index += stride) {
      local.fromBufferAttribute(position, index).applyMatrix4(object.matrixWorld);
      projected.copy(local).project(camera);
      if (
        !Number.isFinite(projected.x) ||
        !Number.isFinite(projected.y) ||
        projected.z < -1 ||
        projected.z > 1
      ) {
        continue;
      }

      const dx = ((projected.x - pointer.x) * rect.width) / 2;
      const dy = ((projected.y - pointer.y) * rect.height) / 2;
      if (dx * dx + dy * dy <= thresholdSq) {
        return true;
      }
    }
  }

  return false;
}

function getActiveSceneModelPickBox() {
  const box = new THREE.Box3();
  [visibleModelRoot, particles, emissionParticles].forEach((object) => {
    expandVisibleObjectWorldBox(object, box);
  });
  return box.isEmpty() ? null : box;
}

function getVisibleObjectWorldBox(object) {
  const box = new THREE.Box3();
  expandVisibleObjectWorldBox(object, box);
  return box.isEmpty() ? null : box;
}

function expandVisibleObjectWorldBox(object, targetBox) {
  if (!object || !object.visible) {
    return targetBox;
  }

  object.updateWorldMatrix(true, true);
  object.traverse((node) => {
    if (!isObjectVisibleInWorld(node) || !(node.isMesh || node.isPoints || node.isLine || node.isLineSegments)) {
      return;
    }
    const geometry = node.geometry;
    if (!geometry) {
      return;
    }
    if (!geometry.boundingBox) {
      geometry.computeBoundingBox();
    }
    if (!geometry.boundingBox || geometry.boundingBox.isEmpty()) {
      return;
    }
    targetBox.union(geometry.boundingBox.clone().applyMatrix4(node.matrixWorld));
  });
  return targetBox;
}

function isObjectVisibleInWorld(object) {
  let current = object;
  while (current) {
    if (!current.visible) {
      return false;
    }
    current = current.parent;
  }
  return true;
}

function isPointerInsideProjectedWorldBox(box, paddingPixels = 24) {
  if (!box || box.isEmpty()) {
    return false;
  }

  const projectedBox = getProjectedWorldBoxDebug(box);
  if (!projectedBox) {
    return false;
  }

  const rect = renderer.domElement.getBoundingClientRect();
  const padX = (paddingPixels / Math.max(rect.width, 1)) * 2;
  const padY = (paddingPixels / Math.max(rect.height, 1)) * 2;
  return (
    pointer.x >= projectedBox.min[0] - padX &&
    pointer.x <= projectedBox.max[0] + padX &&
    pointer.y >= projectedBox.min[1] - padY &&
    pointer.y <= projectedBox.max[1] + padY
  );
}

function getProjectedWorldBoxDebug(box) {
  if (!box || box.isEmpty()) {
    return null;
  }

  const points = [
    [box.min.x, box.min.y, box.min.z],
    [box.min.x, box.min.y, box.max.z],
    [box.min.x, box.max.y, box.min.z],
    [box.min.x, box.max.y, box.max.z],
    [box.max.x, box.min.y, box.min.z],
    [box.max.x, box.min.y, box.max.z],
    [box.max.x, box.max.y, box.min.z],
    [box.max.x, box.max.y, box.max.z]
  ];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let hasProjectedPoint = false;
  points.forEach(([x, y, z]) => {
    const projected = new THREE.Vector3(x, y, z).project(camera);
    if (!Number.isFinite(projected.x) || !Number.isFinite(projected.y)) {
      return;
    }
    if (projected.z < -1.5 || projected.z > 1.5) {
      return;
    }
    hasProjectedPoint = true;
    minX = Math.min(minX, projected.x);
    maxX = Math.max(maxX, projected.x);
    minY = Math.min(minY, projected.y);
    maxY = Math.max(maxY, projected.y);
  });

  if (!hasProjectedPoint) {
    return null;
  }

  return {
    min: [minX, minY],
    max: [maxX, maxY],
    center: [(minX + maxX) * 0.5, (minY + maxY) * 0.5]
  };
}

function isSceneModelPickObject(object) {
  let current = object;
  while (current) {
    if (current.userData?.sceneModelPickTarget) {
      return true;
    }
    if (current === activeModelTransformRoot) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

function selectCameraBezierHandle(keyframeId, type, options = {}) {
  if (normalizeCameraPathMode(cameraAnimation.pathMode) !== 'bezier') {
    return false;
  }
  const keyframe = cameraAnimation.keyframes.find((item) => item.id === keyframeId);
  const handle = findCameraBezierHandleObject(keyframeId, type);
  if (!keyframe || !handle) {
    selectedCameraBezierHandle = null;
    return false;
  }

  selectedImageSplat = false;
  selectedVideoPlaneId = null;
  selectedLightId = null;
  selectedKeyframeId = keyframe.id;
  selectedKeyframeObject = findCameraMarkerObject(keyframe.id);
  selectedCameraBezierHandle = { keyframeId: keyframe.id, type, object: handle };
  resetTransformAxisConstraint(false);
  renderLightList();
  syncLightUi();
  transformControls.setMode('translate');
  transformControls.setSpace('world');
  transformControls.attach(handle);
  transformControls.visible = true;
  transformControls.enabled = true;
  applyTransformAxisConstraint();
  updateKeyframeModeButtons();
  syncCameraCurveUi();

  if (options.frameIfTooClose) {
    frameKeyframeForEditing(keyframe);
  }
  return true;
}

function findCameraBezierHandleObject(keyframeId, type) {
  let found = null;
  cameraPathGroup.traverse((child) => {
    if (
      !found &&
      child.userData?.cameraBezierHandle &&
      !child.userData.cameraBezierPickProxy &&
      child.userData.keyframeId === keyframeId &&
      child.userData.handleType === type
    ) {
      found = child;
    }
  });
  return found;
}

function commitSelectedBezierHandleTransform() {
  if (!selectedCameraBezierHandle?.keyframeId || !selectedCameraBezierHandle?.type) {
    return null;
  }
  const keyframe = cameraAnimation.keyframes.find((item) => item.id === selectedCameraBezierHandle.keyframeId);
  const handleObject = transformControls.object || selectedCameraBezierHandle.object;
  if (!keyframe || !handleObject) {
    return null;
  }
  const base = new THREE.Vector3().fromArray(keyframe.position);
  const offset = handleObject.position.clone().sub(base);
  if (selectedCameraBezierHandle.type === 'in') {
    keyframe.handleIn = offset.toArray();
  } else {
    keyframe.handleOut = offset.toArray();
  }
  selectedCameraBezierHandle.object = handleObject;
  updateSelectedBezierHandleTangent();
  return keyframe;
}

function updateSelectedBezierHandleTangent() {
  if (!selectedCameraBezierHandle?.object) {
    return;
  }
  const keyframe = cameraAnimation.keyframes.find((item) => item.id === selectedCameraBezierHandle.keyframeId);
  if (!keyframe) {
    return;
  }
  const base = new THREE.Vector3().fromArray(keyframe.position);
  const handle = selectedCameraBezierHandle.object;
  const line = handle.parent?.children?.find((child) => child.userData?.cameraBezierTangent);
  if (!line) {
    return;
  }
  line.geometry.dispose();
  line.geometry = new THREE.BufferGeometry().setFromPoints([base, handle.position]);
  line.computeLineDistances?.();
}

function selectCameraKeyframeHandle(keyframeId, options = {}) {
  const { frameIfTooClose = false } = options;
  selectedImageSplat = false;
  selectedVideoPlaneId = null;
  selectedLightId = null;
  selectedCameraBezierHandle = null;
  resetTransformAxisConstraint(false);
  renderLightList();
  syncLightUi();
  selectedKeyframeId = keyframeId;
  selectedKeyframeObject = findCameraMarkerObject(keyframeId);
  const keyframe = cameraAnimation.keyframes.find((item) => item.id === keyframeId);

  if (!selectedKeyframeObject || !keyframe) {
    transformControls.detach();
    transformControls.visible = false;
    return;
  }

  syncTransformProxyFromKeyframe(keyframe);
  transformControls.setMode(selectedKeyframeMode);
  transformControls.setSpace(selectedKeyframeMode === 'translate' ? 'world' : 'local');
  transformControls.attach(selectedTransformProxy);
  transformControls.visible = true;
  transformControls.enabled = true;
  applyTransformAxisConstraint();
  updateKeyframeModeButtons();
  syncCameraCurveUi();

  if (frameIfTooClose) {
    frameKeyframeForEditing(keyframe);
  }
}

function findCameraMarkerObject(keyframeId) {
  return cameraPathGroup.children.find((child) => child.userData.keyframeId === keyframeId) || null;
}

function commitSelectedKeyframeTransform() {
  if (!selectedKeyframeId || selectedCameraBezierHandle) {
    return null;
  }

  const keyframe = cameraAnimation.keyframes.find((item) => item.id === selectedKeyframeId);
  if (!keyframe) {
    return null;
  }

  const previousPosition = new THREE.Vector3().fromArray(keyframe.position);
  const previousTarget = new THREE.Vector3().fromArray(keyframe.target);
  const previousDistance = Math.max(previousPosition.distanceTo(previousTarget), 0.05);
  const direction = getProxyLookDirection();

  keyframe.position = selectedTransformProxy.position.toArray();
  keyframe.quaternion = selectedTransformProxy.quaternion.toArray();
  keyframe.target = selectedTransformProxy.position.clone().addScaledVector(direction, previousDistance).toArray();
  if (selectedKeyframeMode === 'scale') {
    const displaySize = (
      Math.abs(selectedTransformProxy.scale.x) +
      Math.abs(selectedTransformProxy.scale.y) +
      Math.abs(selectedTransformProxy.scale.z)
    ) / 3;
    state.cameraDisplaySize = THREE.MathUtils.clamp(displaySize, 0.2, 5);
    setRangeValue('cameraDisplaySize', state.cameraDisplaySize);
    setValueInput('cameraDisplaySize', state.cameraDisplaySize);
    updateCameraMarkerDisplaySize();
  }
  if (selectedKeyframeObject) {
    selectedKeyframeObject.position.copy(selectedTransformProxy.position);
    selectedKeyframeObject.quaternion.copy(selectedTransformProxy.quaternion);
    selectedKeyframeObject.scale.setScalar(state.cameraDisplaySize);
  }
  return keyframe;
}

function updateSelectedCameraMarkerFromKeyframe(keyframe) {
  if (!selectedKeyframeObject) {
    return;
  }

  const position = new THREE.Vector3().fromArray(keyframe.position);
  selectedKeyframeObject.position.copy(position);
  selectedKeyframeObject.quaternion.copy(getKeyframeQuaternion(keyframe));
  selectedKeyframeObject.scale.setScalar(state.cameraDisplaySize);
}

function syncTransformProxyFromKeyframe(keyframe) {
  const position = new THREE.Vector3().fromArray(keyframe.position);
  selectedTransformProxy.position.copy(position);
  selectedTransformProxy.quaternion.copy(getKeyframeQuaternion(keyframe));
  selectedTransformProxy.scale.setScalar(state.cameraDisplaySize);
  selectedTransformProxy.updateMatrixWorld(true);
}

function getLookQuaternion(position, target) {
  const matrix = new THREE.Matrix4().lookAt(position, target, camera.up);
  return new THREE.Quaternion().setFromRotationMatrix(matrix);
}

function getProxyLookDirection() {
  return new THREE.Vector3(0, 0, -1).applyQuaternion(selectedTransformProxy.quaternion).normalize();
}

function frameKeyframeForEditing(keyframe) {
  activeCameraQuaternion = null;
  const keyPosition = new THREE.Vector3().fromArray(keyframe.position);
  if (camera.position.distanceTo(keyPosition) > 0.9) {
    return;
  }

  const forward = getKeyframeForward(keyframe);
  if (forward.lengthSq() < 0.0001) {
    forward.set(0, 0, -1);
  }

  const side = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
  if (side.lengthSq() < 0.0001) {
    side.set(1, 0, 0);
  }

  const editorPosition = keyPosition
    .clone()
    .addScaledVector(side, 1.75)
    .addScaledVector(camera.up, 0.85)
    .addScaledVector(forward, -1.25);

  camera.position.copy(editorPosition);
  orbit.target.copy(keyPosition);
  orbit.update();
}

function setSelectedKeyframeMode(mode) {
  selectedKeyframeMode = ['translate', 'rotate', 'scale'].includes(mode) ? mode : 'translate';
  transformControls.setMode(selectedKeyframeMode);
  transformControls.setSpace(selectedKeyframeMode === 'translate' ? 'world' : 'local');
  updateKeyframeModeButtons();

  if (selectedKeyframeId) {
    selectCameraKeyframeHandle(selectedKeyframeId, { frameIfTooClose: true });
  }
}

function updateKeyframeModeButtons() {
  controlsUi.moveKeyframe.classList.toggle('active', selectedKeyframeMode === 'translate');
  controlsUi.rotateKeyframe.classList.toggle('active', selectedKeyframeMode === 'rotate');
  controlsUi.scaleKeyframe?.classList.toggle('active', selectedKeyframeMode === 'scale');
}

function updateCameraPathCurve() {
  const keyframes = getSortedCameraKeyframes();
  if (keyframes.length < 2) {
    return;
  }

  const pathLine = cameraPathGroup.children.find((child) => child.userData.cameraPathLine);
  if (!pathLine) {
    return;
  }

  const samples = [];
  const sampleCount = 96;
  for (let index = 0; index <= sampleCount; index += 1) {
    const time = (index / sampleCount) * cameraAnimation.duration;
    samples.push(interpolateKeyframeVector(keyframes, time, 'position'));
  }

  pathLine.geometry.dispose();
  pathLine.geometry = new THREE.BufferGeometry().setFromPoints(samples);
}

function getSortedCameraKeyframes() {
  return [...cameraAnimation.keyframes].sort((a, b) => a.time - b.time);
}

function importCameraKeyframes(keyframes) {
  cameraAnimation.keyframes = keyframes
    .filter((keyframe) => Array.isArray(keyframe.position) && Array.isArray(keyframe.target))
    .map((keyframe, index) => {
      const position = keyframe.position.map(Number).slice(0, 3);
      const target = keyframe.target.map(Number).slice(0, 3);
      const lightSnapshot = Array.isArray(keyframe.lights)
        ? keyframe.lights
        : Array.isArray(keyframe.options?.lights)
          ? keyframe.options.lights
          : null;
      const imported = {
        id: keyframe.id || `imported-${index}`,
        time: THREE.MathUtils.clamp(Number(keyframe.time) || 0, 0, cameraAnimation.duration),
        position,
        target
      };
      if (Array.isArray(lightSnapshot)) {
        imported.lights = lightSnapshot.map((light, lightIndex) => normalizeLightSnapshot(light, lightIndex));
      }
      if (keyframe.curve !== undefined) {
        imported.curve = normalizeCameraCurve(keyframe.curve);
      }
      if (keyframe.curveStrength !== undefined) {
        imported.curveStrength = normalizeCameraCurveStrength(keyframe.curveStrength);
      }
      const handleIn = getVector3Array(keyframe.handleIn);
      const handleOut = getVector3Array(keyframe.handleOut);
      if (handleIn) {
        imported.handleIn = handleIn;
      }
      if (handleOut) {
        imported.handleOut = handleOut;
      }
      imported.quaternion = getKeyframeQuaternion({
        ...imported,
        quaternion: Array.isArray(keyframe.quaternion) ? keyframe.quaternion : undefined
      }).toArray();
      return imported;
    })
    .sort((a, b) => a.time - b.time);
  refreshCameraTimeline();
}

async function exportMovFromUi() {
  commitSelectedImageSplatTransform();
  commitSelectedSceneModelTransform();
  const updatedKeyframe = commitSelectedKeyframeTransform();
  if (updatedKeyframe) {
    updateSelectedCameraMarkerFromKeyframe(updatedKeyframe);
    rebuildCameraPath();
  }

  controlsUi.exportMov.disabled = true;
  controlsUi.exportStatus.value = 'Exporting...';

  try {
    const format = normalizeExportFormat(controlsUi.exportFormat?.value);
    const payload = {
      name: `particle-camera-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}`,
      format,
      duration: cameraAnimation.duration,
      fps: Number(controlsUi.exportFps.value),
      width: Number(controlsUi.exportWidth.value),
      height: Number(controlsUi.exportHeight.value),
      pixelRatio: 1,
      startTime: cameraAnimation.time,
      cameraStartTime: cameraAnimation.time,
      effectStartTime: clock.elapsedTime,
      cameraCurve: {
        curve: cameraAnimation.curve,
        strength: cameraAnimation.curveStrength,
        pathMode: cameraAnimation.pathMode
      },
      options: captureKeyframeOptions(),
      cameraKeyframes: getSortedCameraKeyframes(),
      parameterKeyframes: serializeParameterKeyframes(),
      cameraSnapshot: captureCameraSnapshot(),
      lights: serializeSceneLights(),
      world: serializeWorldEnvironment(),
      imageSplat: serializeImageSplatObject(),
      videoPlanes: serializeVideoPlanes(),
      sceneModels: serializeSceneModels(),
      morphTarget: serializeMorphTargetModel(),
      model: currentModelPayload
    };
    const result = window.electronAPI?.exportMov
      ? await window.electronAPI.exportMov(payload)
      : await exportMovFromDevServer(payload);

    if (!result.ok) {
      throw new Error(result.error || 'Export failed');
    }

    controlsUi.exportStatus.value = result.relativePath || result.path;
    if (window.electronAPI?.showItemInFolder && result.path) {
      window.electronAPI.showItemInFolder(result.path);
    }
  } catch (error) {
    console.error(error);
    controlsUi.exportStatus.value = 'Export failed';
  } finally {
    controlsUi.exportMov.disabled = false;
  }
}

async function exportMovFromDevServer(payload) {
  const response = await fetch('/api/export-mov', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  const result = await response.json();

  if (!response.ok) {
    return {
      ok: false,
      error: result.error || 'Export failed'
    };
  }

  return result;
}

function setStatus(value) {
  statusText.textContent = value;
  statusText.title = value;
}

function formatCount(value) {
  const numericValue = Math.max(0, Math.round(Number(value) || 0));
  if (numericValue < 1000) {
    return String(numericValue);
  }
  if (numericValue < 10000) {
    return `${(numericValue / 1000).toFixed(1)}K`;
  }
  return `${Math.round(numericValue / 1000)}K`;
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

function glowEnabled() {
  if (state.effectMode === 'image') {
    return Boolean(imageSplatGlowParticles) && state.imageSplatGlow > 0 && state.imageSplatOpacity > 0;
  }

  if (state.effectMode === 'emission') {
    return Boolean(emissionGlowParticles) &&
      state.modelVisibility > 0.001 &&
      state.emissionEnabled &&
      state.emissionGlow > 0 &&
      state.emissionOpacity > 0 &&
      (state.emissionIntensity > 0 || state.breakAmount * state.breakProgress > 0);
  }

  return Boolean(glowParticles) &&
    state.modelVisibility > 0.001 &&
    state.particleizeProgress > 0.02 &&
    state.glowRadius > 0 &&
    state.glowExposure > 0;
}

const PROJECT_FORMAT = 'particle-model-studio-project';
const PROJECT_SCHEMA_VERSION = 1;
let currentProjectName = '';

function captureProjectDocument() {
  commitSelectedImageSplatTransform();
  commitSelectedLightTransform();
  commitSelectedSceneModelTransform();
  const keyframe = commitSelectedKeyframeTransform();
  if (keyframe) {
    updateSelectedCameraMarkerFromKeyframe(keyframe);
  }

  const sceneModels = serializeSceneModels();
  const videoPlanes = serializeVideoPlanes();
  const exportResolution = getExportResolution();
  return {
    format: PROJECT_FORMAT,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    appVersion: '1.0.9',
    savedAt: new Date().toISOString(),
    scene: {
      options: captureKeyframeOptions(),
      cameraSettings: getCameraSettings(),
      cameraSnapshot: captureCameraSnapshot(),
      cameraKeyframes: getSortedCameraKeyframes(),
      parameterKeyframes: serializeParameterKeyframes(),
      cameraAnimation: {
        duration: cameraAnimation.duration,
        time: cameraAnimation.time,
        pathMode: cameraAnimation.pathMode,
        curve: cameraAnimation.curve,
        curveStrength: cameraAnimation.curveStrength
      },
      exportSettings: {
        width: exportResolution.width,
        height: exportResolution.height,
        fps: Number(controlsUi.exportFps.value) || 30,
        format: normalizeExportFormat(controlsUi.exportFormat?.value)
      },
      lights: serializeSceneLights(),
      world: serializeProjectWorldEnvironment(),
      imageSplat: serializeImageSplatObject(),
      videoPlanes,
      morphTarget: serializeMorphTargetModel(),
      sceneModels,
      model: sceneModels?.models?.length ? null : currentModelPayload
    }
  };
}

function prepareDesktopProjectDocument(document) {
  const sourceScene = document?.scene || {};
  const scene = { ...sourceScene };
  const preferLocalPath = (descriptor) => {
    if (!descriptor?.path || !descriptor.dataUrl) {
      return descriptor;
    }
    const { dataUrl: _inlineData, ...pathBacked } = descriptor;
    return pathBacked;
  };

  scene.model = preferLocalPath(sourceScene.model);
  scene.morphTarget = preferLocalPath(sourceScene.morphTarget);
  scene.world = preferLocalPath(sourceScene.world);
  scene.imageSplat = preferLocalPath(sourceScene.imageSplat);
  if (Array.isArray(sourceScene.videoPlanes?.items)) {
    scene.videoPlanes = {
      ...sourceScene.videoPlanes,
      items: sourceScene.videoPlanes.items.map(preferLocalPath)
    };
  }
  if (Array.isArray(sourceScene.sceneModels?.models)) {
    scene.sceneModels = {
      ...sourceScene.sceneModels,
      models: sourceScene.sceneModels.models.map(preferLocalPath)
    };
  }
  return { ...document, scene };
}

function formatProjectSaveStatus(error) {
  const message = String(error?.message || error || '工程保存失败。')
    .replace(/^Error invoking remote method ['"]save-project['"]:\s*/i, '')
    .trim();
  return message.length > 120 ? `${message.slice(0, 117)}...` : message;
}

async function saveProjectFromUi(saveAs = false) {
  if (projectUi.save) {
    projectUi.save.disabled = true;
  }
  setStatus('Saving project');
  let recoveryDocument = null;
  let recoverySuggestedName = 'particle-project';

  try {
    const document = captureProjectDocument();
    const suggestedName = getProjectSuggestedName();
    recoverySuggestedName = suggestedName;
    let result;
    if (window.electronAPI?.saveProject) {
      const desktopDocument = prepareDesktopProjectDocument(document);
      recoveryDocument = desktopDocument;
      result = await window.electronAPI.saveProject({ document: desktopDocument, suggestedName, saveAs });
    } else {
      const blob = new Blob([JSON.stringify(document)], { type: 'application/json' });
      const link = documentElement('a');
      const name = `${suggestedName}.pms`;
      link.href = URL.createObjectURL(blob);
      link.download = name;
      link.click();
      URL.revokeObjectURL(link.href);
      result = { ok: true, name };
    }

    if (result?.canceled) {
      setStatus('Ready');
      return result;
    }
    if (!result?.ok) {
      throw new Error(result?.error || 'Project save failed');
    }
    currentProjectName = result.name || `${suggestedName}.pms`;
    syncProjectName();
    setStatus('Project saved');
    return result;
  } catch (error) {
    let recovery = null;
    if (recoveryDocument && window.electronAPI?.saveProjectRecovery) {
      try {
        recovery = await window.electronAPI.saveProjectRecovery({
          document: recoveryDocument,
          suggestedName: recoverySuggestedName
        });
      } catch (recoveryError) {
        console.error('Project recovery save failed.', recoveryError);
      }
    }
    if (recovery?.ok) {
      console.warn('Primary project save failed; recovery copy was saved.', error);
      setStatus(`原位置保存失败；恢复副本已保存：${recovery.name}`);
    } else {
      console.error(error);
      setStatus(`保存失败：${formatProjectSaveStatus(error)}`);
    }
    return { ok: false, error: error.message || String(error), recovery };
  } finally {
    if (projectUi.save) {
      projectUi.save.disabled = false;
    }
  }
}

async function openProjectFromUi() {
  if (projectUi.open) {
    projectUi.open.disabled = true;
  }
  setStatus('Opening project');

  try {
    if (window.electronAPI?.openProject) {
      const result = await window.electronAPI.openProject();
      if (result?.canceled) {
        setStatus('Ready');
        return result;
      }
      if (!result?.ok) {
        throw new Error(result?.error || 'Project open failed');
      }
      await applyProjectDocument(result.document);
      currentProjectName = result.name || 'project.pms';
      syncProjectName();
      return result;
    }

    projectUi.input?.click();
    return { ok: true, awaitingFile: true };
  } catch (error) {
    console.error(error);
    setStatus('Project open failed');
    return { ok: false, error: error.message || String(error) };
  } finally {
    if (projectUi.open) {
      projectUi.open.disabled = false;
    }
  }
}

async function applyProjectDocument(document) {
  validateProjectDocument(document);
  const project = document.scene;
  undoHistory.restoring = true;
  cameraAnimation.playing = false;
  updatePlayButton();
  setStatus('Restoring project');

  try {
    const sceneModels = project.sceneModels?.models?.length
      ? project.sceneModels
      : project.model?.dataUrl || project.model?.url
        ? {
            activeId: 'project-model',
            models: [{ ...project.model, id: 'project-model', name: project.model.name || 'Project Model' }]
          }
        : null;

    if (sceneModels) {
      await importSceneModels(sceneModels);
    } else {
      disposeAllSceneModels();
      currentModelPayload = null;
    }

    if (project.imageSplat?.dataUrl || project.imageSplat?.url) {
      await window.particleStudio.setImageSplatObject(project.imageSplat);
    } else {
      removeImageSplatObject();
      await removeRealSplatObject();
      currentImageSplatPayload = null;
      currentGaussianSplatPayload = null;
    }

    if (project.videoPlanes?.items?.length) {
      await importVideoPlanes(project.videoPlanes);
    } else {
      clearVideoPlanes();
    }

    if (project.morphTarget?.dataUrl || project.morphTarget?.url) {
      await window.particleStudio.setMorphTargetModel(project.morphTarget);
    } else {
      clearMorphTarget({ rebuild: false });
    }

    if (project.world?.dataUrl || project.world?.url) {
      state.worldExport = project.world.export !== false;
      await window.particleStudio.setWorldEnvironment({
        ...project.world,
        url: project.world.url || project.world.dataUrl
      });
    } else {
      disposeWorldEnvironment();
      currentWorldPayload = null;
      state.worldEnabled = false;
      state.worldVisible = false;
      syncWorldEnvironment();
    }

    await applyOptionsSnapshot(project.options || {}, false);
    importSceneLights(Array.isArray(project.lights) ? project.lights : [], false);
    setCameraDuration(project.cameraAnimation?.duration ?? 5);
    setCameraPathMode(project.cameraAnimation?.pathMode ?? 'linear');
    setCameraCurve(project.cameraAnimation?.curve, project.cameraAnimation?.curveStrength, { applyToSelected: false });
    setCameraSettings(project.cameraSettings || {}, false);
    applyCameraSnapshot(project.cameraSnapshot || {}, { pose: true });
    importCameraKeyframes(Array.isArray(project.cameraKeyframes) ? project.cameraKeyframes : []);
    importParameterKeyframes(Array.isArray(project.parameterKeyframes) ? project.parameterKeyframes : []);

    const exportSettings = project.exportSettings || {};
    setExportResolution(exportSettings.width, exportSettings.height, exportSettings.fps);
    if (controlsUi.exportFormat) {
      controlsUi.exportFormat.value = normalizeExportFormat(exportSettings.format);
      syncExportFormatUi();
    }
    setCameraTime(project.cameraAnimation?.time ?? 0, true);
    syncUi();
    syncCameraSettingsFromState(true);
    renderSceneModelList();
    undoHistory.past.length = 0;
    setStatus('Project loaded');
    setCameraPreviewDirty();
    return true;
  } finally {
    undoHistory.restoring = false;
  }
}

function validateProjectDocument(document) {
  if (!document || document.format !== PROJECT_FORMAT || Number(document.schemaVersion) !== PROJECT_SCHEMA_VERSION) {
    throw new Error('这不是有效的 Particle Model Studio .pms 工程文件。');
  }
  if (!document.scene || typeof document.scene !== 'object') {
    throw new Error('工程文件缺少场景数据。');
  }
}

function getProjectSuggestedName() {
  const base = currentProjectName || currentLabel || 'particle-project';
  return String(base)
    .replace(/\.pms$/i, '')
    .replace(/\.[^.]+$/, '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .trim() || 'particle-project';
}

function syncProjectName() {
  if (projectUi.name) {
    projectUi.name.textContent = currentProjectName || '未保存工程';
    projectUi.name.title = currentProjectName || '';
  }
}

function documentElement(tagName) {
  return window.document.createElement(tagName);
}

function normalizeExportFormat(value) {
  return value === 'mp4-360' ? 'mp4-360' : value === 'mp4' ? 'mp4' : 'mov';
}

function syncExportFormatUi() {
  const format = normalizeExportFormat(controlsUi.exportFormat?.value);
  if (controlsUi.exportFormat) {
    controlsUi.exportFormat.value = format;
  }
  const label = format === 'mp4-360' ? '导出 360° MP4' : format === 'mp4' ? '导出 MP4' : '导出透明 MOV';
  const title = format === 'mp4-360'
    ? '导出带球面元数据的 2:1 H.264 MP4'
    : format === 'mp4'
      ? '导出 H.264 MP4'
      : '导出透明底 MOV';
  const buttonLabel = controlsUi.exportMov?.querySelector('span');
  if (buttonLabel) {
    buttonLabel.textContent = label;
  }
  if (controlsUi.exportMov) {
    controlsUi.exportMov.title = title;
  }
}

function glowBlurRadius() {
  if (state.effectMode === 'image') {
    return THREE.MathUtils.clamp(1.0 + normalizedGlowDriver(state.imageSplatGlow) * 18 + state.imageSplatScatter * 0.45, 0.8, 32);
  }

  if (state.effectMode === 'emission') {
    return THREE.MathUtils.clamp(1.1 + normalizedGlowDriver(state.emissionGlow) * 24 + state.emissionDistance * 0.55, 0.85, 42);
  }

  const radius = Math.max(state.glowRadius, 0);
  const exposure = normalizedGlowDriver(state.glowExposure);
  return THREE.MathUtils.clamp(0.45 + Math.pow(radius, 0.85) * (0.22 + exposure * 0.2), 0.35, 78);
}

function normalizedGlowDriver(value) {
  return 1 - Math.exp(-Math.max(Number(value) || 0, 0) * 0.72);
}

function setFullTargetViewport(targetRenderer, target = null) {
  if (target) {
    // Render targets are sized in texture pixels, but setViewport multiplies
    // by renderer pixel ratio. Convert back to logical pixels so bloom passes
    // do not render cropped/offset on high-DPI displays.
    const pixelRatio = Math.max(0.0001, targetRenderer.getPixelRatio?.() || 1);
    targetRenderer.setViewport(0, 0, target.width / pixelRatio, target.height / pixelRatio);
    targetRenderer.setScissor(0, 0, target.width / pixelRatio, target.height / pixelRatio);
    targetRenderer.setScissorTest(false);
    return;
  }

  // WebGLRenderer.setViewport expects logical canvas pixels for the default
  // framebuffer. Passing drawing-buffer pixels on high-DPI Windows/Electron
  // makes the main view render scaled/cropped while raycasting still uses CSS
  // coordinates, so the model appears in one place but is selected elsewhere.
  targetRenderer.getSize(postSize);
  targetRenderer.setViewport(0, 0, postSize.x, postSize.y);
  targetRenderer.setScissor(0, 0, postSize.x, postSize.y);
  targetRenderer.setScissorTest(false);
}

function renderFullscreenWith(targetRenderer, material, target = null) {
  postQuad.material = material;
  targetRenderer.setRenderTarget(target);
  setFullTargetViewport(targetRenderer, target);
  targetRenderer.render(postScene, postCamera);
}

function renderFullscreen(material, target = null) {
  renderFullscreenWith(renderer, material, target);
}

function blurGlowTextureFor(targetRenderer, targets) {
  const radius = glowBlurRadius();
  blurMaterial.uniforms.uTexelSize.value.set(1 / targets.glowTarget.width, 1 / targets.glowTarget.height);

  const passes = [
    radius,
    radius * 0.56,
    Math.max(0.75, radius * 0.24)
  ];

  let input = targets.glowTarget;
  let output = targets.blurTargetA;

  passes.forEach((passRadius) => {
    blurMaterial.uniforms.uTexture.value = input.texture;
    blurMaterial.uniforms.uDirection.value.set(1, 0);
    blurMaterial.uniforms.uRadius.value = passRadius;
    renderFullscreenWith(targetRenderer, blurMaterial, output);

    input = output;
    output = output === targets.blurTargetA ? targets.blurTargetB : targets.blurTargetA;

    blurMaterial.uniforms.uTexture.value = input.texture;
    blurMaterial.uniforms.uDirection.value.set(0, 1);
    blurMaterial.uniforms.uRadius.value = passRadius;
    renderFullscreenWith(targetRenderer, blurMaterial, output);

    input = output;
    output = output === targets.blurTargetA ? targets.blurTargetB : targets.blurTargetA;
  });

  return input;
}

function blurGlowTexture() {
  return blurGlowTextureFor(renderer, { glowTarget, blurTargetA, blurTargetB });
}

function setVisibleModelColorWrite(enabled) {
  if (!visibleModelRoot) {
    return () => {};
  }

  const previous = [];
  visibleModelRoot.traverse((node) => {
    if (!node.isMesh) {
      return;
    }

    const materials = Array.isArray(node.material) ? node.material : [node.material];
    materials.forEach((material) => {
      if (!material) {
        return;
      }
      previous.push([material, material.colorWrite]);
      material.colorWrite = enabled;
    });
  });

  return () => {
    previous.forEach(([material, colorWrite]) => {
      material.colorWrite = colorWrite;
    });
  };
}

function setSceneModelSnapshotsVisible(visible) {
  const previous = [];
  sceneModelObjects.forEach((record) => {
    if (!record.snapshotRoot) {
      return;
    }
    previous.push([record.snapshotRoot, record.snapshotRoot.visible]);
    record.snapshotRoot.visible = visible && !record.hidden;
  });

  return () => {
    previous.forEach(([root, wasVisible]) => {
      root.visible = wasVisible;
    });
  };
}

function configureCompositeCameraUniforms(renderCamera, targets, options = {}) {
  compositeMaterial.uniforms.uDepthTexture.value = targets.sceneTarget.depthTexture;
  compositeMaterial.uniforms.uDofEnabled.value = options.dofEnabled ? 1 : 0;
  compositeMaterial.uniforms.uCameraNear.value = renderCamera.near;
  compositeMaterial.uniforms.uCameraFar.value = renderCamera.far;
  compositeMaterial.uniforms.uFocusDistance.value = state.cameraFocusDistance;
  compositeMaterial.uniforms.uAperture.value = state.cameraAperture;
  compositeMaterial.uniforms.uFocalLength.value = state.cameraFocalLength;
  compositeMaterial.uniforms.uResolution.value.set(targets.sceneTarget.width, targets.sceneTarget.height);
}

function renderSceneWithGlowFor(targetRenderer, renderCamera, targets, options = {}) {
  syncParticleLightingUniforms();
  updateSceneModelSnapshotUniforms();
  updateModelBreakRootInverse();
  const outputTarget = options.outputTarget ?? targetRenderer.getRenderTarget();
  const transparent = options.transparent ?? exportSettings.transparent;
  const previousTarget = targetRenderer.getRenderTarget();
  const previousClearColor = new THREE.Color();
  targetRenderer.getClearColor(previousClearColor);
  const previousAlpha = targetRenderer.getClearAlpha();
  const finalViewport = options.viewport || null;
  const previousViewport = new THREE.Vector4();
  const previousScissor = new THREE.Vector4();
  const previousScissorTest = targetRenderer.getScissorTest?.() || false;
  const forceOutputComposite = Boolean(options.forceOutputComposite && finalViewport && targets?.sceneTarget);
  const depthOfFieldEnabled = Boolean(
    options.dofEnabled &&
    state.cameraDofEnabled &&
    state.cameraType === 'perspective' &&
    targets?.sceneTarget?.depthTexture
  );
  const requiresOutputComposite = forceOutputComposite || depthOfFieldEnabled;
  targetRenderer.getViewport(previousViewport);
  targetRenderer.getScissor(previousScissor);
  const applyFinalViewport = () => {
    if (!finalViewport) {
      return;
    }
    targetRenderer.setViewport(finalViewport.x, finalViewport.y, finalViewport.width, finalViewport.height);
    targetRenderer.setScissor(finalViewport.x, finalViewport.y, finalViewport.width, finalViewport.height);
    targetRenderer.setScissorTest(true);
  };
  const applyOutputViewport = () => {
    if (finalViewport) {
      applyFinalViewport();
    } else {
      setFullTargetViewport(targetRenderer, outputTarget);
    }
  };
  const restoreRendererViewport = () => {
    targetRenderer.setViewport(previousViewport);
    targetRenderer.setScissor(previousScissor);
    targetRenderer.setScissorTest(previousScissorTest);
  };

  const previousGlowVisible = glowParticles?.visible ?? false;
  const previousEmissionGlowVisible = emissionGlowParticles?.visible ?? false;
  const previousImageGlowVisible = imageSplatGlowParticles?.visible ?? false;
  if (glowParticles) {
    glowParticles.visible = false;
  }
  if (emissionGlowParticles) {
    emissionGlowParticles.visible = false;
  }
  if (imageSplatGlowParticles) {
    imageSplatGlowParticles.visible = false;
  }

  if (!glowEnabled()) {
    targetRenderer.setRenderTarget(requiresOutputComposite ? targets.sceneTarget : outputTarget);
    setFullTargetViewport(targetRenderer, requiresOutputComposite ? targets.sceneTarget : outputTarget);
    targetRenderer.setClearColor(0x090a0c, transparent ? 0 : 1);
    targetRenderer.clear(true, true, true);
    targetRenderer.render(scene, renderCamera);
    if (requiresOutputComposite) {
      targetRenderer.setRenderTarget(targets.glowTarget);
      setFullTargetViewport(targetRenderer, targets.glowTarget);
      targetRenderer.setClearColor(0x000000, 0);
      targetRenderer.clear(true, true, true);
      compositeMaterial.uniforms.uBaseTexture.value = targets.sceneTarget.texture;
      compositeMaterial.uniforms.uBloomTexture.value = targets.glowTarget.texture;
      compositeMaterial.uniforms.uBloomStrength.value = 0;
      compositeMaterial.uniforms.uToneExposure.value = targetRenderer.toneMappingExposure;
      compositeMaterial.uniforms.uBloomAlpha.value = 0;
      configureCompositeCameraUniforms(renderCamera, targets, { dofEnabled: depthOfFieldEnabled });
      targetRenderer.setRenderTarget(outputTarget);
      applyOutputViewport();
      targetRenderer.setClearColor(0x090a0c, transparent ? 0 : 1);
      targetRenderer.clear(true, true, true);
      postQuad.material = compositeMaterial;
      targetRenderer.render(postScene, postCamera);
    }
    restoreRendererViewport();
    if (glowParticles) {
      glowParticles.visible = previousGlowVisible;
    }
    if (emissionGlowParticles) {
      emissionGlowParticles.visible = previousEmissionGlowVisible;
    }
    if (imageSplatGlowParticles) {
      imageSplatGlowParticles.visible = previousImageGlowVisible;
    }
    targetRenderer.setRenderTarget(previousTarget);
    targetRenderer.setClearColor(previousClearColor, previousAlpha);
    return;
  }

  targetRenderer.setRenderTarget(targets.sceneTarget);
  setFullTargetViewport(targetRenderer, targets.sceneTarget);
  targetRenderer.setClearColor(0x000000, 0);
  targetRenderer.clear(true, true, true);
  targetRenderer.render(scene, renderCamera);

  const previousParticlesVisible = particles?.visible ?? false;
  const previousEmissionParticlesVisible = emissionParticles?.visible ?? false;
  const previousImageParticlesVisible = imageSplatParticles?.visible ?? false;
  const previousImageMistVisible = imageSplatMistParticles?.visible ?? false;
  const previousVisibleModelVisible = visibleModelRoot?.visible ?? false;
  const previousPathVisible = cameraPathGroup.visible;
  const previousLightHandlesVisible = lightHandleGroup.visible;
  const previousTransformVisible = transformControls.visible;
  const previousBackground = scene.background;
  const previousBackgroundIntensity = scene.backgroundIntensity;
  const restoreSnapshotsVisible = setSceneModelSnapshotsVisible(false);
  const depthMaskVisibleModel =
    previousVisibleModelVisible &&
    (state.effectMode === 'emission' ||
      (state.effectMode === 'particles' && state.particleizeProgress < 0.995));
  const restoreVisibleModelColorWrite = depthMaskVisibleModel ? setVisibleModelColorWrite(false) : null;

  if (particles) {
    particles.visible = false;
  }
  if (emissionParticles) {
    emissionParticles.visible = false;
  }
  if (imageSplatParticles) {
    imageSplatParticles.visible = false;
  }
  if (imageSplatMistParticles) {
    imageSplatMistParticles.visible = state.effectMode === 'image';
  }
  if (visibleModelRoot) {
    visibleModelRoot.visible = depthMaskVisibleModel;
  }
  if (glowParticles) {
    glowParticles.visible = state.effectMode === 'particles' || state.effectMode === 'morph';
  }
  if (emissionGlowParticles) {
    emissionGlowParticles.visible = state.effectMode === 'emission' && state.emissionEnabled;
  }
  if (imageSplatGlowParticles) {
    imageSplatGlowParticles.visible = state.effectMode === 'image';
  }
  cameraPathGroup.visible = false;
  lightHandleGroup.visible = false;
  transformControls.visible = false;

  targetRenderer.setRenderTarget(targets.glowTarget);
  setFullTargetViewport(targetRenderer, targets.glowTarget);
  targetRenderer.setClearColor(0x000000, 0);
  targetRenderer.clear(true, true, true);
  scene.background = null;
  scene.backgroundIntensity = 0;
  targetRenderer.render(scene, renderCamera);
  scene.background = previousBackground;
  scene.backgroundIntensity = previousBackgroundIntensity;
  restoreVisibleModelColorWrite?.();
  restoreSnapshotsVisible();

  if (particles) {
    particles.visible = previousParticlesVisible;
  }
  if (emissionParticles) {
    emissionParticles.visible = previousEmissionParticlesVisible;
  }
  if (imageSplatParticles) {
    imageSplatParticles.visible = previousImageParticlesVisible;
  }
  if (imageSplatMistParticles) {
    imageSplatMistParticles.visible = previousImageMistVisible;
  }
  if (visibleModelRoot) {
    visibleModelRoot.visible = previousVisibleModelVisible;
  }
  if (glowParticles) {
    glowParticles.visible = previousGlowVisible;
  }
  if (emissionGlowParticles) {
    emissionGlowParticles.visible = previousEmissionGlowVisible;
  }
  if (imageSplatGlowParticles) {
    imageSplatGlowParticles.visible = previousImageGlowVisible;
  }
  cameraPathGroup.visible = previousPathVisible;
  lightHandleGroup.visible = previousLightHandlesVisible;
  transformControls.visible = previousTransformVisible;

  const blurredTarget = blurGlowTextureFor(targetRenderer, targets);
  const bloomDriver = state.effectMode === 'emission'
    ? state.emissionGlow
    : state.effectMode === 'image'
      ? state.imageSplatGlow
      : state.glowExposure;
  const bloomShape = normalizedGlowDriver(bloomDriver);
  const bloomStrength = state.effectMode === 'emission'
    ? THREE.MathUtils.clamp(0.55 + bloomShape * 1.25, 0.55, 1.8)
    : state.effectMode === 'image'
      ? THREE.MathUtils.clamp(0.65 + bloomShape * 1.4, 0.65, 2.05)
    : THREE.MathUtils.clamp(0.75 + bloomShape * 1.75, 0.75, 2.5);
  compositeMaterial.uniforms.uBaseTexture.value = targets.sceneTarget.texture;
  compositeMaterial.uniforms.uBloomTexture.value = blurredTarget.texture;
  compositeMaterial.uniforms.uBloomStrength.value = bloomStrength;
  compositeMaterial.uniforms.uToneExposure.value = targetRenderer.toneMappingExposure;
  compositeMaterial.uniforms.uBloomAlpha.value = state.effectMode === 'emission'
    ? THREE.MathUtils.clamp(0.01 + bloomShape * 0.21, 0.01, 0.22)
    : state.effectMode === 'image'
      ? THREE.MathUtils.clamp(0.015 + bloomShape * 0.23, 0.015, 0.245)
    : THREE.MathUtils.clamp(0.02 + bloomShape * 0.28, 0.02, 0.3);
  configureCompositeCameraUniforms(renderCamera, targets, { dofEnabled: depthOfFieldEnabled });

  targetRenderer.setRenderTarget(outputTarget);
  applyOutputViewport();
  targetRenderer.setClearColor(0x090a0c, transparent ? 0 : 1);
  targetRenderer.clear(true, true, true);
  postQuad.material = compositeMaterial;
  targetRenderer.render(postScene, postCamera);
  restoreRendererViewport();
  targetRenderer.setRenderTarget(previousTarget);
  targetRenderer.setClearColor(previousClearColor, previousAlpha);
}

function renderSceneWithGlow() {
  if (cameraViewLocked && cameraViewPostTargets) {
    const layout = getMainCameraViewLayout();
    resizePostTargetSet(cameraViewPostTargets, layout.renderWidth, layout.renderHeight);
    const restoreHelpers = setEditorHelpersVisible(false);

    renderer.setRenderTarget(null);
    renderer.setViewport(0, 0, layout.canvasWidth, layout.canvasHeight);
    renderer.setScissorTest(false);
    renderer.setClearColor(0x090a0c, 1);
    renderer.clear(true, true, true);

    try {
      const viewCamera = configureOutputCamera(outputFrameCamera, layout.aspect, cameraAnimation.time);
      if (state.cameraType === 'panorama') {
        renderPanoramaFor(renderer, viewCamera, {
          outputTarget: null,
          transparent: false,
          width: layout.renderWidth,
          height: layout.renderHeight,
          viewport: layout
        });
      } else {
        renderSceneWithGlowFor(
          renderer,
          viewCamera,
          cameraViewPostTargets,
          {
            outputTarget: null,
            transparent: false,
            viewport: layout,
            forceOutputComposite: true,
            dofEnabled: true
          }
        );
      }
    } finally {
      restoreHelpers();
    }
    return;
  }

  renderer.getSize(mainRendererSize);
  renderer.setViewport(0, 0, mainRendererSize.x, mainRendererSize.y);
  renderer.setScissorTest(false);
  renderSceneWithGlowFor(renderer, camera, { sceneTarget, glowTarget, blurTargetA, blurTargetB }, { dofEnabled: false });
}

function animate() {
  requestAnimationFrame(animate);
  const frameStartedAt = performance.now();
  const delta = Math.min(clock.getDelta(), 0.05);

  if (mainWebglContextLost) {
    smoothPerfStat('frameMs', performance.now() - frameStartedAt);
    return;
  }

  uniforms.uTime.value += delta * (state.effectMode === 'morph' ? Math.max(state.morphFlow, 0.05) : state.speed);
  emissionUniforms.uTime.value += delta;
  imageSplatUniforms.uTime.value += delta;
  realSplatPointUniforms.uTime.value += delta;

  if (exportSettings.autoDissolve) {
    updateDissolve(THREE.MathUtils.clamp(clock.elapsedTime / exportSettings.duration, 0, 1), false);
  }

  if (cameraAnimation.playing) {
    const nextTime = cameraAnimation.time + delta;
    setCameraTime(nextTime > cameraAnimation.duration ? 0 : nextTime, true);
  }

  advanceModelAnimation(delta);
  updateHandControl();

  if (particles && state.autoRotate && (state.effectMode === 'particles' || state.effectMode === 'morph')) {
    const rotationY = modelEffectRoot.rotation.y + delta * 0.16;
    const rotationX = Math.sin(uniforms.uTime.value * 0.16) * 0.055;
    setParticleModeRotation(rotationX, rotationY, 0);
  }

  if (state.autoRotate && state.effectMode === 'emission') {
    const rotationY = modelEffectRoot.rotation.y + delta * 0.16;
    const rotationX = Math.sin(emissionUniforms.uTime.value * 0.16) * 0.035;
    setEmissionModeRotation(rotationX, rotationY, 0);
  }

  updateCameraPathVisibility();
  orbit.update();
  restoreActiveCameraQuaternion();
  const renderStartedAt = performance.now();
  renderSceneWithGlow();
  smoothPerfStat('renderMs', performance.now() - renderStartedAt);
  const previewStartedAt = performance.now();
  if (renderCameraPreview()) {
    smoothPerfStat('cameraPreviewMs', performance.now() - previewStartedAt);
  }
  smoothPerfStat('frameMs', performance.now() - frameStartedAt);
}

function updateDissolve(value, updateControl = true) {
  state.dissolve = THREE.MathUtils.clamp(value, 0, 1);
  uniforms.uDissolve.value = state.dissolve;
  updateVisibleModelMaterials();
  syncEffectVisibility();
  if (updateControl) {
    setRangeValue('dissolve', state.dissolve);
    setValueInput('dissolve', state.dissolve);
  }
}

function stabilizeSceneModelTransformsForRender() {
  const activeRecord = getSelectedSceneModel();
  if (activeRecord) {
    applyActiveSceneModelTransform(activeRecord.transform);
    modelEffectRoot.rotation.fromArray(normalizeVectorArray(activeRecord.effectRotation, [0, 0, 0]));
  }
  sceneModelObjects.forEach((record) => {
    if (!record.snapshotRoot) {
      return;
    }
    applySceneModelTransformToObject(record.snapshotRoot, record.transform);
    const effectRoot = record.snapshotRoot.children[0];
    if (effectRoot) {
      effectRoot.rotation.fromArray(normalizeVectorArray(record.effectRotation, [0, 0, 0]));
      effectRoot.updateMatrixWorld(true);
    }
  });
  scene.updateMatrixWorld(true);
}

function renderStudioFrame(timeSeconds = 0, dissolve, cameraTimeSeconds = timeSeconds) {
  const cameraFrameTime = THREE.MathUtils.clamp(Number(cameraTimeSeconds) || 0, 0, cameraAnimation.duration);
  stabilizeSceneModelTransformsForRender();
  if (cameraAnimation.keyframes.length || parameterKeyframes.length) {
    applyKeyframedOptionsAtTime(cameraFrameTime, false);
    applyKeyframedLightsAtTime(cameraFrameTime, false);
  } else if (Number.isFinite(Number(dissolve))) {
    updateDissolve(dissolve, false);
  }
  uniforms.uTime.value = timeSeconds * (state.effectMode === 'morph' ? Math.max(state.morphFlow, 0.05) : state.speed);
  emissionUniforms.uTime.value = timeSeconds;
  imageSplatUniforms.uTime.value = timeSeconds;
  realSplatPointUniforms.uTime.value = timeSeconds;
  applyModelAnimationPose(getModelAnimationSeconds(timeSeconds, true));

  if (particles && state.autoRotate && (state.effectMode === 'particles' || state.effectMode === 'morph')) {
    const rotationY = timeSeconds * 0.16;
    const rotationX = Math.sin(uniforms.uTime.value * 0.16) * 0.055;
    setParticleModeRotation(rotationX, rotationY, 0);
  }

  if (state.autoRotate && state.effectMode === 'emission') {
    const rotationY = timeSeconds * 0.16;
    const rotationX = Math.sin(emissionUniforms.uTime.value * 0.16) * 0.035;
    setEmissionModeRotation(rotationX, rotationY, 0);
  }

  orbit.update();
  restoreActiveCameraQuaternion();
  const exportResolution = getExportResolution();
  const previousRenderSize = new THREE.Vector2();
  renderer.getSize(previousRenderSize);
  const previousPixelRatio = renderer.getPixelRatio();
  const shouldResizeForExport =
    Math.round(previousRenderSize.x) !== exportResolution.width ||
    Math.round(previousRenderSize.y) !== exportResolution.height ||
    Math.abs(previousPixelRatio - EXPORT_RENDER_PIXEL_RATIO) > 0.0001;
  const restoreHelpers = setEditorHelpersVisible(false);
  try {
    if (shouldResizeForExport) {
      renderer.setPixelRatio(EXPORT_RENDER_PIXEL_RATIO);
      renderer.setSize(exportResolution.width, exportResolution.height, false);
      resizePostTargets();
    }
    const renderCamera = configureOutputCamera(outputFrameCamera, exportResolution.aspect, cameraFrameTime);
    if (state.cameraType === 'panorama') {
      renderPanoramaFor(renderer, renderCamera, {
        outputTarget: null,
        transparent: exportSettings.transparent,
        width: exportResolution.width,
        height: exportResolution.height
      });
    } else {
      renderSceneWithGlowFor(
        renderer,
        renderCamera,
        { sceneTarget, glowTarget, blurTargetA, blurTargetB },
        { dofEnabled: true }
      );
    }
    return canvas.toDataURL('image/png');
  } finally {
    if (shouldResizeForExport) {
      renderer.setPixelRatio(previousPixelRatio);
      renderer.setSize(previousRenderSize.x, previousRenderSize.y, false);
      resizePostTargets();
    }
    restoreHelpers();
  }
}

async function prepareExportFrame(timeSeconds = 0, cameraTimeSeconds = timeSeconds) {
  stabilizeSceneModelTransformsForRender();
  await syncVideoPlanesForRenderTime(timeSeconds);
  renderStudioFrame(timeSeconds, undefined, cameraTimeSeconds);
  await nextFrame();
  await syncVideoPlanesForRenderTime(timeSeconds);
  renderStudioFrame(timeSeconds, undefined, cameraTimeSeconds);
  return true;
}

function isStudioReady() {
  const hasRenderable =
    Boolean(particles) ||
    Boolean(emissionParticles) ||
    Boolean(imageSplatRoot) ||
    Boolean(realSplatRoot);
  return initialModelReady && statusText.textContent === 'Ready' && hasRenderable;
}

function measurePointGeometryBounds(geometry) {
  const position = geometry?.attributes?.position;
  if (!position?.count) {
    return null;
  }

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  const stride = Math.max(1, Math.floor(position.count / 12000));
  for (let index = 0; index < position.count; index += stride) {
    const x = position.getX(index);
    const y = position.getY(index);
    const z = position.getZ(index);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  }

  return {
    count: position.count,
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
    size: [maxX - minX, maxY - minY, maxZ - minZ]
  };
}

function rotationSnapshot(object) {
  return object
    ? [object.rotation.x, object.rotation.y, object.rotation.z].map((value) => Number(value.toFixed(6)))
    : null;
}

function worldRotationSnapshot(object) {
  if (!object) {
    return null;
  }
  object.updateMatrixWorld(true);
  const quaternion = new THREE.Quaternion();
  object.getWorldQuaternion(quaternion);
  const euler = new THREE.Euler().setFromQuaternion(quaternion, object.rotation.order);
  return [euler.x, euler.y, euler.z].map((value) => Number(value.toFixed(6)));
}

function getPerformanceStats() {
  const logicalSize = renderer.getSize(new THREE.Vector2());
  const drawingSize = renderer.getDrawingBufferSize(new THREE.Vector2());
  return {
    ...perfStats,
    frameMs: Number(perfStats.frameMs.toFixed(2)),
    renderMs: Number(perfStats.renderMs.toFixed(2)),
    cameraPreviewMs: Number(perfStats.cameraPreviewMs.toFixed(2)),
    buildMs: Number(perfStats.buildMs.toFixed(2)),
    canvas: {
      cssWidth: Math.round(canvas.clientWidth),
      cssHeight: Math.round(canvas.clientHeight),
      logicalWidth: Math.round(logicalSize.x),
      logicalHeight: Math.round(logicalSize.y),
      drawingWidth: Math.round(drawingSize.x),
      drawingHeight: Math.round(drawingSize.y)
    },
    rendererInfo: {
      geometries: renderer.info.memory.geometries,
      textures: renderer.info.memory.textures,
      calls: renderer.info.render.calls,
      points: renderer.info.render.points,
      triangles: renderer.info.render.triangles
    }
  };
}

window.particleStudio = {
  isReady: isStudioReady,
  renderFrame: renderStudioFrame,
  renderFrameAsync: renderStudioFrameAsync,
  prepareExportFrame,
  undo: undoLastAction,
  canUndo: () => undoHistory.past.length > 0 && !undoHistory.restoring,
  checkpointUndo: (label = '编辑') => recordUndoStep(label),
  setOptions: (options, updateUi = false) => applyOptionsSnapshot(options, updateUi),
  setMorphTargetModel: async (target = {}) => {
    if (!target?.url && !target?.dataUrl) {
      clearMorphTarget({ rebuild: true });
      return false;
    }
    await loadMorphTargetUrl(target.url || target.dataUrl, {
      name: target.name,
      extension: target.extension,
      dataUrl: target.dataUrl
    });
    return true;
  },
  setDissolve: (value) => updateDissolve(value),
  setCameraCurve: (curve, strength, options = {}) => setCameraCurve(curve, strength, options),
  setCameraPathMode: (mode) => setCameraPathMode(mode),
  getCameraCurve: () => ({
    curve: cameraAnimation.curve,
    strength: cameraAnimation.curveStrength,
    pathMode: cameraAnimation.pathMode,
    selectedKeyframeId
  }),
  setCameraKeyframes: (keyframes) => importCameraKeyframes(keyframes),
  setParameterKeyframes: (keyframes) => importParameterKeyframes(keyframes),
  getParameterKeyframes: () => serializeParameterKeyframes(),
  clearCameraKeyframes: () => clearCameraKeyframes(),
  setCameraTime: (time, applyCamera = true) => setCameraTime(Number(time), applyCamera),
  getCameraKeyframes: () => getSortedCameraKeyframes(),
  setCameraSnapshot: (snapshot, options = {}) => applyCameraSnapshot(snapshot, options),
  setCameraSettings: (settings, updateUi = true) => setCameraSettings(settings, updateUi),
  getCameraSettings,
  setExportResolution,
  getOptions: () => ({ ...captureKeyframeOptions(), ...getCameraSettings() }),
  setLights: (lights) => importSceneLights(lights, false),
  getLights: () => serializeSceneLights(),
  getPerformanceStats,
  setModelAnimation: (options = {}) => {
    if (options.clipIndex !== undefined) {
      setModelAnimationClip(Number(options.clipIndex));
    }
    if (options.enabled !== undefined) {
      state.modelAnimEnabled = Boolean(options.enabled);
    }
    if (options.playing !== undefined) {
      state.modelAnimPlaying = Boolean(options.playing);
    }
    if (options.progress !== undefined) {
      state.modelAnimProgress = normalizeNumericStateValue('modelAnimProgress', Number(options.progress));
      if (options.playing === undefined) {
        state.modelAnimPlaying = false;
      }
    }
    if (options.speed !== undefined) {
      state.modelAnimSpeed = normalizeNumericStateValue('modelAnimSpeed', Number(options.speed));
    }
    modelAnimation.lastPoseTime = Number.NaN;
    modelAnimation.lastGeometryMode = '';
    applyModelAnimationPose(getModelAnimationSeconds(0, false), { force: true });
    syncModelAnimationUi();
    return window.particleStudio.getModelAnimation();
  },
  getModelAnimation: () => ({
    clips: modelAnimation.clips.map((clip) => ({ name: clip.name, duration: clip.duration, tracks: clip.tracks.length })),
    clipIndex: modelAnimation.clipIndex,
    enabled: state.modelAnimEnabled,
    playing: state.modelAnimPlaying,
    progress: state.modelAnimProgress,
    speed: state.modelAnimSpeed,
    duration: modelAnimation.duration,
    poseVersion: modelAnimation.poseVersion,
    hasParticleBindings: Boolean(particles?.geometry?.userData?.animationBindings),
    hasEmissionBindings: Boolean(emissionParticles?.geometry?.userData?.animationBindings)
  }),
  getParticleBounds: () => ({
    particles: measurePointGeometryBounds(particles?.geometry),
    emission: measurePointGeometryBounds(emissionParticles?.geometry)
  }),
  getEffectRotationState: () => ({
    effectMode: state.effectMode,
    autoRotate: state.autoRotate,
    modelEffectRoot: rotationSnapshot(modelEffectRoot),
    particles: rotationSnapshot(particles),
    glowParticles: rotationSnapshot(glowParticles),
    visibleModel: rotationSnapshot(visibleModelRoot),
    emissionParticles: rotationSnapshot(emissionParticles),
    emissionGlowParticles: rotationSnapshot(emissionGlowParticles),
    worldParticles: worldRotationSnapshot(particles),
    worldVisibleModel: worldRotationSnapshot(visibleModelRoot),
    worldEmissionParticles: worldRotationSnapshot(emissionParticles)
  }),
  setWorldEnvironment: async (world = {}) => {
    const worldUrl = world?.url || world?.dataUrl;
    if (!worldUrl) {
      disposeWorldEnvironment();
      currentWorldPayload = null;
      if (world.enabled !== undefined) {
        state.worldEnabled = Boolean(world.enabled);
      }
      syncWorldEnvironment();
      return false;
    }

    state.worldEnabled = world.enabled !== undefined ? Boolean(world.enabled) : true;
    state.worldVisible = Boolean(world.visible);
    state.worldIntensity = normalizeNumericStateValue('worldIntensity', Number(world.intensity ?? state.worldIntensity));
    state.worldBlur = normalizeNumericStateValue('worldBlur', Number(world.blur ?? state.worldBlur));
    state.worldRotation = normalizeNumericStateValue('worldRotation', Number(world.rotation ?? state.worldRotation));
    await loadWorldEnvironmentUrl(worldUrl, {
      name: world.name || worldUrl.split('/').pop()?.split('?')[0] || 'HDR Environment',
      extension: world.extension,
      enabled: state.worldEnabled
    });
    if (world.dataUrl) {
      currentWorldPayload = {
        name: world.name || `environment.${world.extension || 'hdr'}`,
        extension: world.extension || 'hdr',
        dataUrl: world.dataUrl
      };
    }
    syncUi();
    return true;
  },
  getWorldEnvironment: () => ({
    hasTexture: Boolean(worldPmremTarget?.texture),
    enabled: state.worldEnabled,
    visible: state.worldVisible,
    export: state.worldExport,
    intensity: state.worldIntensity,
    backgroundIntensity: state.worldIntensity,
    blur: state.worldBlur,
    rotation: state.worldRotation
  }),
  setImageSplatObject: async (imageSplat = {}) => {
    if (!imageSplat?.url && !imageSplat?.dataUrl) {
      removeImageSplatObject();
      await removeRealSplatObject();
      currentImageSplatPayload = null;
      currentGaussianSplatPayload = null;
      if (state.effectMode === 'image') {
        setEffectMode('particles');
      }
      return false;
    }

    if (imageSplat.params) {
      await applyOptionsSnapshot({ ...imageSplat.params, effectMode: 'image' }, false);
    } else {
      state.effectMode = 'image';
    }
    const url = imageSplat.url || imageSplat.dataUrl;
    const extension = (imageSplat.extension || '').toLowerCase();
    if (imageSplat.kind === 'gaussian' || GAUSSIAN_SPLAT_EXTENSIONS.has(extension)) {
      await loadGaussianSplatUrl(url, {
        name: imageSplat.name,
        extension,
        path: imageSplat.path,
        dataUrl: imageSplat.dataUrl,
        params: imageSplat.params,
        transform: imageSplat.transform,
        resetView: false
      });
    } else {
      await loadImageSplatUrl(url, {
        name: imageSplat.name,
        extension,
        dataUrl: imageSplat.dataUrl,
        transform: imageSplat.transform,
        resetView: false
      });
    }
    syncUi();
    return true;
  },
  getImageSplatObject: () => ({
    loaded: Boolean(imageSplatRoot || realSplatRoot),
    kind: realSplatRoot
      ? realSplatRoot.userData?.isSharpPreview ? 'sharp-preview' : 'gaussian'
      : imageSplatRoot ? 'image-preview' : 'none',
    name: currentGaussianSplatPayload?.name || currentImageSplatPayload?.name || currentLabel,
    params: captureKeyframeOptions(),
    transform: captureImageSplatTransform()
  }),
  setSceneModels: (sceneModels = {}) => importSceneModels(sceneModels),
  getSceneModels: () => serializeSceneModels(),
  selectSceneModel: (id) => activateSceneModel(id),
  setVideoPlanes: (videoPlanes = {}) => importVideoPlanes(videoPlanes),
  getVideoPlanes: () => serializeVideoPlanes(),
  selectVideoPlane: (id) => selectVideoPlane(id),
  getMorphTargetModel: () => ({
    loaded: Boolean(morphTargetSource),
    name: morphTargetLabel,
    payload: currentMorphTargetPayload
      ? {
          name: currentMorphTargetPayload.name,
          extension: currentMorphTargetPayload.extension,
          hasPath: Boolean(currentMorphTargetPayload.path),
          hasDataUrl: Boolean(currentMorphTargetPayload.dataUrl),
          size: currentMorphTargetPayload.size || 0
        }
      : null
  }),
  getCurrentAsset: () => ({
    label: currentLabel,
    model: currentModelPayload
      ? {
          name: currentModelPayload.name,
          extension: currentModelPayload.extension,
          hasPath: Boolean(currentModelPayload.path),
          hasDataUrl: Boolean(currentModelPayload.dataUrl),
          size: currentModelPayload.size || 0
        }
      : null,
    morphTarget: currentMorphTargetPayload
      ? {
          name: currentMorphTargetPayload.name,
          extension: currentMorphTargetPayload.extension,
          hasPath: Boolean(currentMorphTargetPayload.path),
          hasDataUrl: Boolean(currentMorphTargetPayload.dataUrl),
          size: currentMorphTargetPayload.size || 0
        }
      : null,
    imageSplat: currentImageSplatPayload
      ? {
          name: currentImageSplatPayload.name,
          extension: currentImageSplatPayload.extension,
          hasDataUrl: Boolean(currentImageSplatPayload.dataUrl)
        }
      : null,
    gaussianSplat: currentGaussianSplatPayload
      ? {
          name: currentGaussianSplatPayload.name,
          extension: currentGaussianSplatPayload.extension,
          hasDataUrl: Boolean(currentGaussianSplatPayload.dataUrl)
        }
      : null,
    videoPlanes: videoPlaneObjects.map((record) => ({
      id: record.id,
      name: record.name,
      extension: record.extension,
      playbackExtension: record.playbackExtension,
      hasProxy: Boolean(record.proxyUrl),
      proxyCached: Boolean(record.proxyCached),
      proxyError: record.proxyError || '',
      hasPath: Boolean(record.payload?.path),
      hasDataUrl: Boolean(record.payload?.dataUrl),
      width: record.width,
      height: record.height,
      opacity: record.opacity,
      duration: getVideoPlaneDuration(record)
    }))
  }),
  hasTransformHandle: () => transformControls.visible,
  captureViewCamera: () => captureCameraSnapshot(),
  captureCameraPreview: () => {
    renderCameraPreview(true);
    return cameraPreviewUi.canvas?.toDataURL('image/png') || '';
  },
  setCameraPreviewVisible: (value) => setCameraPreviewVisible(value),
  getCameraPreviewVisible: () => cameraPreviewVisible,
  setCameraViewLocked: (value) => setCameraViewLocked(value),
  getCameraPreviewPose: () => {
    const previewCamera = configureCameraPreviewCamera(getExportResolution().aspect);
    return {
      position: previewCamera.position.toArray(),
      quaternion: previewCamera.quaternion.toArray(),
      hasTimelineCamera: Boolean(getTimelineCameraPose(cameraAnimation.time))
    };
  },
  selectCameraKeyframeForTest: (index = 0) => {
    const keyframe = getSortedCameraKeyframes()[Math.max(0, Math.round(Number(index) || 0))];
    if (!keyframe) {
      return null;
    }
    rebuildCameraPath();
    selectCameraKeyframeHandle(keyframe.id);
    return keyframe.id;
  },
  selectCameraBezierHandleForTest: (index = 0, type = 'out') => {
    const keyframes = getSortedCameraKeyframes();
    const keyframe = keyframes[Math.max(0, Math.round(Number(index) || 0))];
    const handleType = type === 'in' ? 'in' : 'out';
    if (!keyframe) {
      return null;
    }
    if (normalizeCameraPathMode(cameraAnimation.pathMode) !== 'bezier') {
      setCameraPathMode('bezier');
    }
    rebuildCameraPath();
    return selectCameraBezierHandle(keyframe.id, handleType) ? keyframe.id : null;
  },
  getTransformSelectionDebug: () => ({
    selectedSceneModelId,
    selectedKeyframeId,
    selectedLightId,
    selectedVideoPlaneId,
    selectedImageSplat,
    target: selectedImageSplat
      ? 'image'
      : selectedVideoPlaneId
        ? 'video'
        : selectedLightId
          ? 'light'
          : selectedCameraBezierHandle
            ? 'camera-bezier'
            : selectedKeyframeId
              ? 'camera'
            : selectedSceneModelId
              ? 'model'
              : 'none',
    proxyPosition: (transformControls.object === activeModelTransformRoot
      ? activeModelTransformRoot.position
      : selectedCameraBezierHandle && transformControls.object
        ? transformControls.object.position
      : selectedVideoPlaneId && transformControls.object
        ? transformControls.object.position
        : selectedTransformProxy.position).toArray(),
    proxyQuaternion: (transformControls.object === activeModelTransformRoot
      ? activeModelTransformRoot.quaternion
      : selectedCameraBezierHandle && transformControls.object
        ? transformControls.object.quaternion
      : selectedVideoPlaneId && transformControls.object
        ? transformControls.object.quaternion
        : selectedTransformProxy.quaternion).toArray(),
    targetScale: (transformControls.object === activeModelTransformRoot
      ? activeModelTransformRoot.scale
      : selectedCameraBezierHandle && transformControls.object
        ? transformControls.object.scale
      : selectedVideoPlaneId && transformControls.object
        ? transformControls.object.scale
        : selectedTransformProxy.scale).toArray(),
    activeModelPosition: activeModelTransformRoot.position.toArray(),
    proxyScale: selectedTransformProxy.scale.toArray(),
    cameraMarkerScale: selectedKeyframeObject?.scale?.toArray() || null,
    cameraDisplaySize: state.cameraDisplaySize,
    keyframeMode: selectedKeyframeMode,
    transformMode: getCurrentTransformMode(),
    transformAxes: {
      x: transformControls.showX,
      y: transformControls.showY,
      z: transformControls.showZ
    },
    axisConstraint: transformAxisConstraint ? { ...transformAxisConstraint } : null,
    bezierHandle: selectedCameraBezierHandle
      ? { keyframeId: selectedCameraBezierHandle.keyframeId, type: selectedCameraBezierHandle.type }
      : null,
    attachedToProxy: transformControls.object === selectedTransformProxy,
    attachedToBezierHandle: Boolean(selectedCameraBezierHandle && transformControls.object === selectedCameraBezierHandle.object),
    attachedToModelRoot: transformControls.object === activeModelTransformRoot,
    attachedToVideoRoot: Boolean(selectedVideoPlaneId && transformControls.object === getSelectedVideoPlane()?.root),
    modalTransform: modalTransform
      ? {
          mode: modalTransform.mode,
          target: modalTransform.target,
          active: true
        }
      : null,
    visible: transformControls.visible
  }),
  captureProject: () => captureProjectDocument(),
  captureRecoveryProject: () => prepareDesktopProjectDocument(captureProjectDocument()),
  saveProject: (saveAs = false) => saveProjectFromUi(Boolean(saveAs)),
  applyProject: (document) => applyProjectDocument(document),
  getSceneHitTestDebug: () => {
    const result = {
      cameraPathVisible: cameraPathGroup.visible,
      cameraHit: null,
      modelHit: null,
      activePickBox: null,
      activePickScreenBox: null
    };
    const firstKeyframe = getSortedCameraKeyframes()[0];
    const marker = firstKeyframe ? findCameraMarkerObject(firstKeyframe.id) : null;
    if (marker) {
      const screen = marker.getWorldPosition(new THREE.Vector3()).project(camera);
      pointer.set(screen.x, screen.y);
      raycaster.setFromCamera(pointer, camera);
      result.cameraHit = findCameraKeyframeIdFromPointer();
    }
    const modelBox = getActiveSceneModelPickBox();
    if (modelBox) {
      const center = modelBox.getCenter(new THREE.Vector3()).project(camera);
      pointer.set(center.x, center.y);
      raycaster.setFromCamera(pointer, camera);
      result.modelHit = findSceneModelIdFromPointerHit();
      result.activePickBox = {
        min: modelBox.min.toArray(),
        max: modelBox.max.toArray(),
        center: modelBox.getCenter(new THREE.Vector3()).toArray()
      };
      result.activePickScreenBox = getProjectedWorldBoxDebug(modelBox);
    }
    return result;
  },
  getParticleizeAlignmentDebug: () => {
    const particleBox = particles ? new THREE.Box3().setFromObject(particles) : null;
    const solidBox = visibleModelRoot ? new THREE.Box3().setFromObject(visibleModelRoot) : null;
    if (!particleBox || !solidBox || particleBox.isEmpty() || solidBox.isEmpty()) {
      return { ok: false };
    }
    const particleCenter = particleBox.getCenter(new THREE.Vector3());
    const solidCenter = solidBox.getCenter(new THREE.Vector3());
    const particleSize = particleBox.getSize(new THREE.Vector3());
    const solidSize = solidBox.getSize(new THREE.Vector3());
    const centerDistance = particleCenter.distanceTo(solidCenter);
    const sizeScale = Math.max(solidSize.length(), particleSize.length(), 0.0001);
    return {
      ok: centerDistance / sizeScale < 0.025,
      centerDistance,
      normalizedCenterDistance: centerDistance / sizeScale,
      particleCenter: particleCenter.toArray(),
      solidCenter: solidCenter.toArray(),
      particleSize: particleSize.toArray(),
      solidSize: solidSize.toArray()
    };
  },
  testMoveKeyframe: (index, delta) => {
    const keyframe = getSortedCameraKeyframes()[index];
    if (!keyframe) {
      return;
    }
    const offset = delta.map((value) => Number(value || 0));
    keyframe.position = keyframe.position.map((value, axis) => value + offset[axis]);
    keyframe.target = keyframe.target.map((value, axis) => value + offset[axis]);
    selectedKeyframeId = keyframe.id;
    rebuildCameraPath();
  },
  testRotateKeyframe: (index, euler) => {
    const keyframe = getSortedCameraKeyframes()[index];
    if (!keyframe) {
      return;
    }
    selectedKeyframeId = keyframe.id;
    syncTransformProxyFromKeyframe(keyframe);
    selectedTransformProxy.rotation.x += Number(euler[0] || 0);
    selectedTransformProxy.rotation.y += Number(euler[1] || 0);
    selectedTransformProxy.rotation.z += Number(euler[2] || 0);
    commitSelectedKeyframeTransform();
    rebuildCameraPath();
  },
  setHandControlMock: (metrics = null, options = {}) => {
    handRuntime.mockMetrics = metrics
      ? {
          x: THREE.MathUtils.clamp(Number(metrics.x ?? 0.5), 0, 1),
          y: THREE.MathUtils.clamp(Number(metrics.y ?? 0.5), 0, 1),
          z: Number(metrics.z || 0),
          open: THREE.MathUtils.clamp(Number(metrics.open ?? 0.6), 0, 1),
          pinch: THREE.MathUtils.clamp(Number(metrics.pinch ?? 0.6), 0, 1),
          velocity: THREE.MathUtils.clamp(Number(metrics.velocity ?? 0), 0, 1.6),
          vx: Number(metrics.vx || 0),
          vy: Number(metrics.vy || 0)
        }
      : null;
    if (metrics) {
      state.handControlEnabled = true;
      state.handControlMode = HAND_CONTROL_MODES.has(options.mode) ? options.mode : state.handControlMode;
      handRuntime.baseState = captureHandDrivenBaseState();
      syncHandControlUi();
      updateHandControl();
    } else if (options.disable !== false) {
      state.handControlEnabled = false;
      syncHandControlUi();
      setHandStatus('未启用');
    }
    return window.particleStudio.getHandControlState();
  },
  getHandControlState: () => ({
    enabled: state.handControlEnabled,
    active: handRuntime.active,
    mode: state.handControlMode,
    hasLandmarker: Boolean(handRuntime.landmarker),
    hasMock: Boolean(handRuntime.mockMetrics),
    status: handRuntime.lastStatus,
    lastMetrics: handRuntime.smoothed ? { ...handRuntime.smoothed } : handRuntime.mockMetrics,
    changedKeys: [...handRuntime.changedKeys],
    options: {
      influence: state.handControlInfluence,
      smoothing: state.handControlSmoothing,
      fps: state.handControlFps,
      mirror: state.handControlMirror
    }
  }),
  capturePng: () => cameraViewLocked
    ? renderStudioFrame(clock.elapsedTime, undefined, cameraAnimation.time)
    : canvas.toDataURL('image/png')
};

controlsUi.particleCount.addEventListener('input', () => {
  updateParticleCount(Number(controlsUi.particleCount.value));
});

outputUi.particleCount.addEventListener('change', () => {
  updateParticleCount(Number(outputUi.particleCount.value));
});

NUMERIC_KEYFRAME_FIELDS.forEach((key) => {
  controlsUi[key]?.addEventListener('input', () => {
    updateNumericControl(key, Number(controlsUi[key].value));
  });

  outputUi[key]?.addEventListener('change', () => {
    updateNumericControl(key, Number(outputUi[key].value));
  });
});

function updateParticleCount(value) {
  const nextValue = Math.max(MIN_PARTICLE_COUNT, Math.round(Number.isFinite(value) ? value : state.particleCount));
  state.particleCount = nextValue;
  setRangeValue('particleCount', state.particleCount);
  setValueInput('particleCount', state.particleCount);
  updateStats();
  scheduleRebuild();
}

function updateNumericControl(key, value) {
  if (!Number.isFinite(value)) {
    setValueInput(key, state[key]);
    return;
  }

  state[key] = normalizeNumericStateValue(key, value);
  if (REBUILD_NUMERIC_FIELDS.has(key)) {
    if (key === 'emissionCount' || key === 'imageSplatCount') {
      state[key] = Math.max(MIN_PARTICLE_COUNT, Math.round(state[key]));
    }
    updateStats();
    scheduleRebuild();
  }
  setRangeValue(key, state[key]);
  setValueInput(key, state[key]);
  syncUniforms();
  if (key === 'modelAnimProgress') {
    state.modelAnimPlaying = false;
    if (controlsUi.modelAnimPlaying) {
      controlsUi.modelAnimPlaying.checked = false;
    }
    modelAnimation.lastPoseTime = Number.NaN;
    modelAnimation.lastGeometryMode = '';
    applyModelAnimationPose(getModelAnimationSeconds(0, false), { force: true });
  }
  if (key === 'particleizeProgress') {
    updateVisibleModelMaterials();
    syncEffectVisibility();
  } else if (VISIBLE_MODEL_MATERIAL_FIELDS.has(key)) {
    updateVisibleModelMaterials();
  }
  if (CAMERA_KEYFRAME_FIELDS.has(key)) {
    syncCameraSettingsFromState(true);
  }
}

function normalizeNumericStateValue(key, value) {
  if (key === 'pointSize' || key === 'emissionSize' || key === 'breakSize' || key === 'imageSplatSize') {
    return Math.max(0.01, value);
  }

  if (key === 'emissionCount' || key === 'imageSplatCount') {
    return Math.max(MIN_PARTICLE_COUNT, Math.round(value));
  }

  if (key === 'imageSplatScale') {
    return Math.max(0.01, value);
  }

  if (key === 'cameraSensorWidth') {
    return THREE.MathUtils.clamp(value, 12, 70);
  }

  if (key === 'cameraFocalLength') {
    return THREE.MathUtils.clamp(value, 8, 300);
  }

  if (key === 'cameraAperture') {
    return THREE.MathUtils.clamp(value, 1.2, 22);
  }

  if (key === 'cameraFocusDistance') {
    return THREE.MathUtils.clamp(value, 0.05, CAMERA_FOCUS_DISTANCE_MAX);
  }

  if (CLAMP_01_FIELDS.has(key)) {
    return THREE.MathUtils.clamp(value, 0, 1);
  }

  if (SIGNED_NUMERIC_FIELDS.has(key)) {
    return value;
  }

  return Math.max(0, value);
}

['colorA', 'colorB'].forEach((key) => {
  controlsUi[key].addEventListener('input', () => {
    state[key] = controlsUi[key].value;
    syncUniforms();
  });
});

controlsUi.useTexture.addEventListener('change', () => {
  state.useTexture = controlsUi.useTexture.checked;
  syncUniforms();
  updateVisibleModelMaterials();
});

controlsUi.emissionEnabled.addEventListener('change', () => {
  state.emissionEnabled = controlsUi.emissionEnabled.checked;
  syncUniforms();
});

controlsUi.imageSplatPlaneVisible?.addEventListener('change', () => {
  state.imageSplatPlaneVisible = controlsUi.imageSplatPlaneVisible.checked;
  syncImageSplatUniforms();
  syncEffectVisibility();
});

controlsUi.modelAnimClip?.addEventListener('change', () => {
  setModelAnimationClip(Number(controlsUi.modelAnimClip.value));
});

controlsUi.modelAnimEnabled?.addEventListener('change', () => {
  state.modelAnimEnabled = controlsUi.modelAnimEnabled.checked;
  modelAnimation.lastPoseTime = Number.NaN;
  modelAnimation.lastGeometryMode = '';
  applyModelAnimationPose(getModelAnimationSeconds(0, false), { force: true });
  syncModelAnimationUi();
});

controlsUi.modelAnimPlaying?.addEventListener('change', () => {
  state.modelAnimPlaying = controlsUi.modelAnimPlaying.checked;
  syncModelAnimationUi();
});

controlsUi.autoRotate.addEventListener('change', () => {
  state.autoRotate = controlsUi.autoRotate.checked;
});

controlsUi.worldEnabled.addEventListener('change', () => {
  state.worldEnabled = controlsUi.worldEnabled.checked;
  syncWorldEnvironment();
});

controlsUi.worldVisible.addEventListener('change', () => {
  state.worldVisible = controlsUi.worldVisible.checked;
  syncWorldEnvironment();
});

controlsUi.worldExport.addEventListener('change', () => {
  state.worldExport = controlsUi.worldExport.checked;
});

controlsUi.handControlEnabled?.addEventListener('change', () => {
  if (controlsUi.handControlEnabled.checked) {
    startHandControl();
  } else {
    stopHandControl();
  }
});

controlsUi.handControlMode?.addEventListener('change', () => {
  state.handControlMode = HAND_CONTROL_MODES.has(controlsUi.handControlMode.value)
    ? controlsUi.handControlMode.value
    : 'fluid';
  handRuntime.baseState = captureHandDrivenBaseState();
  syncHandControlUi();
});

controlsUi.handControlMirror?.addEventListener('change', () => {
  state.handControlMirror = controlsUi.handControlMirror.checked;
  syncHandControlUi();
});

controlsUi.handControlRebase?.addEventListener('click', () => {
  handRuntime.baseState = captureHandDrivenBaseState();
  handRuntime.smoothed = null;
  handRuntime.previousRaw = null;
  setHandStatus(state.handControlEnabled ? '基准已更新' : '已设基准');
});

HAND_CONTROL_NUMERIC_FIELDS.forEach((key) => {
  controlsUi[key]?.addEventListener('input', () => {
    updateHandControlOption(key, Number(controlsUi[key].value));
  });
  outputUi[key]?.addEventListener('change', () => {
    updateHandControlOption(key, Number(outputUi[key].value));
  });
});

controlsUi.cameraType?.addEventListener('change', () => {
  setCameraType(controlsUi.cameraType.value);
  if (controlsUi.exportFormat) {
    if (state.cameraType === 'panorama') {
      controlsUi.exportFormat.value = 'mp4-360';
    } else if (controlsUi.exportFormat.value === 'mp4-360') {
      controlsUi.exportFormat.value = 'mp4';
    }
    syncExportFormatUi();
  }
});

controlsUi.exportFormat?.addEventListener('change', () => {
  if (controlsUi.exportFormat.value === 'mp4-360') {
    setCameraType('panorama');
  }
  syncExportFormatUi();
});
syncExportFormatUi();

controlsUi.cameraDofEnabled?.addEventListener('change', () => {
  state.cameraDofEnabled = controlsUi.cameraDofEnabled.checked;
  if (state.cameraDofEnabled) {
    state.cameraFocusDistance = getCurrentCameraFocusDistance();
  }
  syncCameraSettingsFromState(true);
});

controlsUi.cameraDisplaySize?.addEventListener('input', () => {
  state.cameraDisplaySize = Number(controlsUi.cameraDisplaySize.value);
  syncCameraSettingsFromState(true);
});

outputUi.cameraDisplaySize?.addEventListener('change', () => {
  state.cameraDisplaySize = Number(outputUi.cameraDisplaySize.value);
  syncCameraSettingsFromState(true);
});

['input', 'change'].forEach((eventName) => {
  controlsUi.exportWidth?.addEventListener(eventName, () => {
    updateCameraPreviewLayout(true);
    setCameraPreviewDirty();
  });
  controlsUi.exportHeight?.addEventListener(eventName, () => {
    updateCameraPreviewLayout(true);
    setCameraPreviewDirty();
  });
});

controlsUi.timeline.addEventListener('input', () => {
  cameraAnimation.playing = false;
  updatePlayButton();
  setCameraTime(Number(controlsUi.timeline.value), true);
});

controlsUi.duration.addEventListener('change', () => {
  setCameraDuration(Number(controlsUi.duration.value));
});

controlsUi.cameraPathMode?.addEventListener('change', () => {
  setCameraPathMode(controlsUi.cameraPathMode.value);
});

controlsUi.cameraCurve?.addEventListener('change', () => {
  setCameraCurve(controlsUi.cameraCurve.value, controlsUi.cameraCurveStrength?.value);
});

controlsUi.cameraCurveStrength?.addEventListener('change', () => {
  setCameraCurve(controlsUi.cameraCurve?.value, controlsUi.cameraCurveStrength.value);
});

controlsUi.playTimeline.addEventListener('click', () => {
  toggleTimelinePlayback();
});

controlsUi.addKeyframe.addEventListener('click', () => {
  addCameraKeyframe();
});

controlsUi.clearKeyframes.addEventListener('click', () => {
  clearCameraKeyframes();
});

cameraViewUi.toggle?.addEventListener('click', () => {
  setCameraViewLocked(!cameraViewLocked);
});

controlsUi.moveKeyframe.addEventListener('click', () => {
  setSelectedKeyframeMode('translate');
});

controlsUi.rotateKeyframe.addEventListener('click', () => {
  setSelectedKeyframeMode('rotate');
});

controlsUi.scaleKeyframe?.addEventListener('click', () => {
  setSelectedKeyframeMode('scale');
});

projectUi.save?.addEventListener('click', () => {
  void saveProjectFromUi(false);
});

projectUi.open?.addEventListener('click', () => {
  void openProjectFromUi();
});

projectUi.input?.addEventListener('change', async () => {
  const file = projectUi.input.files?.[0];
  projectUi.input.value = '';
  if (!file) {
    return;
  }
  try {
    setStatus('Opening project');
    const document = JSON.parse((await file.text()).replace(/^\uFEFF/, ''));
    await applyProjectDocument(document);
    currentProjectName = file.name;
    syncProjectName();
  } catch (error) {
    console.error(error);
    setStatus('Project open failed');
  }
});

controlsUi.moveImageSplat?.addEventListener('click', () => {
  selectImageSplatObject();
  setSelectedImageSplatMode('translate');
});

controlsUi.rotateImageSplat?.addEventListener('click', () => {
  selectImageSplatObject();
  setSelectedImageSplatMode('rotate');
});

controlsUi.scaleImageSplat?.addEventListener('click', () => {
  selectImageSplatObject();
  setSelectedImageSplatMode('scale');
});

localSharpUi.run?.addEventListener('click', () => {
  runLocalSharpFromCurrentImage();
});

localSharpUi.check?.addEventListener('click', () => {
  checkLocalSharpStatus();
});

localSharpUi.install?.addEventListener('click', () => {
  installLocalSharpRuntime();
});

controlsUi.addSceneModel?.addEventListener('click', () => {
  pendingModelImportMode = 'append';
  appendModelImportClickArmed = true;
  modelInput?.click();
  queueMicrotask(() => {
    appendModelImportClickArmed = false;
  });
});

controlsUi.duplicateSceneModel?.addEventListener('click', () => {
  duplicateSelectedSceneModel();
});

controlsUi.deleteSceneModel?.addEventListener('click', () => {
  deleteSelectedSceneModel();
});

controlsUi.moveSceneModel?.addEventListener('click', () => {
  setSelectedSceneModelMode('translate');
});

controlsUi.rotateSceneModel?.addEventListener('click', () => {
  setSelectedSceneModelMode('rotate');
});

controlsUi.scaleSceneModel?.addEventListener('click', () => {
  setSelectedSceneModelMode('scale');
});

controlsUi.addVideoPlane?.addEventListener('click', () => {
  modelInput?.click();
});

controlsUi.duplicateVideoPlane?.addEventListener('click', () => {
  duplicateSelectedVideoPlane();
});

controlsUi.deleteVideoPlane?.addEventListener('click', () => {
  deleteSelectedVideoPlane();
});

controlsUi.moveVideoPlane?.addEventListener('click', () => {
  setSelectedVideoPlaneMode('translate');
});

controlsUi.rotateVideoPlane?.addEventListener('click', () => {
  setSelectedVideoPlaneMode('rotate');
});

controlsUi.scaleVideoPlane?.addEventListener('click', () => {
  setSelectedVideoPlaneMode('scale');
});

[
  ['videoPlaneWidth', 'width'],
  ['videoPlaneHeight', 'height'],
  ['videoPlaneOpacity', 'opacity'],
  ['videoPlanePlaybackRate', 'playbackRate'],
  ['videoPlaneTime', 'timeOffset']
].forEach(([controlKey, propertyKey]) => {
  controlsUi[controlKey]?.addEventListener('input', () => {
    updateSelectedVideoPlaneProperty(propertyKey, Number(controlsUi[controlKey].value));
  });
  outputUi[controlKey]?.addEventListener('change', () => {
    updateSelectedVideoPlaneProperty(propertyKey, Number(outputUi[controlKey].value));
  });
});

controlsUi.videoPlaneLoop?.addEventListener('change', () => {
  updateSelectedVideoPlaneProperty('loop', controlsUi.videoPlaneLoop.checked);
});

lightsUi.addPoint?.addEventListener('click', () => createSceneLight('point'));
lightsUi.addSun?.addEventListener('click', () => createSceneLight('sun'));
lightsUi.addSpot?.addEventListener('click', () => createSceneLight('spot'));
lightsUi.addArea?.addEventListener('click', () => createSceneLight('area'));
lightsUi.delete?.addEventListener('click', deleteSelectedLight);
lightsUi.type?.addEventListener('change', () => updateSelectedLightProperty('type', lightsUi.type.value));
lightsUi.color?.addEventListener('input', () => updateSelectedLightProperty('color', lightsUi.color.value));
lightsUi.intensity?.addEventListener('input', () => updateSelectedLightProperty('intensity', Number(lightsUi.intensity.value)));
lightsUi.intensityValue?.addEventListener('change', () => updateSelectedLightProperty('intensity', Number(lightsUi.intensityValue.value)));
lightsUi.size?.addEventListener('input', () => updateSelectedLightProperty('size', Number(lightsUi.size.value)));
lightsUi.sizeValue?.addEventListener('change', () => updateSelectedLightProperty('size', Number(lightsUi.sizeValue.value)));
lightsUi.move?.addEventListener('click', () => setSelectedLightMode('translate'));
lightsUi.rotate?.addEventListener('click', () => setSelectedLightMode('rotate'));

const UNDO_SKIPPED_CONTROL_IDS = new Set([
  'timeline',
  'playTimeline',
  'toggleCameraView',
  'exportMov',
  'exportFormat',
  'saveProject',
  'openProject',
  'projectInput',
  'panelToggle',
  'moveKeyframe',
  'rotateKeyframe',
  'scaleKeyframe',
  'moveImageSplat',
  'rotateImageSplat',
  'scaleImageSplat',
  'moveSceneModel',
  'rotateSceneModel',
  'scaleSceneModel',
  'addVideoPlane',
  'moveVideoPlane',
  'rotateVideoPlane',
  'scaleVideoPlane',
  'moveLight',
  'rotateLight',
  'checkLocalSharp',
  'installLocalSharp',
  'runLocalSharp',
  'handControlEnabled',
  'modelInput',
  'worldInput',
  'morphTargetInput'
]);

function getUndoableControl(target) {
  const control = target?.closest?.('input, select, button');
  if (!control || UNDO_SKIPPED_CONTROL_IDS.has(control.id) || control.disabled) {
    return null;
  }
  if (control.tagName === 'BUTTON') {
    const mutatingButton = control.classList.contains('keyframe-dot') ||
      control.hasAttribute('data-preset') ||
      control.hasAttribute('data-effect-mode') ||
      new Set([
        'resetCamera',
        'addKeyframe',
        'clearKeyframes',
        'duplicateSceneModel',
        'deleteSceneModel',
        'duplicateVideoPlane',
        'deleteVideoPlane',
        'addPointLight',
        'addSunLight',
        'addSpotLight',
        'addAreaLight',
        'deleteLight'
      ]).has(control.id);
    return mutatingButton ? control : null;
  }
  return control;
}

document.addEventListener('pointerdown', (event) => {
  const control = getUndoableControl(event.target);
  if (control) {
    recordUndoStep(control.title || control.id || '参数调整');
  }
}, true);

window.addEventListener('pointermove', handleModalTransformPointerMove, { capture: true });
window.addEventListener('pointerdown', handleModalTransformPointerDown, { capture: true });
window.addEventListener('pointerup', handleModalTransformPointerUp, { capture: true });
window.addEventListener('contextmenu', (event) => {
  if (modalTransform) {
    event.preventDefault();
    event.stopPropagation();
  }
}, { capture: true });

document.addEventListener('focusin', (event) => {
  const control = getUndoableControl(event.target);
  if (control && control.tagName !== 'BUTTON') {
    recordUndoStep(control.id || '参数调整');
  }
}, true);

window.addEventListener('keydown', (event) => {
  const key = event.key.toLowerCase();

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    event.stopPropagation();
    void saveProjectFromUi(event.shiftKey);
    return;
  }

  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'o') {
    event.preventDefault();
    event.stopPropagation();
    void openProjectFromUi();
    return;
  }

  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    event.stopPropagation();
    void undoLastAction();
    return;
  }

  const tagName = document.activeElement?.tagName?.toLowerCase();
  if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') {
    return;
  }

  if (event.ctrlKey || event.metaKey || event.altKey) {
    return;
  }

  const hasTransformSelection = getTransformShortcutTarget() !== 'none';
  if (!hasTransformSelection) {
    return;
  }

  if (key === 'escape') {
    event.preventDefault();
    event.stopPropagation();
    if (modalTransform) {
      finishModalTransform(false);
    } else {
      resetTransformAxisConstraint(true);
    }
    return;
  }

  if (key === 'enter' && modalTransform) {
    event.preventDefault();
    event.stopPropagation();
    finishModalTransform(true);
    return;
  }

  if (key === 'g' || key === 'w') {
    event.preventDefault();
    event.stopPropagation();
    beginModalTransform('translate', event);
    return;
  }

  if (key === 'r' || key === 'e') {
    event.preventDefault();
    event.stopPropagation();
    beginModalTransform('rotate', event);
    return;
  }

  if (key === 's') {
    event.preventDefault();
    event.stopPropagation();
    beginModalTransform('scale', event);
    return;
  }

  if (['x', 'y', 'z'].includes(key) && transformControls.visible) {
    event.preventDefault();
    event.stopPropagation();
    setTransformAxisConstraint(key, event.shiftKey ? 'lock' : 'only');
    if (modalTransform && Number.isFinite(lastScenePointer.clientX) && Number.isFinite(lastScenePointer.clientY)) {
      applyModalTransform(lastScenePointer.clientX, lastScenePointer.clientY);
    }
  }
});

controlsUi.exportMov.addEventListener('click', () => {
  exportMovFromUi();
});

presetButtons.forEach((button) => {
  button.addEventListener('click', () => setPreset(button.dataset.preset));
});

effectModeButtons.forEach((button) => {
  button.addEventListener('click', () => setEffectMode(button.dataset.effectMode));
});

resetCameraButton.addEventListener('click', resetCamera);
panelToggle?.addEventListener('click', () => {
  setPanelCollapsed(!document.body.classList.contains('panel-collapsed'));
});
cameraPreviewUi.hide?.addEventListener('click', () => {
  setCameraPreviewVisible(false);
});
cameraPreviewUi.restore?.addEventListener('click', () => {
  setCameraPreviewVisible(true);
});
renderer.domElement.addEventListener('pointerdown', handlePathPointerDown, { capture: true });

modelInput.addEventListener('click', (event) => {
  if (!appendModelImportClickArmed) {
    pendingModelImportMode = 'replace';
  }

  if (event?.key?.toLowerCase?.() === 's' && selectedKeyframeId) {
    setSelectedKeyframeMode('scale');
  }
});

modelInput.addEventListener('change', () => {
  const [file] = modelInput.files;
  const importMode = pendingModelImportMode;
  pendingModelImportMode = 'replace';
  if (file) {
    const extension = file.name.split('.').pop()?.toLowerCase();
    if (VIDEO_EXTENSIONS.has(extension)) {
      recordUndoStep('导入视频');
      loadAssetFile(file, { importMode });
      modelInput.value = '';
      return;
    }
    recordUndoStep(importMode === 'append' ? '追加模型' : '导入模型');
    loadAssetFile(file, { importMode });
  }
  modelInput.value = '';
});

worldUi.input?.addEventListener('change', () => {
  const [file] = worldUi.input.files;
  if (file) {
    loadWorldFile(file);
  }
});

morphUi.input?.addEventListener('change', () => {
  const [file] = morphUi.input.files;
  if (file) {
    loadMorphTargetFile(file);
  }
});

['dragenter', 'dragover'].forEach((eventName) => {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.add('dragging');
  });

  worldUi.dropZone?.addEventListener(eventName, (event) => {
    event.preventDefault();
    worldUi.dropZone.classList.add('dragging');
  });

  morphUi.dropZone?.addEventListener(eventName, (event) => {
    event.preventDefault();
    morphUi.dropZone.classList.add('dragging');
  });
});

['dragleave', 'drop'].forEach((eventName) => {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.remove('dragging');
  });

  worldUi.dropZone?.addEventListener(eventName, (event) => {
    event.preventDefault();
    worldUi.dropZone.classList.remove('dragging');
  });

  morphUi.dropZone?.addEventListener(eventName, (event) => {
    event.preventDefault();
    morphUi.dropZone.classList.remove('dragging');
  });
});

dropZone.addEventListener('drop', (event) => {
  const [file] = event.dataTransfer.files;
  if (file) {
    const extension = file.name.split('.').pop()?.toLowerCase();
    if (VIDEO_EXTENSIONS.has(extension)) {
      recordUndoStep('导入视频');
      pendingModelImportMode = 'replace';
      loadAssetFile(file, { importMode: 'replace' });
      return;
    }
    recordUndoStep('导入模型');
    pendingModelImportMode = 'replace';
    loadAssetFile(file, { importMode: 'replace' });
  }
});

worldUi.dropZone?.addEventListener('drop', (event) => {
  const [file] = event.dataTransfer.files;
  if (file) {
    loadWorldFile(file);
  }
});

morphUi.dropZone?.addEventListener('drop', (event) => {
  const [file] = event.dataTransfer.files;
  if (file) {
    loadMorphTargetFile(file);
  }
});

function resizeRenderer() {
  const size = getMainCanvasCssSize();
  camera.aspect = size.aspect;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(renderPixelRatio);
  renderer.setSize(size.width, size.height, false);
  resizePostTargets();
  uniforms.uPixelRatio.value = studioPixelRatio;
  imageSplatUniforms.uPixelRatio.value = studioPixelRatio;
  updateCameraPreviewLayout(true);
  setCameraPreviewDirty();
}

window.addEventListener('resize', () => {
  applyWorkspaceLayout(workspaceLayoutState, { persist: false });
  resizeRenderer();
});
