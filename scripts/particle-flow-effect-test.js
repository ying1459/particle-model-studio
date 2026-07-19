import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_FLOW_STYLE,
  FLOW_STYLE_PRESETS,
  advanceFlowPhase,
  applyFlowStylePreset,
  getFlowStyleId,
  integrateLinearSpeed,
  normalizeFlowEffectOptions,
  resolveFlowDirectionVector
} from '../src/core/particle-flow-effect.js';

test('Creator migration adds the fluid ribbon style without replacing authored shaping', () => {
  const migrated = normalizeFlowEffectOptions({
    dissolve: 0.65,
    speed: 0,
    dissolveCurl: 3.4,
    dissolveDirectionX: -0.7,
    dissolveDirectionY: 0.2,
    dissolveDirectionZ: 0
  });
  assert.equal(migrated.flowStyle, DEFAULT_FLOW_STYLE);
  assert.equal(migrated.dissolveCurl, 3.4);
  assert.equal(migrated.flowDirectionPreset, 'custom');
  assert.equal(getFlowStyleId(migrated.flowStyle), 0);
});

test('style changes preserve high-level controls and replace only shaping values', () => {
  const original = {
    flowStyle: 'fluid-ribbon',
    dissolve: 0.42,
    spread: 1.7,
    speed: 0.8,
    colorA: '#123456',
    glowRadius: 180,
    dissolveCurl: 0.1
  };
  const styled = applyFlowStylePreset(original, 'weathered-dust');
  assert.equal(styled.dissolve, original.dissolve);
  assert.equal(styled.spread, original.spread);
  assert.equal(styled.speed, original.speed);
  assert.equal(styled.colorA, original.colorA);
  assert.equal(styled.glowRadius, original.glowRadius);
  assert.equal(styled.dissolveCurl, FLOW_STYLE_PRESETS['weathered-dust'].dissolveCurl);
});

test('zero speed is a hard phase freeze and phases are independent', () => {
  assert.equal(advanceFlowPhase(12.5, 1 / 60, 0), 12.5);
  assert.equal(advanceFlowPhase(2, 0.5, 2), 3);
  assert.equal(advanceFlowPhase(8, 0.5, 2), 9);
});

test('linear speed keyframes integrate deterministically', () => {
  const keys = [
    { time: 0, value: 0 },
    { time: 2, value: 2 },
    { time: 4, value: 0 }
  ];
  assert.equal(integrateLinearSpeed(1, keys, 9), 0.5);
  assert.equal(integrateLinearSpeed(2, keys, 9), 2);
  assert.equal(integrateLinearSpeed(4, keys, 9), 4);
  assert.equal(integrateLinearSpeed(7, keys, 9), 4);
  assert.equal(integrateLinearSpeed(3, keys, 9), 3.5);
  assert.equal(integrateLinearSpeed(3, [], 2), 6);
});

test('direction presets are normalized and custom direction remains authoritative', () => {
  assert.deepEqual(resolveFlowDirectionVector('left'), [-1, 0, 0]);
  const custom = resolveFlowDirectionVector('custom', [0, 3, 4]);
  assert.ok(Math.abs(custom[1] - 0.6) < 1e-8);
  assert.ok(Math.abs(custom[2] - 0.8) < 1e-8);
});
