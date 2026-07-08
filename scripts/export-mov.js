import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpegPath from 'ffmpeg-static';
import { chromium } from 'playwright';
import { injectSphericalMetadata } from '../electron/spatial-metadata.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const videoProxyDirs = [];
const args = parseArgs(process.argv.slice(2));
const config = await readConfig(readOption('config', null));
const exportFormat = normalizeExportFormat(readOption('format', config.format ?? 'mov'));
const fps = Number(readOption('fps', config.fps ?? 30));
const duration = Number(readOption('duration', config.duration ?? 5));
let width = Math.round(Number(readOption('width', config.width ?? 1920)));
let height = Math.round(Number(readOption('height', config.height ?? 1080)));
if (exportFormat !== 'mov') {
  width -= width % 2;
  height -= height % 2;
}
if (exportFormat === 'mp4-360') {
  height = Math.max(128, Math.round(width / 2));
}
const pixelRatio = clampNumber(readOption('pixelRatio', config.pixelRatio ?? 1), 0.5, 2, 1);
const startTime = Number(readOption('startTime', readOption('start-time', config.startTime ?? 0)));
const cameraStartTime = Number(readOption('cameraStartTime', readOption('camera-start-time', config.cameraStartTime ?? startTime)));
const effectStartTime = Number(readOption('effectStartTime', readOption('effect-start-time', config.effectStartTime ?? startTime)));
const port = Number(readOption('port', config.port ?? 5173));
const modelUrl = readOption('model', readOption('modelUrl', readOption('model-url', config.modelUrl ?? '')));
const morphTargetUrl = readOption(
  'morphTarget',
  readOption('morphTargetUrl', readOption('morph-target-url', config.morphTargetUrl ?? ''))
);
const worldUrl = readOption('world', readOption('worldUrl', readOption('world-url', config.worldUrl ?? '')));
const options = readJsonOption('options', config.options ?? null);
const sceneModels = await normalizeSceneModelsForBrowser(config.sceneModels ?? null);
const videoPlanes = await normalizeVideoPlanesForBrowser(config.videoPlanes ?? null);
const frameCount = Math.max(2, Math.round(fps * duration));
const outputExtension = exportFormat === 'mov' ? 'mov' : 'mp4';
const outputPath = path.resolve(rootDir, readOption('out', config.out ?? `exports/particle-dissolve.${outputExtension}`));
const keepFrames = readBoolean('keep-frames');
const baseUrl = `http://127.0.0.1:${port}/`;
const pageParams = new URLSearchParams({
  export: '1',
  transparent: exportFormat === 'mov' ? '1' : '0',
  duration: String(duration),
  pixelRatio: String(pixelRatio),
  t: String(Date.now())
});
if (modelUrl) {
  pageParams.set('model', modelUrl);
}
if (morphTargetUrl) {
  pageParams.set('morphTarget', morphTargetUrl);
}
if (worldUrl) {
  pageParams.set('world', worldUrl);
}
const pageUrl = `${baseUrl}?${pageParams.toString()}`;

if (!ffmpegPath) {
  throw new Error('ffmpeg-static did not provide an FFmpeg binary.');
}

if (readBoolean('dry-run')) {
  console.log(
    JSON.stringify(
      {
        fps,
        exportFormat,
        duration,
        width,
        height,
        pixelRatio,
        startTime,
        cameraStartTime,
        effectStartTime,
        port,
        frameCount,
        outputPath,
        keepFrames,
        modelUrl,
        morphTargetUrl,
        worldUrl,
        cameraCurve: config.cameraCurve || null,
        sceneModels: sceneModels
          ? { activeId: sceneModels.activeId, count: sceneModels.models.length }
          : null,
        videoPlanes: videoPlanes
          ? { activeId: videoPlanes.activeId, count: videoPlanes.items.length }
          : null,
        options
      },
      null,
      2
    )
  );
  process.exit(0);
}

await mkdir(path.dirname(outputPath), { recursive: true });

const server = await ensureServer(baseUrl, port);
const framesDir = await mkdtemp(path.join(tmpdir(), 'particle-mov-'));
const chromePath = findChrome();

if (!chromePath) {
  throw new Error('Could not find Google Chrome. Install Chrome or update scripts/export-mov.js with your browser path.');
}

let browser;

try {
  browser = await chromium.launch({
    headless: true,
    executablePath: chromePath
  });

  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: 1
  });

  await page.goto(pageUrl, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.particleStudio?.isReady(), null, { timeout: 60000 });
  await page.evaluate(
    ({ renderWidth, renderHeight, renderFps }) => window.particleStudio.setExportResolution(renderWidth, renderHeight, renderFps),
    { renderWidth: width, renderHeight: height, renderFps: fps }
  );

if (options) {
  await page.evaluate((renderOptions) => window.particleStudio.setOptions(renderOptions), options);
}

if (sceneModels?.models?.length) {
  await page.evaluate((models) => window.particleStudio.setSceneModels(models), sceneModels);
}

if (videoPlanes?.items?.length) {
  await page.evaluate((videos) => window.particleStudio.setVideoPlanes(videos), videoPlanes);
}

if (Array.isArray(config.lights)) {
  await page.evaluate((lights) => window.particleStudio.setLights(lights), config.lights);
}

if (config.world?.url || worldUrl) {
  const worldConfig = {
    ...(config.world || {}),
    url: config.world?.url || worldUrl
  };
  await page.evaluate((world) => window.particleStudio.setWorldEnvironment(world), worldConfig);
}

if (config.imageSplat?.url || config.imageSplat?.dataUrl) {
  await page.evaluate((imageSplat) => window.particleStudio.setImageSplatObject(imageSplat), config.imageSplat);
}

if (config.morphTarget?.url || config.morphTarget?.dataUrl || morphTargetUrl) {
  const morphTarget = {
    ...(config.morphTarget || {}),
    url: config.morphTarget?.url || morphTargetUrl
  };
  await page.evaluate((target) => window.particleStudio.setMorphTargetModel(target), morphTarget);
}

const hasCameraKeyframes = Array.isArray(config.cameraKeyframes) && config.cameraKeyframes.length > 0;

if (config.cameraCurve) {
  await page.evaluate(
    (cameraCurve) => window.particleStudio.setCameraCurve(cameraCurve.curve, cameraCurve.strength, { applyToSelected: false }),
    config.cameraCurve
  );
  if (config.cameraCurve.pathMode) {
    await page.evaluate((pathMode) => window.particleStudio.setCameraPathMode(pathMode), config.cameraCurve.pathMode);
  }
}

if (Array.isArray(config.cameraKeyframes)) {
  await page.evaluate((keyframes) => window.particleStudio.setCameraKeyframes(keyframes), config.cameraKeyframes);
}

if (Array.isArray(config.parameterKeyframes)) {
  await page.evaluate((keyframes) => window.particleStudio.setParameterKeyframes(keyframes), config.parameterKeyframes);
}

const cameraSnapshot = exportFormat === 'mp4-360'
  ? { ...(config.cameraSnapshot || {}), cameraType: 'panorama', dofEnabled: false, cameraDofEnabled: false }
  : config.cameraSnapshot;
if (cameraSnapshot) {
  await page.evaluate(
    ({ snapshot, pose }) => window.particleStudio.setCameraSnapshot(snapshot, { pose }),
    { snapshot: cameraSnapshot, pose: !hasCameraKeyframes }
  );
}

await page.evaluate(
  ({ effectTime: warmupEffectTime, cameraTime: warmupCameraTime }) =>
    window.particleStudio.prepareExportFrame(warmupEffectTime, warmupCameraTime),
  { effectTime: effectStartTime, cameraTime: cameraStartTime }
);

for (let frame = 0; frame < frameCount; frame += 1) {
    const frameOffset = frame / fps;
    const effectTime = effectStartTime + frameOffset;
    const cameraTime = cameraStartTime + frameOffset;
    const dataUrl = await page.evaluate(
      ({ effectTime: frameEffectTime, cameraTime: frameCameraTime }) =>
        window.particleStudio.renderFrameAsync(frameEffectTime, undefined, frameCameraTime),
      { effectTime, cameraTime }
    );
    const png = dataUrl.replace(/^data:image\/png;base64,/, '');
    const framePath = path.join(framesDir, `frame_${String(frame).padStart(5, '0')}.png`);
    await writeFile(framePath, png, 'base64');
    process.stdout.write(`\rRendered ${frame + 1}/${frameCount} frames`);
  }

  if (exportFormat === 'mov') {
    process.stdout.write('\nEncoding transparent MOV...\n');
    await encodeMov(framesDir, outputPath, fps);
  } else if (exportFormat === 'mp4-360') {
    process.stdout.write('\nEncoding 360 MP4 and injecting spherical metadata...\n');
    const encodedPath = path.join(framesDir, 'encoded-panorama.mp4');
    await encodeMp4(framesDir, encodedPath, fps);
    await injectSphericalMetadata(encodedPath, outputPath);
  } else {
    process.stdout.write('\nEncoding MP4...\n');
    await encodeMp4(framesDir, outputPath, fps);
  }
  process.stdout.write(`Done: ${outputPath}\n`);
} finally {
  if (browser) {
    await browser.close();
  }

  if (!keepFrames) {
    await rm(framesDir, { recursive: true, force: true });
  } else {
    process.stdout.write(`Frames kept at: ${framesDir}\n`);
  }

if (server) {
    server.kill();
  }
  await Promise.all(videoProxyDirs.map((dir) => rm(dir, { recursive: true, force: true }).catch(() => {})));
}

async function normalizeSceneModelsForBrowser(sceneModels) {
  const models = Array.isArray(sceneModels?.models) ? sceneModels.models : [];
  if (!models.length) {
    return null;
  }

  const normalized = [];
  for (const model of models) {
    if (!model?.extension) {
      continue;
    }

    if (model.dataUrl || model.url) {
      normalized.push(model);
      continue;
    }

    if (!model.path) {
      continue;
    }

    const filePath = path.resolve(rootDir, String(model.path));
    const buffer = await readFile(filePath);
    normalized.push({
      ...model,
      path: undefined,
      dataUrl: `data:${mimeForModelExtension(model.extension)};base64,${buffer.toString('base64')}`,
      size: model.size || buffer.byteLength
    });
  }

  return normalized.length
    ? {
        activeId: sceneModels.activeId,
        models: normalized
      }
    : null;
}

async function normalizeVideoPlanesForBrowser(videoPlanes) {
  const items = Array.isArray(videoPlanes?.items) ? videoPlanes.items : [];
  if (!items.length) {
    return null;
  }

  const normalized = [];
  for (const item of items) {
    const extension = String(item.extension || '').toLowerCase();
    if (extension === 'mov' && (item.path || item.dataUrl)) {
      const proxy = await createMovBrowserProxy(item);
      normalized.push({
        ...item,
        path: undefined,
        url: undefined,
        dataUrl: proxy.dataUrl,
        playbackExtension: 'webm',
        sourceExtension: 'mov',
        size: proxy.size
      });
      continue;
    }

    if (item.dataUrl || item.url) {
      normalized.push(item);
      continue;
    }

    if (!item.path) {
      continue;
    }

    const filePath = path.resolve(rootDir, String(item.path));
    const buffer = await readFile(filePath);
    normalized.push({
      ...item,
      path: undefined,
      dataUrl: `data:${mimeForVideoExtension(item.extension)};base64,${buffer.toString('base64')}`,
      size: item.size || buffer.byteLength
    });
  }

  return normalized.length
    ? {
        activeId: videoPlanes.activeId,
        items: normalized
      }
    : null;
}

async function createMovBrowserProxy(item) {
  const runtimeDir = await mkdtemp(path.join(tmpdir(), 'particle-cli-video-'));
  videoProxyDirs.push(runtimeDir);
  let inputPath = item.path ? path.resolve(rootDir, String(item.path)) : '';
  if (!inputPath) {
    inputPath = path.join(runtimeDir, 'source.mov');
    await writeFile(inputPath, parseDataUrl(item.dataUrl).buffer);
  }
  const outputPath = path.join(runtimeDir, `${sanitizeExportName(item.name || 'video')}-proxy.webm`);
  await transcodeVideoToWebm(inputPath, outputPath);
  const buffer = await readFile(outputPath);
  return {
    dataUrl: `data:video/webm;base64,${buffer.toString('base64')}`,
    size: buffer.byteLength
  };
}

function parseDataUrl(dataUrl) {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(String(dataUrl || ''));
  if (!match) {
    throw new Error('Invalid video dataUrl.');
  }
  return {
    mime: match[1] || 'application/octet-stream',
    buffer: match[2]
      ? Buffer.from(match[3] || '', 'base64')
      : Buffer.from(decodeURIComponent(match[3] || ''), 'utf8')
  };
}

function sanitizeExportName(value) {
  return String(value)
    .trim()
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9\u4e00-\u9fa5._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'video';
}

function mimeForModelExtension(extension = '') {
  return extension.toLowerCase() === 'glb'
    ? 'model/gltf-binary'
    : 'application/octet-stream';
}

function mimeForVideoExtension(extension = '') {
  const normalized = extension.toLowerCase();
  if (normalized === 'webm') {
    return 'video/webm';
  }
  if (normalized === 'mov') {
    return 'video/quicktime';
  }
  return 'video/mp4';
}

function parseArgs(rawArgs) {
  const parsed = {};

  for (let index = 0; index < rawArgs.length; index += 1) {
    const item = rawArgs[index];
    if (item === '--') {
      continue;
    }

    if (!item.startsWith('--')) {
      continue;
    }

    const [key, inlineValue] = item.slice(2).split('=');
    if (inlineValue !== undefined) {
      parsed[key] = inlineValue;
      continue;
    }

    const next = rawArgs[index + 1];
    if (next && !next.startsWith('--')) {
      parsed[key] = next;
      index += 1;
    } else {
      parsed[key] = true;
    }
  }

  return parsed;
}

function readOption(name, fallback) {
  const envName = `npm_config_${name.replaceAll('-', '_')}`;
  return args[name] ?? process.env[envName] ?? fallback;
}

function readBoolean(name) {
  const value = readOption(name, false);
  return value === true || value === 'true' || value === '1';
}

function readJsonOption(name, fallback) {
  const value = readOption(name, null);
  if (value === null || value === undefined || value === false) {
    return fallback;
  }

  if (typeof value !== 'string') {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`Invalid JSON for --${name}: ${error.message}`);
  }
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, number));
}

async function readConfig(configPath) {
  if (!configPath) {
    return {};
  }

  const absolutePath = path.resolve(rootDir, configPath);
  return JSON.parse((await readFile(absolutePath, 'utf8')).replace(/^\uFEFF/, ''));
}

async function ensureServer(url, port) {
  if (await canFetch(url)) {
    return null;
  }

  const viteCli = path.join(rootDir, 'node_modules', 'vite', 'bin', 'vite.js');
  const child = spawn(process.execPath, [viteCli, '--host', '127.0.0.1', '--port', String(port)], {
    cwd: rootDir,
    stdio: 'ignore',
    windowsHide: true
  });

  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await canFetch(url)) {
      return child;
    }
    await delay(250);
  }

  child.kill();
  throw new Error(`Vite server did not start at ${url}`);
}

async function canFetch(url) {
  try {
    const response = await fetch(url);
    return response.ok;
  } catch {
    return false;
  }
}

async function encodeMov(framesDir, output, frameRate) {
  const inputPattern = path.join(framesDir, 'frame_%05d.png');
  const proresArgs = [
    '-y',
    '-framerate',
    String(frameRate),
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
    output
  ];

  try {
    await runFfmpeg(proresArgs);
  } catch (error) {
    process.stdout.write('ProRes 4444 failed, falling back to qtrle.\n');
    const qtrleArgs = [
      '-y',
      '-framerate',
      String(frameRate),
      '-i',
      inputPattern,
      '-vf',
      'format=rgba',
      '-c:v',
      'qtrle',
      '-pix_fmt',
      'argb',
      output
    ];
    await runFfmpeg(qtrleArgs);
  }
}

async function encodeMp4(framesDir, output, frameRate) {
  const inputPattern = path.join(framesDir, 'frame_%05d.png');
  await runFfmpeg([
    '-y',
    '-framerate',
    String(frameRate),
    '-i',
    inputPattern,
    '-c:v',
    'libx264',
    '-profile:v',
    'main',
    '-preset',
    'medium',
    '-crf',
    '18',
    '-pix_fmt',
    'yuv420p',
    '-r',
    String(frameRate),
    output
  ]);
}

async function transcodeVideoToWebm(inputPath, outputPath) {
  await runFfmpeg([
    '-y',
    '-hide_banner',
    '-i',
    inputPath,
    '-map',
    '0:v:0',
    '-an',
    '-vf',
    'format=rgba',
    '-c:v',
    'libvpx-vp9',
    '-pix_fmt',
    'yuva420p',
    '-auto-alt-ref',
    '0',
    '-deadline',
    'realtime',
    '-cpu-used',
    '8',
    '-row-mt',
    '1',
    '-threads',
    '0',
    '-tile-columns',
    '2',
    '-frame-parallel',
    '1',
    '-lag-in-frames',
    '0',
    '-b:v',
    '0',
    '-crf',
    '32',
    outputPath
  ]);
}

function normalizeExportFormat(value) {
  return value === 'mp4-360' ? 'mp4-360' : value === 'mp4' ? 'mp4' : 'mov';
}

async function runFfmpeg(ffmpegArgs) {
  const child = spawn(ffmpegPath, ffmpegArgs, {
    cwd: rootDir,
    stdio: ['ignore', 'inherit', 'inherit'],
    windowsHide: true
  });

  const [code] = await once(child, 'exit');
  if (code !== 0) {
    throw new Error(`FFmpeg exited with code ${code}`);
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
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft/Edge/Application/msedge.exe'),
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
  ].filter(Boolean);

  return candidates.find((candidate) => existsSync(candidate));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
