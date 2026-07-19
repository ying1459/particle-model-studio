import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpegPath from 'ffmpeg-static';
import { _electron as electron } from 'playwright';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = path.join(rootDir, 'build');
const svgPath = path.join(buildDir, 'app-icon.svg');
const pngPath = path.join(buildDir, 'app-icon.png');
const icoPath = path.join(buildDir, 'app-icon.ico');
const executablePath = path.join(rootDir, 'node_modules', 'electron', 'dist', 'electron.exe');

await mkdir(buildDir, { recursive: true });
const svg = await readFile(svgPath, 'utf8');
const launchEnv = { ...process.env };
delete launchEnv.ELECTRON_RUN_AS_NODE;
let electronApp;
try {
  electronApp = await electron.launch({
    executablePath,
    args: ['.'],
    cwd: rootDir,
    env: launchEnv,
    timeout: 60000
  });
  const page = await electronApp.firstWindow({ timeout: 60000 });
  await page.setViewportSize({ width: 1024, height: 1024 });
  await page.setContent(`<!doctype html><style>html,body{margin:0;width:1024px;height:1024px;background:transparent;overflow:hidden}svg{display:block;width:1024px;height:1024px}</style>${svg}`);
  await page.screenshot({ path: pngPath, omitBackground: true });
} finally {
  await electronApp?.close().catch(() => {});
}

const result = spawnSync(ffmpegPath, [
  '-hide_banner', '-loglevel', 'warning', '-y',
  '-i', pngPath,
  '-vf', 'scale=256:256:flags=lanczos',
  '-frames:v', '1',
  icoPath
], { cwd: rootDir, stdio: 'inherit', windowsHide: true });
assert.equal(result.status, 0, 'Failed to encode Windows icon');
console.log(JSON.stringify({ ok: true, svgPath, pngPath, icoPath }, null, 2));
