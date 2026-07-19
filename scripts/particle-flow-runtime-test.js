import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const executablePath = path.join(rootDir, 'node_modules', 'electron', 'dist', 'electron.exe');
const outputDir = path.join(rootDir, 'verification', 'particle-flow');
const errors = [];
const launchEnv = { ...process.env };
delete launchEnv.ELECTRON_RUN_AS_NODE;
let electronApp;

try {
  await mkdir(outputDir, { recursive: true });
  electronApp = await electron.launch({
    executablePath,
    args: ['.'],
    cwd: rootDir,
    env: { ...launchEnv, ELECTRON_ENABLE_LOGGING: '1' },
    timeout: 60000
  });
  const page = await electronApp.firstWindow({ timeout: 60000 });
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(`console: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  await page.waitForFunction(() => window.particleStudio?.isReady(), null, { timeout: 90000 });

  const result = await page.evaluate(async () => {
    await window.particleStudio.setOptions({
      particleCount: 12000,
      particleizeProgress: 1,
      flowStyle: 'fluid-ribbon',
      flowCharacter: 0.28,
      dissolve: 0.65,
      spread: 0.35,
      speed: 0
    }, true);
    await window.particleStudio.duplicateSelectedSceneModelForTest();
    const models = window.particleStudio.getSceneModels().models;
    const firstId = models[0].id;
    const secondId = models[1].id;
    await window.particleStudio.selectSceneModel(firstId);
    await window.particleStudio.setOptions({ speed: 0 }, true);
    await window.particleStudio.selectSceneModel(secondId);
    await window.particleStudio.setOptions({ speed: 0 }, true);
    window.particleStudio.setExportResolution(320, 180, 30);

    const beforeWait = window.particleStudio.getFlowRuntimeState();
    await new Promise((resolve) => setTimeout(resolve, 280));
    const afterWait = window.particleStudio.getFlowRuntimeState();

    const frameBefore = window.particleStudio.renderFrame(1, undefined, 1);
    await window.particleStudio.selectSceneModel(firstId);
    const frameAfter = window.particleStudio.renderFrame(1, undefined, 1);

    const decode = (source) => new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.drawImage(image, 0, 0);
        resolve(context.getImageData(0, 0, image.width, image.height).data);
      };
      image.onerror = reject;
      image.src = source;
    });
    const [pixelsBefore, pixelsAfter] = await Promise.all([decode(frameBefore), decode(frameAfter)]);
    let difference = 0;
    let changed = 0;
    const pixelCount = pixelsBefore.length / 4;
    for (let index = 0; index < pixelsBefore.length; index += 4) {
      const delta = (
        Math.abs(pixelsBefore[index] - pixelsAfter[index]) +
        Math.abs(pixelsBefore[index + 1] - pixelsAfter[index + 1]) +
        Math.abs(pixelsBefore[index + 2] - pixelsAfter[index + 2])
      ) / 3;
      difference += delta;
      if (delta > 1) {
        changed += 1;
      }
    }

    await window.particleStudio.setOptions({ speed: 1 }, true);
    const movingBefore = window.particleStudio.getFlowRuntimeState();
    await new Promise((resolve) => setTimeout(resolve, 280));
    const movingAfter = window.particleStudio.getFlowRuntimeState();
    const movingId = movingAfter.activeId;
    const staticId = movingAfter.models.find((model) => model.id !== movingId)?.id;

    return {
      creatorFeedbackEnabled: beforeWait.creatorFeedbackEnabled,
      frozenPhasesBefore: beforeWait.models.map((model) => [model.id, model.phase]),
      frozenPhasesAfter: afterWait.models.map((model) => [model.id, model.phase]),
      meanPixelDifference: difference / pixelCount,
      changedPixelRatio: changed / pixelCount,
      movingPhaseBefore: movingBefore.models.find((model) => model.id === movingId)?.phase,
      movingPhaseAfter: movingAfter.models.find((model) => model.id === movingId)?.phase,
      staticPhaseBefore: movingBefore.models.find((model) => model.id === staticId)?.phase,
      staticPhaseAfter: movingAfter.models.find((model) => model.id === staticId)?.phase
    };
  });

  await page.reload();
  await page.waitForFunction(() => window.particleStudio?.isReady(), null, { timeout: 90000 });
  await page.evaluate(() => window.particleStudio.setCameraViewLocked(true));
  for (const style of ['fluid-ribbon', 'weathered-dust', 'energy-burst']) {
    await page.evaluate((flowStyle) => {
      const select = document.querySelector('#flowStyle');
      select.value = flowStyle;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }, style);
    for (const dissolve of [0, 0.35, 0.65, 0.9]) {
      await page.evaluate(async (progress) => {
        await window.particleStudio.setOptions({
          particleizeProgress: 1,
          dissolve: progress,
          spread: 0.35,
          speed: 0
        }, true);
      }, dissolve);
      await page.waitForTimeout(80);
      await page.locator('#scene').screenshot({
        path: path.join(outputDir, `${style}-${String(dissolve).replace('.', '-')}.png`)
      });
    }
  }

  assert.equal(result.creatorFeedbackEnabled, false);
  assert.deepEqual(result.frozenPhasesAfter, result.frozenPhasesBefore);
  assert.ok(result.meanPixelDifference < 0.1, `mean pixel difference ${result.meanPixelDifference}`);
  assert.ok(result.changedPixelRatio < 0.005, `changed pixel ratio ${result.changedPixelRatio}`);
  assert.ok(result.movingPhaseAfter > result.movingPhaseBefore + 0.08);
  assert.equal(result.staticPhaseAfter, result.staticPhaseBefore);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
} finally {
  await electronApp?.close().catch(() => {});
}
