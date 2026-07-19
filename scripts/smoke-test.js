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

  const qualityProfiles = await page.evaluate(() => {
    const low = window.particleStudio.setQualityMode('low', { persist: false });
    const medium = window.particleStudio.setQualityMode('medium', { persist: false });
    const high = window.particleStudio.setQualityMode('high', { persist: false });
    const auto = window.particleStudio.setQualityMode('auto', { persist: false, resolvedLevel: 'medium' });
    window.particleStudio.setQualityMode('high', { persist: false });
    return { low, medium, high, auto };
  });
  if (
    qualityProfiles.low.level !== 'low' || qualityProfiles.low.profile.glowLayers !== 1 || qualityProfiles.low.profile.dofSamples !== 12 ||
    qualityProfiles.medium.level !== 'medium' || qualityProfiles.medium.profile.glowLayers !== 2 || qualityProfiles.medium.profile.dofSamples !== 24 ||
    qualityProfiles.high.level !== 'high' || qualityProfiles.high.profile.glowLayers !== 3 || qualityProfiles.high.profile.dofSamples !== 48 ||
    qualityProfiles.auto.mode !== 'auto' || qualityProfiles.auto.level !== 'medium'
  ) {
    throw new Error(`Quality profiles are not applied correctly: ${JSON.stringify(qualityProfiles)}`);
  }

  const operatorGraph = await page.evaluate(() => {
    const graph = window.particleStudio.getOperatorGraph();
    const validation = window.particleStudio.validateOperatorGraph(graph);
    const fullPlan = window.particleStudio.getOperatorExecutionPlan();
    const dirtyPlan = window.particleStudio.getOperatorExecutionPlan({ dirtyNodeIds: ['flow-dissolve'] });
    const projectGraph = window.particleStudio.captureProject().operatorGraph;
    const customGraph = structuredClone(graph);
    customGraph.name = 'Smoke Custom Graph';
    customGraph.metadata = { ...customGraph.metadata, mode: 'graph', synchronized: false };
    const customResult = window.particleStudio.setOperatorGraph(customGraph, { dirtyNodeIds: ['multi-glow'] });
    const retainedName = window.particleStudio.getOperatorGraph().name;
    const resetResult = window.particleStudio.resetOperatorGraph();
    return {
      graph,
      validation,
      fullPlan,
      dirtyPlan,
      projectGraph,
      customExecution: customResult.plan.executionNodeIds,
      retainedName,
      resetMode: resetResult.graph.metadata.mode
    };
  });
  if (
    !operatorGraph.validation.valid ||
    operatorGraph.graph.schemaVersion !== 1 ||
    operatorGraph.graph.nodes.length !== 13 ||
    operatorGraph.graph.edges.length !== 14 ||
    operatorGraph.fullPlan.order.at(-1) !== 'viewport-output' ||
    operatorGraph.dirtyPlan.executionNodeIds[0] !== 'flow-dissolve' ||
    !operatorGraph.dirtyPlan.executionNodeIds.includes('viewport-output') ||
    operatorGraph.projectGraph?.metadata?.mode !== 'creator' ||
    operatorGraph.retainedName !== 'Smoke Custom Graph' ||
    operatorGraph.resetMode !== 'creator'
  ) {
    throw new Error(`Operator graph runtime integration failed: ${JSON.stringify(operatorGraph)}`);
  }

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
    window.particleStudio.setCameraCurve('linear', 1, { applyToSelected: false });
    window.particleStudio.setCameraKeyframes([
      {
        id: 'bezier-a',
        time: 0,
        position: [-2, 0, 5],
        target: [0, 0, 0],
        handleOut: [0, 3, 0]
      },
      {
        id: 'bezier-b',
        time: 2,
        position: [2, 0, 5],
        target: [0, 0, 0],
        handleIn: [0, 3, 0]
      }
    ]);
    window.particleStudio.setCameraPathMode('linear');
    window.particleStudio.setCameraTime(1, true);
    const linearPathPose = window.particleStudio.getCameraPreviewPose();
    window.particleStudio.setCameraPathMode('bezier');
    window.particleStudio.setCameraTime(1, true);
    const bezierPathPose = window.particleStudio.getCameraPreviewPose();
    const bezierCurve = window.particleStudio.getCameraCurve();

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
    window.particleStudio.setCameraPathMode('linear');
    window.particleStudio.setCameraSettings({ type: 'perspective', dofEnabled: false, sensorWidth: 36 });
    window.particleStudio.setCameraSnapshot({ position: [0, 1.2, 6], target: [0, 0, 0], fov: 48 });
    return {
      perspective,
      cameraOnlyDissolve,
      independentlyKeyedDissolve,
      undoDissolve,
      linearPathPose,
      bezierPathPose,
      bezierCurve,
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
  if (
    cameraFeatureCheck.bezierCurve?.pathMode !== 'bezier' ||
    Math.abs(Number(cameraFeatureCheck.linearPathPose?.position?.[1] || 0)) > 0.05 ||
    Number(cameraFeatureCheck.bezierPathPose?.position?.[1] || 0) < 1.2
  ) {
    throw new Error(`Bezier camera path failed: ${JSON.stringify(cameraFeatureCheck)}`);
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

  const cameraDistanceLighting = await verifyCameraDistanceLighting(page);
  if (!cameraDistanceLighting.ok) {
    throw new Error(`Camera distance changes scene lighting: ${JSON.stringify(cameraDistanceLighting)}`);
  }
  const cameraClipRange = await verifyCameraClipRange(page);
  if (!cameraClipRange.ok) {
    throw new Error(`Camera clipping range is too short: ${JSON.stringify(cameraClipRange)}`);
  }
  const parameterContinuity = await verifyParameterContinuity(page);
  if (!parameterContinuity.ok) {
    throw new Error(`Parameter zero-crossing is visually discontinuous: ${JSON.stringify(parameterContinuity)}`);
  }
  const visualQuality = await verifyVisualQuality(page);
  if (!visualQuality.ok) {
    throw new Error(`Glow/DOF/dissolve visual regression failed: ${JSON.stringify(visualQuality)}`);
  }
  const operatorRuntimeRendering = await verifyOperatorRuntimeRendering(page);
  if (!operatorRuntimeRendering.ok) {
    throw new Error(`Operator runtime did not control the rendered frame: ${JSON.stringify(operatorRuntimeRendering)}`);
  }

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
  await page.evaluate(() => window.particleStudio.setCameraSnapshot({
    position: [0, 2.4, 9.5],
    target: [0, 0, 0],
    cameraType: 'perspective',
    focalLength: 35,
    filmGauge: 36
  }));
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
    const panelIsLeftDock = panelRect && panelRect.right < rect.left + rect.width * 0.5;
    const panelIsRightDock = panelRect && panelRect.left > rect.left + rect.width * 0.5;
    const leftSafeX = panelIsLeftDock ? panelRect.right + 36 : rect.left + 36;
    const rightSafeX = panelIsRightDock ? panelRect.left - 36 : rect.right - 36;
    const x = Math.min(Math.max(leftSafeX, centerX), rightSafeX, maxX - 24);
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

  const transformPoint = await page.evaluate(() => {
    const canvas = document.querySelector('#scene');
    const rect = canvas.getBoundingClientRect();
    return {
      x: rect.left + rect.width * 0.58,
      y: rect.top + rect.height * 0.54
    };
  });

  const modalCameraMove = await page.evaluate(() => {
    window.particleStudio.selectCameraKeyframeForTest(0);
    document.activeElement?.blur?.();
    return window.particleStudio.getTransformSelectionDebug();
  });
  await page.mouse.move(transformPoint.x, transformPoint.y);
  await page.keyboard.press('KeyG');
  const modalCameraDuringMove = await page.evaluate(() => window.particleStudio.getTransformSelectionDebug());
  await page.mouse.move(transformPoint.x + 110, transformPoint.y - 35, { steps: 5 });
  const modalCameraMoved = await page.evaluate(() => window.particleStudio.getTransformSelectionDebug());
  await page.mouse.click(transformPoint.x + 110, transformPoint.y - 35);
  const modalCameraConfirmed = await page.evaluate(() => window.particleStudio.getTransformSelectionDebug());

  await page.mouse.move(transformPoint.x, transformPoint.y);
  await page.keyboard.press('KeyG');
  await page.keyboard.press('KeyX');
  await page.mouse.move(transformPoint.x + 120, transformPoint.y + 80, { steps: 5 });
  const cameraMoveXDuringShortcut = await page.evaluate(() => window.particleStudio.getTransformSelectionDebug());
  await page.mouse.click(transformPoint.x + 120, transformPoint.y + 80);
  const cameraMoveXShortcut = await page.evaluate(() => window.particleStudio.getTransformSelectionDebug());

  await page.mouse.move(transformPoint.x, transformPoint.y);
  await page.keyboard.press('KeyG');
  await page.keyboard.press('Shift+KeyZ');
  const lockZStart = await page.evaluate(() => window.particleStudio.getTransformSelectionDebug());
  await page.mouse.move(transformPoint.x + 90, transformPoint.y - 70, { steps: 5 });
  const cameraMoveLockZDuringShortcut = await page.evaluate(() => window.particleStudio.getTransformSelectionDebug());
  await page.mouse.click(transformPoint.x + 90, transformPoint.y - 70);
  const cameraMoveLockZShortcut = await page.evaluate(() => window.particleStudio.getTransformSelectionDebug());

  await page.mouse.move(transformPoint.x, transformPoint.y);
  await page.keyboard.press('KeyR');
  const rotateStart = await page.evaluate(() => window.particleStudio.getTransformSelectionDebug());
  await page.mouse.move(transformPoint.x + 100, transformPoint.y - 20, { steps: 5 });
  await page.mouse.click(transformPoint.x + 100, transformPoint.y - 20);
  const cameraRotateShortcut = await page.evaluate(() => window.particleStudio.getTransformSelectionDebug());

  await page.mouse.move(transformPoint.x, transformPoint.y);
  await page.keyboard.press('KeyS');
  const scaleStart = await page.evaluate(() => window.particleStudio.getTransformSelectionDebug());
  await page.mouse.move(transformPoint.x + 80, transformPoint.y - 80, { steps: 5 });
  await page.mouse.click(transformPoint.x + 80, transformPoint.y - 80);
  const cameraScaleShortcut = await page.evaluate(() => window.particleStudio.getTransformSelectionDebug());

  const movedDistance = Math.hypot(
    modalCameraMoved.proxyPosition[0] - modalCameraMove.proxyPosition[0],
    modalCameraMoved.proxyPosition[1] - modalCameraMove.proxyPosition[1],
    modalCameraMoved.proxyPosition[2] - modalCameraMove.proxyPosition[2]
  );
  const confirmedDistance = Math.hypot(
    modalCameraConfirmed.proxyPosition[0] - modalCameraMove.proxyPosition[0],
    modalCameraConfirmed.proxyPosition[1] - modalCameraMove.proxyPosition[1],
    modalCameraConfirmed.proxyPosition[2] - modalCameraMove.proxyPosition[2]
  );
  const xAxisMoved = Math.abs(cameraMoveXShortcut.proxyPosition[0] - modalCameraConfirmed.proxyPosition[0]);
  const xAxisYDrift = Math.abs(cameraMoveXShortcut.proxyPosition[1] - modalCameraConfirmed.proxyPosition[1]);
  const xAxisZDrift = Math.abs(cameraMoveXShortcut.proxyPosition[2] - modalCameraConfirmed.proxyPosition[2]);
  const lockZDrift = Math.abs(cameraMoveLockZShortcut.proxyPosition[2] - lockZStart.proxyPosition[2]);
  const rotationDelta = Math.hypot(
    cameraRotateShortcut.proxyQuaternion[0] - rotateStart.proxyQuaternion[0],
    cameraRotateShortcut.proxyQuaternion[1] - rotateStart.proxyQuaternion[1],
    cameraRotateShortcut.proxyQuaternion[2] - rotateStart.proxyQuaternion[2],
    cameraRotateShortcut.proxyQuaternion[3] - rotateStart.proxyQuaternion[3]
  );
  if (
    modalCameraDuringMove.modalTransform?.mode !== 'translate' ||
    modalCameraDuringMove.modalTransform?.target !== 'camera' ||
    movedDistance < 0.01 ||
    confirmedDistance < 0.01 ||
    cameraMoveXDuringShortcut.axisConstraint?.axis !== 'x' ||
    cameraMoveXDuringShortcut.axisConstraint?.mode !== 'only' ||
    xAxisMoved < 0.005 ||
    xAxisYDrift > 0.001 ||
    xAxisZDrift > 0.001 ||
    cameraMoveLockZDuringShortcut.axisConstraint?.axis !== 'z' ||
    cameraMoveLockZDuringShortcut.axisConstraint?.mode !== 'lock' ||
    lockZDrift > 0.001 ||
    cameraRotateShortcut.transformMode !== 'rotate' ||
    rotationDelta < 0.005 ||
    cameraScaleShortcut.transformMode !== 'scale' ||
    Math.abs(cameraScaleShortcut.cameraDisplaySize - scaleStart.cameraDisplaySize) < 0.01
  ) {
    throw new Error(`Blender-style modal transform failed: ${JSON.stringify({
      modalCameraMove,
      modalCameraDuringMove,
      modalCameraMoved,
      modalCameraConfirmed,
      cameraMoveXDuringShortcut,
      cameraMoveXShortcut,
      cameraMoveLockZDuringShortcut,
      cameraMoveLockZShortcut,
      cameraRotateShortcut,
      cameraScaleShortcut,
      movedDistance,
      confirmedDistance,
      xAxisMoved,
      xAxisYDrift,
      xAxisZDrift,
      lockZDrift,
      rotationDelta
    })}`);
  }

  const bezierShortcutSetup = await page.evaluate(() => {
    window.particleStudio.setCameraPathMode('bezier');
    window.particleStudio.setCameraKeyframes([
      { id: 'smoke-bezier-a', time: 0, position: [0, 0.7, 7.2], target: [0, 0, 0], handleOut: [1.2, 0.35, 0] },
      { id: 'smoke-bezier-b', time: 1, position: [1.4, 1.2, 5.4], target: [0, 0.1, 0], handleIn: [-1.1, -0.25, 0] }
    ]);
    const selected = window.particleStudio.selectCameraBezierHandleForTest(0, 'out');
    document.activeElement?.blur?.();
    return { selected, debug: window.particleStudio.getTransformSelectionDebug() };
  });
  await page.mouse.move(transformPoint.x, transformPoint.y);
  await page.keyboard.press('KeyG');
  await page.keyboard.press('KeyY');
  await page.mouse.move(transformPoint.x - 30, transformPoint.y - 120, { steps: 5 });
  const bezierMoveYDuringShortcut = await page.evaluate(() => window.particleStudio.getTransformSelectionDebug());
  await page.mouse.click(transformPoint.x - 30, transformPoint.y - 120);
  const bezierMoveYShortcut = await page.evaluate(() => window.particleStudio.getTransformSelectionDebug());
  if (
    !bezierShortcutSetup.selected ||
    bezierShortcutSetup.debug.target !== 'camera-bezier' ||
    !bezierShortcutSetup.debug.attachedToBezierHandle ||
    bezierMoveYDuringShortcut.modalTransform?.target !== 'camera-bezier' ||
    bezierMoveYDuringShortcut.axisConstraint?.axis !== 'y' ||
    bezierMoveYDuringShortcut.axisConstraint?.mode !== 'only' ||
    Math.abs(bezierMoveYShortcut.proxyPosition[1] - bezierShortcutSetup.debug.proxyPosition[1]) < 0.005 ||
    Math.abs(bezierMoveYShortcut.proxyPosition[0] - bezierShortcutSetup.debug.proxyPosition[0]) > 0.001 ||
    Math.abs(bezierMoveYShortcut.proxyPosition[2] - bezierShortcutSetup.debug.proxyPosition[2]) > 0.001
  ) {
    throw new Error(`Bezier handle shortcut/attachment failed: ${JSON.stringify({
      bezierShortcutSetup,
      bezierMoveYDuringShortcut,
      bezierMoveYShortcut
    })}`);
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
  const videoPlaneCheck = await verifyVideoPlaneControls(page);
  if (!videoPlaneCheck.ok) {
    throw new Error(`Video plane controls are not rendering/selectable: ${JSON.stringify(videoPlaneCheck)}`);
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
        cameraDistanceLighting,
        cameraClipRange,
        qualityProfiles,
        operatorGraph: {
          nodes: operatorGraph.graph.nodes.length,
          edges: operatorGraph.graph.edges.length,
          stages: operatorGraph.fullPlan.stages.length,
          dirtyExecution: operatorGraph.dirtyPlan.executionNodeIds
        },
        parameterContinuity,
        visualQuality,
        operatorRuntimeRendering,
        imageSplat: imageSplatCheck,
        videoPlane: videoPlaneCheck,
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

async function verifyCameraDistanceLighting(page) {
  const frames = await page.evaluate(async () => {
    window.particleStudio.clearCameraKeyframes();
    window.particleStudio.setParameterKeyframes([]);
    window.particleStudio.setExportResolution(512, 288, 24);
    await window.particleStudio.setOptions({
      effectMode: 'particles',
      particleizeProgress: 0,
      modelVisibility: 1,
      glowRadius: 0,
      glowExposure: 0,
      autoRotate: false,
      worldEnabled: false,
      worldVisible: false
    }, true);

    window.particleStudio.setCameraSnapshot({
      position: [0, 0.7, 7.2],
      target: [0, 0, 0],
      cameraType: 'perspective',
      focalLength: 35,
      filmGauge: 36,
      dofEnabled: false
    });
    const near = window.particleStudio.renderFrame(0, undefined, 0);

    window.particleStudio.setCameraSnapshot({
      position: [0, 1.56, 16],
      target: [0, 0, 0],
      cameraType: 'perspective',
      focalLength: 35,
      filmGauge: 36,
      dofEnabled: false
    });
    const far = window.particleStudio.renderFrame(0, undefined, 0);
    return { near, far };
  });

  await writeDataUrl(path.join(outDir, 'lighting-near.png'), frames.near);
  await writeDataUrl(path.join(outDir, 'lighting-far.png'), frames.far);
  const measured = await measureForegroundLighting(page, frames.near, frames.far);
  const ratio = measured.far.meanLuminance / Math.max(measured.near.meanLuminance, 0.0001);
  const colorDistance = Math.hypot(
    measured.near.meanRgb[0] - measured.far.meanRgb[0],
    measured.near.meanRgb[1] - measured.far.meanRgb[1],
    measured.near.meanRgb[2] - measured.far.meanRgb[2]
  );
  return {
    ok:
      measured.near.pixelCount > 100 &&
      measured.far.pixelCount > 40 &&
      ratio > 0.82 &&
      ratio < 1.18 &&
      colorDistance < 28,
    ratio,
    colorDistance,
    ...measured
  };
}

async function verifyCameraClipRange(page) {
  return page.evaluate(() => {
    window.particleStudio.setCameraSnapshot({
      position: [0, 0.7, 7.2],
      target: [0, 0, 0],
      cameraType: 'perspective',
      focalLength: 35,
      filmGauge: 36,
      near: 0.001,
      far: 100,
      dofEnabled: false
    });
    const snapshot = window.particleStudio.captureViewCamera();
    return {
      ok: snapshot.near <= 0.0011 && snapshot.far >= 9999,
      near: snapshot.near,
      far: snapshot.far
    };
  });
}

async function verifyVisualQuality(page) {
  const baseOptions = {
    effectMode: 'particles',
    particleCount: 20000,
    pointSize: 2.8,
    particleizeProgress: 1,
    modelVisibility: 1,
    sampleCleanup: 0,
    sizeRandom: 0.28,
    spread: 0,
    noise: 0,
    dissolve: 0,
    dissolveSpread: 1.55,
    dissolveEdgeWidth: 0.22,
    dissolveTurbulence: 0.9,
    dissolveCurl: 1.1,
    dissolveMist: 0.62,
    growth: 1,
    glowRadius: 0,
    glowExposure: 0,
    autoRotate: false,
    worldEnabled: false,
    worldVisible: false
  };

  const glowFrames = await page.evaluate(async (options) => {
    window.particleStudio.setQualityMode('high', { persist: false });
    window.particleStudio.clearCameraKeyframes();
    window.particleStudio.setParameterKeyframes([]);
    window.particleStudio.setExportResolution(512, 288, 24);
    window.particleStudio.setCameraSnapshot({
      position: [0, 0.9, 8.8],
      target: [0, 0.15, 0],
      cameraType: 'perspective',
      focalLength: 42,
      filmGauge: 36,
      dofEnabled: false
    });
    await window.particleStudio.setOptions(options, true);
    const base = window.particleStudio.renderFrame(0, undefined, 0);
    await window.particleStudio.setOptions({ ...options, glowRadius: 220, glowExposure: 2 }, true);
    const styled = window.particleStudio.renderFrame(0, undefined, 0);
    return { base, styled };
  }, baseOptions);
  const glowDifference = await measureFrameDifference(page, glowFrames.base, glowFrames.styled);
  await writeDataUrl(path.join(outDir, 'visual-glow-high.png'), glowFrames.styled);

  const dissolveFrames = await page.evaluate(async (options) => {
    await window.particleStudio.setOptions({ ...options, glowRadius: 80, glowExposure: 0.85, dissolve: 0 }, true);
    const base = window.particleStudio.renderFrame(0.8, undefined, 0);
    await window.particleStudio.setOptions({ ...options, glowRadius: 80, glowExposure: 0.85, dissolve: 0.5 }, true);
    const styled = window.particleStudio.renderFrame(0.8, undefined, 0);
    return { base, styled };
  }, baseOptions);
  const dissolveDifference = await measureFrameDifference(page, dissolveFrames.base, dissolveFrames.styled);
  await writeDataUrl(path.join(outDir, 'visual-dissolve-mid.png'), dissolveFrames.styled);

  await page.evaluate(async (options) => {
    await window.particleStudio.setOptions({ ...options, particleizeProgress: 0, glowRadius: 0, glowExposure: 0, dissolve: 0 }, true);
    window.particleStudio.setCameraSnapshot({ position: [0, 0.9, 8.8], target: [0, 0.15, 0], focalLength: 42, filmGauge: 36 });
    window.particleStudio.setCameraSettings({ type: 'perspective', dofEnabled: false, aperture: 1.2, focusDistance: 1 });
  }, baseOptions);
  await page.waitForTimeout(180);
  const dofOff = await page.evaluate(() => window.particleStudio.capturePng());
  await page.evaluate(() => window.particleStudio.setCameraSettings({ type: 'perspective', dofEnabled: true, aperture: 1.2, focusDistance: 1 }));
  await page.waitForTimeout(220);
  const dofOn = await page.evaluate(() => window.particleStudio.capturePng());
  const dofViewportDifference = await measureFrameDifference(page, dofOff, dofOn);
  await writeDataUrl(path.join(outDir, 'visual-dof-viewport.png'), dofOn);

  await page.evaluate(async (options) => {
    await window.particleStudio.setOptions({
      ...options,
      particleCount: 18,
      particleizeProgress: 1,
      modelVisibility: 1,
      pointSize: 8,
      sizeRandom: 0,
      glowRadius: 120,
      glowExposure: 4,
      dissolve: 0
    }, true);
    window.particleStudio.setCameraSnapshot({
      position: [0, 0.9, 8.8],
      target: [0, 0.15, 0],
      cameraType: 'perspective',
      focalLength: 85,
      filmGauge: 36,
      dofEnabled: false
    });
    window.particleStudio.setCameraSettings({
      type: 'perspective',
      dofEnabled: false,
      aperture: 1.2,
      focusDistance: 3
    });
  }, baseOptions);
  await page.waitForTimeout(220);
  const bokehSharp = await page.evaluate(() => window.particleStudio.capturePng());
  await page.evaluate(() => window.particleStudio.setCameraSettings({
    type: 'perspective',
    dofEnabled: true,
    aperture: 1.2,
    focusDistance: 3
  }));
  await page.waitForTimeout(260);
  const bokehBlurred = await page.evaluate(() => window.particleStudio.capturePng());
  const bokehDifference = await measureFrameDifference(page, bokehSharp, bokehBlurred);
  await writeDataUrl(path.join(outDir, 'visual-dof-bokeh-sharp.png'), bokehSharp);
  await writeDataUrl(path.join(outDir, 'visual-dof-bokeh-f1.2.png'), bokehBlurred);

  await page.evaluate(() => {
    window.particleStudio.setCameraSettings({ type: 'perspective', dofEnabled: false });
    window.particleStudio.setQualityMode('high', { persist: false });
  });

  return {
    ok:
      glowDifference.meanDelta > 0.05 && glowDifference.changedRatio > 0.001 &&
      dissolveDifference.meanDelta > 0.5 && dissolveDifference.changedRatio > 0.01 &&
      dofViewportDifference.meanDelta > 0.5 && dofViewportDifference.changedRatio > 0.01 &&
      bokehDifference.meanDelta > 0.05 && bokehDifference.changedRatio > 0.001,
    glowDifference,
    dissolveDifference,
    dofViewportDifference,
    bokehDifference,
    fixtures: {
      glow: path.join(outDir, 'visual-glow-high.png'),
      dissolve: path.join(outDir, 'visual-dissolve-mid.png'),
      dofViewport: path.join(outDir, 'visual-dof-viewport.png'),
      dofBokehSharp: path.join(outDir, 'visual-dof-bokeh-sharp.png'),
      dofBokehF12: path.join(outDir, 'visual-dof-bokeh-f1.2.png')
    }
  };
}

async function verifyOperatorRuntimeRendering(page) {
  const frames = await page.evaluate(async () => {
    window.particleStudio.setQualityMode('high', { persist: false });
    window.particleStudio.clearCameraKeyframes();
    window.particleStudio.setParameterKeyframes([]);
    window.particleStudio.setExportResolution(512, 288, 24);
    window.particleStudio.setCameraSnapshot({
      position: [0, 0.9, 8.8],
      target: [0, 0.15, 0],
      cameraType: 'perspective',
      focalLength: 42,
      filmGauge: 36,
      dofEnabled: false
    });
    await window.particleStudio.setOptions({
      effectMode: 'particles',
      particleCount: 20000,
      pointSize: 2.8,
      particleizeProgress: 1,
      modelVisibility: 1,
      sampleCleanup: 0,
      spread: 0,
      noise: 0,
      dissolve: 0,
      growth: 1,
      glowRadius: 220,
      glowExposure: 2,
      autoRotate: false,
      worldEnabled: false,
      worldVisible: false
    }, true);

    window.particleStudio.resetOperatorGraph();
    const glowOn = window.particleStudio.renderFrame(0.4, undefined, 0);
    const enabledStats = window.particleStudio.getOperatorRuntimeStats();
    const graph = window.particleStudio.getOperatorGraph();
    window.particleStudio.setCameraSettings({
      type: 'perspective',
      dofEnabled: true,
      aperture: 1.4,
      focusDistance: 1.2
    });
    window.particleStudio.resetOperatorGraph();
    window.particleStudio.renderFrame(0.4, undefined, 0);
    const fullEffectsStats = window.particleStudio.getOperatorRuntimeStats();
    window.particleStudio.setCameraSettings({ type: 'perspective', dofEnabled: false });
    graph.metadata = { ...graph.metadata, mode: 'graph', synchronized: false };
    const glowNode = graph.nodes.find((node) => node.type === 'post.glow');
    glowNode.params = { ...glowNode.params, glowRadius: 30, glowExposure: 0.15 };
    window.particleStudio.setOperatorGraph(graph);
    const glowParamLow = window.particleStudio.renderFrame(0.4, undefined, 0);
    const parameterStats = window.particleStudio.getOperatorRuntimeStats();

    const feedbackGraph = structuredClone(graph);
    const feedbackNode = feedbackGraph.nodes.find((node) => node.type === 'simulation.feedback-particles');
    const forceNode = feedbackGraph.nodes.find((node) => node.type === 'simulation.force-field');
    const returnForceNode = feedbackGraph.nodes.find((node) => node.type === 'simulation.return-force');
    forceNode.params = {
      ...forceNode.params,
      strength: 1.6,
      forceX: 0.22,
      forceY: 0.35,
      forceZ: -0.08,
      turbulence: 1.8,
      curl: 1.2
    };
    returnForceNode.params = { ...returnForceNode.params, strength: 0.05 };
    feedbackNode.params = {
      ...feedbackNode.params,
      resetVersion: Number(feedbackNode.params.resetVersion || 0) + 100,
      strength: 3.2,
      dissolveCoupling: 0,
      drag: 0.12,
      damping: 0,
      turbulence: 0,
      curl: 0,
      forceX: 0,
      forceY: 0,
      forceZ: 0,
      attraction: 0,
      maxVelocity: 4,
      life: 10,
      substeps: 4
    };
    window.particleStudio.setOperatorGraph(feedbackGraph);
    window.particleStudio.renderFrame(0, undefined, 0);
    const feedbackResetStats = window.particleStudio.getOperatorRuntimeStats();
    window.particleStudio.renderFrame(0.12, undefined, 0);
    const feedbackOn = window.particleStudio.renderFrame(0.24, undefined, 0);
    const feedbackStats = window.particleStudio.getOperatorRuntimeStats();
    feedbackNode.bypass = true;
    window.particleStudio.setOperatorGraph(feedbackGraph);
    const feedbackBypassed = window.particleStudio.renderFrame(0.24, undefined, 0);
    const feedbackBypassStats = window.particleStudio.getOperatorRuntimeStats();

    const forceBypassGraph = structuredClone(feedbackGraph);
    const forceBypassNode = forceBypassGraph.nodes.find((node) => node.type === 'simulation.force-field');
    const forceBypassFeedbackNode = forceBypassGraph.nodes.find((node) => node.type === 'simulation.feedback-particles');
    forceBypassNode.bypass = true;
    forceBypassFeedbackNode.bypass = false;
    forceBypassFeedbackNode.params.resetVersion = Number(forceBypassFeedbackNode.params.resetVersion || 0) + 1;
    window.particleStudio.setOperatorGraph(forceBypassGraph);
    window.particleStudio.renderFrame(0, undefined, 0);
    window.particleStudio.renderFrame(0.12, undefined, 0);
    const forceBypassed = window.particleStudio.renderFrame(0.24, undefined, 0);
    const forceBypassStats = window.particleStudio.getOperatorRuntimeStats();

    const lifecycleAllGraph = structuredClone(graph);
    const lifecycleForceNode = lifecycleAllGraph.nodes.find((node) => node.type === 'simulation.force-field');
    const lifecycleReturnNode = lifecycleAllGraph.nodes.find((node) => node.type === 'simulation.return-force');
    const lifecycleEmitterNode = lifecycleAllGraph.nodes.find((node) => node.type === 'simulation.emitter');
    const lifecycleBirthLifeNode = lifecycleAllGraph.nodes.find((node) => node.type === 'simulation.birth-life');
    const lifecycleFeedbackNode = lifecycleAllGraph.nodes.find((node) => node.type === 'simulation.feedback-particles');
    lifecycleForceNode.bypass = true;
    lifecycleReturnNode.bypass = true;
    lifecycleEmitterNode.params = {
      ...lifecycleEmitterNode.params,
      mode: 'all',
      startTime: 0,
      duration: 0,
      directionX: 0,
      directionY: 1,
      directionZ: 0,
      speed: 2,
      spread: 0,
      positionSpread: 0
    };
    lifecycleBirthLifeNode.params = {
      ...lifecycleBirthLifeNode.params,
      lifetimeMin: 10,
      lifetimeMax: 10,
      respawn: false,
      fadeIn: 0,
      fadeOut: 0
    };
    lifecycleFeedbackNode.params = {
      ...lifecycleFeedbackNode.params,
      resetVersion: Number(lifecycleFeedbackNode.params.resetVersion || 0) + 400,
      strength: 1,
      dissolveCoupling: 0,
      substeps: 1
    };
    window.particleStudio.setOperatorGraph(lifecycleAllGraph);
    const lifecycleAll = window.particleStudio.renderFrame(1, undefined, 0);
    const lifecycleAllMoved = window.particleStudio.renderFrame(1.2, undefined, 0);

    const lifecycleBurstGraph = structuredClone(lifecycleAllGraph);
    const burstEmitterNode = lifecycleBurstGraph.nodes.find((node) => node.type === 'simulation.emitter');
    burstEmitterNode.params = {
      ...burstEmitterNode.params,
      mode: 'burst',
      burstCount: 800,
      loop: false
    };
    lifecycleBurstGraph.nodes.find((node) => node.type === 'simulation.feedback-particles').params.resetVersion += 1;
    window.particleStudio.setOperatorGraph(lifecycleBurstGraph);
    const lifecycleBurst = window.particleStudio.renderFrame(1, undefined, 0);
    const lifecycleBurstRepeat = window.particleStudio.renderFrame(1, undefined, 0);

    const lifecycleContinuousGraph = structuredClone(lifecycleAllGraph);
    const continuousEmitterNode = lifecycleContinuousGraph.nodes.find((node) => node.type === 'simulation.emitter');
    continuousEmitterNode.params = {
      ...continuousEmitterNode.params,
      mode: 'continuous',
      rate: 2000,
      seed: 17
    };
    lifecycleContinuousGraph.nodes.find((node) => node.type === 'simulation.feedback-particles').params.resetVersion += 2;
    window.particleStudio.setOperatorGraph(lifecycleContinuousGraph);
    const lifecycleContinuousStart = window.particleStudio.renderFrame(0, undefined, 0);
    const lifecycleContinuousMid = window.particleStudio.renderFrame(5, undefined, 0);
    const lifecycleStats = window.particleStudio.getOperatorRuntimeStats();

    const spatialGraph = structuredClone(feedbackGraph);
    const spatialForceNode = spatialGraph.nodes.find((node) => node.type === 'simulation.force-field');
    const spatialReturnNode = spatialGraph.nodes.find((node) => node.type === 'simulation.return-force');
    const spatialFeedbackNode = spatialGraph.nodes.find((node) => node.type === 'simulation.feedback-particles');
    spatialForceNode.bypass = false;
    spatialForceNode.params = {
      ...spatialForceNode.params,
      strength: 1,
      forceX: 0.15,
      forceY: -3,
      forceZ: 0,
      turbulence: 0,
      curl: 0
    };
    spatialReturnNode.params = { ...spatialReturnNode.params, strength: 0 };
    spatialFeedbackNode.bypass = false;
    spatialFeedbackNode.params = {
      ...spatialFeedbackNode.params,
      resetVersion: Number(spatialFeedbackNode.params.resetVersion || 0) + 20,
      strength: 3.2,
      drag: 0.05,
      maxVelocity: 6,
      life: 10,
      substeps: 4
    };
    spatialGraph.nodes.push(
      {
        id: 'particle-attractor',
        type: 'simulation.attractor',
        label: 'Attractor',
        position: { x: 1040, y: 250 },
        params: {
          enabled: true,
          centerX: 0.8,
          centerY: 0.4,
          centerZ: 0,
          strength: 5,
          radius: 4,
          falloff: 0.8
        }
      },
      {
        id: 'particle-collision',
        type: 'simulation.collision-plane',
        label: 'Plane Collision',
        position: { x: 1260, y: 250 },
        params: {
          enabled: true,
          normalX: 0,
          normalY: 1,
          normalZ: 0,
          offset: 0,
          restitution: 0.65,
          friction: 0.18
        }
      },
      {
        id: 'particle-trail',
        type: 'simulation.trail',
        label: 'Particle Trail',
        position: { x: 1480, y: 250 },
        params: {
          enabled: true,
          samples: 6,
          interval: 0.02,
          opacity: 0.82,
          fade: 1.1,
          size: 0.86
        }
      }
    );
    spatialGraph.edges = spatialGraph.edges.filter((edge) => edge.id !== 'return-to-emitter');
    spatialGraph.edges.push(
      {
        id: 'return-to-attractor',
        from: { node: 'particle-return', port: 'points' },
        to: { node: 'particle-attractor', port: 'points' }
      },
      {
        id: 'attractor-to-collision',
        from: { node: 'particle-attractor', port: 'points' },
        to: { node: 'particle-collision', port: 'points' }
      },
      {
        id: 'collision-to-trail',
        from: { node: 'particle-collision', port: 'points' },
        to: { node: 'particle-trail', port: 'points' }
      },
      {
        id: 'trail-to-emitter',
        from: { node: 'particle-trail', port: 'points' },
        to: { node: 'particle-emitter', port: 'points' }
      }
    );
    window.particleStudio.setOperatorGraph(spatialGraph);
    window.particleStudio.renderFrame(0, undefined, 0);
    window.particleStudio.renderFrame(0.12, undefined, 0);
    const spatialCollisionOn = window.particleStudio.renderFrame(0.24, undefined, 0);
    const spatialCollisionStats = window.particleStudio.getOperatorRuntimeStats();

    const collisionBypassGraph = structuredClone(spatialGraph);
    collisionBypassGraph.nodes.find((node) => node.id === 'particle-collision').bypass = true;
    collisionBypassGraph.nodes.find((node) => node.id === 'particle-feedback').params.resetVersion += 1;
    window.particleStudio.setOperatorGraph(collisionBypassGraph);
    window.particleStudio.renderFrame(0, undefined, 0);
    window.particleStudio.renderFrame(0.12, undefined, 0);
    const spatialCollisionBypassed = window.particleStudio.renderFrame(0.24, undefined, 0);
    const spatialCollisionBypassStats = window.particleStudio.getOperatorRuntimeStats();

    const trailBypassGraph = structuredClone(spatialGraph);
    trailBypassGraph.nodes.find((node) => node.id === 'particle-trail').bypass = true;
    trailBypassGraph.nodes.find((node) => node.id === 'particle-feedback').params.resetVersion += 2;
    window.particleStudio.setOperatorGraph(trailBypassGraph);
    window.particleStudio.renderFrame(0, undefined, 0);
    window.particleStudio.renderFrame(0.12, undefined, 0);
    const spatialTrailBypassed = window.particleStudio.renderFrame(0.24, undefined, 0);
    const spatialTrailBypassStats = window.particleStudio.getOperatorRuntimeStats();

    const dissolveGraph = structuredClone(graph);
    const dissolveNode = dissolveGraph.nodes.find((node) => node.type === 'simulation.dissolve');
    dissolveNode.params = {
      ...dissolveNode.params,
      dissolve: 0.65,
      dissolveSpread: 1.55,
      dissolveTurbulence: 1.25,
      dissolveCurl: 1.5,
      dissolveMist: 0.7
    };
    window.particleStudio.setOperatorGraph(dissolveGraph);
    const graphDissolve = window.particleStudio.renderFrame(0.4, undefined, 0);
    const dissolveStats = window.particleStudio.getOperatorRuntimeStats();
    const creatorDissolveAfterGraph = window.particleStudio.getOptions().dissolve;
    dissolveNode.bypass = true;
    window.particleStudio.setOperatorGraph(dissolveGraph);
    const dissolveBypassed = window.particleStudio.renderFrame(0.4, undefined, 0);
    const dissolveBypassStats = window.particleStudio.getOperatorRuntimeStats();

    const brokenOutputGraph = structuredClone(graph);
    brokenOutputGraph.edges = brokenOutputGraph.edges.filter((edge) => edge.to.node !== 'viewport-output');
    window.particleStudio.setOperatorGraph(brokenOutputGraph);
    window.particleStudio.renderFrame(0.4, undefined, 0);
    const brokenOutputStats = window.particleStudio.getOperatorRuntimeStats();

    const disabledOutputGraph = structuredClone(graph);
    disabledOutputGraph.nodes.find((node) => node.type === 'output.viewport').enabled = false;
    window.particleStudio.setOperatorGraph(disabledOutputGraph);
    window.particleStudio.renderFrame(0.4, undefined, 0);
    const disabledOutputStats = window.particleStudio.getOperatorRuntimeStats();

    const directGraph = structuredClone(graph);
    directGraph.edges = directGraph.edges.filter((edge) => edge.to.node !== 'viewport-output');
    directGraph.edges.push({
      id: 'render-direct-to-viewport',
      from: { node: 'particle-render', port: 'color' },
      to: { node: 'viewport-output', port: 'color' },
      enabled: true,
      feedback: false,
      metadata: {}
    });
    window.particleStudio.setOperatorGraph(directGraph);
    const directOutput = window.particleStudio.renderFrame(0.4, undefined, 0);
    const directOutputStats = window.particleStudio.getOperatorRuntimeStats();

    glowNode.bypass = true;
    window.particleStudio.setOperatorGraph(graph);
    const glowBypassed = window.particleStudio.renderFrame(0.4, undefined, 0);
    const bypassStats = window.particleStudio.getOperatorRuntimeStats();

    window.particleStudio.resetOperatorGraph();
    await window.particleStudio.setOptions({ glowRadius: 0, glowExposure: 0 }, true);
    window.particleStudio.setCameraSettings({
      type: 'perspective',
      dofEnabled: true,
      aperture: 1.2,
      focusDistance: 1
    });
    window.particleStudio.resetOperatorGraph();
    const dofOn = window.particleStudio.renderFrame(0.4, undefined, 0);
    const dofEnabledStats = window.particleStudio.getOperatorRuntimeStats();
    const dofGraph = window.particleStudio.getOperatorGraph();
    dofGraph.metadata = { ...dofGraph.metadata, mode: 'graph', synchronized: false };
    const dofNode = dofGraph.nodes.find((node) => node.type === 'post.depth-of-field');
    dofNode.bypass = true;
    window.particleStudio.setOperatorGraph(dofGraph);
    const dofBypassed = window.particleStudio.renderFrame(0.4, undefined, 0);
    const dofBypassStats = window.particleStudio.getOperatorRuntimeStats();

    window.particleStudio.setExportResolution(400, 224, 24);
    window.particleStudio.resetOperatorGraph();
    window.particleStudio.renderFrame(0.4, undefined, 0);
    const resizedPoolStats = window.particleStudio.getOperatorRuntimeStats();
    window.particleStudio.setExportResolution(512, 288, 24);

    window.particleStudio.setCameraSettings({ type: 'perspective', dofEnabled: false });
    window.particleStudio.resetOperatorGraph();
    return {
      glowOn,
      glowParamLow,
      feedbackOn,
      feedbackBypassed,
      forceBypassed,
      lifecycleAll,
      lifecycleAllMoved,
      lifecycleBurst,
      lifecycleBurstRepeat,
      lifecycleContinuousStart,
      lifecycleContinuousMid,
      lifecycleStats,
      spatialCollisionOn,
      spatialCollisionBypassed,
      spatialTrailBypassed,
      graphDissolve,
      dissolveBypassed,
      directOutput,
      glowBypassed,
      dofOn,
      dofBypassed,
      enabledStats,
      fullEffectsStats,
      parameterStats,
      feedbackResetStats,
      feedbackStats,
      feedbackBypassStats,
      forceBypassStats,
      spatialCollisionStats,
      spatialCollisionBypassStats,
      spatialTrailBypassStats,
      dissolveStats,
      dissolveBypassStats,
      brokenOutputStats,
      disabledOutputStats,
      resizedPoolStats,
      creatorDissolveAfterGraph,
      directOutputStats,
      bypassStats,
      dofEnabledStats,
      dofBypassStats
    };
  });

  const glowDifference = await measureFrameDifference(page, frames.glowOn, frames.glowBypassed);
  const glowParameterDifference = await measureFrameDifference(page, frames.glowOn, frames.glowParamLow);
  const graphDissolveDifference = await measureFrameDifference(page, frames.glowParamLow, frames.graphDissolve);
  const feedbackDifference = await measureFrameDifference(page, frames.feedbackOn, frames.feedbackBypassed);
  const forceBypassDifference = await measureFrameDifference(page, frames.feedbackOn, frames.forceBypassed);
  const lifecycleBurstDifference = await measureFrameDifference(page, frames.lifecycleAll, frames.lifecycleBurst);
  const lifecycleInitialVelocityDifference = await measureFrameDifference(
    page,
    frames.lifecycleAll,
    frames.lifecycleAllMoved
  );
  const lifecycleContinuousDifference = await measureFrameDifference(
    page,
    frames.lifecycleContinuousStart,
    frames.lifecycleContinuousMid
  );
  const spatialCollisionDifference = await measureFrameDifference(
    page,
    frames.spatialCollisionOn,
    frames.spatialCollisionBypassed
  );
  const spatialTrailDifference = await measureFrameDifference(
    page,
    frames.spatialCollisionOn,
    frames.spatialTrailBypassed
  );
  const dissolveBypassDifference = await measureFrameDifference(page, frames.graphDissolve, frames.dissolveBypassed);
  const directOutputDifference = await measureFrameDifference(page, frames.glowOn, frames.directOutput);
  const dofDifference = await measureFrameDifference(page, frames.dofOn, frames.dofBypassed);
  await writeDataUrl(path.join(outDir, 'operator-runtime-glow-on.png'), frames.glowOn);
  await writeDataUrl(path.join(outDir, 'operator-runtime-glow-param-low.png'), frames.glowParamLow);
  await writeDataUrl(path.join(outDir, 'operator-runtime-feedback-on.png'), frames.feedbackOn);
  await writeDataUrl(path.join(outDir, 'operator-runtime-feedback-bypassed.png'), frames.feedbackBypassed);
  await writeDataUrl(path.join(outDir, 'operator-runtime-force-bypassed.png'), frames.forceBypassed);
  await writeDataUrl(path.join(outDir, 'operator-runtime-lifecycle-all.png'), frames.lifecycleAll);
  await writeDataUrl(path.join(outDir, 'operator-runtime-lifecycle-all-moved.png'), frames.lifecycleAllMoved);
  await writeDataUrl(path.join(outDir, 'operator-runtime-lifecycle-burst.png'), frames.lifecycleBurst);
  await writeDataUrl(path.join(outDir, 'operator-runtime-lifecycle-continuous-start.png'), frames.lifecycleContinuousStart);
  await writeDataUrl(path.join(outDir, 'operator-runtime-lifecycle-continuous-mid.png'), frames.lifecycleContinuousMid);
  await writeDataUrl(path.join(outDir, 'operator-runtime-attractor-collision.png'), frames.spatialCollisionOn);
  await writeDataUrl(path.join(outDir, 'operator-runtime-collision-bypassed.png'), frames.spatialCollisionBypassed);
  await writeDataUrl(path.join(outDir, 'operator-runtime-trail-bypassed.png'), frames.spatialTrailBypassed);
  await writeDataUrl(path.join(outDir, 'operator-runtime-graph-dissolve.png'), frames.graphDissolve);
  await writeDataUrl(path.join(outDir, 'operator-runtime-dissolve-bypassed.png'), frames.dissolveBypassed);
  await writeDataUrl(path.join(outDir, 'operator-runtime-direct-output.png'), frames.directOutput);
  await writeDataUrl(path.join(outDir, 'operator-runtime-glow-bypassed.png'), frames.glowBypassed);
  await writeDataUrl(path.join(outDir, 'operator-runtime-dof-on.png'), frames.dofOn);
  await writeDataUrl(path.join(outDir, 'operator-runtime-dof-bypassed.png'), frames.dofBypassed);
  const requiredNodes = [
    'particle-force',
    'particle-return',
    'particle-emitter',
    'particle-birth-life',
    'particle-feedback',
    'particle-render',
    'multi-glow',
    'viewport-dof',
    'viewport-output'
  ];
  const requiredResourcePasses = [
    'geometry.particle-sampler',
    'simulation.dissolve',
    'simulation.force-field',
    'simulation.return-force',
    'simulation.emitter',
    'simulation.birth-life',
    'simulation.feedback-particles',
    'render.particles',
    'post.glow',
    'post.depth-of-field',
    'output.viewport'
  ];
  const enabledResourceStats = frames.enabledStats.resources;
  const enabledPoolStats = enabledResourceStats?.pools?.[0];
  const fullEffectsResourceStats = frames.fullEffectsStats.resources;
  const fullEffectsPoolStats = fullEffectsResourceStats?.pools?.[0];
  const parameterPoolStats = frames.parameterStats.resources?.pools?.[0];
  const resizedPoolStats = frames.resizedPoolStats.resources?.pools?.[0];
  const dofEnabledResourceStats = frames.dofEnabledStats.resources;
  const dofEnabledPoolStats = dofEnabledResourceStats?.pools?.[0];
  const dofResourceStats = frames.dofBypassStats.resources;
  const feedbackResetResource = frames.feedbackResetStats.resources?.resources?.find((resource) => (
    resource.producerNodeId === 'particle-feedback' && resource.kind === 'points'
  ));
  const feedbackResource = frames.feedbackStats.resources?.resources?.find((resource) => (
    resource.producerNodeId === 'particle-feedback' && resource.kind === 'points'
  ));
  const spatialFeedbackResource = frames.spatialCollisionStats.resources?.resources?.find((resource) => (
    resource.producerNodeId === 'particle-feedback' && resource.kind === 'points'
  ));
  const lifecycleFeedbackResource = frames.lifecycleStats.resources?.resources?.find((resource) => (
    resource.producerNodeId === 'particle-feedback' && resource.kind === 'points'
  ));
  const spatialRenderResource = frames.spatialCollisionStats.resources?.resources?.find((resource) => (
    resource.producerNodeId === 'particle-render' && resource.kind === 'texture'
  ));
  const spatialGlowResource = frames.spatialCollisionStats.resources?.resources?.find((resource) => (
    resource.producerNodeId === 'multi-glow' && resource.kind === 'texture'
  ));
  return {
    ok:
      glowDifference.meanDelta > 0.5 &&
      glowDifference.changedRatio > 0.01 &&
      glowParameterDifference.meanDelta > 0.5 &&
      glowParameterDifference.changedRatio > 0.01 &&
      feedbackDifference.meanDelta > 0.1 &&
      feedbackDifference.changedRatio > 0.003 &&
      forceBypassDifference.meanDelta > 0.1 &&
      forceBypassDifference.changedRatio > 0.003 &&
      lifecycleBurstDifference.meanDelta > 0.1 &&
      lifecycleBurstDifference.changedRatio > 0.003 &&
      lifecycleInitialVelocityDifference.meanDelta > 0.1 &&
      lifecycleInitialVelocityDifference.changedRatio > 0.003 &&
      lifecycleContinuousDifference.meanDelta > 0.1 &&
      lifecycleContinuousDifference.changedRatio > 0.003 &&
      frames.lifecycleBurst === frames.lifecycleBurstRepeat &&
      lifecycleFeedbackResource?.metadata?.emitterMode === 'continuous' &&
      lifecycleFeedbackResource?.metadata?.emitterRate === 2000 &&
      lifecycleFeedbackResource?.metadata?.lifetimeRange?.join(',') === '10,10' &&
      lifecycleFeedbackResource?.metadata?.lifecycleSeekDeterministic === true &&
      spatialCollisionDifference.meanDelta > 0.1 &&
      spatialCollisionDifference.changedRatio > 0.003 &&
      spatialTrailDifference.meanDelta > 0.05 &&
      spatialTrailDifference.changedRatio > 0.001 &&
      graphDissolveDifference.meanDelta > 0.5 &&
      graphDissolveDifference.changedRatio > 0.01 &&
      dissolveBypassDifference.meanDelta > 0.5 &&
      dissolveBypassDifference.changedRatio > 0.01 &&
      frames.creatorDissolveAfterGraph === 0 &&
      directOutputDifference.meanDelta > 0.5 &&
      directOutputDifference.changedRatio > 0.01 &&
      dofDifference.meanDelta > 0.5 &&
      dofDifference.changedRatio > 0.01 &&
      !frames.enabledStats.error &&
      !frames.parameterStats.error &&
      !frames.feedbackStats.error &&
      !frames.feedbackBypassStats.error &&
      !frames.forceBypassStats.error &&
      !frames.spatialCollisionStats.error &&
      !frames.spatialCollisionBypassStats.error &&
      !frames.spatialTrailBypassStats.error &&
      feedbackResetResource?.metadata?.reset === true &&
      feedbackResetResource?.metadata?.resetReason === 'reset-version' &&
      feedbackResource?.metadata?.computeFrames >= 2 &&
      feedbackResource?.metadata?.computeSteps >= 8 &&
      feedbackResource?.metadata?.frameSteps === 4 &&
      Math.abs(feedbackResource?.metadata?.delta - 0.12) < 0.001 &&
      feedbackResource?.metadata?.simulationModifierCount === 4 &&
      feedbackResource?.metadata?.simulationModifierNodeIds?.join(',') ===
        'particle-force,particle-return,particle-emitter,particle-birth-life' &&
      feedbackResource?.metadata?.lifecycleTimeModel === 'absolute-cycle-v1' &&
      feedbackResource?.metadata?.lifecycleSeekDeterministic === true &&
      feedbackResource?.metadata?.motionSeekDeterministic === false &&
      feedbackResource?.metadata?.emitterNodeId === 'particle-emitter' &&
      feedbackResource?.metadata?.birthLifeNodeId === 'particle-birth-life' &&
      Math.abs(feedbackResource?.metadata?.effectiveForce?.[0] - 0.352) < 0.001 &&
      Math.abs(feedbackResource?.metadata?.effectiveForce?.[1] - 0.56) < 0.001 &&
      Math.abs(feedbackResource?.metadata?.effectiveForce?.[2] + 0.128) < 0.001 &&
      Math.abs(feedbackResource?.metadata?.effectiveAttraction - 0.05) < 0.001 &&
      Math.abs(feedbackResource?.metadata?.effectiveTurbulence - 2.88) < 0.001 &&
      Math.abs(feedbackResource?.metadata?.effectiveCurl - 1.92) < 0.001 &&
      spatialFeedbackResource?.metadata?.stateSpace === 'model-local-position' &&
      spatialFeedbackResource?.metadata?.basePositionByteLength > 0 &&
      spatialFeedbackResource?.metadata?.stateByteLength > spatialFeedbackResource?.metadata?.pingPongByteLength &&
      spatialFeedbackResource?.metadata?.simulationModifierCount === 7 &&
      spatialFeedbackResource?.metadata?.attractorCount === 1 &&
      spatialFeedbackResource?.metadata?.attractorNodeIds?.join(',') === 'particle-attractor' &&
      spatialFeedbackResource?.metadata?.collisionPlaneCount === 1 &&
      spatialFeedbackResource?.metadata?.collisionPlaneNodeIds?.join(',') === 'particle-collision' &&
      spatialFeedbackResource?.metadata?.trailByteLength > 0 &&
      spatialFeedbackResource?.metadata?.trailHistorySamples === 6 &&
      spatialFeedbackResource?.metadata?.trailHistoryCapacity === 6 &&
      spatialFeedbackResource?.metadata?.trailNodeId === 'particle-trail' &&
      spatialRenderResource?.metadata?.trailDrawCount === 6 &&
      spatialGlowResource?.metadata?.trailGlowDrawCount === 6 &&
      frames.spatialCollisionStats.resources?.passes?.map((pass) => pass.type).join(',') ===
        'geometry.particle-sampler,simulation.dissolve,simulation.force-field,simulation.return-force,simulation.attractor,simulation.collision-plane,simulation.trail,simulation.emitter,simulation.birth-life,simulation.feedback-particles,render.particles,post.glow,post.depth-of-field,output.viewport' &&
      frames.spatialCollisionBypassStats.resources?.passes?.some((pass) => (
        pass.type === 'simulation.collision-plane' &&
        pass.skipped &&
        pass.reason === 'bypass' &&
        pass.inputResourceIds.length === 1 &&
        pass.inputResourceIds[0] === pass.outputResourceIds[0]
      )) &&
      frames.spatialCollisionBypassStats.resources?.resources?.some((resource) => (
        resource.producerNodeId === 'particle-feedback' &&
        resource.metadata?.simulationModifierCount === 6 &&
        resource.metadata?.attractorCount === 1 &&
        resource.metadata?.collisionPlaneCount === 0 &&
        resource.metadata?.trailHistoryCapacity === 6
      )) &&
      frames.spatialTrailBypassStats.resources?.passes?.some((pass) => (
        pass.type === 'simulation.trail' &&
        pass.skipped &&
        pass.reason === 'bypass' &&
        pass.inputResourceIds.length === 1 &&
        pass.inputResourceIds[0] === pass.outputResourceIds[0]
      )) &&
      frames.spatialTrailBypassStats.resources?.resources?.some((resource) => (
        resource.producerNodeId === 'particle-feedback' &&
        resource.metadata?.simulationModifierCount === 6 &&
        resource.metadata?.trailHistorySamples === 0 &&
        resource.metadata?.trailHistoryCapacity === 0 &&
        resource.metadata?.trailByteLength === 0
      )) &&
      frames.feedbackBypassStats.resources?.passes?.some((pass) => (
        pass.type === 'simulation.feedback-particles' &&
        pass.skipped &&
        pass.reason === 'bypass' &&
        pass.inputResourceIds.length === 1 &&
        pass.inputResourceIds[0] === pass.outputResourceIds[0]
      )) &&
      frames.feedbackBypassStats.resources?.passes?.some((pass) => (
        pass.type === 'render.particles' &&
        pass.inputResourceIds.some((id) => id.includes(':particle-birth-life:points:'))
      )) &&
      frames.forceBypassStats.resources?.passes?.some((pass) => (
        pass.type === 'simulation.force-field' &&
        pass.skipped &&
        pass.reason === 'bypass' &&
        pass.inputResourceIds.length === 1 &&
        pass.inputResourceIds[0] === pass.outputResourceIds[0]
      )) &&
      frames.forceBypassStats.resources?.passes?.some((pass) => (
        pass.type === 'simulation.return-force' &&
        pass.inputResourceIds.some((id) => id.includes(':flow-dissolve:points:'))
      )) &&
      frames.forceBypassStats.resources?.resources?.some((resource) => (
        resource.producerNodeId === 'particle-feedback' &&
        resource.metadata?.simulationModifierCount === 3 &&
        Math.abs(resource.metadata?.effectiveForce?.[0] || 0) < 0.001 &&
        Math.abs(resource.metadata?.effectiveForce?.[1] || 0) < 0.001 &&
        Math.abs(resource.metadata?.effectiveForce?.[2] || 0) < 0.001 &&
        Math.abs(resource.metadata?.effectiveAttraction - 0.05) < 0.001
      )) &&
      !frames.dissolveStats.error &&
      !frames.dissolveBypassStats.error &&
      frames.brokenOutputStats.fallback === true &&
      frames.brokenOutputStats.error?.nodeId === 'viewport-output' &&
      frames.brokenOutputStats.resources?.pools?.[0]?.activeLeaseCount === 0 &&
      frames.brokenOutputStats.resources?.pools?.[0]?.acquisitions === 0 &&
      frames.brokenOutputStats.resources?.pools?.[0]?.releases === 0 &&
      frames.brokenOutputStats.resources?.lifetime?.activeResourceCount === 0 &&
      frames.brokenOutputStats.resources?.lifetime?.aborted === true &&
      frames.disabledOutputStats.fallback === true &&
      frames.disabledOutputStats.error?.message?.includes('without reaching an enabled Viewport Output') &&
      frames.disabledOutputStats.resources?.pools?.[0]?.activeLeaseCount === 0 &&
      frames.disabledOutputStats.resources?.pools?.[0]?.acquisitions === 0 &&
      frames.disabledOutputStats.resources?.pools?.[0]?.releases === 0 &&
      frames.disabledOutputStats.resources?.lifetime?.activeResourceCount === 0 &&
      !frames.directOutputStats.error &&
      !frames.bypassStats.error &&
      !frames.dofEnabledStats.error &&
      !frames.dofBypassStats.error &&
      frames.bypassStats.scope === 'export-frame' &&
      frames.dofBypassStats.scope === 'export-frame' &&
      requiredNodes.every((nodeId) => frames.bypassStats.executedNodeIds.includes(nodeId)) &&
      requiredNodes.every((nodeId) => frames.dofBypassStats.executedNodeIds.includes(nodeId)) &&
      enabledResourceStats?.resourceCount >= 3 &&
      enabledResourceStats?.poolCount === 1 &&
      enabledPoolStats?.entryCount === 9 &&
      enabledPoolStats?.adoptedEntryCount === 9 &&
      enabledPoolStats?.ownedEntryCount === 0 &&
      enabledPoolStats?.reuses === 7 &&
      enabledPoolStats?.allocations === 0 &&
      enabledPoolStats?.releases === 7 &&
      enabledPoolStats?.peakActiveLeases === 7 &&
      enabledPoolStats?.activeLeaseCount === 0 &&
      enabledResourceStats?.lifetime?.managedResourceCount === 3 &&
      enabledResourceStats?.lifetime?.activeResourceCount === 0 &&
      enabledResourceStats?.lifetime?.aliasPublications === 1 &&
      enabledResourceStats?.lifetime?.releases === 3 &&
      fullEffectsPoolStats?.reuses === 11 &&
      fullEffectsPoolStats?.allocations === 0 &&
      fullEffectsPoolStats?.releases === 11 &&
      fullEffectsPoolStats?.peakActiveLeases === 7 &&
      fullEffectsPoolStats?.activeLeaseCount === 0 &&
      fullEffectsResourceStats?.lifetime?.managedResourceCount === 4 &&
      fullEffectsResourceStats?.lifetime?.activeResourceCount === 0 &&
      fullEffectsResourceStats?.lifetime?.releases === 4 &&
      parameterPoolStats?.totalReuses > fullEffectsPoolStats?.totalReuses &&
      parameterPoolStats?.activeLeaseCount === 0 &&
      resizedPoolStats?.entryCount === 9 &&
      resizedPoolStats?.reuses === 5 &&
      resizedPoolStats?.allocations === 0 &&
      resizedPoolStats?.releases === 5 &&
      resizedPoolStats?.peakActiveLeases === 5 &&
      resizedPoolStats?.activeLeaseCount === 0 &&
      resizedPoolStats?.entries?.some((entry) => (
        entry.label === 'sceneTarget' &&
        entry.descriptor?.width === 400 &&
        entry.descriptor?.height === 224
      )) &&
      enabledResourceStats?.passes?.map((pass) => pass.type).join(',') === requiredResourcePasses.join(',') &&
      enabledResourceStats?.resources?.some((resource) => (
        resource.kind === 'points' &&
        resource.producerNodeId === 'particle-sampler' &&
        resource.count === 20000 &&
        resource.byteLength > 0
      )) &&
      enabledResourceStats?.resources?.some((resource) => (
        resource.kind === 'points' && resource.producerNodeId === 'flow-dissolve'
      )) &&
      enabledResourceStats?.resources?.some((resource) => (
        resource.kind === 'points' &&
        resource.producerNodeId === 'particle-force' &&
        resource.metadata?.stage === 'particle-force-field' &&
        resource.metadata?.modifierKind === 'force-field'
      )) &&
      enabledResourceStats?.resources?.some((resource) => (
        resource.kind === 'points' &&
        resource.producerNodeId === 'particle-return' &&
        resource.metadata?.stage === 'particle-return-force' &&
        resource.metadata?.modifierKind === 'return-force'
      )) &&
      enabledResourceStats?.resources?.some((resource) => (
        resource.kind === 'points' &&
        resource.producerNodeId === 'particle-feedback' &&
        resource.metadata?.stage === 'particle-feedback' &&
        resource.metadata?.stateTextureWidth > 0 &&
        resource.metadata?.stateTextureHeight > 0 &&
        resource.metadata?.pingPongByteLength > 0 &&
        resource.metadata?.simulationModifierCount === 4 &&
        Math.abs(resource.metadata?.effectiveForce?.[1] - 0.1) < 0.001 &&
        Math.abs(resource.metadata?.effectiveAttraction - 0.48) < 0.001 &&
        Math.abs(resource.metadata?.effectiveTurbulence - 0.72) < 0.001
      )) &&
      enabledResourceStats?.resources?.some((resource) => resource.kind === 'depth') &&
      enabledResourceStats?.resources?.some((resource) => resource.metadata?.stage === 'glow') &&
      frames.parameterStats.resources?.resources?.some((resource) => (
        resource.metadata?.stage === 'glow' &&
        resource.metadata.glowRadius === 30 &&
        resource.metadata.glowExposure === 0.15
      )) &&
      frames.dissolveStats.resources?.resources?.some((resource) => (
        resource.kind === 'points' &&
        resource.producerNodeId === 'flow-dissolve' &&
        resource.metadata?.dissolve === 0.65 &&
        resource.metadata?.turbulence === 1.25 &&
        resource.metadata?.curl === 1.5
      )) &&
      frames.dissolveStats.resources?.passes?.some((pass) => (
        pass.type === 'render.particles' &&
        pass.inputResourceIds.some((id) => id.includes(':particle-feedback:points:'))
      )) &&
      frames.dissolveBypassStats.resources?.passes?.some((pass) => (
        pass.type === 'simulation.dissolve' &&
        pass.skipped &&
        pass.reason === 'bypass' &&
        pass.inputResourceIds.length === 1 &&
        pass.inputResourceIds[0] === pass.outputResourceIds[0]
      )) &&
      frames.dissolveBypassStats.resources?.passes?.some((pass) => (
        pass.type === 'simulation.force-field' &&
        pass.inputResourceIds.some((id) => id.includes(':particle-sampler:points:'))
      )) &&
      frames.directOutputStats.demandedNodeIds?.includes('particle-render') &&
      !frames.directOutputStats.demandedNodeIds?.includes('multi-glow') &&
      !frames.directOutputStats.demandedNodeIds?.includes('viewport-dof') &&
      frames.directOutputStats.skippedUndemandedNodeIds?.includes('multi-glow') &&
      frames.directOutputStats.resources?.passes?.map((pass) => pass.type).join(',') ===
        'geometry.particle-sampler,simulation.dissolve,simulation.force-field,simulation.return-force,simulation.emitter,simulation.birth-life,simulation.feedback-particles,render.particles,output.viewport' &&
      frames.directOutputStats.resources?.pools?.[0]?.acquisitions === 1 &&
      frames.directOutputStats.resources?.pools?.[0]?.reuses === 1 &&
      frames.directOutputStats.resources?.pools?.[0]?.releases === 1 &&
      frames.directOutputStats.resources?.pools?.[0]?.peakActiveLeases === 1 &&
      frames.directOutputStats.resources?.lifetime?.managedResourceCount === 2 &&
      frames.directOutputStats.resources?.lifetime?.zeroConsumerReleases === 1 &&
      frames.directOutputStats.resources?.lifetime?.activeResourceCount === 0 &&
      dofEnabledPoolStats?.entryCount === 9 &&
      dofEnabledPoolStats?.reuses === 5 &&
      dofEnabledPoolStats?.allocations === 0 &&
      dofEnabledPoolStats?.releases === 5 &&
      dofEnabledPoolStats?.peakActiveLeases === 5 &&
      dofEnabledPoolStats?.activeLeaseCount === 0 &&
      dofEnabledResourceStats?.resources?.some((resource) => (
        resource.metadata?.stage === 'depth-of-field' &&
        resource.producerNodeId === 'viewport-dof' &&
        resource.metadata?.lensModel === 'thin-lens-signed-coc' &&
        resource.metadata?.maximumRadiusPixels > 0 &&
        resource.metadata?.prefilterRadiusPixels > 0 &&
        resource.metadata?.prefilterWidth > 0 &&
        resource.metadata?.prefilterHeight > 0 &&
        resource.metadata?.bokehWidth > 0 &&
        resource.metadata?.bokehHeight > 0 &&
        resource.metadata?.bokehRenderScale === 0.5 &&
        resource.metadata?.resolveRadiusPixels >= 2
      )) &&
      dofEnabledResourceStats?.passes?.some((pass) => (
        pass.type === 'post.depth-of-field' && !pass.skipped && pass.outputResourceIds.length === 1
      )) &&
      dofResourceStats?.passes?.some((pass) => (
        pass.type === 'post.depth-of-field' && pass.skipped && pass.reason === 'bypass'
      )),
    glowDifference,
    glowParameterDifference,
    feedbackDifference,
    forceBypassDifference,
    lifecycleBurstDifference,
    lifecycleInitialVelocityDifference,
    lifecycleContinuousDifference,
    lifecycleBurstRepeatable: frames.lifecycleBurst === frames.lifecycleBurstRepeat,
    spatialCollisionDifference,
    spatialTrailDifference,
    graphDissolveDifference,
    dissolveBypassDifference,
    directOutputDifference,
    dofDifference,
    enabledStats: {
      scope: frames.enabledStats.scope,
      totalMs: frames.enabledStats.totalMs,
      executedNodeIds: frames.enabledStats.executedNodeIds,
      cacheHitNodeIds: frames.enabledStats.cacheHitNodeIds,
      error: frames.enabledStats.error,
      resources: frames.enabledStats.resources
    },
    fullEffectsStats: {
      scope: frames.fullEffectsStats.scope,
      totalMs: frames.fullEffectsStats.totalMs,
      executedNodeIds: frames.fullEffectsStats.executedNodeIds,
      error: frames.fullEffectsStats.error,
      resources: frames.fullEffectsStats.resources
    },
    bypassStats: {
      scope: frames.bypassStats.scope,
      totalMs: frames.bypassStats.totalMs,
      executedNodeIds: frames.bypassStats.executedNodeIds,
      cacheHitNodeIds: frames.bypassStats.cacheHitNodeIds,
      error: frames.bypassStats.error
    },
    parameterStats: {
      scope: frames.parameterStats.scope,
      totalMs: frames.parameterStats.totalMs,
      executedNodeIds: frames.parameterStats.executedNodeIds,
      cacheHitNodeIds: frames.parameterStats.cacheHitNodeIds,
      error: frames.parameterStats.error,
      resources: frames.parameterStats.resources
    },
    feedbackStats: {
      scope: frames.feedbackStats.scope,
      totalMs: frames.feedbackStats.totalMs,
      executedNodeIds: frames.feedbackStats.executedNodeIds,
      error: frames.feedbackStats.error,
      feedbackResource
    },
    feedbackBypassStats: {
      scope: frames.feedbackBypassStats.scope,
      totalMs: frames.feedbackBypassStats.totalMs,
      executedNodeIds: frames.feedbackBypassStats.executedNodeIds,
      error: frames.feedbackBypassStats.error
    },
    directOutputStats: {
      scope: frames.directOutputStats.scope,
      totalMs: frames.directOutputStats.totalMs,
      executedNodeIds: frames.directOutputStats.executedNodeIds,
      demandedNodeIds: frames.directOutputStats.demandedNodeIds,
      skippedUndemandedNodeIds: frames.directOutputStats.skippedUndemandedNodeIds,
      error: frames.directOutputStats.error,
      resources: frames.directOutputStats.resources
    },
    dofEnabledStats: {
      scope: frames.dofEnabledStats.scope,
      totalMs: frames.dofEnabledStats.totalMs,
      executedNodeIds: frames.dofEnabledStats.executedNodeIds,
      cacheHitNodeIds: frames.dofEnabledStats.cacheHitNodeIds,
      error: frames.dofEnabledStats.error,
      resources: frames.dofEnabledStats.resources
    },
    dofBypassStats: {
      scope: frames.dofBypassStats.scope,
      totalMs: frames.dofBypassStats.totalMs,
      executedNodeIds: frames.dofBypassStats.executedNodeIds,
      cacheHitNodeIds: frames.dofBypassStats.cacheHitNodeIds,
      error: frames.dofBypassStats.error,
      resources: frames.dofBypassStats.resources
    },
    fixtures: {
      glowOn: path.join(outDir, 'operator-runtime-glow-on.png'),
      glowParamLow: path.join(outDir, 'operator-runtime-glow-param-low.png'),
      feedbackOn: path.join(outDir, 'operator-runtime-feedback-on.png'),
      feedbackBypassed: path.join(outDir, 'operator-runtime-feedback-bypassed.png'),
      forceBypassed: path.join(outDir, 'operator-runtime-force-bypassed.png'),
      lifecycleAll: path.join(outDir, 'operator-runtime-lifecycle-all.png'),
      lifecycleAllMoved: path.join(outDir, 'operator-runtime-lifecycle-all-moved.png'),
      lifecycleBurst: path.join(outDir, 'operator-runtime-lifecycle-burst.png'),
      lifecycleContinuousStart: path.join(outDir, 'operator-runtime-lifecycle-continuous-start.png'),
      lifecycleContinuousMid: path.join(outDir, 'operator-runtime-lifecycle-continuous-mid.png'),
      spatialCollisionOn: path.join(outDir, 'operator-runtime-attractor-collision.png'),
      spatialCollisionBypassed: path.join(outDir, 'operator-runtime-collision-bypassed.png'),
      spatialTrailBypassed: path.join(outDir, 'operator-runtime-trail-bypassed.png'),
      graphDissolve: path.join(outDir, 'operator-runtime-graph-dissolve.png'),
      dissolveBypassed: path.join(outDir, 'operator-runtime-dissolve-bypassed.png'),
      directOutput: path.join(outDir, 'operator-runtime-direct-output.png'),
      glowBypassed: path.join(outDir, 'operator-runtime-glow-bypassed.png'),
      dofOn: path.join(outDir, 'operator-runtime-dof-on.png'),
      dofBypassed: path.join(outDir, 'operator-runtime-dof-bypassed.png')
    }
  };
}

async function verifyParameterContinuity(page) {
  return page.evaluate(async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    function loadImage(src) {
      return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = src;
      });
    }

    async function measureFrame(src) {
      const image = await loadImage(src);
      const width = 192;
      const height = 108;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(image, 0, 0, width, height);
      const data = context.getImageData(0, 0, width, height).data;
      let pixelCount = 0;
      let luminance = 0;
      let brightCount = 0;
      let grayishCount = 0;
      for (let offset = 0; offset < data.length; offset += 4) {
        const r = data[offset];
        const g = data[offset + 1];
        const b = data[offset + 2];
        const value = r * 0.2126 + g * 0.7152 + b * 0.0722;
        const backgroundDistance = Math.abs(r - 9) + Math.abs(g - 10) + Math.abs(b - 12);
        if (backgroundDistance < 22 || value < 12) {
          continue;
        }
        pixelCount += 1;
        luminance += value;
        if (value > 205) {
          brightCount += 1;
        }
        const chroma = Math.max(r, g, b) - Math.min(r, g, b);
        if (chroma < 12 && value > 35) {
          grayishCount += 1;
        }
      }
      return {
        pixelCount,
        meanLuminance: luminance / Math.max(pixelCount, 1),
        brightRatio: brightCount / Math.max(pixelCount, 1),
        grayishRatio: grayishCount / Math.max(pixelCount, 1)
      };
    }

    async function renderMetrics(options) {
      await window.particleStudio.setOptions(options, true);
      await sleep(80);
      return measureFrame(window.particleStudio.renderFrame(0, undefined, 0));
    }

    async function compare(name, baseOptions, lowOptions, limits = {}) {
      const base = await renderMetrics(baseOptions);
      const low = await renderMetrics(lowOptions);
      const luminanceRatio = low.meanLuminance / Math.max(base.meanLuminance, 0.0001);
      const pixelRatio = low.pixelCount / Math.max(base.pixelCount, 1);
      const brightDelta = low.brightRatio - base.brightRatio;
      const grayDelta = low.grayishRatio - base.grayishRatio;
      const ok =
        base.pixelCount > 80 &&
        low.pixelCount > 80 &&
        luminanceRatio <= (limits.maxLuminanceRatio ?? 1.42) &&
        luminanceRatio >= (limits.minLuminanceRatio ?? 0.62) &&
        pixelRatio <= (limits.maxPixelRatio ?? 1.85) &&
        pixelRatio >= (limits.minPixelRatio ?? 0.42) &&
        brightDelta <= (limits.maxBrightDelta ?? 0.12) &&
        grayDelta <= (limits.maxGrayDelta ?? 0.32);
      return { name, ok, base, low, luminanceRatio, pixelRatio, brightDelta, grayDelta };
    }

    window.particleStudio.clearCameraKeyframes();
    window.particleStudio.setParameterKeyframes([]);
    window.particleStudio.setExportResolution(384, 216, 24);
    window.particleStudio.setCameraSnapshot({
      position: [0, 0.9, 8.8],
      target: [0, 0.15, 0],
      cameraType: 'perspective',
      focalLength: 42,
      filmGauge: 36,
      dofEnabled: false
    });

    const particleBase = {
      effectMode: 'particles',
      particleCount: 20000,
      pointSize: 2.8,
      particleizeProgress: 1,
      modelVisibility: 1,
      sampleCleanup: 0,
      sizeRandom: 0.28,
      spread: 0,
      noise: 0,
      dissolve: 0,
      growth: 1,
      glowRadius: 80,
      glowExposure: 0,
      autoRotate: false,
      worldEnabled: false,
      worldVisible: false
    };

    const checks = [];
    checks.push(await compare('glowExposure 0 -> 0.05', particleBase, { ...particleBase, glowExposure: 0.05 }));
    checks.push(await compare('glowRadius 0 -> 6', { ...particleBase, glowRadius: 0, glowExposure: 0.35 }, { ...particleBase, glowRadius: 6, glowExposure: 0.35 }));
    checks.push(await compare('spread 0 -> 0.08', particleBase, { ...particleBase, spread: 0.08 }, { maxPixelRatio: 2.2 }));
    checks.push(await compare('noise 0 -> 0.08', particleBase, { ...particleBase, noise: 0.08 }, { maxPixelRatio: 2.2 }));
    checks.push(await compare('dissolve 0 -> 0.04', particleBase, { ...particleBase, dissolve: 0.04 }, { minLuminanceRatio: 0.5, maxPixelRatio: 2.2 }));

    const emissionBase = {
      effectMode: 'emission',
      useTexture: true,
      modelVisibility: 1,
      emissionEnabled: true,
      emissionCount: 600,
      emissionIntensity: 0.65,
      emissionDistance: 0.75,
      emissionSpeed: 0.2,
      emissionOpacity: 0.38,
      emissionSize: 1.1,
      emissionGlow: 0,
      breakAmount: 0,
      breakProgress: 0,
      autoRotate: false,
      worldEnabled: false,
      worldVisible: false
    };
    checks.push(await compare('emissionGlow 0 -> 0.05', emissionBase, { ...emissionBase, emissionGlow: 0.05 }, { maxPixelRatio: 2.3 }));

    const sourceCanvas = document.createElement('canvas');
    sourceCanvas.width = 96;
    sourceCanvas.height = 64;
    const context = sourceCanvas.getContext('2d');
    const gradient = context.createLinearGradient(0, 0, sourceCanvas.width, sourceCanvas.height);
    gradient.addColorStop(0, '#163fff');
    gradient.addColorStop(0.5, '#f7ead0');
    gradient.addColorStop(1, '#ff4b1f');
    context.fillStyle = gradient;
    context.fillRect(0, 0, sourceCanvas.width, sourceCanvas.height);
    context.fillStyle = '#0a0d12';
    context.fillRect(10, 10, 26, 42);
    context.fillStyle = '#44e6a2';
    context.beginPath();
    context.arc(66, 34, 18, 0, Math.PI * 2);
    context.fill();
    await window.particleStudio.setImageSplatObject({
      name: 'continuity-image.png',
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
    const imageSplatBase = {
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
      imageSplatPlaneVisible: false,
      autoRotate: false,
      worldEnabled: false,
      worldVisible: false
    };
    checks.push(await compare('imageSplatGlow 0 -> 0.05', imageSplatBase, { ...imageSplatBase, imageSplatGlow: 0.05 }, { maxPixelRatio: 2.3 }));

    return {
      ok: checks.every((check) => check.ok),
      checks
    };
  });
}

async function measureForegroundLighting(page, nearDataUrl, farDataUrl) {
  return page.evaluate(
    async ({ near, far }) => {
      const width = 256;
      const height = 144;

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
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.drawImage(image, 0, 0, width, height);
        const data = context.getImageData(0, 0, width, height).data;
        let pixelCount = 0;
        let luminance = 0;
        const rgb = [0, 0, 0];
        for (let offset = 0; offset < data.length; offset += 4) {
          const r = data[offset];
          const g = data[offset + 1];
          const b = data[offset + 2];
          const backgroundDistance = Math.abs(r - 9) + Math.abs(g - 10) + Math.abs(b - 12);
          const value = r * 0.2126 + g * 0.7152 + b * 0.0722;
          if (backgroundDistance < 22 || value < 13) {
            continue;
          }
          pixelCount += 1;
          luminance += value;
          rgb[0] += r;
          rgb[1] += g;
          rgb[2] += b;
        }
        return {
          pixelCount,
          meanLuminance: luminance / Math.max(pixelCount, 1),
          meanRgb: rgb.map((value) => value / Math.max(pixelCount, 1))
        };
      }

      return { near: await measure(near), far: await measure(far) };
    },
    { near: nearDataUrl, far: farDataUrl }
  );
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

async function verifyVideoPlaneControls(page) {
  const setup = await page.evaluate(async () => {
    if (typeof MediaRecorder === 'undefined') {
      return { skipped: true, ok: true, reason: 'MediaRecorder unavailable' };
    }

    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 90;
    const context = canvas.getContext('2d');
    const stream = canvas.captureStream(12);
    const preferredTypes = [
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm'
    ];
    const mimeType = preferredTypes.find((type) => MediaRecorder.isTypeSupported(type)) || '';
    const chunks = [];
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recorder.addEventListener('dataavailable', (event) => {
      if (event.data?.size) {
        chunks.push(event.data);
      }
    });
    const stopped = new Promise((resolve) => recorder.addEventListener('stop', resolve, { once: true }));
    recorder.start();
    for (let frame = 0; frame < 16; frame += 1) {
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = frame % 2 ? 'rgba(255, 72, 24, 0.92)' : 'rgba(32, 230, 255, 0.92)';
      context.fillRect(18 + frame, 16, 74, 48);
      context.fillStyle = 'rgba(255, 220, 40, 0.78)';
      context.beginPath();
      context.arc(112, 45, 18 + (frame % 4), 0, Math.PI * 2);
      context.fill();
      await new Promise((resolve) => setTimeout(resolve, 42));
    }
    recorder.stop();
    await stopped;
    stream.getTracks().forEach((track) => track.stop());
    const blob = new Blob(chunks, { type: recorder.mimeType || 'video/webm' });
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });

    await window.particleStudio.setOptions({ modelVisibility: 0, glowRadius: 0, glowExposure: 0 }, true);
    await window.particleStudio.setVideoPlanes({
      activeId: 'smoke-video',
      items: [
        {
          id: 'smoke-video',
          name: 'smoke-video.webm',
          extension: 'webm',
          dataUrl,
          width: 2.1,
          height: 1.18,
          opacity: 0.95,
          playbackRate: 1,
          timeOffset: 0,
          loop: true,
          transform: { position: [0, 0.32, 0.55], rotation: [0, 180, 0], scale: [1, 1, 1] }
        }
      ]
    });
    window.particleStudio.selectVideoPlane('smoke-video');
    window.particleStudio.setCameraSnapshot({ position: [0, 0.35, 3], target: [0, 0.3, 0], fov: 32 });
    return {
      ok: true,
      mimeType: recorder.mimeType,
      bytes: blob.size,
      videoPlanes: window.particleStudio.getVideoPlanes(),
      selection: window.particleStudio.getTransformSelectionDebug(),
      project: window.particleStudio.captureProject()
    };
  });

  if (setup.skipped) {
    return setup;
  }

  await page.waitForFunction(() => window.particleStudio?.isReady(), null, { timeout: 60000 });
  const frameA = await page.evaluate(() => window.particleStudio.renderFrameAsync(0, undefined, 0));
  const frameB = await page.evaluate(() => window.particleStudio.renderFrameAsync(0.42, undefined, 0));
  const difference = await measureFrameDifference(page, frameA, frameB);
  const item = setup.videoPlanes?.items?.[0];
  const projectItem = setup.project?.scene?.videoPlanes?.items?.[0];
  return {
    ok:
      setup.ok &&
      setup.bytes > 100 &&
      item?.name === 'smoke-video.webm' &&
      projectItem?.dataUrl?.startsWith('data:video/webm') &&
      setup.selection?.target === 'video' &&
      setup.selection?.attachedToVideoRoot &&
      difference.meanDelta > 0.03,
    setup: {
      mimeType: setup.mimeType,
      bytes: setup.bytes,
      item,
      selection: setup.selection
    },
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
        let pixelCount = 0;
        const rgb = [0, 0, 0];
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
            pixelCount += 1;
            weight += value;
            rgb[0] += data[offset];
            rgb[1] += data[offset + 1];
            rgb[2] += data[offset + 2];
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
          cy: (cy / weight) / targetHeight,
          meanLuminance: weight / Math.max(pixelCount, 1),
          meanRgb: rgb.map((value) => value / Math.max(pixelCount, 1))
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
      const luminanceDelta = Math.abs(a.meanLuminance - b.meanLuminance);
      const colorDistance = Math.hypot(
        a.meanRgb[0] - b.meanRgb[0],
        a.meanRgb[1] - b.meanRgb[1],
        a.meanRgb[2] - b.meanRgb[2]
      );
      const colorMatch = luminanceDelta < 24 && colorDistance < 38;
      const strictMatch = centerDelta < 0.06 && sizeDelta < 0.16 && shapeRatioDelta < 0.35 && colorMatch;
      const sparsePointMatch = centerDelta < 0.045 && sizeDelta < 0.14 && shapeRatioDelta < 0.55 && colorMatch;
      return {
        ok: strictMatch || sparsePointMatch,
        centerDelta,
        sizeDelta,
        shapeRatioDelta,
        luminanceDelta,
        colorDistance,
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
