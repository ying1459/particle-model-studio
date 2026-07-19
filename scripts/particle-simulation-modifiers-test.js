import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PARTICLE_SIMULATION_MODIFIER_SCHEMA_VERSION,
  appendParticleSimulationModifier,
  createParticleSimulationModifier,
  getParticleSimulationModifiers,
  normalizeParticleSimulationModifier,
  resolveParticleSimulationModifiers
} from '../src/core/particle-simulation-modifiers.js';

test('simulation modifiers normalize to a serializable versioned contract', () => {
  const modifier = normalizeParticleSimulationModifier({
    kind: 'force-field',
    nodeId: 42,
    params: { strength: 99, forceX: -99, turbulence: 99, curl: -1 }
  });

  assert.deepEqual(modifier, {
    schemaVersion: PARTICLE_SIMULATION_MODIFIER_SCHEMA_VERSION,
    kind: 'force-field',
    nodeId: '42',
    params: {
      enabled: true,
      strength: 8,
      forceX: -20,
      forceY: 0.1,
      forceZ: -0.015,
      turbulence: 12,
      curl: 0
    }
  });
  assert.throws(() => normalizeParticleSimulationModifier({ kind: 'collision' }), /Unsupported/);
  assert.doesNotThrow(() => JSON.stringify(modifier));
});

test('force fields compose additively without mutating their source payload', () => {
  const payload = {
    simulationModifiers: [createParticleSimulationModifier('force-field', {
      strength: 2,
      forceX: 0.5,
      forceY: 0,
      forceZ: -0.25,
      turbulence: 0.4,
      curl: 0.6
    }, 'wind-a')]
  };
  const appended = appendParticleSimulationModifier(payload, createParticleSimulationModifier('force-field', {
    strength: 0.5,
    forceX: -0.2,
    forceY: 0.8,
    forceZ: 0,
    turbulence: 1.2,
    curl: 0.4
  }, 'wind-b'));
  const resolved = resolveParticleSimulationModifiers({ forceX: 0.1, turbulence: 0.2 }, appended);

  assert.equal(payload.simulationModifiers.length, 1);
  assert.equal(appended.length, 2);
  assert.equal(resolved.activeCount, 2);
  assert.ok(Math.abs(resolved.params.forceX - 1) < 1e-9);
  assert.ok(Math.abs(resolved.params.forceY - 0.4) < 1e-9);
  assert.ok(Math.abs(resolved.params.forceZ + 0.5) < 1e-9);
  assert.ok(Math.abs(resolved.params.turbulence - 1.6) < 1e-9);
  assert.ok(Math.abs(resolved.params.curl - 1.4) < 1e-9);
});

test('return forces support attraction, repulsion, and disabled modifiers', () => {
  const modifiers = [
    createParticleSimulationModifier('return-force', { strength: 1.5 }, 'return'),
    createParticleSimulationModifier('return-force', { strength: -0.4 }, 'repel'),
    createParticleSimulationModifier('force-field', { enabled: false, forceY: 8 }, 'disabled')
  ];
  const resolved = resolveParticleSimulationModifiers({ attraction: 0.2 }, modifiers);

  assert.equal(resolved.activeCount, 2);
  assert.ok(Math.abs(resolved.params.attraction - 1.3) < 1e-9);
  assert.equal(resolved.params.forceY, undefined);
  assert.deepEqual(getParticleSimulationModifiers({ simulationModifiers: modifiers }), modifiers);
});

test('the last emitter and birth-life modifiers own deterministic lifecycle profiles', () => {
  const resolved = resolveParticleSimulationModifiers({ life: 8 }, [
    createParticleSimulationModifier('emitter', { mode: 'continuous', rate: 1200 }, 'emitter-a'),
    createParticleSimulationModifier('emitter', {
      mode: 'burst',
      burstCount: 0,
      directionX: 0,
      directionY: 0,
      directionZ: 0,
      speed: 99,
      spread: 2,
      seed: 3.7
    }, 'emitter-b'),
    createParticleSimulationModifier('birth-life', {
      lifetimeMin: 8,
      lifetimeMax: 2,
      fadeIn: -1,
      fadeOut: 99,
      respawn: false
    }, 'life')
  ]);

  assert.equal(resolved.activeCount, 3);
  assert.equal(resolved.params.emitter.mode, 'burst');
  assert.equal(resolved.params.emitter.burstCount, 1);
  assert.deepEqual(
    [resolved.params.emitter.directionX, resolved.params.emitter.directionY, resolved.params.emitter.directionZ],
    [0, 1, 0]
  );
  assert.equal(resolved.params.emitter.speed, 50);
  assert.equal(resolved.params.emitter.spread, 1);
  assert.equal(resolved.params.emitter.seed, 4);
  assert.equal(resolved.params.emitter.nodeId, 'emitter-b');
  assert.deepEqual(resolved.params.birthLife, {
    enabled: true,
    lifetimeMin: 8,
    lifetimeMax: 8,
    respawn: false,
    fadeIn: 0,
    fadeOut: 30,
    nodeId: 'life'
  });
});

test('attractors and collision planes normalize, compose, and cap GPU slots', () => {
  const modifiers = [
    ...Array.from({ length: 5 }, (_, index) => createParticleSimulationModifier('attractor', {
      centerX: index,
      centerY: index === 0 ? 2000 : 0,
      strength: index === 0 ? -99 : 1,
      radius: index === 0 ? 0 : 4,
      falloff: index === 0 ? 99 : 2
    }, `attractor-${index}`)),
    createParticleSimulationModifier('collision-plane', {
      normalX: 0,
      normalY: 3,
      normalZ: 4,
      offset: -2000,
      restitution: 9,
      friction: -1
    }, 'floor')
  ];
  const resolved = resolveParticleSimulationModifiers({}, modifiers);

  assert.equal(resolved.activeCount, 6);
  assert.equal(resolved.params.attractors.length, 4);
  assert.deepEqual(resolved.params.attractors[0], {
    enabled: true,
    centerX: 0,
    centerY: 1000,
    centerZ: 0,
    strength: -50,
    radius: 0.001,
    falloff: 8,
    nodeId: 'attractor-0'
  });
  assert.deepEqual(resolved.params.collisionPlanes[0], {
    enabled: true,
    normalX: 0,
    normalY: 0.6,
    normalZ: 0.8,
    offset: -1000,
    restitution: 2,
    friction: 0,
    nodeId: 'floor'
  });
  assert.doesNotThrow(() => JSON.stringify(resolved.params));
});

test('the last active trail modifier owns a bounded serializable history profile', () => {
  const resolved = resolveParticleSimulationModifiers({}, [
    createParticleSimulationModifier('trail', {
      samples: 3,
      interval: 0.08,
      opacity: 0.25,
      fade: 1.2,
      size: 0.6
    }, 'trail-a'),
    createParticleSimulationModifier('trail', {
      samples: 99,
      interval: 0,
      opacity: 2,
      fade: 0,
      size: 9
    }, 'trail-b'),
    createParticleSimulationModifier('trail', { enabled: false, samples: 2 }, 'disabled')
  ]);

  assert.equal(resolved.activeCount, 2);
  assert.deepEqual(resolved.params.trail, {
    enabled: true,
    samples: 8,
    interval: 1 / 240,
    opacity: 1,
    fade: 0.1,
    size: 2,
    nodeId: 'trail-b'
  });
});
