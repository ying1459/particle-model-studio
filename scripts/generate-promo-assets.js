import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpegPath from 'ffmpeg-static';
import { _electron as electron } from 'playwright';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const docsImageDir = path.join(rootDir, 'docs', 'images');
const verificationDir = path.join(rootDir, 'verification', 'promo-1.0.21');
const frameRoot = path.join(verificationDir, 'frames');
const segmentDir = path.join(verificationDir, 'segments');
const releaseDir = path.join(rootDir, 'release');
const promoVideoPath = path.join(releaseDir, 'Particle-Model-Studio-1.0.21-Promo-1080p.mp4');
const executablePath = path.join(rootDir, 'node_modules', 'electron', 'dist', 'electron.exe');
const fontPath = 'C\\:/Windows/Fonts/segoeuib.ttf';
const fps = 24;
const clipSeconds = 3;
const clipFrames = fps * clipSeconds;
const styleDefinitions = [
  { id: 'fluid-ribbon', label: 'FLUID RIBBON', detail: 'Continuous bundled flow' },
  { id: 'weathered-dust', label: 'WEATHERED DUST', detail: 'Soft erosion and controlled mist' },
  { id: 'energy-burst', label: 'ENERGY BURST', detail: 'Directional impact and bright fragments' }
];

function assertWorkspacePath(target, parent) {
  const normalizedTarget = path.resolve(target).toLowerCase();
  const normalizedParent = `${path.resolve(parent).toLowerCase()}${path.sep}`;
  assert.ok(normalizedTarget.startsWith(normalizedParent), `${target} escaped ${parent}`);
}

function runFfmpeg(args) {
  const result = spawnSync(ffmpegPath, ['-hide_banner', '-loglevel', 'warning', '-y', ...args], {
    cwd: rootDir,
    stdio: 'inherit',
    windowsHide: true
  });
  if (result.status !== 0) {
    throw new Error(`ffmpeg failed with exit code ${result.status}`);
  }
}

function videoFilter({ title = '', detail = '', duration = clipSeconds, darken = false } = {}) {
  const filters = [
    'scale=1920:1080:force_original_aspect_ratio=increase:flags=lanczos',
    'crop=1920:1080',
    'format=yuv420p'
  ];
  if (darken) {
    filters.push('drawbox=x=0:y=0:w=iw:h=ih:color=black@0.28:t=fill');
  }
  if (title) {
    filters.push('drawbox=x=66:y=66:w=680:h=118:color=black@0.52:t=fill');
    filters.push(`drawtext=fontfile='${fontPath}':text='${title}':x=94:y=84:fontsize=43:fontcolor=white`);
  }
  if (detail) {
    filters.push(`drawtext=fontfile='${fontPath}':text='${detail}':x=96:y=140:fontsize=21:fontcolor=0x9DEDE8`);
  }
  filters.push('fade=t=in:st=0:d=0.25');
  filters.push(`fade=t=out:st=${Math.max(0, duration - 0.35).toFixed(2)}:d=0.35`);
  return filters.join(',');
}

function encodeStill(input, output, duration, title = '', detail = '', darken = false) {
  runFfmpeg([
    '-loop', '1',
    '-framerate', String(fps),
    '-i', input,
    '-t', String(duration),
    '-vf', videoFilter({ title, detail, duration, darken }),
    '-r', String(fps),
    '-an',
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '18',
    '-pix_fmt', 'yuv420p',
    output
  ]);
}

function encodeStyleClip(style, inputPattern, output) {
  runFfmpeg([
    '-framerate', String(fps),
    '-i', inputPattern,
    '-vf', videoFilter({ title: style.label, detail: style.detail, duration: clipSeconds }),
    '-r', String(fps),
    '-an',
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '18',
    '-pix_fmt', 'yuv420p',
    output
  ]);
}

function dataUrlBuffer(dataUrl) {
  const marker = ';base64,';
  const index = dataUrl.indexOf(marker);
  assert.ok(index >= 0, 'Expected a base64 image data URL');
  return Buffer.from(dataUrl.slice(index + marker.length), 'base64');
}

async function prepareDirectories() {
  assertWorkspacePath(verificationDir, path.join(rootDir, 'verification'));
  await rm(verificationDir, { recursive: true, force: true });
  await Promise.all([
    mkdir(docsImageDir, { recursive: true }),
    mkdir(frameRoot, { recursive: true }),
    mkdir(segmentDir, { recursive: true }),
    mkdir(releaseDir, { recursive: true })
  ]);
}

async function renderAssets() {
  const launchEnv = { ...process.env };
  delete launchEnv.ELECTRON_RUN_AS_NODE;
  let electronApp;
  const errors = [];
  try {
    electronApp = await electron.launch({
      executablePath,
      args: ['.'],
      cwd: rootDir,
      env: { ...launchEnv, ELECTRON_ENABLE_LOGGING: '1' },
      timeout: 60000
    });
    const page = await electronApp.firstWindow({ timeout: 60000 });
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') {
        errors.push(`console: ${message.text()}`);
      }
    });
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.waitForFunction(() => window.particleStudio?.isReady(), null, { timeout: 90000 });
    await page.addStyleTag({ content: '* { cursor: none !important; }' });
    await page.evaluate(async () => {
      window.particleStudio.setQualityMode('high', { persist: false });
      window.particleStudio.setCameraPreviewVisible(true, false);
      window.particleStudio.setCameraViewLocked(true);
      window.particleStudio.setCameraSettings({ dofEnabled: false }, false);
      window.particleStudio.setCameraSnapshot({
        position: [0, 0.45, 4.25],
        target: [0, 0.35, 0]
      }, { pose: true });
      await window.particleStudio.setOptions({
        particleCount: 160000,
        particleizeProgress: 1,
        pointSize: 0.95,
        edgeFeather: 0.68,
        sizeRandom: 0.22,
        glowRadius: 78,
        glowExposure: 0.64,
        flowStyle: 'fluid-ribbon',
        flowCharacter: 0.24,
        flowDirectionPreset: 'right',
        spread: 0.58,
        dissolve: 0.52,
        speed: 0
      }, true);
    });
    await page.click('[data-property-tab="dissolve"]');
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(docsImageDir, 'studio-1.0.21.png') });

    await page.click('[data-workspace-mode="graph"]');
    await page.waitForTimeout(250);
    await page.locator('.operator-node[data-node-id="flow-dissolve"]').click();
    await page.waitForTimeout(180);
    await page.screenshot({ path: path.join(docsImageDir, 'operator-graph-1.0.21.png') });
    await page.click('[data-workspace-mode="layout"]');

    await page.evaluate(() => window.particleStudio.setExportResolution(1280, 720, 24));
    for (const style of styleDefinitions) {
      const styleDir = path.join(frameRoot, style.id);
      await mkdir(styleDir, { recursive: true });
      await page.evaluate(async (styleId) => {
        const select = document.querySelector('#flowStyle');
        select.value = styleId;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        await window.particleStudio.setOptions({
          particleCount: 160000,
          particleizeProgress: 1,
          pointSize: 0.95,
          glowRadius: styleId === 'energy-burst' ? 92 : 78,
          glowExposure: styleId === 'energy-burst' ? 0.78 : 0.62,
          flowDirectionPreset: styleId === 'weathered-dust' ? 'up' : 'right',
          spread: styleId === 'energy-burst' ? 0.78 : 0.56,
          speed: 0.56
        }, true);
      }, style.id);
      console.log(`Rendering ${style.id}...`);
      for (let frame = 0; frame < clipFrames; frame += 1) {
        const normalized = frame / Math.max(1, clipFrames - 1);
        const eased = normalized * normalized * (3 - 2 * normalized);
        const dissolve = 0.1 + eased * 0.72;
        const time = frame / fps;
        const dataUrl = await page.evaluate(
          ({ timeSeconds, dissolveAmount }) => window.particleStudio.renderFrame(
            timeSeconds,
            dissolveAmount,
            timeSeconds
          ),
          { timeSeconds: time, dissolveAmount: dissolve }
        );
        const frameName = `frame-${String(frame).padStart(3, '0')}.png`;
        await writeFile(path.join(styleDir, frameName), dataUrlBuffer(dataUrl));
        if ((frame + 1) % 12 === 0) {
          console.log(`  ${style.id}: ${frame + 1}/${clipFrames}`);
        }
      }
      const stillFrame = path.join(styleDir, `frame-${String(Math.round(clipFrames * 0.58)).padStart(3, '0')}.png`);
      await copyFile(stillFrame, path.join(docsImageDir, `flow-${style.id}.png`));
    }
    assert.deepEqual(errors, []);
  } finally {
    await electronApp?.close().catch(() => {});
  }
}

async function buildPromo() {
  const fluidStill = path.join(docsImageDir, 'flow-fluid-ribbon.png');
  const posterPath = path.join(docsImageDir, 'promo-poster.jpg');
  runFfmpeg([
    '-i', fluidStill,
    '-vf', [
      'scale=1920:1080:force_original_aspect_ratio=increase:flags=lanczos',
      'crop=1920:1080',
      'drawbox=x=0:y=0:w=iw:h=ih:color=black@0.22:t=fill',
      'drawbox=x=70:y=690:w=1120:h=270:color=black@0.58:t=fill',
      `drawtext=fontfile='${fontPath}':text='PARTICLE MODEL STUDIO':x=110:y=730:fontsize=72:fontcolor=white`,
      `drawtext=fontfile='${fontPath}':text='1.0.21  /  FAST TD-LEVEL PARTICLE FLOW':x=114:y=825:fontsize=31:fontcolor=0x8FF0E7`,
      `drawtext=fontfile='${fontPath}':text='MODEL  /  DISSOLVE  /  GRAPH  /  CAMERA  /  EXPORT':x=114:y=882:fontsize=23:fontcolor=0xD0D6DC`
    ].join(','),
    '-frames:v', '1',
    '-q:v', '2',
    posterPath
  ]);

  const titleSegment = path.join(segmentDir, '00-title.mp4');
  const interfaceSegment = path.join(segmentDir, '01-interface.mp4');
  const graphSegment = path.join(segmentDir, '05-graph.mp4');
  const finalSegment = path.join(segmentDir, '06-final.mp4');
  encodeStill(posterPath, titleSegment, 2.5, '', '', false);
  encodeStill(
    path.join(docsImageDir, 'studio-1.0.21.png'),
    interfaceSegment,
    3,
    'CREATOR MODE',
    'Three styles. Six essential controls. Ready to render.'
  );
  for (let index = 0; index < styleDefinitions.length; index += 1) {
    const style = styleDefinitions[index];
    encodeStyleClip(
      style,
      path.join(frameRoot, style.id, 'frame-%03d.png'),
      path.join(segmentDir, `0${index + 2}-${style.id}.mp4`)
    );
  }
  encodeStill(
    path.join(docsImageDir, 'operator-graph-1.0.21.png'),
    graphSegment,
    3,
    'GRAPH MODE',
    'Chinese nodes. GPU feedback when you need it.'
  );
  encodeStill(posterPath, finalSegment, 2.5, 'DOWNLOAD ON GITHUB', 'Windows x64  /  Open source', true);

  const orderedSegments = [
    titleSegment,
    interfaceSegment,
    ...styleDefinitions.map((style, index) => path.join(segmentDir, `0${index + 2}-${style.id}.mp4`)),
    graphSegment,
    finalSegment
  ];
  const concatPath = path.join(verificationDir, 'concat.txt');
  await writeFile(
    concatPath,
    orderedSegments.map((file) => `file '${file.replaceAll('\\', '/')}'`).join('\n')
  );
  runFfmpeg([
    '-f', 'concat',
    '-safe', '0',
    '-i', concatPath,
    '-c', 'copy',
    '-movflags', '+faststart',
    promoVideoPath
  ]);
  return { posterPath, promoVideoPath };
}

await prepareDirectories();
await renderAssets();
const output = await buildPromo();
console.log(JSON.stringify({ ok: true, ...output }, null, 2));
