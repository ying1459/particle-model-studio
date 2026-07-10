import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpegPath from 'ffmpeg-static';
import { _electron as electron } from 'playwright';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packaged = process.argv.includes('--packaged');
const executablePath = packaged
  ? path.join(rootDir, 'release', 'win-unpacked', 'Particle Model Studio.exe')
  : path.join(rootDir, 'node_modules', 'electron', 'dist', 'electron.exe');
const expectedVersion = JSON.parse(await readFile(path.join(rootDir, 'package.json'), 'utf8')).version;
const errors = [];
const projectSmokePath = path.join(rootDir, 'verification', 'electron-project-smoke.pms');
const streamedProjectSmokePath = path.join(rootDir, 'verification', 'electron-streamed-project-smoke.pms');
const streamedAssetSmokePath = path.join(rootDir, 'verification', 'electron-streamed-asset-smoke.ply');
const videoProjectSmokePath = path.join(rootDir, 'verification', 'electron-video-project-smoke.pms');
const videoAssetSmokePath = path.join(rootDir, 'verification', 'electron-video-asset-smoke.mp4');
const movAssetSmokePath = path.join(rootDir, 'verification', 'electron-video-alpha-smoke.mov');
const missingProjectSmokePath = path.join(rootDir, 'verification', 'electron-missing-project-smoke.pms');
const automaticRecoveryFailurePath = path.join(rootDir, 'verification', 'missing-auto-save-dir', 'automatic-recovery-smoke.pms');
const pathReferenceProjectSmokePath = path.join(rootDir, 'verification', 'electron-path-reference-smoke.pms');
const uiScreenshotPath = path.join(rootDir, 'verification', packaged ? 'electron-ui-packaged.png' : 'electron-ui.png');
const uiCameraScreenshotPath = path.join(rootDir, 'verification', packaged ? 'electron-ui-camera-packaged.png' : 'electron-ui-camera.png');
let electronApp;
let recoverySmokeOutputPath = '';
let automaticRecoveryOutputPath = '';
const launchEnv = { ...process.env };
delete launchEnv.ELECTRON_RUN_AS_NODE;

try {
  await mkdir(path.dirname(projectSmokePath), { recursive: true });
  await rm(projectSmokePath, { force: true });
  await rm(streamedProjectSmokePath, { force: true });
  await rm(streamedAssetSmokePath, { force: true });
  await rm(videoProjectSmokePath, { force: true });
  await rm(videoAssetSmokePath, { force: true });
  await rm(movAssetSmokePath, { force: true });
  await rm(missingProjectSmokePath, { force: true });
  await rm(pathReferenceProjectSmokePath, { force: true });
  await rm(path.dirname(automaticRecoveryFailurePath), { recursive: true, force: true });
  await writeFile(streamedAssetSmokePath, Buffer.alloc(8 * 1024 * 1024, 0x5a));
  await writeFile(videoAssetSmokePath, Buffer.from('00000018667479706d703432000000006d70343269736f6d', 'hex'));
  await createAlphaMovSmoke(movAssetSmokePath);
  electronApp = await electron.launch({
    executablePath,
    args: packaged ? [] : ['.'],
    cwd: rootDir,
    env: {
      ...launchEnv,
      ELECTRON_ENABLE_LOGGING: '1'
    },
    timeout: 60000
  });
  const appVersion = await electronApp.evaluate(({ app }) => app.getVersion());
  if (appVersion !== expectedVersion) {
    throw new Error(`Packaged app version mismatch: expected ${expectedVersion}, got ${appVersion}`);
  }

  await electronApp.evaluate(async ({ dialog }, paths) => {
    dialog.showSaveDialog = async (_owner, options = {}) => {
      const requestedName = String(options.defaultPath || '');
      const filePath = requestedName.includes('streamed-project')
        ? paths.streamed
        : requestedName.includes('video-project')
          ? paths.video
        : requestedName.includes('missing-project')
          ? paths.missing
          : paths.project;
      return { canceled: false, filePath };
    };
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [paths.project] });
  }, {
    project: projectSmokePath,
    streamed: streamedProjectSmokePath,
    video: videoProjectSmokePath,
    missing: missingProjectSmokePath
  });

  const page = await electronApp.firstWindow({ timeout: 60000 });
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(`console: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => {
    errors.push(`pageerror: ${error.message}`);
  });

  await page.waitForFunction(() => window.particleStudio?.isReady(), null, { timeout: 90000 });
  await page.evaluate(() => window.particleStudio?.setCameraPreviewVisible?.(true));
  await page.waitForTimeout(60);
  const uiLayout = await page.evaluate(() => {
    const panel = document.querySelector('.panel');
    const canvas = document.querySelector('#scene');
    const topbar = document.querySelector('.workspace-topbar');
    const timeline = document.querySelector('.workspace-timeline-dock');
    const outliner = document.querySelector('.workspace-outliner-pane');
    const properties = document.querySelector('.workspace-properties-pane');
    const rightResizer = document.querySelector('.workspace-resizer-right');
    const timelineResizer = document.querySelector('.workspace-resizer-timeline');
    const sceneRows = document.querySelectorAll('.scene-model-row').length;
    const sceneCameraPanel = document.querySelector('#sceneCamerasPanel');
    const sceneCameraRows = document.querySelectorAll('.scene-camera-row').length;
    const sceneCameraEnabled = document.querySelectorAll('.scene-camera-row.enabled').length;
    const videoKeyButtons = document.querySelectorAll('.video-keyframe-dot, .video-transform-key').length;
    const frameTicks = [...document.querySelectorAll('.timeline-frame-tick')].map((item) => item.textContent.trim()).filter(Boolean);
    const timelineValue = document.querySelector('#timelineValue')?.textContent || '';
    const propertyTabs = [...document.querySelectorAll('.workspace-property-tab')].map((item) => item.dataset.propertyTab);
    const activePropertyTab = document.querySelector('.workspace-property-tab.active')?.dataset.propertyTab || '';
    const visiblePropertyPage = document.querySelector('.workspace-property-page:not([hidden])')?.dataset.propertyPage || '';
    const panelRect = panel.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    const topbarRect = topbar.getBoundingClientRect();
    const timelineRect = timeline.getBoundingClientRect();
    return {
      workspace: document.body.classList.contains('workspace-layout'),
      panelWidth: panel.clientWidth,
      panelLeft: Math.round(panelRect.left),
      panelRightGap: Math.round(window.innerWidth - panelRect.right),
      canvasLeft: Math.round(canvasRect.left),
      canvasTop: Math.round(canvasRect.top),
      canvasRightGap: Math.round(window.innerWidth - canvasRect.right),
      canvasBottomGap: Math.round(window.innerHeight - canvasRect.bottom),
      canvasWidth: Math.round(canvasRect.width),
      canvasHeight: Math.round(canvasRect.height),
      topbarHeight: Math.round(topbarRect.height),
      timelineHeight: Math.round(timelineRect.height),
      timelineTop: Math.round(timelineRect.top),
      outlinerHeight: Math.round(outliner.getBoundingClientRect().height),
      propertiesHeight: Math.round(properties.getBoundingClientRect().height),
      hasRightResizer: Boolean(rightResizer),
      hasTimelineResizer: Boolean(timelineResizer),
      frameTicks,
      timelineValue,
      propertyTabs,
      activePropertyTab,
      visiblePropertyPage,
      sceneRows,
      sceneCameraPanel: Boolean(sceneCameraPanel),
      sceneCameraRows,
      sceneCameraEnabled,
      videoKeyButtons
    };
  });
  if (
    !uiLayout.workspace ||
    uiLayout.panelWidth < 300 ||
    uiLayout.panelRightGap > 2 ||
    uiLayout.canvasLeft < 40 ||
    uiLayout.canvasTop < 30 ||
    uiLayout.canvasRightGap < uiLayout.panelWidth - 4 ||
    uiLayout.canvasBottomGap < uiLayout.timelineHeight - 4 ||
    uiLayout.canvasWidth < 480 ||
    uiLayout.canvasHeight < 280 ||
    uiLayout.timelineTop < uiLayout.canvasTop + uiLayout.canvasHeight - 2 ||
    uiLayout.outlinerHeight < 110 ||
    uiLayout.propertiesHeight < 160 ||
    !uiLayout.hasRightResizer ||
    !uiLayout.hasTimelineResizer ||
    uiLayout.frameTicks.length < 4 ||
    !uiLayout.frameTicks.includes('1') ||
    !/^.+F\d+/.test(uiLayout.timelineValue) ||
    uiLayout.propertyTabs.length < 8 ||
    !uiLayout.propertyTabs.includes('camera') ||
    uiLayout.activePropertyTab !== uiLayout.visiblePropertyPage ||
    uiLayout.sceneRows < 1 ||
    !uiLayout.sceneCameraPanel ||
    uiLayout.sceneCameraRows < 1 ||
    uiLayout.sceneCameraEnabled !== 1 ||
    uiLayout.videoKeyButtons < 9
  ) {
    throw new Error(`Packaged UI layout regression: ${JSON.stringify(uiLayout)}`);
  }
  const rightResizerStart = await page.evaluate(() => {
    const handle = document.querySelector('.workspace-resizer-right');
    const panel = document.querySelector('.panel');
    const canvas = document.querySelector('#scene');
    const handleRect = handle.getBoundingClientRect();
    return {
      x: handleRect.left + handleRect.width / 2,
      y: handleRect.top + Math.min(180, handleRect.height / 2),
      panelWidth: panel.getBoundingClientRect().width,
      canvasWidth: canvas.getBoundingClientRect().width
    };
  });
  await page.mouse.move(rightResizerStart.x, rightResizerStart.y);
  await page.mouse.down();
  await page.mouse.move(rightResizerStart.x - 72, rightResizerStart.y, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(100);
  const rightResizerEnd = await page.evaluate(() => {
    const panel = document.querySelector('.panel');
    const canvas = document.querySelector('#scene');
    return {
      panelWidth: panel.getBoundingClientRect().width,
      canvasWidth: canvas.getBoundingClientRect().width
    };
  });
  if (
    rightResizerEnd.panelWidth < rightResizerStart.panelWidth + 40 ||
    rightResizerEnd.canvasWidth > rightResizerStart.canvasWidth - 40
  ) {
    throw new Error(`Workspace right resize failed: ${JSON.stringify({ rightResizerStart, rightResizerEnd })}`);
  }
  await page.click('.workspace-reset-layout');
  await page.waitForTimeout(100);
  const resetLayout = await page.evaluate(() => {
    const panel = document.querySelector('.panel');
    const canvas = document.querySelector('#scene');
    return {
      panelWidth: Math.round(panel.getBoundingClientRect().width),
      canvasRightGap: Math.round(window.innerWidth - canvas.getBoundingClientRect().right)
    };
  });
  if (resetLayout.panelWidth < 340 || resetLayout.panelWidth > 380 || resetLayout.canvasRightGap < 340 || resetLayout.canvasRightGap > 380) {
    throw new Error(`Workspace reset layout failed: ${JSON.stringify(resetLayout)}`);
  }
  await page.click('#cameraPreviewHide');
  await page.waitForTimeout(80);
  const previewHidden = await page.evaluate(() => ({
    bodyClass: document.body.classList.contains('camera-preview-hidden'),
    api: window.particleStudio.getCameraPreviewVisible(),
    restoreDisplay: getComputedStyle(document.querySelector('#cameraPreviewRestore')).display
  }));
  if (!previewHidden.bodyClass || previewHidden.api !== false || previewHidden.restoreDisplay === 'none') {
    throw new Error(`Camera preview hide failed: ${JSON.stringify(previewHidden)}`);
  }
  await page.click('#cameraPreviewRestore');
  await page.waitForTimeout(80);
  const previewRestored = await page.evaluate(() => ({
    bodyClass: document.body.classList.contains('camera-preview-hidden'),
    api: window.particleStudio.getCameraPreviewVisible(),
    restoreDisplay: getComputedStyle(document.querySelector('#cameraPreviewRestore')).display
  }));
  if (previewRestored.bodyClass || previewRestored.api !== true || previewRestored.restoreDisplay !== 'none') {
    throw new Error(`Camera preview restore failed: ${JSON.stringify(previewRestored)}`);
  }
  await page.screenshot({ path: uiScreenshotPath, type: 'png' });
  await page.evaluate(() => {
    const properties = document.querySelector('.workspace-properties-pane') || document.querySelector('.panel');
    properties.scrollTop = properties.scrollHeight;
  });
  await page.screenshot({ path: uiCameraScreenshotPath, type: 'png' });
  await page.evaluate(() => {
    const properties = document.querySelector('.workspace-properties-pane') || document.querySelector('.panel');
    properties.scrollTop = 0;
  });
  const result = await page.evaluate(async () => {
    const hasElectronBridge = Boolean(window.electronAPI?.exportMov);
    const initialCamera = window.particleStudio.getCameraSettings();
    const camerasBefore = window.particleStudio.getSceneCameras();
    const addedCamera = window.particleStudio.addSceneCamera();
    const camerasAfterAdd = window.particleStudio.getSceneCameras();
    window.particleStudio.toggleSceneCameraHidden(addedCamera.id);
    const camerasAfterHide = window.particleStudio.getSceneCameras();
    const sceneModelsBefore = window.particleStudio.getSceneModels();
    const firstModelId = sceneModelsBefore?.models?.[0]?.id;
    let collectionResult = null;
    if (firstModelId) {
      window.particleStudio.selectSceneModelIdsForTest([firstModelId]);
      const collection = window.particleStudio.addSceneModelCollectionForTest('Smoke Collection');
      window.particleStudio.assignSelectedSceneModelsToCollectionForTest(collection.id);
      collectionResult = window.particleStudio.getSceneModels();
    }

    window.particleStudio.setCameraSettings({ displaySize: 2.5 });
    document.querySelector('#addKeyframe')?.click();
    document.querySelector('#scaleKeyframe')?.click();
    const cameraSize = window.particleStudio.getTransformSelectionDebug();

    window.particleStudio.setExportResolution(320, 160, 2);
    window.particleStudio.setCameraSettings({ type: 'panorama' });
    const panoramaFrame = window.particleStudio.renderFrame(0, undefined, 0);
    const panoramaSize = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve([image.naturalWidth, image.naturalHeight]);
      image.onerror = reject;
      image.src = panoramaFrame;
    });

    window.particleStudio.setCameraSettings({
      type: 'perspective',
      dofEnabled: true,
      aperture: 1.8,
      focusDistance: 1.5
    });
    const dofFrameBytes = window.particleStudio.renderFrame(0, undefined, 0).length;

    window.particleStudio.setParameterKeyframes([]);
    window.particleStudio.setCameraKeyframes([]);
    await window.particleStudio.setOptions({ dissolve: 0.2 }, true);
    window.particleStudio.checkpointUndo('electron smoke');
    await window.particleStudio.setOptions({ dissolve: 0.8 }, true);
    await window.particleStudio.undo();

    return {
      href: location.href,
      hasElectronBridge,
      initialCamera,
      camerasBefore: camerasBefore.items.length,
      camerasAfterAdd: camerasAfterAdd.items.length,
      addedCameraActive: camerasAfterAdd.activeId === addedCamera.id,
      addedCameraHidden: camerasAfterHide.items.find((item) => item.id === addedCamera.id)?.hidden,
      collectionCount: collectionResult?.collections?.length || 0,
      groupedModelId: collectionResult?.models?.find((item) => item.id === firstModelId)?.collectionId || '',
      cameraSize,
      panoramaSize,
      panoramaBytes: panoramaFrame.length,
      dofFrameBytes,
      undoDissolve: window.particleStudio.getOptions().dissolve,
      status: document.querySelector('#status')?.textContent || ''
    };
  });

  if (!result.hasElectronBridge) {
    throw new Error('Electron preload bridge is unavailable.');
  }
  if (result.panoramaSize[0] !== 320 || result.panoramaSize[1] !== 160 || result.panoramaBytes < 1000) {
    throw new Error(`Panorama frame failed: ${JSON.stringify(result)}`);
  }
  if (result.dofFrameBytes < 1000) {
    throw new Error(`Depth-of-field frame failed: ${JSON.stringify(result)}`);
  }
  if (
    result.camerasBefore < 1 ||
    result.camerasAfterAdd < result.camerasBefore + 1 ||
    !result.addedCameraActive ||
    result.addedCameraHidden !== true ||
    result.collectionCount < 1 ||
    !result.groupedModelId
  ) {
    throw new Error(`Scene cameras / collections failed: ${JSON.stringify(result)}`);
  }
  if (
    Math.abs(result.cameraSize?.cameraDisplaySize - 2.5) > 0.01 ||
    Math.abs(result.cameraSize?.cameraMarkerScale?.[0] - 2.5) > 0.01 ||
    result.cameraSize?.keyframeMode !== 'scale'
  ) {
    throw new Error(`Camera display size control failed: ${JSON.stringify(result.cameraSize)}`);
  }
  if (Math.abs(result.undoDissolve - 0.2) > 0.01) {
    throw new Error(`Undo failed: ${JSON.stringify(result)}`);
  }

  const modalPoint = await page.evaluate(() => {
    const canvas = document.querySelector('#scene');
    const rect = canvas.getBoundingClientRect();
    return {
      x: rect.left + rect.width * 0.58,
      y: rect.top + rect.height * 0.52
    };
  });
  const packagedModalStart = await page.evaluate(() => {
    window.particleStudio.setCameraKeyframes([
      { id: 'electron-modal-camera', time: 0, position: [0, 0.7, 7.2], target: [0, 0, 0] }
    ]);
    window.particleStudio.selectCameraKeyframeForTest(0);
    document.activeElement?.blur?.();
    return window.particleStudio.getTransformSelectionDebug();
  });
  await page.mouse.move(modalPoint.x, modalPoint.y);
  await page.keyboard.press('KeyG');
  const packagedModalDuring = await page.evaluate(() => window.particleStudio.getTransformSelectionDebug());
  await page.keyboard.press('KeyX');
  await page.mouse.move(modalPoint.x + 100, modalPoint.y + 40, { steps: 4 });
  const packagedModalConstrained = await page.evaluate(() => window.particleStudio.getTransformSelectionDebug());
  await page.mouse.click(modalPoint.x + 100, modalPoint.y + 40);
  const packagedModalEnd = await page.evaluate(() => window.particleStudio.getTransformSelectionDebug());
  const packagedXMove = Math.abs(packagedModalEnd.proxyPosition[0] - packagedModalStart.proxyPosition[0]);
  const packagedYDrift = Math.abs(packagedModalEnd.proxyPosition[1] - packagedModalStart.proxyPosition[1]);
  const packagedZDrift = Math.abs(packagedModalEnd.proxyPosition[2] - packagedModalStart.proxyPosition[2]);
  if (
    packagedModalDuring.modalTransform?.mode !== 'translate' ||
    packagedModalDuring.modalTransform?.target !== 'camera' ||
    packagedModalConstrained.axisConstraint?.axis !== 'x' ||
    packagedModalConstrained.axisConstraint?.mode !== 'only' ||
    packagedXMove < 0.005 ||
    packagedYDrift > 0.001 ||
    packagedZDrift > 0.001
  ) {
    throw new Error(`Packaged modal transform failed: ${JSON.stringify({
      packagedModalStart,
      packagedModalDuring,
      packagedModalConstrained,
      packagedModalEnd,
      packagedXMove,
      packagedYDrift,
      packagedZDrift
    })}`);
  }

  const movProxyResult = await page.evaluate(async (assetPath) => {
    const ipcProxy = await window.electronAPI.prepareVideoProxy({
      path: assetPath,
      extension: 'mov',
      name: 'electron-video-alpha-smoke.mov'
    });
    await window.particleStudio.setVideoPlanes({
      activeId: 'electron-mov-proxy-smoke',
      items: [
        {
          id: 'electron-mov-proxy-smoke',
          name: 'electron-video-alpha-smoke.mov',
          extension: 'mov',
          path: assetPath,
          width: 1.8,
          height: 1.8,
          opacity: 0.9,
          playbackRate: 1,
          loop: true,
          transform: { position: [0, 0.5, 0.25], rotation: [0, 180, 0], scale: [1, 1, 1] }
        }
      ]
    });
    window.particleStudio.addVideoPlaneKeyframe('width');
    window.particleStudio.addVideoPlaneKeyframe('position');
    window.particleStudio.addVideoPlaneKeyframe('uniformScale');
    const videoKeyframes = window.particleStudio.getVideoPlaneKeyframes();
    const asset = window.particleStudio.getCurrentAsset().videoPlanes.find((item) => item.id === 'electron-mov-proxy-smoke');
    const frame = await window.particleStudio.renderFrameAsync(0, undefined, 0);
    return {
      ipcProxy: {
        ok: ipcProxy?.ok,
        extension: ipcProxy?.extension,
        url: ipcProxy?.url,
        size: ipcProxy?.size,
        cached: Boolean(ipcProxy?.cached)
      },
      asset,
      videoKeyframes,
      frameBytes: frame.length,
      status: document.querySelector('#videoPlaneStatus')?.value || ''
    };
  }, movAssetSmokePath);
  if (
    !movProxyResult.ipcProxy?.ok ||
    movProxyResult.ipcProxy.extension !== 'webm' ||
    !movProxyResult.ipcProxy.url?.startsWith('/__runtime-asset/') ||
    movProxyResult.ipcProxy.size < 100 ||
    !movProxyResult.asset?.hasProxy ||
    !movProxyResult.asset?.proxyCached ||
    movProxyResult.asset.playbackExtension !== 'webm' ||
    movProxyResult.videoKeyframes?.length < 3 ||
    !movProxyResult.videoKeyframes?.some((keyframe) => keyframe.track === 'uniformScale') ||
    movProxyResult.frameBytes < 1000
  ) {
    throw new Error(`MOV proxy import failed: ${JSON.stringify(movProxyResult)}`);
  }
  result.movProxy = movProxyResult;

  const projectResult = await page.evaluate(async () => {
    await window.particleStudio.setOptions({ dissolve: 0.37, spread: 1.23 }, true);
    window.particleStudio.setCameraSettings({ displaySize: 1.75, focalLength: 70 });
    window.particleStudio.setCameraPathMode('bezier');
    window.particleStudio.setCameraKeyframes([
      { id: 'project-camera', time: 0, position: [0, 0.7, 7.2], target: [0, 0, 0], handleOut: [0.5, 0.25, 0] }
    ]);
    window.particleStudio.setParameterKeyframes([
      { id: 'project-param', field: 'noise', time: 1, value: 0.64 }
    ]);
    window.particleStudio.setCameraTime(0, false);
    const before = window.particleStudio.captureProject();
    const save = await window.electronAPI.saveProject({
      document: before,
      suggestedName: 'electron-project-smoke',
      saveAs: true
    });

    await window.particleStudio.setOptions({ dissolve: 0.91, spread: 0.12 }, true);
    window.particleStudio.setCameraSettings({ displaySize: 0.5, focalLength: 18 });
    window.particleStudio.setCameraPathMode('linear');
    window.particleStudio.setCameraKeyframes([]);
    window.particleStudio.setParameterKeyframes([]);

    const opened = await window.electronAPI.openProject();
    await window.particleStudio.applyProject(opened.document);
    const after = window.particleStudio.captureProject();
    return {
      save: { ok: save.ok, name: save.name, bytes: save.bytes },
      opened: { ok: opened.ok, name: opened.name },
      format: after.format,
      dissolve: after.scene.options.dissolve,
      spread: after.scene.options.spread,
      displaySize: after.scene.cameraSettings.displaySize,
      focalLength: after.scene.cameraSettings.focalLength,
      pathMode: after.scene.cameraAnimation.pathMode,
      handleOut: after.scene.cameraKeyframes[0]?.handleOut,
      cameraKeyframes: after.scene.cameraKeyframes.length,
      parameterKeyframes: after.scene.parameterKeyframes.length
    };
  });
  const savedProject = JSON.parse(await readFile(projectSmokePath, 'utf8'));
  const embeddedModel = savedProject.scene?.sceneModels?.models?.find((model) => model.dataUrl);
  if (
    !projectResult.save.ok ||
    !projectResult.opened.ok ||
    projectResult.format !== 'particle-model-studio-project' ||
    Math.abs(projectResult.dissolve - 0.37) > 0.01 ||
    Math.abs(projectResult.spread - 1.23) > 0.01 ||
    Math.abs(projectResult.displaySize - 1.75) > 0.01 ||
    Math.abs(projectResult.focalLength - 70) > 0.01 ||
    projectResult.pathMode !== 'bezier' ||
    Math.abs(Number(projectResult.handleOut?.[0] || 0) - 0.5) > 0.001 ||
    projectResult.cameraKeyframes !== 1 ||
    projectResult.parameterKeyframes !== 1 ||
    !embeddedModel
  ) {
    throw new Error(`Project save/open roundtrip failed: ${JSON.stringify({ projectResult, embeddedModel: Boolean(embeddedModel) })}`);
  }
  const uiSaveToast = await page.evaluate(async () => {
    const result = await window.particleStudio.saveProject(true);
    await new Promise((resolve) => setTimeout(resolve, 120));
    const toast = document.querySelector('.app-toast');
    return {
      ok: result?.ok,
      text: toast?.textContent || '',
      visible: Boolean(toast?.classList.contains('visible') || (result?.ok && toast?.textContent))
    };
  });
  if (!uiSaveToast.ok || !uiSaveToast.visible || !uiSaveToast.text.includes('工程已保存')) {
    throw new Error(`Project save toast failed: ${JSON.stringify(uiSaveToast)}`);
  }
  projectResult.uiSaveToast = uiSaveToast.text;
  result.project = projectResult;
  await rm(projectSmokePath, { force: true });

  const streamedSaveResult = await page.evaluate(async (assetPath) => {
    const document = window.particleStudio.captureProject();
    document.scene.sceneModels = null;
    document.scene.model = null;
    document.scene.morphTarget = null;
    document.scene.world = null;
    document.scene.imageSplat = {
      name: 'electron-streamed-asset-smoke.ply',
      extension: 'ply',
      path: assetPath,
      size: 8 * 1024 * 1024,
      kind: 'gaussian'
    };
    return window.electronAPI.saveProject({
      document,
      suggestedName: 'electron-streamed-project-smoke',
      saveAs: true
    });
  }, streamedAssetSmokePath);
  const streamedProject = JSON.parse(await readFile(streamedProjectSmokePath, 'utf8'));
  const streamedAsset = streamedProject.scene?.imageSplat;
  if (
    !streamedSaveResult?.ok ||
    streamedSaveResult.bytes < 10 * 1024 * 1024 ||
    !streamedAsset?.dataUrl?.startsWith('data:application/octet-stream;base64,Wlpa') ||
    streamedAsset.sourcePath !== streamedAssetSmokePath
  ) {
    throw new Error(`Streamed project asset save failed: ${JSON.stringify({
      streamedSaveResult,
      hasDataUrl: Boolean(streamedAsset?.dataUrl),
      sourcePath: streamedAsset?.sourcePath
    })}`);
  }
  result.streamedProject = {
    bytes: streamedSaveResult.bytes,
    sourceBytes: 8 * 1024 * 1024,
    embedded: true
  };

  const videoSaveResult = await page.evaluate(async (assetPath) => {
    const document = window.particleStudio.captureProject();
    document.scene.sceneModels = null;
    document.scene.model = null;
    document.scene.morphTarget = null;
    document.scene.world = null;
    document.scene.imageSplat = null;
    document.scene.videoPlanes = {
      activeId: 'electron-video-smoke',
      items: [
        {
          id: 'electron-video-smoke',
          name: 'electron-video-asset-smoke.mp4',
          extension: 'mp4',
          path: assetPath,
          size: 24,
          width: 2.4,
          height: 1.35,
          opacity: 0.85,
          playbackRate: 1,
          loop: true,
          transform: { position: [0, 0.5, 0.25], rotation: [0, 180, 0], scale: [1, 1, 1] }
        }
      ]
    };
    return window.electronAPI.saveProject({
      document,
      suggestedName: 'electron-video-project-smoke',
      saveAs: true
    });
  }, videoAssetSmokePath);
  const videoProject = JSON.parse(await readFile(videoProjectSmokePath, 'utf8'));
  const savedVideo = videoProject.scene?.videoPlanes?.items?.[0];
  if (
    !videoSaveResult?.ok ||
    !savedVideo?.dataUrl?.startsWith('data:video/mp4;base64,') ||
    savedVideo.sourcePath !== videoAssetSmokePath ||
    Math.abs(savedVideo.opacity - 0.85) > 0.001
  ) {
    throw new Error(`Video project asset save failed: ${JSON.stringify({
      videoSaveResult,
      hasDataUrl: Boolean(savedVideo?.dataUrl),
      sourcePath: savedVideo?.sourcePath,
      opacity: savedVideo?.opacity
    })}`);
  }
  result.videoProject = {
    bytes: videoSaveResult.bytes,
    embedded: true,
    mime: savedVideo.dataUrl.slice(0, 14)
  };

  const missingAssetResult = await page.evaluate(async () => {
    const document = window.particleStudio.captureProject();
    document.scene.sceneModels = null;
    document.scene.model = null;
    document.scene.morphTarget = null;
    document.scene.world = null;
    document.scene.imageSplat = {
      name: 'missing-asset.ply',
      extension: 'ply',
      path: 'Z:\\particle-model-studio-missing\\missing-asset.ply',
      kind: 'gaussian'
    };
    return window.electronAPI.saveProject({
      document,
      suggestedName: 'electron-missing-project-smoke',
      saveAs: true
    });
  });
  if (
    missingAssetResult?.ok ||
    missingAssetResult?.code !== 'PROJECT_ASSET_MISSING' ||
    !String(missingAssetResult?.error || '').includes('missing-asset.ply')
  ) {
    throw new Error(`Missing project asset error was not reported: ${JSON.stringify(missingAssetResult)}`);
  }
  result.missingAssetError = missingAssetResult.error;
  await rm(streamedProjectSmokePath, { force: true });
  await rm(streamedAssetSmokePath, { force: true });
  await rm(videoProjectSmokePath, { force: true });
  await rm(videoAssetSmokePath, { force: true });

  const recoveryResult = await page.evaluate(async () => {
    const document = window.particleStudio.captureRecoveryProject();
    document.scene.sceneModels = null;
    document.scene.model = null;
    document.scene.morphTarget = null;
    document.scene.world = null;
    document.scene.imageSplat = null;
    return window.electronAPI.saveProjectRecovery({
      document,
      suggestedName: 'electron-recovery-smoke'
    });
  });
  recoverySmokeOutputPath = recoveryResult?.path || '';
  if (!recoveryResult?.ok || !recoverySmokeOutputPath) {
    throw new Error(`Recovery project save failed: ${JSON.stringify(recoveryResult)}`);
  }
  const recoveryDocument = JSON.parse(await readFile(recoverySmokeOutputPath, 'utf8'));
  if (recoveryDocument.format !== 'particle-model-studio-project') {
    throw new Error(`Recovery project is invalid: ${recoverySmokeOutputPath}`);
  }
  result.recoveryProject = {
    ok: true,
    name: recoveryResult.name,
    bytes: recoveryResult.bytes
  };

  await writeFile(pathReferenceProjectSmokePath, JSON.stringify({
    format: 'particle-model-studio-project',
    schemaVersion: 1,
    appVersion: expectedVersion,
    scene: {
      sceneModels: {
        activeId: 'path-reference-model',
        models: [{
          id: 'path-reference-model',
          name: 'cs.glb',
          extension: 'glb',
          path: path.join(rootDir, 'public', 'cs.glb')
        }]
      }
    }
  }), 'utf8');
  await electronApp.evaluate(async ({ dialog }, filePath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] });
  }, pathReferenceProjectSmokePath);
  const pathReferenceResult = await page.evaluate(() => window.electronAPI.openProject());
  const pathReferenceAsset = pathReferenceResult?.document?.scene?.sceneModels?.models?.[0];
  if (
    !pathReferenceResult?.ok ||
    !pathReferenceAsset?.url?.startsWith('/__runtime-asset/') ||
    pathReferenceAsset.path !== path.join(rootDir, 'public', 'cs.glb')
  ) {
    throw new Error(`Path-reference recovery open failed: ${JSON.stringify(pathReferenceResult)}`);
  }
  result.pathReferenceRecovery = { ok: true, materialized: true };

  await electronApp.evaluate(async ({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({
      canceled: false,
      filePath
    });
  }, automaticRecoveryFailurePath);
  const automaticRecoveryResult = await page.evaluate(async () => {
    const result = await window.particleStudio.saveProject(true);
    return {
      result,
      status: document.querySelector('#status')?.textContent || ''
    };
  });
  automaticRecoveryOutputPath = automaticRecoveryResult.result?.recovery?.path || '';
  if (
    automaticRecoveryResult.result?.ok ||
    !automaticRecoveryResult.result?.recovery?.ok ||
    !automaticRecoveryOutputPath ||
    !automaticRecoveryResult.status.includes('恢复副本已保存')
  ) {
    throw new Error(`Automatic project recovery failed: ${JSON.stringify(automaticRecoveryResult)}`);
  }
  result.automaticRecovery = {
    ok: true,
    name: automaticRecoveryResult.result.recovery.name,
    status: automaticRecoveryResult.status
  };

  const exportResult = await page.evaluate(async () => {
    const source = document.createElement('canvas');
    source.width = 64;
    source.height = 32;
    const context = source.getContext('2d');
    const gradient = context.createLinearGradient(0, 0, 64, 32);
    gradient.addColorStop(0, '#0b4fff');
    gradient.addColorStop(1, '#ffb51f');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 32);
    return window.electronAPI.exportMov({
      name: `particle-electron-smoke-${Date.now()}`,
      format: 'mp4-360',
      duration: 0.25,
      fps: 4,
      width: 320,
      height: 160,
      pixelRatio: 1,
      startTime: 0,
      cameraStartTime: 0,
      effectStartTime: 0,
      options: {
        effectMode: 'image',
        imageSplatCount: 500,
        imageSplatDepth: 0.2,
        imageSplatScatter: 0,
        imageSplatSpeed: 0,
        imageSplatSize: 1.2,
        imageSplatOpacity: 1,
        imageSplatGlow: 0,
        imageSplatPlaneVisible: true,
        autoRotate: false,
        glowRadius: 0,
        glowExposure: 0
      },
      cameraKeyframes: [],
      parameterKeyframes: [],
      cameraSnapshot: {
        ...window.particleStudio.captureViewCamera(),
        cameraType: 'panorama',
        dofEnabled: false
      },
      imageSplat: {
        name: 'electron-smoke.png',
        extension: 'png',
        kind: 'image-preview',
        dataUrl: source.toDataURL('image/png'),
        params: {
          effectMode: 'image',
          imageSplatCount: 500,
          imageSplatDepth: 0.2,
          imageSplatScatter: 0,
          imageSplatSpeed: 0,
          imageSplatSize: 1.2,
          imageSplatOpacity: 1,
          imageSplatGlow: 0,
          imageSplatPlaneVisible: true
        }
      }
    });
  });
  if (!exportResult?.ok || !exportResult.path) {
    throw new Error(`Packaged 360 MP4 export failed: ${JSON.stringify(exportResult)}`);
  }
  const exportedProbe = await probeMedia(exportResult.path);
  if (!exportedProbe.includes('spherical: equirectangular') || !exportedProbe.includes('320x160')) {
    throw new Error(`Packaged 360 MP4 metadata is invalid:\n${exportedProbe}`);
  }
  result.export360 = {
    format: exportResult.format,
    width: exportResult.width,
    height: exportResult.height,
    spherical: true
  };
  await rm(exportResult.path, { force: true });
  if (errors.length) {
    throw new Error(`Renderer errors: ${errors.join(' | ')}`);
  }

  console.log(JSON.stringify({
    ok: true,
    packaged,
    executablePath,
    appVersion,
    uiLayout,
    uiScreenshotPath,
    uiCameraScreenshotPath,
    result,
    errors
  }, null, 2));
} finally {
  await electronApp?.close().catch(() => {});
  await rm(projectSmokePath, { force: true }).catch(() => {});
  await rm(streamedProjectSmokePath, { force: true }).catch(() => {});
  await rm(streamedAssetSmokePath, { force: true }).catch(() => {});
  await rm(videoProjectSmokePath, { force: true }).catch(() => {});
  await rm(videoAssetSmokePath, { force: true }).catch(() => {});
  await rm(movAssetSmokePath, { force: true }).catch(() => {});
  await rm(missingProjectSmokePath, { force: true }).catch(() => {});
  await rm(pathReferenceProjectSmokePath, { force: true }).catch(() => {});
  await rm(path.dirname(automaticRecoveryFailurePath), { recursive: true, force: true }).catch(() => {});
  if (recoverySmokeOutputPath) {
    await rm(recoverySmokeOutputPath, { force: true }).catch(() => {});
  }
  if (automaticRecoveryOutputPath) {
    await rm(automaticRecoveryOutputPath, { force: true }).catch(() => {});
  }
}

async function createAlphaMovSmoke(outputPath) {
  await runFfmpeg([
    '-y',
    '-hide_banner',
    '-f',
    'lavfi',
    '-i',
    'color=c=black@0.0:s=48x48:d=0.5:r=6,format=rgba,drawbox=x=8:y=8:w=32:h=32:color=red@0.65:t=fill',
    '-c:v',
    'qtrle',
    '-pix_fmt',
    'argb',
    outputPath
  ]);
}

async function runFfmpeg(args) {
  const child = spawn(ffmpegPath, args, {
    cwd: rootDir,
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  const [code] = await once(child, 'exit');
  if (code !== 0) {
    throw new Error(`FFmpeg exited with code ${code}:\n${stderr}`);
  }
  return stderr;
}

async function probeMedia(filePath) {
  const child = spawn(ffmpegPath, ['-hide_banner', '-i', filePath], {
    cwd: rootDir,
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  await once(child, 'exit');
  return stderr;
}
