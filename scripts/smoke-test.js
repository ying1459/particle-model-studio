import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, statSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import ffmpegPath from 'ffmpeg-static';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.SMOKE_PORT || 5174);
const baseUrl = `http://127.0.0.1:${port}/`;
const modelUrl = process.env.SMOKE_MODEL_URL || '/glb/%E5%8F%A4%E9%A3%8E1.glb';
const outDir = path.resolve(rootDir, 'verification', 'smoke');
const workspaceRoot = path.resolve(rootDir);

if (!outDir.startsWith(workspaceRoot + path.sep)) {
  throw new Error(`Refusing to clean unexpected smoke output path: ${outDir}`);
}

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

const server = await ensureServer();
let browser;

try {
  const executablePath = findChrome();
  browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {})
  });

  const page = await browser.newPage({
    viewport: { width: 960, height: 540 },
    deviceScaleFactor: 1
  });

  await page.goto(`${baseUrl}?model=${modelUrl}&t=${Date.now()}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.particleStudio?.isReady(), null, { timeout: 90000 });

  const importModeCheck = await verifyImportReplaceAndAppend(page);
  if (!importModeCheck.replaceOk || !importModeCheck.appendOk) {
    throw new Error(`Import replace/append behavior is wrong: ${JSON.stringify(importModeCheck)}`);
  }

  await page.evaluate(async () => {
    await window.particleStudio.setOptions(
      {
        effectMode: 'particles',
        particleCount: 20000,
        pointSize: 3,
        particleizeProgress: 0.5,
        sampleCleanup: 0,
        dissolve: 0,
        growth: 1,
        glowRadius: 0,
        glowExposure: 1,
        autoRotate: true
      },
      true
    );
  });
  await page.waitForFunction(() => document.querySelector('#stats')?.textContent?.includes('20K'), null, {
    timeout: 30000
  });
  await page.waitForTimeout(500);
  const particleizeRotation = await page.evaluate(() => window.particleStudio.getEffectRotationState());
  assertRotationsClose(
    particleizeRotation?.particles,
    particleizeRotation?.visibleModel,
    `Particleize visible model rotation is not following particles: ${JSON.stringify(particleizeRotation)}`
  );
  assertRotationsClose(
    particleizeRotation?.worldParticles,
    particleizeRotation?.worldVisibleModel,
    `Particleize world rotations diverged: ${JSON.stringify(particleizeRotation)}`
  );
  await page.evaluate(() => window.particleStudio.renderFrame(1, undefined, 0));
  const particleizeRenderRotation = await page.evaluate(() => window.particleStudio.getEffectRotationState());
  assertRotationsClose(
    particleizeRenderRotation?.particles,
    particleizeRenderRotation?.visibleModel,
    `Export-frame particleize rotation is not synchronized: ${JSON.stringify(particleizeRenderRotation)}`
  );
  assertRotationsClose(
    particleizeRenderRotation?.worldParticles,
    particleizeRenderRotation?.worldVisibleModel,
    `Export-frame world rotations diverged: ${JSON.stringify(particleizeRenderRotation)}`
  );
  const particleizeAlignment = await page.evaluate(() => window.particleStudio.getParticleizeAlignmentDebug());
  if (!particleizeAlignment.ok) {
    throw new Error(`Particleize solid model and particles are not aligned: ${JSON.stringify(particleizeAlignment)}`);
  }
  const handControlCheck = await page.evaluate(async () => {
    const readValue = (id) => Number(document.querySelector(id)?.value || 0);
    const before = {
      spread: readValue('#spreadValue'),
      noise: readValue('#noiseValue'),
      speed: readValue('#speedValue')
    };
    const status = window.particleStudio.setHandControlMock(
      { x: 0.85, y: 0.22, open: 0.92, pinch: 0.7, velocity: 0.75, vx: 0.6, vy: -0.2 },
      { mode: 'fluid' }
    );
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const after = {
      spread: readValue('#spreadValue'),
      noise: readValue('#noiseValue'),
      speed: readValue('#speedValue')
    };
    window.particleStudio.setHandControlMock(null);
    await window.particleStudio.setOptions({ spread: 0, noise: 0, swirl: 0, speed: 0 }, true);
    return { before, after, status };
  });
  if (
    handControlCheck.after.spread <= handControlCheck.before.spread ||
    handControlCheck.after.noise <= handControlCheck.before.noise ||
    handControlCheck.after.speed <= handControlCheck.before.speed ||
    !handControlCheck.status?.changedKeys?.includes('spread')
  ) {
    throw new Error(`Hand control mock did not drive particle parameters: ${JSON.stringify(handControlCheck)}`);
  }
  const parameterKeyframeCheck = await page.evaluate(async () => {
    window.particleStudio.clearCameraKeyframes();
    window.particleStudio.setCameraTime(0, true);
    await window.particleStudio.setOptions({ modelVisibility: 0.25 }, true);
    const dot = document.querySelector('[data-parameter-keyframe="modelVisibility"]');
    dot?.click();
    const afterFirst = {
      hasDot: Boolean(dot),
      hasClass: Boolean(dot?.classList.contains('has-keyframe')),
      atClass: Boolean(dot?.classList.contains('at-keyframe')),
      frames: window.particleStudio.getParameterKeyframes()
    };
    window.particleStudio.setCameraTime(0.5, true);
    await window.particleStudio.setOptions({ modelVisibility: 0.85 }, true);
    dot?.click();
    const afterSecond = {
      hasClass: Boolean(dot?.classList.contains('has-keyframe')),
      atClass: Boolean(dot?.classList.contains('at-keyframe')),
      frames: window.particleStudio.getParameterKeyframes()
    };
    return { afterFirst, afterSecond, dotCount: document.querySelectorAll('.keyframe-dot').length };
  });
  if (
    !parameterKeyframeCheck.afterFirst.hasDot ||
    !parameterKeyframeCheck.afterFirst.hasClass ||
    !parameterKeyframeCheck.afterFirst.atClass ||
    parameterKeyframeCheck.afterSecond.frames.filter((item) => item.field === 'modelVisibility').length !== 2 ||
    parameterKeyframeCheck.dotCount < 12
  ) {
    throw new Error(`Parameter keyframe dot UI is not working: ${JSON.stringify(parameterKeyframeCheck)}`);
  }
  await page.evaluate(() => window.particleStudio.clearCameraKeyframes());

  await page.evaluate(async ({ url }) => {
    const sharedOptions = {
      effectMode: 'particles',
      particleCount: 20000,
      pointSize: 4,
      particleizeProgress: 0.65,
      sampleCleanup: 0,
      dissolve: 0,
      growth: 1,
      spread: 0,
      noise: 0,
      swirl: 0,
      speed: 0,
      glowRadius: 0,
      glowExposure: 0,
      autoRotate: false,
      useTexture: true,
      modelVisibility: 1
    };
    await window.particleStudio.setSceneModels({
      activeId: 'visibility-model',
      models: [
        {
          id: 'visibility-model',
          name: 'visibility.glb',
          extension: 'glb',
          url,
          options: sharedOptions,
          transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }
        }
      ]
    });
    window.particleStudio.setCameraSnapshot({ position: [0, 0.85, 3.6], target: [0, 0.35, 0], fov: 42 });
  }, { url: modelUrl });
  await page.waitForFunction(() => window.particleStudio?.isReady(), null, { timeout: 60000 });

  const visibleFrame = await page.evaluate(async () => {
    await window.particleStudio.setOptions(
      {
        effectMode: 'particles',
        modelVisibility: 1,
        particleCount: 20000,
        particleizeProgress: 0.65,
        pointSize: 4,
        sampleCleanup: 0,
        glowRadius: 0,
        glowExposure: 0
      },
      true
    );
    return window.particleStudio.renderFrame(0, undefined, 0);
  });
  const hiddenFrame = await page.evaluate(async () => {
    await window.particleStudio.setOptions({ modelVisibility: 0 }, true);
    return window.particleStudio.renderFrame(0, undefined, 0);
  });
  const visibilityDifference = await measureFrameDifference(page, visibleFrame, hiddenFrame);
  if (visibilityDifference.meanDelta < 1.5 || visibilityDifference.changedRatio < 0.015) {
    throw new Error(`Model visibility slider does not visibly hide/show the model: ${JSON.stringify(visibilityDifference)}`);
  }
  await page.evaluate(async () => window.particleStudio.setOptions({ modelVisibility: 1 }, true));

  await page.evaluate(() => window.particleStudio.setCameraCurve('linear', 1, { applyToSelected: false }));
  const cameraCurve = await page.evaluate(() => window.particleStudio.getCameraCurve());
  if (cameraCurve?.curve !== 'linear' || Math.abs(Number(cameraCurve.strength) - 1) > 0.001) {
    throw new Error(`Camera curve did not apply: ${JSON.stringify(cameraCurve)}`);
  }
  const previewPoseCheck = await page.evaluate(() => {
    window.particleStudio.setCameraKeyframes([
      { id: 'preview-a', time: 0, position: [-2, 0, 5], target: [0, 0, 0], options: {} },
      { id: 'preview-b', time: 2, position: [2, 0, 5], target: [0, 0, 0], options: {} }
    ]);
    const timeline = document.querySelector('#timeline');
    timeline.value = '1';
    timeline.dispatchEvent(new Event('input', { bubbles: true }));
    window.particleStudio.setCameraSnapshot({ position: [9, 9, 9], target: [0, 0, 0], fov: 48 });
    return window.particleStudio.getCameraPreviewPose();
  });
  if (!previewPoseCheck?.hasTimelineCamera || Math.abs(Number(previewPoseCheck.position?.[0] || 0)) > 0.1) {
    throw new Error(`Camera preview is not using the timeline camera: ${JSON.stringify(previewPoseCheck)}`);
  }
  await page.evaluate(() => {
    window.particleStudio.setCameraKeyframes([]);
    window.particleStudio.setCameraSnapshot({ position: [0, 1.2, 6], target: [0, 0, 0], fov: 48 });
  });
  const lightKeyframeCheck = await page.evaluate(() => {
    const lightA = {
      id: 'smoke-light',
      type: 'spot',
      name: 'Smoke Spot',
      color: '#000000',
      intensity: 0,
      size: 0.4,
      position: [-2, 1, 3],
      quaternion: [0, 0, 0, 1]
    };
    const lightB = {
      ...lightA,
      color: '#ffffff',
      intensity: 10,
      size: 1.2,
      position: [2, 1, 3]
    };
    window.particleStudio.setLights([lightA]);
    window.particleStudio.setCameraKeyframes([
      { id: 'light-a', time: 0, position: [0, 1.2, 6], target: [0, 0, 0], options: {}, lights: [lightA] },
      { id: 'light-b', time: 2, position: [0, 1.2, 6], target: [0, 0, 0], options: {}, lights: [lightB] }
    ]);
    window.particleStudio.setCameraCurve('linear', 1, { applyToSelected: false });
    window.particleStudio.setCameraTime(1, true);
    return window.particleStudio.getLights()[0];
  });
  if (
    Math.abs(Number(lightKeyframeCheck?.position?.[0] || 0)) > 0.15 ||
    Math.abs(Number(lightKeyframeCheck?.intensity || 0) - 5) > 0.25 ||
    Math.abs(Number(lightKeyframeCheck?.size || 0) - 0.8) > 0.15
  ) {
    throw new Error(`Light keyframes are not interpolating: ${JSON.stringify(lightKeyframeCheck)}`);
  }
  await page.evaluate(() => {
    window.particleStudio.setCameraKeyframes([]);
    window.particleStudio.setLights([]);
    window.particleStudio.setCameraSnapshot({ position: [0, 1.2, 6], target: [0, 0, 0], fov: 48 });
  });

  const cameraFeatureCheck = await page.evaluate(async () => {
    window.particleStudio.setCameraSettings({
      type: 'perspective',
      sensorWidth: 24,
      focalLength: 85,
      dofEnabled: true,
      aperture: 2,
      focusDistance: 3.2
    });
    const perspective = window.particleStudio.getCameraSettings();

    await window.particleStudio.setOptions({ dissolve: 0.33 }, true);
    window.particleStudio.setParameterKeyframes([]);
    window.particleStudio.setCameraKeyframes([
      { id: 'independent-a', time: 0, position: [-1, 1, 5], target: [0, 0, 0], options: { dissolve: 0 } },
      { id: 'independent-b', time: 2, position: [1, 1, 5], target: [0, 0, 0], options: { dissolve: 1 } }
    ]);
    window.particleStudio.setCameraTime(1, true);
    const cameraOnlyDissolve = window.particleStudio.getOptions().dissolve;

    window.particleStudio.setParameterKeyframes([
      { id: 'dissolve-a', field: 'dissolve', time: 0, value: 0.1 },
      { id: 'dissolve-b', field: 'dissolve', time: 2, value: 0.9 }
    ]);
    window.particleStudio.setCameraTime(1, true);
    const independentlyKeyedDissolve = window.particleStudio.getOptions().dissolve;

    window.particleStudio.setParameterKeyframes([]);
    await window.particleStudio.setOptions({ dissolve: 0.2 }, true);
    window.particleStudio.checkpointUndo('smoke undo');
    await window.particleStudio.setOptions({ dissolve: 0.8 }, true);
    await window.particleStudio.undo();
    const undoDissolve = window.particleStudio.getOptions().dissolve;

    window.particleStudio.setParameterKeyframes([]);
    window.particleStudio.setCameraKeyframes([]);
    window.particleStudio.setExportResolution(512, 288, 12);
    window.particleStudio.setCameraSettings({ type: 'perspective', dofEnabled: true, aperture: 1.4, focusDistance: 0.5 });
    const dofFrameBytes = window.particleStudio.renderFrame(0, undefined, 0).length;
    window.particleStudio.setExportResolution(512, 256, 12);
    window.particleStudio.setCameraSettings({ type: 'panorama', dofEnabled: true });
    const panoramaSettings = window.particleStudio.getCameraSettings();
    const panoramaFrame = window.particleStudio.renderFrame(0, undefined, 0);
    const panoramaSize = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve([image.naturalWidth, image.naturalHeight]);
      image.onerror = reject;
      image.src = panoramaFrame;
    });

    window.particleStudio.setExportResolution(1920, 1080, 30);
    window.particleStudio.setCameraSettings({ type: 'perspective', dofEnabled: false, sensorWidth: 36 });
    window.particleStudio.setCameraSnapshot({ position: [0, 1.2, 6], target: [0, 0, 0], fov: 48 });
    return {
      perspective,
      cameraOnlyDissolve,
      independentlyKeyedDissolve,
      undoDissolve,
      dofFrameBytes,
      panoramaSettings,
      panoramaSize,
      panoramaBytes: panoramaFrame.length
    };
  });
  if (
    cameraFeatureCheck.perspective.type !== 'perspective' ||
    Math.abs(cameraFeatureCheck.perspective.sensorWidth - 24) > 0.01 ||
    Math.abs(cameraFeatureCheck.perspective.focalLength - 85) > 0.01 ||
    !cameraFeatureCheck.perspective.dofEnabled ||
    Math.abs(cameraFeatureCheck.perspective.aperture - 2) > 0.01
  ) {
    throw new Error(`Perspective camera settings failed: ${JSON.stringify(cameraFeatureCheck)}`);
  }
  if (Math.abs(cameraFeatureCheck.cameraOnlyDissolve - 0.33) > 0.01) {
    throw new Error(`Camera keyframes still mutate effect parameters: ${JSON.stringify(cameraFeatureCheck)}`);
  }
  if (Math.abs(cameraFeatureCheck.independentlyKeyedDissolve - 0.5) > 0.04) {
    throw new Error(`Independent parameter keyframes failed: ${JSON.stringify(cameraFeatureCheck)}`);
  }
  if (Math.abs(cameraFeatureCheck.undoDissolve - 0.2) > 0.01) {
    throw new Error(`Undo failed to restore the previous parameter value: ${JSON.stringify(cameraFeatureCheck)}`);
  }
  if (cameraFeatureCheck.dofFrameBytes < 1000) {
    throw new Error(`Depth-of-field rendering failed: ${JSON.stringify(cameraFeatureCheck)}`);
  }
  if (
    cameraFeatureCheck.panoramaSettings.type !== 'panorama' ||
    cameraFeatureCheck.panoramaSettings.dofEnabled ||
    cameraFeatureCheck.panoramaSize[0] !== 512 ||
    cameraFeatureCheck.panoramaSize[1] !== 256 ||
    cameraFeatureCheck.panoramaBytes < 1000
  ) {
    throw new Error(`Panorama rendering failed: ${JSON.stringify(cameraFeatureCheck)}`);
  }

  const restoredModelPath = path.join(rootDir, 'glb', decodeURIComponent(modelUrl.split('/').pop() || ''));
  if (existsSync(restoredModelPath)) {
    await page.setInputFiles('#modelInput', restoredModelPath);
    await page.waitForFunction(() => window.particleStudio?.isReady(), null, { timeout: 90000 });
  }

  const asset = await page.evaluate(() => window.particleStudio.getCurrentAsset());
  if (!asset?.model?.size) {
    throw new Error(`Expected a loaded model payload, got ${JSON.stringify(asset)}`);
  }

  const stats = await page.locator('#stats').innerText();
  await writeDataUrl(path.join(outDir, 'preview.png'), await page.evaluate(() => window.particleStudio.capturePng()));

  await page.evaluate(async () => {
    await window.particleStudio.setOptions(
      {
        effectMode: 'emission',
        useTexture: true,
        emissionEnabled: true,
        emissionCount: 50,
        emissionIntensity: 0.65,
        emissionDistance: 0.75,
        emissionSpeed: 0.35,
        emissionOpacity: 0.35,
        emissionSize: 1.1,
        emissionGlow: 0.15,
        modelWhite: 0,
        modelRoughness: 0.8
      },
      true
    );
  });
  await page.waitForFunction(() => document.querySelector('#stats')?.textContent?.includes('50 emission'), null, {
    timeout: 30000
  });
  const emissionStats = await page.locator('#stats').innerText();
  await writeDataUrl(
    path.join(outDir, 'emission-preview.png'),
    await page.evaluate(() => window.particleStudio.capturePng())
  );

  await page.evaluate(() => {
    window.particleStudio.setCameraKeyframes([
      { id: 'export-camera-a', time: 0, position: [-1.6, 1.1, 5.8], target: [0, 0, 0], options: {} },
      { id: 'export-camera-b', time: 2, position: [1.6, 1.1, 5.8], target: [0, 0, 0], options: {} }
    ]);
    window.particleStudio.setCameraCurve('linear', 1, { applyToSelected: false });
    window.particleStudio.setCameraTime(1, true);
  });
  const exportCameraPose = await page.evaluate(() => window.particleStudio.getCameraPreviewPose());
  if (!exportCameraPose?.hasTimelineCamera || Math.abs(Number(exportCameraPose.position?.[0] || 0)) > 0.15) {
    throw new Error(`Export camera preview is not using keyed camera: ${JSON.stringify(exportCameraPose)}`);
  }
  const sceneHitTest = await page.evaluate(() => window.particleStudio.getSceneHitTestDebug());
  if (!sceneHitTest.cameraPathVisible || !sceneHitTest.cameraHit || !sceneHitTest.modelHit) {
    throw new Error(`Camera/model viewport hit testing is broken: ${JSON.stringify(sceneHitTest)}`);
  }
  if (!sceneHitTest.activePickScreenBox?.center) {
    throw new Error(`Model pick screen box was not computed: ${JSON.stringify(sceneHitTest)}`);
  }
  await page.evaluate(() => window.particleStudio.selectCameraKeyframeForTest(0));
  const sceneHitTestAfterCameraSelect = await page.evaluate(() => window.particleStudio.getSceneHitTestDebug());
  const modelClickPoint = await page.evaluate((screenBox) => {
    const canvas = document.querySelector('#scene');
    const panel = document.querySelector('.panel');
    const rect = canvas.getBoundingClientRect();
    const panelRect = panel?.getBoundingClientRect();
    const centerX = rect.left + ((screenBox.center[0] + 1) * rect.width) / 2;
    const minX = rect.left + ((screenBox.min[0] + 1) * rect.width) / 2;
    const maxX = rect.left + ((screenBox.max[0] + 1) * rect.width) / 2;
    const centerY = rect.top + ((1 - screenBox.center[1]) * rect.height) / 2;
    const panelSafeX = panelRect ? panelRect.right + 36 : rect.left + 36;
    const x = Math.min(Math.max(panelSafeX, centerX), maxX - 24);
    return {
      x,
      y: centerY
    };
  }, sceneHitTestAfterCameraSelect.activePickScreenBox || sceneHitTest.activePickScreenBox);
  const beforeModelClickSelection = await page.evaluate(() => window.particleStudio.getTransformSelectionDebug());
  await page.mouse.click(modelClickPoint.x, modelClickPoint.y);
  await page.waitForTimeout(120);
  const afterModelClickSelection = await page.evaluate(() => window.particleStudio.getTransformSelectionDebug());
  if (beforeModelClickSelection.target !== 'camera' || afterModelClickSelection.target !== 'model') {
    throw new Error(`Clicking the visible model area did not select the model: ${JSON.stringify({
      sceneHitTest,
      sceneHitTestAfterCameraSelect,
      modelClickPoint,
      beforeModelClickSelection,
      afterModelClickSelection
    })}`);
  }
  const transformSelectionCheck = await page.evaluate(async () => {
    window.particleStudio.selectCameraKeyframeForTest(0);
    const cameraSelection = window.particleStudio.getTransformSelectionDebug();
    document.querySelector('#moveSceneModel')?.click();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const modelSelection = window.particleStudio.getTransformSelectionDebug();
    const distance = Math.hypot(
      modelSelection.proxyPosition[0] - modelSelection.activeModelPosition[0],
      modelSelection.proxyPosition[1] - modelSelection.activeModelPosition[1],
      modelSelection.proxyPosition[2] - modelSelection.activeModelPosition[2]
    );
    return { cameraSelection, modelSelection, distance };
  });
  if (
    transformSelectionCheck.cameraSelection?.target !== 'camera' ||
    transformSelectionCheck.modelSelection?.target !== 'model' ||
    transformSelectionCheck.modelSelection?.selectedKeyframeId ||
    transformSelectionCheck.distance > 0.001
  ) {
    throw new Error(`Model transform axis did not detach from camera axis: ${JSON.stringify(transformSelectionCheck)}`);
  }

  const cameraSnapshot = await page.evaluate(() => window.particleStudio.captureViewCamera());
  const cameraTime = cameraSnapshot.time || 0;
  const cameraKeyframes = await page.evaluate(() => window.particleStudio.getCameraKeyframes());
  const cameraPreviewDataUrl = await page.evaluate(() => window.particleStudio.captureCameraPreview());
  await writeDataUrl(
    path.join(outDir, 'camera-preview.png'),
    cameraPreviewDataUrl
  );
  const exportPreviewDataUrl = await page.evaluate(
    ({ cameraTime: frameCameraTime }) => window.particleStudio.renderFrame(0, undefined, frameCameraTime),
    { cameraTime }
  );
  await writeDataUrl(path.join(outDir, 'export-preview.png'), exportPreviewDataUrl);
  const previewCameraMatch = await compareRenderedFrames(page, cameraPreviewDataUrl, exportPreviewDataUrl);
  if (!previewCameraMatch.ok) {
    throw new Error(`Camera preview differs from renderFrame: ${JSON.stringify(previewCameraMatch)}`);
  }
  await page.evaluate(() => window.particleStudio.setCameraViewLocked(true));
  await page.waitForTimeout(250);
  const cameraViewDataUrl = await page.evaluate(() => window.particleStudio.capturePng());
  await writeDataUrl(path.join(outDir, 'camera-view.png'), cameraViewDataUrl);
  const cameraViewMatch = await compareRenderedFrames(page, cameraViewDataUrl, exportPreviewDataUrl);
  if (!cameraViewMatch.ok) {
    throw new Error(`Main camera view differs from renderFrame: ${JSON.stringify(cameraViewMatch)}`);
  }
  await page.evaluate(() => window.particleStudio.setCameraViewLocked(false));

  const multiModelCheck = await page.evaluate(async () => {
    const sharedOptions = {
      effectMode: 'particles',
      particleCount: 600,
      pointSize: 3,
      particleizeProgress: 1,
      sampleCleanup: 0,
      dissolve: 0,
      growth: 1,
      spread: 0,
      noise: 0,
      swirl: 0,
      speed: 0,
      glowRadius: 0,
      glowExposure: 0,
      autoRotate: false,
      useTexture: true
    };
    await window.particleStudio.setSceneModels({
      activeId: 'smoke-model-b',
      models: [
        {
          id: 'smoke-model-a',
          name: '古风1.glb',
          extension: 'glb',
          url: '/glb/%E5%8F%A4%E9%A3%8E1.glb',
          path: 'glb/古风1.glb',
          options: sharedOptions,
          transform: { position: [-0.85, 0, 0], rotation: [0, 0, 0], scale: [0.9, 0.9, 0.9] }
        },
        {
          id: 'smoke-model-b',
          name: '古风3.glb',
          extension: 'glb',
          url: '/glb/%E5%8F%A4%E9%A3%8E3.glb',
          path: 'glb/古风3.glb',
          options: { ...sharedOptions, particleCount: 500 },
          transform: { position: [0.95, 0, 0], rotation: [0, 12, 0], scale: [0.85, 0.85, 0.85] }
        }
      ]
    });
    window.particleStudio.setCameraKeyframes([
      { id: 'multi-camera-a', time: 0, position: [0, 1.3, 6.2], target: [0, 0, 0], options: {} },
      { id: 'multi-camera-b', time: 2, position: [0.25, 1.1, 5.4], target: [0.1, 0, 0], options: {} }
    ]);
    window.particleStudio.setCameraCurve('linear', 1, { applyToSelected: false });
    window.particleStudio.setCameraTime(1, true);
    return window.particleStudio.getSceneModels();
  });
  if (!Array.isArray(multiModelCheck?.models) || multiModelCheck.models.length !== 2) {
    throw new Error(`Multi-model scene did not import correctly: ${JSON.stringify(multiModelCheck)}`);
  }
  await page.waitForFunction(() => window.particleStudio?.isReady(), null, { timeout: 60000 });
  const multiCameraPreviewDataUrl = await page.evaluate(() => window.particleStudio.captureCameraPreview());
  await writeDataUrl(path.join(outDir, 'multi-camera-preview.png'), multiCameraPreviewDataUrl);
  const multiExportPreviewDataUrl = await page.evaluate(() => window.particleStudio.renderFrame(0, undefined, 1));
  await writeDataUrl(path.join(outDir, 'multi-export-preview.png'), multiExportPreviewDataUrl);
  const multiPreviewMatch = await compareRenderedFrames(page, multiCameraPreviewDataUrl, multiExportPreviewDataUrl);
  if (!multiPreviewMatch.ok) {
    throw new Error(`Multi-model camera preview differs from renderFrame: ${JSON.stringify(multiPreviewMatch)}`);
  }
  await page.evaluate(() => window.particleStudio.setCameraViewLocked(true));
  await page.waitForTimeout(250);
  const multiCameraViewDataUrl = await page.evaluate(() => window.particleStudio.capturePng());
  await writeDataUrl(path.join(outDir, 'multi-camera-view.png'), multiCameraViewDataUrl);
  const multiCameraViewMatch = await compareRenderedFrames(page, multiCameraViewDataUrl, multiExportPreviewDataUrl);
  if (!multiCameraViewMatch.ok) {
    throw new Error(`Multi-model main camera view differs from renderFrame: ${JSON.stringify(multiCameraViewMatch)}`);
  }
  await page.evaluate(() => window.particleStudio.setCameraViewLocked(false));

  const configPath = path.join(outDir, 'export-config.json');
  const exportRelative = 'verification/smoke/smoke-export.mov';
  await writeFile(
    configPath,
    JSON.stringify(
      {
        port,
        duration: 0.5,
        fps: 2,
        width: 320,
        height: 180,
        pixelRatio: 1,
        startTime: 0,
        cameraStartTime: cameraTime,
        effectStartTime: 0,
        out: exportRelative,
        modelUrl,
        cameraCurve: {
          curve: 'linear',
          strength: 1
        },
        cameraKeyframes,
        options: {
          effectMode: 'emission',
          useTexture: true,
          particleCount: 100,
          emissionEnabled: true,
          emissionCount: 50,
          pointSize: 3,
          sampleCleanup: 0,
          dissolve: 0,
          growth: 1,
          glowRadius: 0,
          glowExposure: 1,
          emissionIntensity: 0.65,
          emissionDistance: 0.75,
          emissionSpeed: 0.35,
          emissionOpacity: 0.35,
          emissionSize: 1.1,
          emissionGlow: 0.15,
          modelWhite: 0,
          modelRoughness: 0.8
        },
        cameraSnapshot
      },
      null,
      2
    )
  );

  const exportLog = await runNode(['scripts/export-mov.js', '--config', configPath, '--keep-frames']);
  await writeFile(path.join(outDir, 'export.log'), exportLog);

  const movPath = path.resolve(rootDir, exportRelative);
  assertFileLooksReal(movPath, 1000);

  const frameDirMatch = exportLog.match(/Frames kept at:\s*(.+)\s*$/m);
  if (!frameDirMatch) {
    throw new Error('Export did not report kept frames.');
  }
  const firstFramePath = path.join(frameDirMatch[1].trim(), 'frame_00000.png');
  assertFileLooksReal(firstFramePath, 800);
  const exportedFrameDataUrl = await fileToDataUrl(firstFramePath, 'image/png');
  const cameraMatch = await compareRenderedFrames(page, exportPreviewDataUrl, exportedFrameDataUrl);
  if (!cameraMatch.ok) {
    throw new Error(`Export camera frame differs from preview: ${JSON.stringify(cameraMatch)}`);
  }

  const panoramaConfigPath = path.join(outDir, 'panorama-export-config.json');
  const panoramaExportRelative = 'verification/smoke/smoke-panorama-export.mp4';
  await writeFile(
    panoramaConfigPath,
    JSON.stringify({
      format: 'mp4-360',
      port,
      duration: 0.5,
      fps: 2,
      width: 320,
      height: 160,
      pixelRatio: 1,
      startTime: 0,
      cameraStartTime: 0,
      effectStartTime: 0,
      out: panoramaExportRelative,
      modelUrl,
      cameraKeyframes: [],
      parameterKeyframes: [],
      options: {
        effectMode: 'particles',
        useTexture: true,
        particleCount: 100,
        pointSize: 3,
        sampleCleanup: 0,
        dissolve: 0,
        growth: 1,
        glowRadius: 0,
        glowExposure: 0,
        autoRotate: false
      },
      cameraSnapshot: {
        ...cameraSnapshot,
        cameraType: 'panorama',
        dofEnabled: false
      }
    }, null, 2)
  );
  const panoramaExportLog = await runNode(['scripts/export-mov.js', '--config', panoramaConfigPath]);
  await writeFile(path.join(outDir, 'panorama-export.log'), panoramaExportLog);
  const panoramaMp4Path = path.resolve(rootDir, panoramaExportRelative);
  assertFileLooksReal(panoramaMp4Path, 1000);
  const panoramaProbe = await probeMedia(panoramaMp4Path);
  if (!panoramaProbe.includes('spherical: equirectangular')) {
    throw new Error(`360 MP4 is missing equirectangular spherical metadata:\n${panoramaProbe}`);
  }
  if (!panoramaProbe.includes('320x160')) {
    throw new Error(`360 MP4 does not have the expected 2:1 dimensions:\n${panoramaProbe}`);
  }

  const imageSplatCheck = await verifyImageSplatControls(page);
  if (!imageSplatCheck.ok) {
    throw new Error(`Image splat controls are not visibly interactive: ${JSON.stringify(imageSplatCheck)}`);
  }
  const animationCheck = await verifyAnimatedModel(page);

  console.log(
    JSON.stringify(
      {
        ok: true,
        page: baseUrl,
        model: asset.model.name,
        stats,
        emissionStats,
        preview: path.join(outDir, 'preview.png'),
        emissionPreview: path.join(outDir, 'emission-preview.png'),
        cameraPreview: path.join(outDir, 'camera-preview.png'),
        exportPreview: path.join(outDir, 'export-preview.png'),
        importMode: importModeCheck,
        cameraFeatures: cameraFeatureCheck,
        imageSplat: imageSplatCheck,
        animation: animationCheck,
        mov: movPath,
        panoramaMp4: panoramaMp4Path
      },
      null,
      2
    )
  );
} finally {
  if (browser) {
    await browser.close();
  }
  if (server) {
    server.kill();
  }
}

function assertRotationsClose(a, b, message) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length < 3 || b.length < 3) {
    throw new Error(message);
  }

  const maxDelta = Math.max(...a.slice(0, 3).map((value, index) => Math.abs(Number(value) - Number(b[index]))));
  if (!Number.isFinite(maxDelta) || maxDelta > 0.0005) {
    throw new Error(message);
  }
}

async function probeMedia(filePath) {
  if (!ffmpegPath) {
    throw new Error('ffmpeg-static did not provide an FFmpeg binary.');
  }
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

async function verifyImportReplaceAndAppend(page) {
  const replacePath = path.join(rootDir, 'glb', '古风3.glb');
  const appendPath = path.join(rootDir, 'glb', '古风1.glb');
  if (!existsSync(replacePath) || !existsSync(appendPath)) {
    return { skipped: true, replaceOk: true, appendOk: true, reason: '古风1/古风3 test models not found' };
  }

  await page.setInputFiles('#modelInput', replacePath);
  await page.waitForFunction(() => window.particleStudio?.isReady(), null, { timeout: 90000 });
  await page.waitForFunction(
    () => window.particleStudio?.getCurrentAsset?.()?.model?.name?.includes('古风3'),
    null,
    { timeout: 90000 }
  );
  const replaceState = await page.evaluate(() => ({
    asset: window.particleStudio.getCurrentAsset(),
    sceneModels: window.particleStudio.getSceneModels()
  }));

  const chooserPromise = page.waitForEvent('filechooser', { timeout: 15000 });
  await page.click('#addSceneModel');
  const chooser = await chooserPromise;
  await chooser.setFiles(appendPath);
  await page.waitForFunction(() => window.particleStudio?.isReady(), null, { timeout: 90000 });
  await page.waitForFunction(
    () => (window.particleStudio?.getSceneModels?.()?.models || []).length === 2,
    null,
    { timeout: 90000 }
  );
  const appendState = await page.evaluate(() => ({
    asset: window.particleStudio.getCurrentAsset(),
    sceneModels: window.particleStudio.getSceneModels()
  }));

  return {
    replaceOk:
      replaceState.asset?.model?.name?.includes('古风3') &&
      (replaceState.sceneModels?.models || []).length === 1,
    appendOk:
      appendState.asset?.model?.name?.includes('古风1') &&
      (appendState.sceneModels?.models || []).length === 2,
    replaceCount: (replaceState.sceneModels?.models || []).length,
    appendCount: (appendState.sceneModels?.models || []).length,
    activeAfterReplace: replaceState.asset?.model?.name,
    activeAfterAppend: appendState.asset?.model?.name
  };
}

async function verifyImageSplatControls(page) {
  const check = await page.evaluate(async () => {
    window.particleStudio.clearCameraKeyframes();
    window.particleStudio.setParameterKeyframes?.([]);
    const sourceCanvas = document.createElement('canvas');
    sourceCanvas.width = 96;
    sourceCanvas.height = 64;
    const context = sourceCanvas.getContext('2d');
    const gradient = context.createLinearGradient(0, 0, sourceCanvas.width, sourceCanvas.height);
    gradient.addColorStop(0, '#1038ff');
    gradient.addColorStop(0.52, '#f2e9b6');
    gradient.addColorStop(1, '#ff4a1c');
    context.fillStyle = gradient;
    context.fillRect(0, 0, sourceCanvas.width, sourceCanvas.height);
    context.fillStyle = '#0b0d12';
    context.fillRect(12, 12, 24, 40);
    context.fillStyle = '#40e090';
    context.beginPath();
    context.arc(64, 34, 18, 0, Math.PI * 2);
    context.fill();

    await window.particleStudio.setImageSplatObject({
      name: 'smoke-image.png',
      extension: 'png',
      dataUrl: sourceCanvas.toDataURL('image/png'),
      kind: 'image-preview',
      params: {
        effectMode: 'image',
        imageSplatCount: 18000,
        imageSplatDepth: 0.45,
        imageSplatScatter: 0,
        imageSplatSpeed: 0,
        imageSplatDirX: 0,
        imageSplatDirY: 0,
        imageSplatDirZ: 0,
        imageSplatTurbulence: 0,
        imageSplatSize: 1.2,
        imageSplatFeather: 0.15,
        imageSplatColorKeep: 1,
        imageSplatOpacity: 0.9,
        imageSplatGlow: 0,
        imageSplatPlaneVisible: false
      }
    });
    window.particleStudio.setCameraSnapshot({ position: [0, 0.08, 2.6], target: [0, 0, 0], fov: 36 });
    await window.particleStudio.setOptions(
      {
        effectMode: 'image',
        imageSplatCount: 18000,
        imageSplatDepth: 0.45,
        imageSplatScatter: 0,
        imageSplatSpeed: 0,
        imageSplatDirX: 0,
        imageSplatDirY: 0,
        imageSplatDirZ: 0,
        imageSplatTurbulence: 0,
        imageSplatSize: 1.2,
        imageSplatGlow: 0,
        imageSplatPlaneVisible: false
      },
      true
    );
    return window.particleStudio.getImageSplatObject();
  });

  await page.waitForFunction(() => window.particleStudio?.isReady(), null, { timeout: 60000 });
  const stillFrame = await page.evaluate(() => window.particleStudio.renderFrame(0, undefined, 0));
  const disturbedFrame = await page.evaluate(async () => {
    await window.particleStudio.setOptions(
      {
        imageSplatScatter: 5,
        imageSplatTurbulence: 4,
        imageSplatDirX: 1.25,
        imageSplatDirY: 0.55,
        imageSplatDirZ: -1.05,
        imageSplatSpeed: 1.35
      },
      true
    );
    return window.particleStudio.renderFrame(1.25, undefined, 0);
  });
  const difference = await measureFrameDifference(page, stillFrame, disturbedFrame);
  return {
    ok: Boolean(check.loaded) && difference.meanDelta > 0.35 && difference.changedRatio > 0.0008,
    object: check,
    difference
  };
}

async function verifyAnimatedModel(page) {
  const animatedModelPath = path.join(rootDir, 'glb', 'Standing.fbx');
  if (!existsSync(animatedModelPath)) {
    return { skipped: true, reason: 'Standing.fbx not found' };
  }

  await page.goto(`${baseUrl}?model=/glb/Standing.fbx&t=${Date.now()}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.particleStudio?.isReady(), null, { timeout: 120000 });
  await page.evaluate(async () => {
    await window.particleStudio.setOptions(
      {
        effectMode: 'particles',
        particleCount: 600,
        emissionCount: 600,
        sampleCleanup: 0,
        modelAnimEnabled: true,
        modelAnimPlaying: false,
        modelAnimProgress: 0
      },
      true
    );
  });
  await page.waitForTimeout(300);
  const animation = await page.evaluate(() => window.particleStudio.getModelAnimation());
  if (!animation?.clips?.length || !animation.hasParticleBindings || !animation.hasEmissionBindings) {
    throw new Error(`Animated FBX did not bind to particle geometry: ${JSON.stringify(animation)}`);
  }

  await page.evaluate(() => window.particleStudio.setModelAnimation({ enabled: true, playing: false, progress: 0 }));
  await page.waitForTimeout(250);
  const boundsA = await page.evaluate(() => window.particleStudio.getParticleBounds());
  await page.evaluate(() => window.particleStudio.setModelAnimation({ enabled: true, playing: false, progress: 0.85 }));
  await page.waitForTimeout(250);
  const boundsB = await page.evaluate(() => window.particleStudio.getParticleBounds());
  const heightA = Number(boundsA?.particles?.size?.[1] || 0);
  const heightB = Number(boundsB?.particles?.size?.[1] || 0);
  const heightDelta = Math.abs(heightA - heightB);
  if (heightDelta < 0.45) {
    throw new Error(`Animated FBX pose did not deform particle bounds: ${JSON.stringify({ boundsA, boundsB })}`);
  }

  return {
    clip: animation.clips[0].name,
    duration: animation.clips[0].duration,
    heightDelta: Number(heightDelta.toFixed(2))
  };
}

async function ensureServer() {
  if (await canFetch(baseUrl)) {
    return null;
  }

  const viteCli = path.join(rootDir, 'node_modules', 'vite', 'bin', 'vite.js');
  const child = spawn(process.execPath, [viteCli, '--host', '127.0.0.1', '--port', String(port)], {
    cwd: rootDir,
    stdio: 'ignore',
    windowsHide: true
  });

  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (await canFetch(baseUrl)) {
      return child;
    }
    await delay(250);
  }

  child.kill();
  throw new Error(`Vite server did not start at ${baseUrl}`);
}

async function canFetch(url) {
  try {
    const response = await fetch(url);
    return response.ok;
  } catch {
    return false;
  }
}

async function runNode(args) {
  const child = spawn(process.execPath, args, {
    cwd: rootDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  const [code] = await once(child, 'exit');
  const output = `${stdout}\n${stderr}`.trim();
  if (code !== 0) {
    throw new Error(`Command failed: node ${args.join(' ')}\n${output}`);
  }
  return output;
}

async function writeDataUrl(filePath, dataUrl) {
  const base64 = String(dataUrl || '').replace(/^data:image\/png;base64,/, '');
  if (!base64 || base64 === dataUrl) {
    throw new Error(`Expected PNG data URL for ${filePath}`);
  }
  await writeFile(filePath, Buffer.from(base64, 'base64'));
  assertFileLooksReal(filePath, 800);
}

async function fileToDataUrl(filePath, mimeType) {
  const buffer = await readFile(filePath);
  return `data:${mimeType};base64,${buffer.toString('base64')}`;
}

async function compareRenderedFrames(page, previewDataUrl, exportDataUrl) {
  return page.evaluate(
    async ({ preview, exported }) => {
      const targetWidth = 160;
      const targetHeight = 90;

      function loadImage(src) {
        return new Promise((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve(image);
          image.onerror = reject;
          image.src = src;
        });
      }

      async function measure(src) {
        const image = await loadImage(src);
        const canvas = document.createElement('canvas');
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.clearRect(0, 0, targetWidth, targetHeight);
        context.drawImage(image, 0, 0, targetWidth, targetHeight);
        const data = context.getImageData(0, 0, targetWidth, targetHeight).data;
        let minX = targetWidth;
        let minY = targetHeight;
        let maxX = -1;
        let maxY = -1;
        let weight = 0;
        let cx = 0;
        let cy = 0;

        for (let y = 0; y < targetHeight; y += 1) {
          for (let x = 0; x < targetWidth; x += 1) {
            const offset = (y * targetWidth + x) * 4;
            const brightness = data[offset] + data[offset + 1] + data[offset + 2];
            const value = brightness / 3;
            if (value < 12) {
              continue;
            }
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
            weight += value;
            cx += x * value;
            cy += y * value;
          }
        }

        if (weight <= 0 || maxX < 0) {
          return { empty: true, width: 0, height: 0, cx: 0, cy: 0 };
        }

        return {
          empty: false,
          width: (maxX - minX + 1) / targetWidth,
          height: (maxY - minY + 1) / targetHeight,
          cx: (cx / weight) / targetWidth,
          cy: (cy / weight) / targetHeight
        };
      }

      const a = await measure(preview);
      const b = await measure(exported);
      if (a.empty || b.empty) {
        return { ok: false, preview: a, exported: b, reason: 'empty frame' };
      }

      const centerDelta = Math.hypot(a.cx - b.cx, a.cy - b.cy);
      const sizeDelta = Math.abs(a.width - b.width) + Math.abs(a.height - b.height);
      const shapeRatioDelta =
        Math.abs((a.width / Math.max(a.height, 0.0001)) - (b.width / Math.max(b.height, 0.0001)));
      const strictMatch = centerDelta < 0.06 && sizeDelta < 0.16 && shapeRatioDelta < 0.35;
      const sparsePointMatch = centerDelta < 0.045 && sizeDelta < 0.14 && shapeRatioDelta < 0.55;
      return {
        ok: strictMatch || sparsePointMatch,
        centerDelta,
        sizeDelta,
        shapeRatioDelta,
        preview: a,
        exported: b
      };
    },
    { preview: previewDataUrl, exported: exportDataUrl }
  );
}

async function measureFrameDifference(page, firstDataUrl, secondDataUrl) {
  return page.evaluate(
    async ({ first, second }) => {
      const targetWidth = 128;
      const targetHeight = 72;

      function loadImage(src) {
        return new Promise((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve(image);
          image.onerror = reject;
          image.src = src;
        });
      }

      async function pixels(src) {
        const image = await loadImage(src);
        const canvas = document.createElement('canvas');
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.drawImage(image, 0, 0, targetWidth, targetHeight);
        return context.getImageData(0, 0, targetWidth, targetHeight).data;
      }

      const a = await pixels(first);
      const b = await pixels(second);
      let totalDelta = 0;
      let changed = 0;
      const pixelCount = targetWidth * targetHeight;
      for (let index = 0; index < pixelCount; index += 1) {
        const offset = index * 4;
        const delta =
          Math.abs(a[offset] - b[offset]) +
          Math.abs(a[offset + 1] - b[offset + 1]) +
          Math.abs(a[offset + 2] - b[offset + 2]);
        totalDelta += delta / 3;
        if (delta > 42) {
          changed += 1;
        }
      }

      return {
        meanDelta: totalDelta / pixelCount,
        changedRatio: changed / pixelCount
      };
    },
    { first: firstDataUrl, second: secondDataUrl }
  );
}

function assertFileLooksReal(filePath, minBytes) {
  if (!existsSync(filePath)) {
    throw new Error(`Missing expected file: ${filePath}`);
  }
  const size = statSync(filePath).size;
  if (size < minBytes) {
    throw new Error(`File is suspiciously small: ${filePath} (${size} bytes)`);
  }
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'),
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Google/Chrome/Application/chrome.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Microsoft/Edge/Application/msedge.exe'),
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Microsoft/Edge/Application/msedge.exe'),
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft/Edge/Application/msedge.exe')
  ].filter(Boolean);

  return candidates.find((candidate) => existsSync(candidate));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
