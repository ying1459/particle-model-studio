import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getMaximumBokehRadiusPixels,
  getThinLensCircleOfConfusionPixels,
  normalizeDepthOfFieldLensParams
} from '../src/core/depth-of-field.js';

const baseLens = {
  aperture: 2,
  focalLength: 50,
  focusDistance: 5,
  sensorWidth: 36,
  bokehScale: 2.35,
  width: 1920,
  height: 1080
};

test('thin-lens CoC is signed around the focus plane', () => {
  const focused = getThinLensCircleOfConfusionPixels(5, baseLens);
  const foreground = getThinLensCircleOfConfusionPixels(2.5, baseLens);
  const background = getThinLensCircleOfConfusionPixels(12, baseLens);

  assert.ok(Math.abs(focused) < 1e-9);
  assert.ok(foreground < 0);
  assert.ok(background > 0);
});

test('wide apertures and longer focal lengths produce larger defocus', () => {
  const wideAperture = Math.abs(getThinLensCircleOfConfusionPixels(10, { ...baseLens, aperture: 1.2 }));
  const stoppedDown = Math.abs(getThinLensCircleOfConfusionPixels(10, { ...baseLens, aperture: 8 }));
  const normalLens = Math.abs(getThinLensCircleOfConfusionPixels(10, { ...baseLens, focalLength: 35 }));
  const portraitLens = Math.abs(getThinLensCircleOfConfusionPixels(10, { ...baseLens, focalLength: 85 }));

  assert.ok(wideAperture > stoppedDown * 5);
  assert.ok(portraitLens > normalLens * 4);
});

test('lens inputs and maximum bokeh radius remain bounded', () => {
  const normalized = normalizeDepthOfFieldLensParams({
    aperture: 0,
    focalLength: 1000,
    focusDistance: 0,
    sensorWidth: 0,
    bokehScale: 100,
    width: 1,
    height: 1
  });
  assert.equal(normalized.aperture, 0.7);
  assert.equal(normalized.focalLength, 300);
  assert.ok(normalized.focusDistance > 0.3);
  assert.equal(normalized.sensorWidth, 8);
  assert.equal(normalized.bokehScale, 6);
  assert.equal(normalized.width, 2);
  assert.equal(normalized.height, 2);
  assert.equal(getMaximumBokehRadiusPixels(512, 288), 25.919999999999998);
  assert.equal(getMaximumBokehRadiusPixels(7680, 4320), 82);
  assert.equal(
    Math.abs(getThinLensCircleOfConfusionPixels(10000, {
      ...baseLens,
      aperture: 0.7,
      focalLength: 300,
      focusDistance: 1,
      bokehScale: 6
    })),
    getMaximumBokehRadiusPixels(baseLens.width, baseLens.height)
  );
});
