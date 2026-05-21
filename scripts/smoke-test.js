import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, statSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

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

  await page.evaluate(async () => {
    await window.particleStudio.setOptions(
      {
        effectMode: 'particles',
        particleCount: 100,
        pointSize: 3,
        sampleCleanup: 0,
        dissolve: 0,
        growth: 1,
        glowRadius: 0,
        glowExposure: 1
      },
      true
    );
  });
  await page.waitForFunction(() => document.querySelector('#stats')?.textContent?.includes('100'), null, {
    timeout: 30000
  });
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

  const asset = await page.evaluate(() => window.particleStudio.getCurrentAsset());
  if (!asset?.model?.size) {
    throw new Error(`Expected a loaded model payload, got ${JSON.stringify(asset)}`);
  }

  const stats = await page.locator('#stats').innerText();
  await writeDataUrl(path.join(outDir, 'preview.png'), await page.evaluate(() => window.particleStudio.capturePng()));
  await writeDataUrl(
    path.join(outDir, 'camera-preview.png'),
    await page.evaluate(() => window.particleStudio.captureCameraPreview())
  );

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

  const cameraSnapshot = await page.evaluate(() => window.particleStudio.captureViewCamera());
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
        cameraStartTime: cameraSnapshot.time || 0,
        effectStartTime: 0,
        out: exportRelative,
        modelUrl,
        cameraCurve: {
          curve: 'linear',
          strength: 1
        },
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
  assertFileLooksReal(path.join(frameDirMatch[1].trim(), 'frame_00000.png'), 800);

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
        mov: movPath
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
