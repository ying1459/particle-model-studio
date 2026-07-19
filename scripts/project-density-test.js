import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const packaged = args.includes('--packaged');
const projectArgument = args.find((argument) => argument !== '--packaged');
const projectPath = path.resolve(projectArgument || '');
if (!projectArgument) {
  throw new Error('Usage: node scripts/project-density-test.js [--packaged] <project.pms>');
}
const executablePath = packaged
  ? path.join(rootDir, 'release', 'win-unpacked', 'Particle Model Studio.exe')
  : path.join(rootDir, 'node_modules', 'electron', 'dist', 'electron.exe');
const expectedVersion = JSON.parse(await readFile(path.join(rootDir, 'package.json'), 'utf8')).version;

const outputDir = path.join(rootDir, 'verification');
const outputPrefix = packaged ? 'project-density-packaged' : 'project-density';
const outputPaths = {
  far: path.join(outputDir, `${outputPrefix}-far.png`),
  original: path.join(outputDir, `${outputPrefix}-original.png`),
  near: path.join(outputDir, `${outputPrefix}-near.png`)
};
const launchEnv = { ...process.env };
delete launchEnv.ELECTRON_RUN_AS_NODE;
let electronApp;
const errors = [];

function decodeDataUrl(dataUrl) {
  const encoded = String(dataUrl || '').split(',', 2)[1] || '';
  return Buffer.from(encoded, 'base64');
}

try {
  await mkdir(outputDir, { recursive: true });
  electronApp = await electron.launch({
    executablePath,
    args: packaged ? [] : ['.'],
    cwd: rootDir,
    env: { ...launchEnv, ELECTRON_ENABLE_LOGGING: '1' },
    timeout: 60000
  });
  const appVersion = await electronApp.evaluate(({ app }) => app.getVersion());
  if (appVersion !== expectedVersion) {
    throw new Error(`App version mismatch: expected ${expectedVersion}, got ${appVersion}`);
  }

  await electronApp.evaluate(async ({ dialog }, filePath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] });
  }, projectPath);

  const page = await electronApp.firstWindow({ timeout: 60000 });
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  await page.waitForFunction(() => window.particleStudio?.isReady(), null, { timeout: 90000 });

  const startedAt = Date.now();
  const result = await page.evaluate(async () => {
    const opened = await window.electronAPI.openProject();
    if (!opened?.ok || !opened.document) {
      throw new Error(opened?.error || 'Project could not be opened.');
    }
    await window.particleStudio.applyProject(opened.document);
    window.particleStudio.setQualityMode('high', { persist: false });
    window.particleStudio.setExportResolution(1920, 1080, 30);

    const project = window.particleStudio.captureProject();
    const sceneModels = project.scene?.sceneModels?.models || [];
    const flowBefore = window.particleStudio.getFlowRuntimeState?.();
    await new Promise((resolve) => setTimeout(resolve, 280));
    const flowAfter = window.particleStudio.getFlowRuntimeState?.();
    const originalCamera = window.particleStudio.captureViewCamera();
    const originalPosition = originalCamera.position.slice(0, 3);
    const target = originalCamera.target.slice(0, 3);
    const distance = Math.hypot(
      originalPosition[0] - target[0],
      originalPosition[1] - target[1],
      originalPosition[2] - target[2]
    );
    const dollyPosition = (scale) => target.map((value, index) => (
      value + (originalPosition[index] - value) * scale
    ));
    const renderAtScale = (scale) => {
      window.particleStudio.setCameraSnapshot({
        ...originalCamera,
        position: dollyPosition(scale),
        target,
        dofEnabled: false
      });
      const frame = window.particleStudio.renderFrame(0, undefined, 0);
      return {
        frame,
        adaptive: window.particleStudio.getAdaptiveParticleStats?.() || []
      };
    };

    window.particleStudio.clearCameraKeyframes();
    window.particleStudio.setParameterKeyframes([]);
    window.particleStudio.setCameraSettings({ dofEnabled: false }, false);
    const renders = {
      far: renderAtScale(1.55),
      original: renderAtScale(1),
      near: renderAtScale(0.2)
    };
    const frames = Object.fromEntries(
      Object.entries(renders).map(([key, value]) => [key, value.frame])
    );
    const adaptive = Object.fromEntries(
      Object.entries(renders).map(([key, value]) => [key, value.adaptive])
    );

    const measure = (dataUrl) => new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.drawImage(image, 0, 0);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let minX = canvas.width;
        let minY = canvas.height;
        let maxX = -1;
        let maxY = -1;
        let foregroundPixels = 0;
        let brightPixels = 0;
        const tileSize = 16;
        const tileColumns = Math.ceil(canvas.width / tileSize);
        const tileRows = Math.ceil(canvas.height / tileSize);
        const tileForeground = new Uint16Array(tileColumns * tileRows);
        for (let y = 0; y < canvas.height; y += 1) {
          for (let x = 0; x < canvas.width; x += 1) {
            const offset = (y * canvas.width + x) * 4;
            const peak = Math.max(pixels[offset], pixels[offset + 1], pixels[offset + 2]);
            if (peak <= 10) continue;
            foregroundPixels += 1;
            if (peak >= 48) brightPixels += 1;
            const tileIndex = Math.floor(y / tileSize) * tileColumns + Math.floor(x / tileSize);
            tileForeground[tileIndex] += 1;
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
          }
        }
        const boxWidth = Math.max(0, maxX - minX + 1);
        const boxHeight = Math.max(0, maxY - minY + 1);
        const boxArea = boxWidth * boxHeight;
        let totalTiles = 0;
        let activeTiles = 0;
        let denseTiles = 0;
        let tileFillSum = 0;
        const minTileX = Math.max(0, Math.floor(minX / tileSize));
        const minTileY = Math.max(0, Math.floor(minY / tileSize));
        const maxTileX = Math.min(tileColumns - 1, Math.floor(maxX / tileSize));
        const maxTileY = Math.min(tileRows - 1, Math.floor(maxY / tileSize));
        for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
          for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
            totalTiles += 1;
            const count = tileForeground[tileY * tileColumns + tileX];
            if (count > 0) {
              activeTiles += 1;
              tileFillSum += count / (tileSize * tileSize);
            }
            if (count >= 4) {
              denseTiles += 1;
            }
          }
        }
        resolve({
          width: canvas.width,
          height: canvas.height,
          foregroundPixels,
          brightPixels,
          bounds: [minX, minY, maxX, maxY],
          boxArea,
          occupancy: boxArea ? foregroundPixels / boxArea : 0,
          brightOccupancy: boxArea ? brightPixels / boxArea : 0,
          activeTileCoverage: totalTiles ? activeTiles / totalTiles : 0,
          denseTileCoverage: totalTiles ? denseTiles / totalTiles : 0,
          averageActiveTileFill: activeTiles ? tileFillSum / activeTiles : 0
        });
      };
      image.onerror = reject;
      image.src = dataUrl;
    });

    const metrics = {
      far: await measure(frames.far),
      original: await measure(frames.original),
      near: await measure(frames.near)
    };
    return {
      project: {
        name: opened.name,
        modelCount: sceneModels.length,
        zeroSpeedModelCount: sceneModels.filter((model) => Number(model.options?.speed) === 0).length,
        particleCount: project.scene?.options?.particleCount,
        pointSize: project.scene?.options?.pointSize,
        effectMode: project.scene?.options?.effectMode,
        cameraDistance: distance
      },
      quality: window.particleStudio.getQualitySettings(),
      flow: {
        creatorFeedbackEnabled: flowAfter?.creatorFeedbackEnabled,
        before: flowBefore?.models?.map((model) => [model.id, model.phase]) || [],
        after: flowAfter?.models?.map((model) => [model.id, model.phase]) || []
      },
      metrics,
      adaptive,
      frames
    };
  }, { timeout: 600000 });

  await Promise.all([
    writeFile(outputPaths.far, decodeDataUrl(result.frames.far)),
    writeFile(outputPaths.original, decodeDataUrl(result.frames.original)),
    writeFile(outputPaths.near, decodeDataUrl(result.frames.near))
  ]);

  const occupancyRatio = result.metrics.near.occupancy / Math.max(result.metrics.far.occupancy, 0.000001);
  const brightOccupancyRatio = result.metrics.near.brightOccupancy /
    Math.max(result.metrics.far.brightOccupancy, 0.000001);
  const occupancies = Object.values(result.metrics).map((metric) => metric.occupancy);
  const brightOccupancies = Object.values(result.metrics).map((metric) => metric.brightOccupancy);
  const occupancySpread = Math.max(...occupancies) / Math.max(Math.min(...occupancies), 0.000001);
  const brightOccupancySpread = Math.max(...brightOccupancies) /
    Math.max(Math.min(...brightOccupancies), 0.000001);
  const adaptiveVisible = Object.fromEntries(
    Object.entries(result.adaptive).map(([key, stats]) => [
      key,
      Array.isArray(stats)
        ? stats.reduce((sum, item) => sum + (Number(item.visibleCount) || 0), 0)
        : 0
    ])
  );
  const adaptiveNearBoost = adaptiveVisible.near / Math.max(adaptiveVisible.far, 1);
  const summary = {
    packaged,
    executablePath,
    appVersion,
    ok: errors.length === 0 &&
      result.project.modelCount > 0 &&
      result.project.zeroSpeedModelCount === result.project.modelCount &&
      result.flow.creatorFeedbackEnabled === false &&
      JSON.stringify(result.flow.before) === JSON.stringify(result.flow.after) &&
      result.metrics.near.foregroundPixels > 100 &&
      result.metrics.near.activeTileCoverage >= result.metrics.far.activeTileCoverage * 0.62 &&
      result.metrics.near.denseTileCoverage >= result.metrics.far.denseTileCoverage * 0.55 &&
      occupancySpread <= 1.8 &&
      brightOccupancySpread <= 1.8 &&
      adaptiveNearBoost >= 1.35,
    loadMs: Date.now() - startedAt,
    project: result.project,
    quality: result.quality,
    flow: result.flow,
    occupancyRatio,
    brightOccupancyRatio,
    occupancySpread,
    brightOccupancySpread,
    adaptiveVisible,
    adaptiveNearBoost,
    metrics: result.metrics,
    adaptive: result.adaptive,
    screenshots: outputPaths,
    errors
  };
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) process.exitCode = 1;
} finally {
  await electronApp?.close().catch(() => {});
}
