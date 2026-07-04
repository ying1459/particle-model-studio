import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpegPath from 'ffmpeg-static';
import { _electron as electron } from 'playwright';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packaged = process.argv.includes('--packaged');
const executablePath = packaged
  ? path.join(rootDir, 'release', 'win-unpacked', 'Particle Model Studio.exe')
  : path.join(rootDir, 'node_modules', 'electron', 'dist', 'electron.exe');
const errors = [];
let electronApp;

try {
  electronApp = await electron.launch({
    executablePath,
    args: packaged ? [] : ['.'],
    cwd: rootDir,
    env: {
      ...process.env,
      ELECTRON_ENABLE_LOGGING: '1'
    },
    timeout: 60000
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
  const result = await page.evaluate(async () => {
    const hasElectronBridge = Boolean(window.electronAPI?.exportMov);
    const initialCamera = window.particleStudio.getCameraSettings();

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
    Math.abs(result.cameraSize?.cameraDisplaySize - 2.5) > 0.01 ||
    Math.abs(result.cameraSize?.cameraMarkerScale?.[0] - 2.5) > 0.01 ||
    result.cameraSize?.keyframeMode !== 'scale'
  ) {
    throw new Error(`Camera display size control failed: ${JSON.stringify(result.cameraSize)}`);
  }
  if (Math.abs(result.undoDissolve - 0.2) > 0.01) {
    throw new Error(`Undo failed: ${JSON.stringify(result)}`);
  }

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

  console.log(JSON.stringify({ ok: true, packaged, executablePath, result, errors }, null, 2));
} finally {
  await electronApp?.close().catch(() => {});
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
