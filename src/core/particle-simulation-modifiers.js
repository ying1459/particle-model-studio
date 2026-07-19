export const PARTICLE_SIMULATION_MODIFIER_SCHEMA_VERSION = 1;

export const PARTICLE_SIMULATION_MODIFIER_KINDS = Object.freeze([
  'force-field',
  'return-force',
  'emitter',
  'birth-life',
  'attractor',
  'collision-plane',
  'trail'
]);

const MODIFIER_KIND_SET = new Set(PARTICLE_SIMULATION_MODIFIER_KINDS);

export const PARTICLE_FORCE_FIELD_DEFAULTS = Object.freeze({
  enabled: true,
  strength: 1,
  forceX: 0.02,
  forceY: 0.1,
  forceZ: -0.015,
  turbulence: 0.72,
  curl: 1.05
});

export const PARTICLE_RETURN_FORCE_DEFAULTS = Object.freeze({
  enabled: true,
  strength: 0.48
});

export const PARTICLE_EMITTER_DEFAULTS = Object.freeze({
  enabled: true,
  mode: 'all',
  rate: 5000,
  burstCount: 20000,
  startTime: 0,
  duration: 0,
  loop: false,
  loopInterval: 1,
  directionX: 0,
  directionY: 1,
  directionZ: 0,
  speed: 0,
  spread: 0.18,
  positionSpread: 0,
  seed: 1
});

export const PARTICLE_BIRTH_LIFE_DEFAULTS = Object.freeze({
  enabled: true,
  lifetimeMin: 3.96,
  lifetimeMax: 7.04,
  respawn: true,
  fadeIn: 0,
  fadeOut: 0.35
});

export const PARTICLE_ATTRACTOR_DEFAULTS = Object.freeze({
  enabled: true,
  centerX: 0,
  centerY: 0,
  centerZ: 0,
  strength: 1,
  radius: 4,
  falloff: 2
});

export const PARTICLE_COLLISION_PLANE_DEFAULTS = Object.freeze({
  enabled: true,
  normalX: 0,
  normalY: 1,
  normalZ: 0,
  offset: -1,
  restitution: 0.45,
  friction: 0.12
});

export const PARTICLE_TRAIL_DEFAULTS = Object.freeze({
  enabled: true,
  samples: 4,
  interval: 0.04,
  opacity: 0.38,
  fade: 1.6,
  size: 0.72
});

function finiteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clampNumber(value, fallback, min, max) {
  return Math.min(max, Math.max(min, finiteNumber(value, fallback)));
}

function normalizeForceFieldParams(params = {}) {
  return {
    enabled: params.enabled === undefined ? PARTICLE_FORCE_FIELD_DEFAULTS.enabled : Boolean(params.enabled),
    strength: clampNumber(params.strength, PARTICLE_FORCE_FIELD_DEFAULTS.strength, 0, 8),
    forceX: clampNumber(params.forceX, PARTICLE_FORCE_FIELD_DEFAULTS.forceX, -20, 20),
    forceY: clampNumber(params.forceY, PARTICLE_FORCE_FIELD_DEFAULTS.forceY, -20, 20),
    forceZ: clampNumber(params.forceZ, PARTICLE_FORCE_FIELD_DEFAULTS.forceZ, -20, 20),
    turbulence: clampNumber(params.turbulence, PARTICLE_FORCE_FIELD_DEFAULTS.turbulence, 0, 12),
    curl: clampNumber(params.curl, PARTICLE_FORCE_FIELD_DEFAULTS.curl, 0, 8)
  };
}

function normalizeReturnForceParams(params = {}) {
  return {
    enabled: params.enabled === undefined ? PARTICLE_RETURN_FORCE_DEFAULTS.enabled : Boolean(params.enabled),
    strength: clampNumber(params.strength, PARTICLE_RETURN_FORCE_DEFAULTS.strength, -20, 20)
  };
}

function normalizeEmitterParams(params = {}) {
  const mode = ['all', 'continuous', 'burst'].includes(params.mode)
    ? params.mode
    : PARTICLE_EMITTER_DEFAULTS.mode;
  let directionX = finiteNumber(params.directionX, PARTICLE_EMITTER_DEFAULTS.directionX);
  let directionY = finiteNumber(params.directionY, PARTICLE_EMITTER_DEFAULTS.directionY);
  let directionZ = finiteNumber(params.directionZ, PARTICLE_EMITTER_DEFAULTS.directionZ);
  const directionLength = Math.hypot(directionX, directionY, directionZ);
  if (directionLength < 0.000001) {
    directionX = PARTICLE_EMITTER_DEFAULTS.directionX;
    directionY = PARTICLE_EMITTER_DEFAULTS.directionY;
    directionZ = PARTICLE_EMITTER_DEFAULTS.directionZ;
  } else {
    directionX /= directionLength;
    directionY /= directionLength;
    directionZ /= directionLength;
  }
  return {
    enabled: params.enabled === undefined ? PARTICLE_EMITTER_DEFAULTS.enabled : Boolean(params.enabled),
    mode,
    rate: clampNumber(params.rate, PARTICLE_EMITTER_DEFAULTS.rate, 0.001, 1_000_000),
    burstCount: Math.round(clampNumber(params.burstCount, PARTICLE_EMITTER_DEFAULTS.burstCount, 1, 10_000_000)),
    startTime: clampNumber(params.startTime, PARTICLE_EMITTER_DEFAULTS.startTime, -3600, 3600),
    duration: clampNumber(params.duration, PARTICLE_EMITTER_DEFAULTS.duration, 0, 3600),
    loop: params.loop === undefined ? PARTICLE_EMITTER_DEFAULTS.loop : Boolean(params.loop),
    loopInterval: clampNumber(params.loopInterval, PARTICLE_EMITTER_DEFAULTS.loopInterval, 1 / 240, 3600),
    directionX,
    directionY,
    directionZ,
    speed: clampNumber(params.speed, PARTICLE_EMITTER_DEFAULTS.speed, 0, 50),
    spread: clampNumber(params.spread, PARTICLE_EMITTER_DEFAULTS.spread, 0, 1),
    positionSpread: clampNumber(params.positionSpread, PARTICLE_EMITTER_DEFAULTS.positionSpread, 0, 100),
    seed: Math.round(clampNumber(params.seed, PARTICLE_EMITTER_DEFAULTS.seed, 0, 1_000_000))
  };
}

function normalizeBirthLifeParams(params = {}) {
  const lifetimeMin = clampNumber(
    params.lifetimeMin,
    PARTICLE_BIRTH_LIFE_DEFAULTS.lifetimeMin,
    0.05,
    120
  );
  const lifetimeMax = clampNumber(
    params.lifetimeMax,
    PARTICLE_BIRTH_LIFE_DEFAULTS.lifetimeMax,
    lifetimeMin,
    120
  );
  return {
    enabled: params.enabled === undefined ? PARTICLE_BIRTH_LIFE_DEFAULTS.enabled : Boolean(params.enabled),
    lifetimeMin,
    lifetimeMax,
    respawn: params.respawn === undefined ? PARTICLE_BIRTH_LIFE_DEFAULTS.respawn : Boolean(params.respawn),
    fadeIn: clampNumber(params.fadeIn, PARTICLE_BIRTH_LIFE_DEFAULTS.fadeIn, 0, 30),
    fadeOut: clampNumber(params.fadeOut, PARTICLE_BIRTH_LIFE_DEFAULTS.fadeOut, 0, 30)
  };
}

function normalizeAttractorParams(params = {}) {
  return {
    enabled: params.enabled === undefined ? PARTICLE_ATTRACTOR_DEFAULTS.enabled : Boolean(params.enabled),
    centerX: clampNumber(params.centerX, PARTICLE_ATTRACTOR_DEFAULTS.centerX, -1000, 1000),
    centerY: clampNumber(params.centerY, PARTICLE_ATTRACTOR_DEFAULTS.centerY, -1000, 1000),
    centerZ: clampNumber(params.centerZ, PARTICLE_ATTRACTOR_DEFAULTS.centerZ, -1000, 1000),
    strength: clampNumber(params.strength, PARTICLE_ATTRACTOR_DEFAULTS.strength, -50, 50),
    radius: clampNumber(params.radius, PARTICLE_ATTRACTOR_DEFAULTS.radius, 0.001, 1000),
    falloff: clampNumber(params.falloff, PARTICLE_ATTRACTOR_DEFAULTS.falloff, 0.05, 8)
  };
}

function normalizeCollisionPlaneParams(params = {}) {
  let normalX = finiteNumber(params.normalX, PARTICLE_COLLISION_PLANE_DEFAULTS.normalX);
  let normalY = finiteNumber(params.normalY, PARTICLE_COLLISION_PLANE_DEFAULTS.normalY);
  let normalZ = finiteNumber(params.normalZ, PARTICLE_COLLISION_PLANE_DEFAULTS.normalZ);
  const length = Math.hypot(normalX, normalY, normalZ);
  if (length < 0.000001) {
    normalX = PARTICLE_COLLISION_PLANE_DEFAULTS.normalX;
    normalY = PARTICLE_COLLISION_PLANE_DEFAULTS.normalY;
    normalZ = PARTICLE_COLLISION_PLANE_DEFAULTS.normalZ;
  } else {
    normalX /= length;
    normalY /= length;
    normalZ /= length;
  }
  return {
    enabled: params.enabled === undefined ? PARTICLE_COLLISION_PLANE_DEFAULTS.enabled : Boolean(params.enabled),
    normalX,
    normalY,
    normalZ,
    offset: clampNumber(params.offset, PARTICLE_COLLISION_PLANE_DEFAULTS.offset, -1000, 1000),
    restitution: clampNumber(params.restitution, PARTICLE_COLLISION_PLANE_DEFAULTS.restitution, 0, 2),
    friction: clampNumber(params.friction, PARTICLE_COLLISION_PLANE_DEFAULTS.friction, 0, 1)
  };
}

function normalizeTrailParams(params = {}) {
  return {
    enabled: params.enabled === undefined ? PARTICLE_TRAIL_DEFAULTS.enabled : Boolean(params.enabled),
    samples: Math.round(clampNumber(params.samples, PARTICLE_TRAIL_DEFAULTS.samples, 1, 8)),
    interval: clampNumber(params.interval, PARTICLE_TRAIL_DEFAULTS.interval, 1 / 240, 2),
    opacity: clampNumber(params.opacity, PARTICLE_TRAIL_DEFAULTS.opacity, 0, 1),
    fade: clampNumber(params.fade, PARTICLE_TRAIL_DEFAULTS.fade, 0.1, 8),
    size: clampNumber(params.size, PARTICLE_TRAIL_DEFAULTS.size, 0.1, 2)
  };
}

function normalizeModifierParams(kind, params) {
  if (kind === 'force-field') return normalizeForceFieldParams(params);
  if (kind === 'return-force') return normalizeReturnForceParams(params);
  if (kind === 'emitter') return normalizeEmitterParams(params);
  if (kind === 'birth-life') return normalizeBirthLifeParams(params);
  if (kind === 'attractor') return normalizeAttractorParams(params);
  if (kind === 'collision-plane') return normalizeCollisionPlaneParams(params);
  return normalizeTrailParams(params);
}

export function normalizeParticleSimulationModifier(modifier = {}) {
  const kind = String(modifier.kind || '');
  if (!MODIFIER_KIND_SET.has(kind)) {
    throw new Error(`Unsupported particle simulation modifier: ${kind || '(missing)'}.`);
  }
  return {
    schemaVersion: PARTICLE_SIMULATION_MODIFIER_SCHEMA_VERSION,
    kind,
    nodeId: String(modifier.nodeId || ''),
    params: normalizeModifierParams(kind, modifier.params)
  };
}

export function createParticleSimulationModifier(kind, params = {}, nodeId = '') {
  return normalizeParticleSimulationModifier({ kind, params, nodeId });
}

export function getParticleSimulationModifiers(value) {
  const source = Array.isArray(value)
    ? value
    : Array.isArray(value?.simulationModifiers)
      ? value.simulationModifiers
      : [];
  return source.map(normalizeParticleSimulationModifier);
}

export function appendParticleSimulationModifier(value, modifier) {
  return [
    ...getParticleSimulationModifiers(value),
    normalizeParticleSimulationModifier(modifier)
  ];
}

function addFinite(base, key, amount) {
  base[key] = finiteNumber(base[key], 0) + finiteNumber(amount, 0);
}

export function resolveParticleSimulationModifiers(baseParams = {}, value = []) {
  const params = {
    ...(baseParams || {}),
    attractors: Array.isArray(baseParams?.attractors) ? [...baseParams.attractors] : [],
    collisionPlanes: Array.isArray(baseParams?.collisionPlanes) ? [...baseParams.collisionPlanes] : [],
    trail: baseParams?.trail && typeof baseParams.trail === 'object' ? { ...baseParams.trail } : null,
    emitter: baseParams?.emitter && typeof baseParams.emitter === 'object' ? { ...baseParams.emitter } : null,
    birthLife: baseParams?.birthLife && typeof baseParams.birthLife === 'object' ? { ...baseParams.birthLife } : null
  };
  const modifiers = getParticleSimulationModifiers(value);
  const activeModifiers = [];

  modifiers.forEach((modifier) => {
    if (!modifier.params.enabled) return;
    activeModifiers.push(modifier);
    if (modifier.kind === 'force-field') {
      const strength = modifier.params.strength;
      addFinite(params, 'forceX', modifier.params.forceX * strength);
      addFinite(params, 'forceY', modifier.params.forceY * strength);
      addFinite(params, 'forceZ', modifier.params.forceZ * strength);
      addFinite(params, 'turbulence', modifier.params.turbulence * strength);
      addFinite(params, 'curl', modifier.params.curl * strength);
      return;
    }
    if (modifier.kind === 'return-force') {
      addFinite(params, 'attraction', modifier.params.strength);
      return;
    }
    if (modifier.kind === 'emitter') {
      params.emitter = { ...modifier.params, nodeId: modifier.nodeId };
      return;
    }
    if (modifier.kind === 'birth-life') {
      params.birthLife = { ...modifier.params, nodeId: modifier.nodeId };
      return;
    }
    if (modifier.kind === 'attractor' && params.attractors.length < 4) {
      params.attractors.push({ ...modifier.params, nodeId: modifier.nodeId });
      return;
    }
    if (modifier.kind === 'collision-plane' && params.collisionPlanes.length < 4) {
      params.collisionPlanes.push({ ...modifier.params, nodeId: modifier.nodeId });
      return;
    }
    if (modifier.kind === 'trail') {
      params.trail = { ...modifier.params, nodeId: modifier.nodeId };
    }
  });

  return {
    params,
    modifiers,
    activeModifiers,
    activeCount: activeModifiers.length
  };
}
