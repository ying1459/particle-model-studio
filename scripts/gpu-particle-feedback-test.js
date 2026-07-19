import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {
  GPU_PARTICLE_FEEDBACK_DEFAULTS,
  GpuParticleFeedbackManager,
  ensureGpuParticleFeedbackUv,
  getGpuParticleFeedbackLayout,
  getGpuParticleLifecycleSample,
  getGpuParticleTrailHistoryIndices,
  normalizeGpuParticleFeedbackParams,
  writeGpuParticleBasePositions
} from '../src/core/gpu-particle-feedback.js';

test('feedback parameters normalize to safe deterministic GPU ranges', () => {
  const defaults = normalizeGpuParticleFeedbackParams();
  const clamped = normalizeGpuParticleFeedbackParams({
    enabled: false,
    resetVersion: 3.9,
    strength: 99,
    dissolveCoupling: -2,
    drag: -1,
    turbulence: 100,
    attraction: -99,
    maxVelocity: 0,
    life: 0,
    substeps: 99,
    timeScale: -1,
    attractors: Array.from({ length: 5 }, (_, index) => ({
      centerX: index === 0 ? 5000 : index,
      strength: index === 0 ? -99 : 1,
      radius: 0,
      falloff: 99,
      nodeId: `attractor-${index}`
    })),
    collisionPlanes: [{
      normalX: 0,
      normalY: 3,
      normalZ: 4,
      offset: -5000,
      restitution: 9,
      friction: -1,
      nodeId: 'floor'
    }],
    trail: {
      enabled: true,
      samples: 99,
      interval: 0,
      opacity: 2,
      fade: 0,
      size: 9,
      nodeId: 'trail'
    },
    emitter: {
      mode: 'invalid',
      rate: 0,
      burstCount: 0,
      directionX: 0,
      directionY: 0,
      directionZ: 0,
      speed: 99,
      spread: 9,
      seed: 4.6,
      nodeId: 'emitter'
    },
    birthLife: {
      lifetimeMin: 9,
      lifetimeMax: 2,
      fadeIn: -1,
      fadeOut: 99,
      respawn: false,
      nodeId: 'life'
    }
  });

  assert.equal(defaults.strength, GPU_PARTICLE_FEEDBACK_DEFAULTS.strength);
  assert.equal(clamped.enabled, false);
  assert.equal(clamped.resetVersion, 3);
  assert.equal(clamped.strength, 8);
  assert.equal(clamped.dissolveCoupling, 0);
  assert.equal(clamped.drag, 0);
  assert.equal(clamped.turbulence, 12);
  assert.equal(clamped.attraction, -20);
  assert.equal(clamped.maxVelocity, 0.001);
  assert.equal(clamped.life, 0.05);
  assert.equal(clamped.substeps, 8);
  assert.equal(clamped.timeScale, 0);
  assert.equal(clamped.attractors.length, 4);
  assert.deepEqual(clamped.attractors[0], {
    centerX: 1000,
    centerY: 0,
    centerZ: 0,
    strength: -50,
    radius: 0.001,
    falloff: 8,
    nodeId: 'attractor-0'
  });
  assert.deepEqual(clamped.collisionPlanes[0], {
    normalX: 0,
    normalY: 0.6,
    normalZ: 0.8,
    offset: -1000,
    restitution: 2,
    friction: 0,
    nodeId: 'floor'
  });
  assert.deepEqual(clamped.trail, {
    enabled: true,
    samples: 8,
    interval: 1 / 240,
    opacity: 1,
    fade: 0.1,
    size: 2,
    nodeId: 'trail'
  });
  assert.equal(clamped.emitter.mode, 'all');
  assert.equal(clamped.emitter.rate, 0.001);
  assert.equal(clamped.emitter.burstCount, 1);
  assert.deepEqual(
    [clamped.emitter.directionX, clamped.emitter.directionY, clamped.emitter.directionZ],
    [0, 1, 0]
  );
  assert.equal(clamped.emitter.speed, 50);
  assert.equal(clamped.emitter.spread, 1);
  assert.equal(clamped.emitter.seed, 5);
  assert.equal(clamped.emitter.nodeId, 'emitter');
  assert.deepEqual(clamped.birthLife, {
    enabled: true,
    lifetimeMin: 9,
    lifetimeMax: 9,
    respawn: false,
    fadeIn: 0,
    fadeOut: 30,
    nodeId: 'life'
  });
});

test('absolute-time lifecycle samples reproduce all, continuous, and burst schedules', () => {
  const allParams = {
    emitter: { mode: 'all', startTime: 1 },
    birthLife: { lifetimeMin: 2, lifetimeMax: 2, respawn: true, fadeIn: 0.5, fadeOut: 0.5 }
  };
  assert.equal(getGpuParticleLifecycleSample(3, 10, 0.5, allParams).active, false);
  const allA = getGpuParticleLifecycleSample(3, 10, 3.25, allParams);
  const allB = getGpuParticleLifecycleSample(3, 10, 3.25, allParams);
  assert.deepEqual(allA, allB);
  assert.equal(allA.active, true);
  assert.ok(Math.abs(allA.age - 0.25) < 1e-9);

  const continuousParams = {
    emitter: { mode: 'continuous', rate: 2, startTime: 0, seed: 7 },
    birthLife: { lifetimeMin: 4, lifetimeMax: 4, respawn: false }
  };
  const before = getGpuParticleLifecycleSample(4, 10, 0, continuousParams);
  const after = getGpuParticleLifecycleSample(4, 10, 5, continuousParams);
  assert.equal(before.active, false);
  assert.equal(after.active, true);
  assert.ok(after.age >= 0 && after.age < 4);

  const burstParams = {
    emitter: { mode: 'burst', burstCount: 10, startTime: 1, loop: true, loopInterval: 2 },
    birthLife: { lifetimeMin: 0.75, lifetimeMax: 0.75, respawn: false }
  };
  assert.ok(Math.abs(getGpuParticleLifecycleSample(0, 10, 3.25, burstParams).age - 0.25) < 1e-9);
  assert.equal(getGpuParticleLifecycleSample(0, 10, 4, burstParams).active, false);
});

test('trail history ring exposes newest-to-oldest texture indices deterministically', () => {
  assert.deepEqual(getGpuParticleTrailHistoryIndices(-1, 0, 4), []);
  assert.deepEqual(getGpuParticleTrailHistoryIndices(1, 4, 4), [1, 0, 3, 2]);
  assert.deepEqual(getGpuParticleTrailHistoryIndices(6, 3, 4), [2, 1, 0]);
  assert.deepEqual(getGpuParticleTrailHistoryIndices(0, 9, 3), [0, 2, 1]);
});

test('base-position texture stores absolute model-local positions and zero-pads spare texels', () => {
  const geometry = new THREE.BufferGeometry();
  const attribute = new THREE.BufferAttribute(new Float32Array([
    1, 2, 3,
    -4, 5, -6
  ]), 3);
  geometry.setAttribute('position', attribute);
  const layout = getGpuParticleFeedbackLayout(2, 4);
  const texture = new THREE.DataTexture(new Float32Array(layout.texelCount * 4), layout.width, layout.height);
  const source = writeGpuParticleBasePositions(texture, geometry, layout);

  assert.equal(source.attribute, attribute);
  assert.equal(source.array, attribute.array);
  assert.deepEqual([...texture.image.data], [1, 2, 3, 0, -4, 5, -6, 0]);
  geometry.dispose();
  texture.dispose();
});

test('feedback layout packs every particle within the hardware texture limit', () => {
  assert.deepEqual(getGpuParticleFeedbackLayout(20_000, 4096), {
    width: 142,
    height: 141,
    texelCount: 20_022,
    particleCount: 20_000
  });
  assert.throws(() => getGpuParticleFeedbackLayout(65, 8), /above the GPU limit/);
});

test('simulation UVs address texel centers and are stable for a matching layout', () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(15), 3));
  const layout = getGpuParticleFeedbackLayout(5, 8);
  const first = ensureGpuParticleFeedbackUv(geometry, layout);
  const second = ensureGpuParticleFeedbackUv(geometry, layout);

  assert.equal(first, second);
  assert.equal(first.count, 5);
  const expected = [1 / 6, 1 / 4, 3 / 6, 1 / 4, 3 / 6, 3 / 4];
  const actual = [first.array[0], first.array[1], first.array[2], first.array[3], first.array[8], first.array[9]];
  actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 1e-6));
  geometry.dispose();
});

test('manager reports an explicit fallback when WebGL2 vertex textures are unavailable', () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
  const manager = new GpuParticleFeedbackManager();
  const result = manager.step({
    renderer: { capabilities: { isWebGL2: false, maxVertexTextures: 0, maxTextureSize: 4096 } },
    geometry,
    count: 1
  });

  assert.equal(result.supported, false);
  assert.equal(result.enabled, false);
  assert.equal(result.reason, 'webgl2-vertex-textures-required');
  geometry.dispose();
});
