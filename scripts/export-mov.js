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

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = parseArgs(process.argv.slice(2));
const config = await readConfig(readOption('config', null));
const fps = Number(readOption('fps', config.fps ?? 30));
const duration = Number(readOption('duration', config.duration ?? 5));
const width = Number(readOption('width', config.width ?? 1920));
const height = Number(readOption('height', config.height ?? 1080));
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
const frameCount = Math.max(2, Math.round(fps * duration));
const outputPath = path.resolve(rootDir, readOption('out', config.out ?? 'exports/particle-dissolve.mov'));
const keepFrames = readBoolean('keep-frames');
const baseUrl = `http://127.0.0.1:${port}/`;
const pageParams = new URLSearchParams({
  export: '1',
  transparent: '1',
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

if (options) {
  await page.evaluate((renderOptions) => window.particleStudio.setOptions(renderOptions), options);
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
}

if (Array.isArray(config.cameraKeyframes)) {
  await page.evaluate((keyframes) => window.particleStudio.setCameraKeyframes(keyframes), config.cameraKeyframes);
}

if (config.cameraSnapshot) {
  await page.evaluate(
    ({ snapshot, pose }) => window.particleStudio.setCameraSnapshot(snapshot, { pose }),
    { snapshot: config.cameraSnapshot, pose: !hasCameraKeyframes }
  );
}

for (let frame = 0; frame < frameCount; frame += 1) {
    const frameOffset = frame / fps;
    const effectTime = effectStartTime + frameOffset;
    const cameraTime = cameraStartTime + frameOffset;
    const dataUrl = await page.evaluate(
      ({ effectTime: frameEffectTime, cameraTime: frameCameraTime }) =>
        window.particleStudio.renderFrame(frameEffectTime, undefined, frameCameraTime),
      { effectTime, cameraTime }
    );
    const png = dataUrl.replace(/^data:image\/png;base64,/, '');
    const framePath = path.join(framesDir, `frame_${String(frame).padStart(5, '0')}.png`);
    await writeFile(framePath, png, 'base64');
    process.stdout.write(`\rRendered ${frame + 1}/${frameCount} frames`);
  }

  process.stdout.write('\nEncoding transparent MOV...\n');
  await encodeMov(framesDir, outputPath, fps);
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
