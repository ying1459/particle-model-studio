import { app, BrowserWindow, ipcMain, net, protocol, shell } from 'electron';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ffmpegStaticPath from 'ffmpeg-static';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, '..');
const distDir = path.join(appRoot, 'dist');
const preloadPath = path.join(__dirname, 'preload.cjs');
let exportModelDir = '';

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'particle',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true
    }
  }
]);

app.whenReady().then(async () => {
  registerAppProtocol();
  registerIpc();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

function createMainWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1000,
    minHeight: 720,
    title: 'Particle Model Studio',
    backgroundColor: '#090a0c',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });

  window.loadURL('particle://app/index.html');
}

function registerAppProtocol() {
  protocol.handle('particle', async (request) => {
    const url = new URL(request.url);
    const pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    let filePath;

    if (pathname.startsWith('/__export-model/')) {
      filePath = path.join(exportModelDir, path.basename(pathname));
    } else {
      filePath = path.join(distDir, pathname);
    }

    if (!isInside(pathname.startsWith('/__export-model/') ? exportModelDir : distDir, filePath)) {
      return new Response('Forbidden', { status: 403 });
    }

    if (!existsSync(filePath)) {
      return new Response('Not found', { status: 404 });
    }

    return net.fetch(pathToFileURL(filePath).toString());
  });
}

function registerIpc() {
  ipcMain.handle('export-mov', async (_event, payload) => {
    return exportMov(payload || {});
  });

  ipcMain.handle('show-item-in-folder', async (_event, filePath) => {
    if (filePath && existsSync(filePath)) {
      shell.showItemInFolder(filePath);
    }
  });
}

async function exportMov(payload) {
  const duration = clampNumber(payload.duration, 0.25, 120, 5);
  const fps = clampNumber(payload.fps, 1, 60, 30);
  const width = clampNumber(payload.width, 128, 7680, 1920);
  const height = clampNumber(payload.height, 128, 4320, 1080);
  const pixelRatio = clampNumber(payload.pixelRatio, 0.5, 2, 1);
  const startTime = clampNumber(payload.startTime, 0, 120, 0);
  const cameraStartTime = clampNumber(payload.cameraStartTime, 0, 120, startTime);
  const effectStartTime = clampNumber(payload.effectStartTime, 0, 86400, startTime);
  const frameCount = Math.max(2, Math.round(duration * fps));
  const outputDir = path.join(app.getPath('videos'), 'Particle Model Studio');
  const outputName = `${sanitizeFilename(payload.name || `particle-camera-${timestampName()}`)}.mov`;
  const outputPath = path.join(outputDir, outputName);
  const framesDir = await mkdtemp(path.join(tmpdir(), 'particle-desktop-mov-'));
  exportModelDir = await mkdtemp(path.join(tmpdir(), 'particle-desktop-model-'));
  let modelUrl = '';
  let morphTargetUrl = '';
  let worldUrl = '';
  let imageSplatUrl = '';
  let hiddenWindow;

  try {
    await mkdir(outputDir, { recursive: true });

    if (payload.model?.path && payload.model?.extension) {
      const extension = sanitizeExtension(payload.model.extension);
      const modelName = `current-model.${extension}`;
      const modelPath = path.join(exportModelDir, modelName);
      await copyFile(String(payload.model.path), modelPath);
      modelUrl = `/__export-model/${modelName}`;
    } else if (payload.model?.dataUrl && payload.model?.extension) {
      const extension = sanitizeExtension(payload.model.extension);
      const modelName = `current-model.${extension}`;
      const modelPath = path.join(exportModelDir, modelName);
      const base64 = String(payload.model.dataUrl).replace(/^data:[^;]+;base64,/, '');
      await writeFile(modelPath, Buffer.from(base64, 'base64'));
      modelUrl = `/__export-model/${modelName}`;
    } else if ((payload.options?.effectMode || 'particles') !== 'image') {
      throw new Error('当前模型没有可用于导出的文件数据，请重新导入模型后再导出。');
    }

    if (payload.morphTarget?.path && payload.morphTarget?.extension) {
      const extension = sanitizeExtension(payload.morphTarget.extension);
      const targetName = `morph-target.${extension}`;
      const targetPath = path.join(exportModelDir, targetName);
      await copyFile(String(payload.morphTarget.path), targetPath);
      morphTargetUrl = `/__export-model/${targetName}`;
    } else if (payload.morphTarget?.dataUrl && payload.morphTarget?.extension) {
      const extension = sanitizeExtension(payload.morphTarget.extension);
      const targetName = `morph-target.${extension}`;
      const targetPath = path.join(exportModelDir, targetName);
      const base64 = String(payload.morphTarget.dataUrl).replace(/^data:[^;]+;base64,/, '');
      await writeFile(targetPath, Buffer.from(base64, 'base64'));
      morphTargetUrl = `/__export-model/${targetName}`;
    }

    if (payload.world?.dataUrl && payload.world?.extension) {
      const extension = sanitizeWorldExtension(payload.world.extension);
      const worldName = `current-world.${extension}`;
      const worldPath = path.join(exportModelDir, worldName);
      const base64 = String(payload.world.dataUrl).replace(/^data:[^;]+;base64,/, '');
      await writeFile(worldPath, Buffer.from(base64, 'base64'));
      worldUrl = `/__export-model/${worldName}`;
    }

    if (payload.imageSplat?.dataUrl && payload.imageSplat?.extension) {
      const extension = sanitizeImageExtension(payload.imageSplat.extension);
      const imageSplatName = `current-image-splat.${extension}`;
      const imageSplatPath = path.join(exportModelDir, imageSplatName);
      const base64 = String(payload.imageSplat.dataUrl).replace(/^data:[^;]+;base64,/, '');
      await writeFile(imageSplatPath, Buffer.from(base64, 'base64'));
      imageSplatUrl = `/__export-model/${imageSplatName}`;
    }

    hiddenWindow = new BrowserWindow({
      show: false,
      width,
      height,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
        offscreen: false
      }
    });

    const params = new URLSearchParams({
      export: '1',
      transparent: '1',
      duration: String(duration),
      pixelRatio: String(pixelRatio),
      t: String(Date.now())
    });
    if (modelUrl) {
      params.set('model', modelUrl);
    }
    if (morphTargetUrl) {
      params.set('morphTarget', morphTargetUrl);
    }
    if (worldUrl) {
      params.set('world', worldUrl);
    }

    await hiddenWindow.loadURL(`particle://app/index.html?${params.toString()}`);
    await waitForRendererReady(hiddenWindow);

    if (payload.options) {
      await hiddenWindow.webContents.executeJavaScript(
        `window.particleStudio.setOptions(${JSON.stringify(payload.options)})`
      );
    }

    if (Array.isArray(payload.lights)) {
      await hiddenWindow.webContents.executeJavaScript(
        `window.particleStudio.setLights(${JSON.stringify(payload.lights)})`
      );
    }

    if (worldUrl) {
      await hiddenWindow.webContents.executeJavaScript(
        `window.particleStudio.setWorldEnvironment(${JSON.stringify({
          ...(payload.world || {}),
          dataUrl: undefined,
          url: worldUrl
        })})`
      );
    }

    if (imageSplatUrl) {
      await hiddenWindow.webContents.executeJavaScript(
        `window.particleStudio.setImageSplatObject(${JSON.stringify({
          ...(payload.imageSplat || {}),
          dataUrl: undefined,
          url: imageSplatUrl
        })})`
      );
    }

    if (morphTargetUrl) {
      await hiddenWindow.webContents.executeJavaScript(
        `window.particleStudio.setMorphTargetModel(${JSON.stringify({
          ...(payload.morphTarget || {}),
          dataUrl: undefined,
          url: morphTargetUrl
        })})`
      );
    }

    const hasCameraKeyframes = Array.isArray(payload.cameraKeyframes) && payload.cameraKeyframes.length > 0;

    if (payload.cameraCurve) {
      await hiddenWindow.webContents.executeJavaScript(
        `window.particleStudio.setCameraCurve(${JSON.stringify(payload.cameraCurve.curve)}, ${JSON.stringify(payload.cameraCurve.strength)}, ${JSON.stringify({
          applyToSelected: false
        })})`
      );
    }

    if (Array.isArray(payload.cameraKeyframes)) {
      await hiddenWindow.webContents.executeJavaScript(
        `window.particleStudio.setCameraKeyframes(${JSON.stringify(payload.cameraKeyframes)})`
      );
    }

    if (payload.cameraSnapshot) {
      await hiddenWindow.webContents.executeJavaScript(
        `window.particleStudio.setCameraSnapshot(${JSON.stringify(payload.cameraSnapshot)}, ${JSON.stringify({
          pose: !hasCameraKeyframes
        })})`
      );
    }

    for (let frame = 0; frame < frameCount; frame += 1) {
      const frameOffset = frame / fps;
      const effectTime = effectStartTime + frameOffset;
      const cameraTime = cameraStartTime + frameOffset;
      const dataUrl = await hiddenWindow.webContents.executeJavaScript(
        `window.particleStudio.renderFrame(${JSON.stringify(effectTime)}, undefined, ${JSON.stringify(cameraTime)})`
      );
      const png = String(dataUrl).replace(/^data:image\/png;base64,/, '');
      await writeFile(path.join(framesDir, `frame_${String(frame).padStart(5, '0')}.png`), png, 'base64');
    }

    await encodeMov(framesDir, outputPath, fps);
    return {
      ok: true,
      path: outputPath,
      relativePath: outputPath
    };
  } finally {
    if (hiddenWindow && !hiddenWindow.isDestroyed()) {
      hiddenWindow.destroy();
    }

    await rm(framesDir, { recursive: true, force: true });
    await rm(exportModelDir, { recursive: true, force: true });
    exportModelDir = '';
  }
}

async function waitForRendererReady(window) {
  await window.webContents.executeJavaScript(`
    new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const tick = () => {
        if (window.particleStudio?.isReady?.()) {
          resolve(true);
          return;
        }
        if (Date.now() - startedAt > 60000) {
          reject(new Error('Renderer did not become ready for export.'));
          return;
        }
        setTimeout(tick, 100);
      };
      tick();
    })
  `);
}

async function encodeMov(framesDir, outputPath, fps) {
  const inputPattern = path.join(framesDir, 'frame_%05d.png');
  const ffmpegPath = getFfmpegPath();
  const args = [
    '-y',
    '-framerate',
    String(fps),
    '-i',
    inputPattern,
    '-vf',
    'format=rgba',
    '-c:v',
    'prores_ks',
    '-profile:v',
    '4',
    '-pix_fmt',
    'yuva444p10le',
    '-vendor',
    'apl0',
    '-alpha_bits',
    '16',
    outputPath
  ];

  const child = spawn(ffmpegPath, args, {
    cwd: app.isPackaged ? path.dirname(ffmpegPath) : appRoot,
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  const [code] = await once(child, 'exit');

  if (code !== 0) {
    throw new Error(stderr || `FFmpeg exited with code ${code}`);
  }
}

function getFfmpegPath() {
  if (!ffmpegStaticPath) {
    throw new Error('FFmpeg binary was not found.');
  }

  if (app.isPackaged) {
    return ffmpegStaticPath.replace('app.asar', 'app.asar.unpacked');
  }

  return ffmpegStaticPath;
}

function isInside(root, target) {
  if (!root) {
    return false;
  }

  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, number));
}

function sanitizeFilename(value) {
  return String(value)
    .trim()
    .replace(/[^a-zA-Z0-9\u4e00-\u9fa5._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'particle-camera';
}

function sanitizeExtension(value) {
  const extension = String(value).toLowerCase().replace(/[^a-z0-9]/g, '');
  return ['glb', 'gltf', 'obj', 'stl', 'fbx'].includes(extension) ? extension : 'glb';
}

function sanitizeWorldExtension(value) {
  const extension = String(value).toLowerCase().replace(/[^a-z0-9]/g, '');
  return ['hdr', 'exr'].includes(extension) ? extension : 'hdr';
}

function sanitizeImageExtension(value) {
  const extension = String(value).toLowerCase().replace(/[^a-z0-9]/g, '');
  return ['jpg', 'jpeg', 'png', 'webp', 'hdr', 'exr', 'ply', 'splat', 'ksplat', 'spz'].includes(extension) ? extension : 'png';
}

function timestampName() {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
}
