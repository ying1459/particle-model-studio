import * as THREE from 'three';
import { GPUComputationRenderer } from 'three/examples/jsm/misc/GPUComputationRenderer.js';

export const GPU_PARTICLE_FEEDBACK_DEFAULTS = Object.freeze({
  enabled: true,
  resetVersion: 0,
  strength: 0.72,
  dissolveCoupling: 0.88,
  drag: 1.15,
  damping: 0.16,
  turbulence: 0.72,
  curl: 1.05,
  forceX: 0.02,
  forceY: 0.1,
  forceZ: -0.015,
  attraction: 0.48,
  maxVelocity: 0.72,
  life: 5.5,
  emitter: Object.freeze({
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
    seed: 1,
    nodeId: ''
  }),
  birthLife: Object.freeze({
    enabled: true,
    lifetimeMin: 3.96,
    lifetimeMax: 7.04,
    respawn: true,
    fadeIn: 0,
    fadeOut: 0.35,
    nodeId: ''
  }),
  substeps: 2,
  timeScale: 1,
  attractors: Object.freeze([]),
  collisionPlanes: Object.freeze([]),
  trail: Object.freeze({
    enabled: false,
    samples: 4,
    interval: 0.04,
    opacity: 0.38,
    fade: 1.6,
    size: 0.72,
    nodeId: ''
  })
});

const MAX_GPU_PARTICLE_ATTRACTORS = 4;
const MAX_GPU_PARTICLE_COLLISION_PLANES = 4;
const MAX_GPU_PARTICLE_TRAIL_SAMPLES = 8;

const COPY_POSITION_SHADER = `
  uniform sampler2D uSource;

  void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    gl_FragColor = texture2D(uSource, uv);
  }
`;

const SIMULATION_SHADER_COMMON = `
  uniform float uDeltaTime;
  uniform float uTime;
  uniform float uDrag;
  uniform float uDamping;
  uniform float uTurbulence;
  uniform float uCurl;
  uniform vec3 uForce;
  uniform float uAttraction;
  uniform float uMaxVelocity;
  uniform float uLife;
  uniform float uParticleCount;
  uniform float uEmitterMode;
  uniform float uEmitterRate;
  uniform float uEmitterBurstCount;
  uniform float uEmitterStartTime;
  uniform float uEmitterDuration;
  uniform float uEmitterLoop;
  uniform float uEmitterLoopInterval;
  uniform vec3 uEmitterDirection;
  uniform float uEmitterSpeed;
  uniform float uEmitterSpread;
  uniform float uEmitterPositionSpread;
  uniform float uEmitterSeed;
  uniform float uLifetimeMin;
  uniform float uLifetimeMax;
  uniform float uRespawn;
  uniform float uLifecycleEnabled;
  uniform sampler2D uBasePosition;
  uniform float uAttractorCount;
  uniform vec4 uAttractors[${MAX_GPU_PARTICLE_ATTRACTORS}];
  uniform vec2 uAttractorShape[${MAX_GPU_PARTICLE_ATTRACTORS}];
  uniform float uCollisionPlaneCount;
  uniform vec4 uCollisionPlanes[${MAX_GPU_PARTICLE_COLLISION_PLANES}];
  uniform vec2 uCollisionResponse[${MAX_GPU_PARTICLE_COLLISION_PLANES}];

  float feedbackHash(float value) {
    return fract(sin(value * 12.9898 + 78.233) * 43758.5453);
  }

  float emitterSeed(float seed) {
    return fract(seed + fract(uEmitterSeed * 0.61803398875 + 0.12345));
  }

  float particleLifetime(float seed) {
    return max(mix(uLifetimeMin, uLifetimeMax, seed), 0.05);
  }

  float scheduledParticleAge(float particleIndex, float seed, float time) {
    if (uLifecycleEnabled < 0.5 || particleIndex >= uParticleCount) return -1.0;
    float rankedSeed = emitterSeed(seed);
    float life = particleLifetime(seed);
    float firstBirth = uEmitterStartTime;
    if (uEmitterMode > 1.5) {
      if (rankedSeed * uParticleCount >= uEmitterBurstCount || time < uEmitterStartTime) return -1.0;
      float burstBirth = uEmitterStartTime;
      if (uEmitterLoop > 0.5) {
        float eventIndex = floor((time - uEmitterStartTime) / max(uEmitterLoopInterval, 0.0041667));
        burstBirth += eventIndex * max(uEmitterLoopInterval, 0.0041667);
      }
      if (uEmitterDuration > 0.0 && burstBirth > uEmitterStartTime + uEmitterDuration + 0.00001) return -1.0;
      float burstAge = time - burstBirth;
      return burstAge >= 0.0 && burstAge < life ? burstAge : -1.0;
    }
    if (uEmitterMode > 0.5) {
      firstBirth += rankedSeed * uParticleCount / max(uEmitterRate, 0.001);
    }
    if (uEmitterDuration > 0.0 && firstBirth > uEmitterStartTime + uEmitterDuration + 0.00001) return -1.0;
    float elapsed = time - firstBirth;
    if (elapsed < 0.0) return -1.0;
    if (uRespawn < 0.5) return elapsed < life ? elapsed : -1.0;
    float cycle = floor(elapsed / life);
    float cycleBirth = firstBirth + cycle * life;
    if (uEmitterDuration > 0.0 && cycleBirth > uEmitterStartTime + uEmitterDuration + 0.00001) return -1.0;
    return elapsed - cycle * life;
  }

  vec3 seededDirection(float seed) {
    vec3 randomDirection = normalize(vec3(
      feedbackHash(seed * 19.17 + 0.13) * 2.0 - 1.0,
      feedbackHash(seed * 31.73 + 0.37) * 2.0 - 1.0,
      feedbackHash(seed * 47.11 + 0.71) * 2.0 - 1.0
    ) + vec3(0.0001));
    return normalize(mix(normalize(uEmitterDirection), randomDirection, uEmitterSpread));
  }

  vec3 spawnPosition(vec3 basePosition, float seed) {
    return basePosition + seededDirection(seed + 0.417) *
      uEmitterPositionSpread * feedbackHash(seed * 83.91 + 0.27);
  }

  vec3 spawnVelocity(float seed) {
    return seededDirection(seed) * uEmitterSpeed * mix(0.72, 1.28, feedbackHash(seed * 71.31 + 0.61));
  }

  vec3 feedbackCurl(vec3 p, float time, float seed) {
    vec3 a = p * (0.72 + uCurl * 0.28) + vec3(
      time * 0.23 + seed * 3.1,
      -time * 0.19 + seed * 1.7,
      time * 0.17 - seed * 2.3
    );
    vec3 first = vec3(
      -sin(a.y) - cos(a.z),
      -sin(a.z) - cos(a.x),
      -sin(a.x) - cos(a.y)
    );
    vec3 b = p * (1.31 + uCurl * 0.41) + vec3(1.9, -1.1, 0.6) + vec3(
      -time * 0.13,
      time * 0.16,
      time * 0.11
    );
    vec3 second = vec3(
      -sin(b.y) - cos(b.z),
      -sin(b.z) - cos(b.x),
      -sin(b.x) - cos(b.y)
    );
    return normalize(first + second * 0.43 + vec3(0.001, 0.002, 0.003));
  }

  vec3 attractorAcceleration(vec3 position) {
    vec3 acceleration = vec3(0.0);
    for (int i = 0; i < ${MAX_GPU_PARTICLE_ATTRACTORS}; i++) {
      float enabled = step(float(i) + 0.5, uAttractorCount);
      vec3 delta = uAttractors[i].xyz - position;
      float distanceToCenter = length(delta);
      float radius = max(uAttractorShape[i].x, 0.001);
      float falloff = max(uAttractorShape[i].y, 0.05);
      float influence = pow(clamp(1.0 - distanceToCenter / radius, 0.0, 1.0), falloff) * enabled;
      acceleration += delta / max(distanceToCenter, 0.0001) * uAttractors[i].w * influence;
    }
    return acceleration;
  }

  vec3 nextVelocity(vec3 position, vec3 basePosition, vec3 velocity, float seed) {
    vec3 fieldPosition = position + vec3(seed * 0.73, seed * 1.17, seed * 1.91);
    vec3 acceleration = uForce;
    acceleration += feedbackCurl(fieldPosition, uTime, seed) * uTurbulence * (0.32 + uCurl * 0.56);
    acceleration -= (position - basePosition) * uAttraction;
    acceleration += attractorAcceleration(position);
    velocity += acceleration * uDeltaTime;
    velocity *= exp(-max(uDrag + uDamping * 2.6, 0.0) * uDeltaTime);
    float speed = length(velocity);
    if (speed > uMaxVelocity) {
      velocity *= uMaxVelocity / max(speed, 0.00001);
    }
    return velocity;
  }

  void resolveCollisions(inout vec3 position, inout vec3 velocity) {
    for (int i = 0; i < ${MAX_GPU_PARTICLE_COLLISION_PLANES}; i++) {
      float enabled = step(float(i) + 0.5, uCollisionPlaneCount);
      vec3 normal = normalize(uCollisionPlanes[i].xyz);
      float signedDistance = dot(position, normal) - uCollisionPlanes[i].w;
      if (enabled > 0.5 && signedDistance < 0.0) {
        position -= normal * signedDistance;
        float normalSpeed = dot(velocity, normal);
        if (normalSpeed < 0.0) {
          velocity -= normal * normalSpeed * (1.0 + uCollisionResponse[i].x);
        }
        vec3 normalVelocity = normal * dot(velocity, normal);
        vec3 tangentVelocity = velocity - normalVelocity;
        velocity = normalVelocity + tangentVelocity * (1.0 - uCollisionResponse[i].y);
      }
    }
  }
`;

const POSITION_SHADER = `${SIMULATION_SHADER_COMMON}

  void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    vec4 positionState = texture2D(texturePosition, uv);
    vec4 velocityState = texture2D(textureVelocity, uv);
    vec3 basePosition = texture2D(uBasePosition, uv).xyz;
    float seed = velocityState.a;
    float particleIndex = floor(gl_FragCoord.y) * resolution.x + floor(gl_FragCoord.x);
    float scheduledAge = scheduledParticleAge(particleIndex, seed, uTime);
    if (scheduledAge < 0.0) {
      gl_FragColor = vec4(basePosition, -1.0);
      return;
    }
    bool spawned = positionState.a < 0.0 || scheduledAge + max(uDeltaTime, 0.00001) * 0.5 < positionState.a;
    if (spawned) {
      gl_FragColor = vec4(spawnPosition(basePosition, emitterSeed(seed)), scheduledAge);
      return;
    }
    vec3 velocity = nextVelocity(positionState.xyz, basePosition, velocityState.xyz, seed);
    vec3 nextPosition = positionState.xyz + velocity * uDeltaTime;
    resolveCollisions(nextPosition, velocity);
    gl_FragColor = vec4(nextPosition, scheduledAge);
  }
`;

const VELOCITY_SHADER = `${SIMULATION_SHADER_COMMON}
  void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    vec4 positionState = texture2D(texturePosition, uv);
    vec4 velocityState = texture2D(textureVelocity, uv);
    vec3 basePosition = texture2D(uBasePosition, uv).xyz;
    float seed = velocityState.a;
    float particleIndex = floor(gl_FragCoord.y) * resolution.x + floor(gl_FragCoord.x);
    float scheduledAge = scheduledParticleAge(particleIndex, seed, uTime);
    if (scheduledAge < 0.0) {
      gl_FragColor = vec4(0.0, 0.0, 0.0, seed);
      return;
    }
    bool spawned = positionState.a < 0.0 || scheduledAge + max(uDeltaTime, 0.00001) * 0.5 < positionState.a;
    if (spawned) {
      gl_FragColor = vec4(spawnVelocity(emitterSeed(seed)), seed);
      return;
    }
    vec3 velocity = nextVelocity(positionState.xyz, basePosition, velocityState.xyz, seed);
    vec3 nextPosition = positionState.xyz + velocity * uDeltaTime;
    resolveCollisions(nextPosition, velocity);
    gl_FragColor = vec4(velocity, seed);
  }
`;

function finiteNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clampNumber(value, fallback, min, max) {
  return THREE.MathUtils.clamp(finiteNumber(value, fallback), min, max);
}

function normalizeAttractors(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_GPU_PARTICLE_ATTRACTORS).map((item = {}) => ({
    centerX: clampNumber(item.centerX, 0, -1000, 1000),
    centerY: clampNumber(item.centerY, 0, -1000, 1000),
    centerZ: clampNumber(item.centerZ, 0, -1000, 1000),
    strength: clampNumber(item.strength, 1, -50, 50),
    radius: clampNumber(item.radius, 4, 0.001, 1000),
    falloff: clampNumber(item.falloff, 2, 0.05, 8),
    nodeId: String(item.nodeId || '')
  }));
}

function normalizeCollisionPlanes(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_GPU_PARTICLE_COLLISION_PLANES).map((item = {}) => {
    let normalX = finiteNumber(item.normalX, 0);
    let normalY = finiteNumber(item.normalY, 1);
    let normalZ = finiteNumber(item.normalZ, 0);
    const length = Math.hypot(normalX, normalY, normalZ);
    if (length < 0.000001) {
      normalX = 0;
      normalY = 1;
      normalZ = 0;
    } else {
      normalX /= length;
      normalY /= length;
      normalZ /= length;
    }
    return {
      normalX,
      normalY,
      normalZ,
      offset: clampNumber(item.offset, -1, -1000, 1000),
      restitution: clampNumber(item.restitution, 0.45, 0, 2),
      friction: clampNumber(item.friction, 0.12, 0, 1),
      nodeId: String(item.nodeId || '')
    };
  });
}

function normalizeTrail(value) {
  const source = value && typeof value === 'object' ? value : {};
  const defaults = GPU_PARTICLE_FEEDBACK_DEFAULTS.trail;
  return {
    enabled: source.enabled === undefined ? defaults.enabled : Boolean(source.enabled),
    samples: Math.round(clampNumber(source.samples, defaults.samples, 1, MAX_GPU_PARTICLE_TRAIL_SAMPLES)),
    interval: clampNumber(source.interval, defaults.interval, 1 / 240, 2),
    opacity: clampNumber(source.opacity, defaults.opacity, 0, 1),
    fade: clampNumber(source.fade, defaults.fade, 0.1, 8),
    size: clampNumber(source.size, defaults.size, 0.1, 2),
    nodeId: String(source.nodeId || '')
  };
}

function normalizeEmitter(value) {
  const source = value && typeof value === 'object' ? value : {};
  const defaults = GPU_PARTICLE_FEEDBACK_DEFAULTS.emitter;
  const mode = ['all', 'continuous', 'burst'].includes(source.mode) ? source.mode : defaults.mode;
  let directionX = finiteNumber(source.directionX, defaults.directionX);
  let directionY = finiteNumber(source.directionY, defaults.directionY);
  let directionZ = finiteNumber(source.directionZ, defaults.directionZ);
  const directionLength = Math.hypot(directionX, directionY, directionZ);
  if (directionLength < 0.000001) {
    directionX = defaults.directionX;
    directionY = defaults.directionY;
    directionZ = defaults.directionZ;
  } else {
    directionX /= directionLength;
    directionY /= directionLength;
    directionZ /= directionLength;
  }
  return {
    enabled: source.enabled === undefined ? defaults.enabled : Boolean(source.enabled),
    mode,
    rate: clampNumber(source.rate, defaults.rate, 0.001, 1_000_000),
    burstCount: Math.round(clampNumber(source.burstCount, defaults.burstCount, 1, 10_000_000)),
    startTime: clampNumber(source.startTime, defaults.startTime, -3600, 3600),
    duration: clampNumber(source.duration, defaults.duration, 0, 3600),
    loop: source.loop === undefined ? defaults.loop : Boolean(source.loop),
    loopInterval: clampNumber(source.loopInterval, defaults.loopInterval, 1 / 240, 3600),
    directionX,
    directionY,
    directionZ,
    speed: clampNumber(source.speed, defaults.speed, 0, 50),
    spread: clampNumber(source.spread, defaults.spread, 0, 1),
    positionSpread: clampNumber(source.positionSpread, defaults.positionSpread, 0, 100),
    seed: Math.round(clampNumber(source.seed, defaults.seed, 0, 1_000_000)),
    nodeId: String(source.nodeId || '')
  };
}

function normalizeBirthLife(value, legacyLife) {
  const source = value && typeof value === 'object' ? value : {};
  const defaults = GPU_PARTICLE_FEEDBACK_DEFAULTS.birthLife;
  const safeLegacyLife = clampNumber(legacyLife, GPU_PARTICLE_FEEDBACK_DEFAULTS.life, 0.05, 120);
  const fallbackMin = value ? defaults.lifetimeMin : safeLegacyLife * 0.72;
  const fallbackMax = value ? defaults.lifetimeMax : safeLegacyLife * 1.28;
  const lifetimeMin = clampNumber(source.lifetimeMin, fallbackMin, 0.05, 120);
  return {
    enabled: source.enabled === undefined ? defaults.enabled : Boolean(source.enabled),
    lifetimeMin,
    lifetimeMax: clampNumber(source.lifetimeMax, fallbackMax, lifetimeMin, 120),
    respawn: source.respawn === undefined ? defaults.respawn : Boolean(source.respawn),
    fadeIn: clampNumber(source.fadeIn, defaults.fadeIn, 0, 30),
    fadeOut: clampNumber(source.fadeOut, defaults.fadeOut, 0, 30),
    nodeId: String(source.nodeId || '')
  };
}

export function normalizeGpuParticleFeedbackParams(params = {}) {
  const life = clampNumber(params.life, GPU_PARTICLE_FEEDBACK_DEFAULTS.life, 0.05, 120);
  return {
    enabled: params.enabled === undefined ? GPU_PARTICLE_FEEDBACK_DEFAULTS.enabled : Boolean(params.enabled),
    resetVersion: Math.max(0, Math.floor(finiteNumber(params.resetVersion, GPU_PARTICLE_FEEDBACK_DEFAULTS.resetVersion))),
    strength: clampNumber(params.strength, GPU_PARTICLE_FEEDBACK_DEFAULTS.strength, 0, 8),
    dissolveCoupling: clampNumber(
      params.dissolveCoupling,
      GPU_PARTICLE_FEEDBACK_DEFAULTS.dissolveCoupling,
      0,
      1
    ),
    drag: clampNumber(params.drag, GPU_PARTICLE_FEEDBACK_DEFAULTS.drag, 0, 20),
    damping: clampNumber(params.damping, GPU_PARTICLE_FEEDBACK_DEFAULTS.damping, 0, 1),
    turbulence: clampNumber(params.turbulence, GPU_PARTICLE_FEEDBACK_DEFAULTS.turbulence, 0, 12),
    curl: clampNumber(params.curl, GPU_PARTICLE_FEEDBACK_DEFAULTS.curl, 0, 8),
    forceX: clampNumber(params.forceX, GPU_PARTICLE_FEEDBACK_DEFAULTS.forceX, -20, 20),
    forceY: clampNumber(params.forceY, GPU_PARTICLE_FEEDBACK_DEFAULTS.forceY, -20, 20),
    forceZ: clampNumber(params.forceZ, GPU_PARTICLE_FEEDBACK_DEFAULTS.forceZ, -20, 20),
    attraction: clampNumber(params.attraction, GPU_PARTICLE_FEEDBACK_DEFAULTS.attraction, -20, 20),
    maxVelocity: clampNumber(params.maxVelocity, GPU_PARTICLE_FEEDBACK_DEFAULTS.maxVelocity, 0.001, 50),
    life,
    substeps: Math.round(clampNumber(params.substeps, GPU_PARTICLE_FEEDBACK_DEFAULTS.substeps, 1, 8)),
    timeScale: clampNumber(params.timeScale, GPU_PARTICLE_FEEDBACK_DEFAULTS.timeScale, 0, 8),
    attractors: normalizeAttractors(params.attractors),
    collisionPlanes: normalizeCollisionPlanes(params.collisionPlanes),
    trail: normalizeTrail(params.trail),
    emitter: normalizeEmitter(params.emitter),
    birthLife: normalizeBirthLife(params.birthLife, life)
  };
}

function fract(value) {
  return value - Math.floor(value);
}

function getEmitterRankSeed(seed, emitterSeed) {
  return fract(seed + fract(emitterSeed * 0.61803398875 + 0.12345));
}

export function getGpuParticleLifecycleSample(index, count, time, params = {}) {
  const normalized = normalizeGpuParticleFeedbackParams(params);
  const safeIndex = Math.max(0, Math.floor(finiteNumber(index, 0)));
  const safeCount = Math.max(1, Math.floor(finiteNumber(count, 1)));
  const numericTime = finiteNumber(time, 0);
  const seed = deterministicSeed(safeIndex);
  const emitter = normalized.emitter;
  const birthLife = normalized.birthLife;
  const rankSeed = getEmitterRankSeed(seed, emitter.seed);
  const lifetime = Math.max(
    birthLife.lifetimeMin + (birthLife.lifetimeMax - birthLife.lifetimeMin) * seed,
    0.05
  );
  let age = -1;
  let cycle = -1;
  let birthTime = Number.NaN;

  if (emitter.enabled && birthLife.enabled) {
    if (emitter.mode === 'burst') {
      const eligible = rankSeed * safeCount < emitter.burstCount;
      if (eligible && numericTime >= emitter.startTime) {
        const event = emitter.loop
          ? Math.floor((numericTime - emitter.startTime) / emitter.loopInterval)
          : 0;
        birthTime = emitter.startTime + event * emitter.loopInterval;
        const insideDuration = emitter.duration <= 0 || birthTime <= emitter.startTime + emitter.duration + 0.00001;
        const eventAge = numericTime - birthTime;
        if (insideDuration && eventAge >= 0 && eventAge < lifetime) {
          age = eventAge;
          cycle = event;
        }
      }
    } else {
      birthTime = emitter.startTime;
      if (emitter.mode === 'continuous') {
        birthTime += rankSeed * safeCount / Math.max(emitter.rate, 0.001);
      }
      const firstBirthInsideDuration = emitter.duration <= 0 ||
        birthTime <= emitter.startTime + emitter.duration + 0.00001;
      const elapsed = numericTime - birthTime;
      if (firstBirthInsideDuration && elapsed >= 0) {
        if (birthLife.respawn) {
          cycle = Math.floor(elapsed / lifetime);
          const cycleBirth = birthTime + cycle * lifetime;
          const cycleInsideDuration = emitter.duration <= 0 ||
            cycleBirth <= emitter.startTime + emitter.duration + 0.00001;
          if (cycleInsideDuration) {
            birthTime = cycleBirth;
            age = elapsed - cycle * lifetime;
          }
        } else if (elapsed < lifetime) {
          age = elapsed;
          cycle = 0;
        }
      }
    }
  }

  const active = age >= 0;
  const fadeIn = birthLife.fadeIn <= 0 ? 1 : Math.min(1, age / birthLife.fadeIn);
  const fadeOut = birthLife.fadeOut <= 0 ? 1 : Math.min(1, (lifetime - age) / birthLife.fadeOut);
  return {
    active,
    age: active ? age : -1,
    lifetime,
    normalizedAge: active ? age / lifetime : -1,
    opacity: active ? Math.max(0, Math.min(fadeIn, fadeOut)) : 0,
    cycle,
    birthTime: active ? birthTime : null,
    seed,
    rankSeed
  };
}

export function getGpuParticleTrailHistoryIndices(cursor, count, capacity) {
  const safeCapacity = Math.max(0, Math.floor(finiteNumber(capacity, 0)));
  const safeCount = Math.min(safeCapacity, Math.max(0, Math.floor(finiteNumber(count, 0))));
  if (!safeCapacity || safeCount === 0) return [];
  const safeCursor = ((Math.floor(finiteNumber(cursor, 0)) % safeCapacity) + safeCapacity) % safeCapacity;
  return Array.from({ length: safeCount }, (_, index) => (
    (safeCursor - index + safeCapacity) % safeCapacity
  ));
}

export function getGpuParticleFeedbackLayout(count, maxTextureSize = 4096) {
  const safeCount = Math.max(1, Math.floor(finiteNumber(count, 1)));
  const safeMax = Math.max(1, Math.floor(finiteNumber(maxTextureSize, 4096)));
  if (safeCount > safeMax * safeMax) {
    throw new Error(`Particle feedback requires ${safeCount} texels, above the GPU limit ${safeMax}x${safeMax}.`);
  }
  const width = Math.min(safeMax, Math.ceil(Math.sqrt(safeCount)));
  const height = Math.ceil(safeCount / width);
  return {
    width,
    height,
    texelCount: width * height,
    particleCount: safeCount
  };
}

export function ensureGpuParticleFeedbackUv(geometry, layout) {
  if (!geometry?.setAttribute) {
    throw new Error('Particle feedback requires a BufferGeometry.');
  }
  const positionCount = Math.max(0, Number(geometry.getAttribute?.('position')?.count || 0));
  const count = Math.min(positionCount, Math.max(0, Number(layout?.particleCount) || 0));
  const signature = `${layout.width}x${layout.height}:${count}`;
  const existing = geometry.getAttribute?.('aSimulationUv');
  if (existing?.count === positionCount && geometry.userData?.gpuParticleFeedbackUv === signature) {
    return existing;
  }
  const values = new Float32Array(positionCount * 2);
  for (let index = 0; index < positionCount; index += 1) {
    const clampedIndex = Math.min(index, Math.max(0, layout.texelCount - 1));
    values[index * 2] = ((clampedIndex % layout.width) + 0.5) / layout.width;
    values[index * 2 + 1] = (Math.floor(clampedIndex / layout.width) + 0.5) / layout.height;
  }
  const attribute = new THREE.BufferAttribute(values, 2);
  geometry.setAttribute('aSimulationUv', attribute);
  geometry.userData.gpuParticleFeedbackUv = signature;
  return attribute;
}

function deterministicSeed(index) {
  const value = Math.sin((index + 1) * 12.9898 + 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function assignComputeUniforms(material, uniforms) {
  Object.entries(uniforms).forEach(([name, uniform]) => {
    material.uniforms[name] = uniform;
  });
}

export function writeGpuParticleBasePositions(texture, geometry, layout) {
  const attribute = geometry?.getAttribute?.('position');
  if (!attribute) {
    throw new Error('Particle feedback requires a position attribute.');
  }
  const data = texture.image.data;
  data.fill(0);
  const count = Math.min(attribute.count, layout.particleCount, layout.texelCount);
  const array = attribute.array;
  const itemSize = Math.max(1, Number(attribute.itemSize) || 3);
  const direct = array && !attribute.isInterleavedBufferAttribute;
  for (let index = 0; index < count; index += 1) {
    const target = index * 4;
    if (direct) {
      const source = index * itemSize;
      data[target] = finiteNumber(array[source], 0);
      data[target + 1] = finiteNumber(array[source + 1], 0);
      data[target + 2] = finiteNumber(array[source + 2], 0);
    } else {
      data[target] = finiteNumber(attribute.getX?.(index), 0);
      data[target + 1] = finiteNumber(attribute.getY?.(index), 0);
      data[target + 2] = finiteNumber(attribute.getZ?.(index), 0);
    }
  }
  texture.needsUpdate = true;
  return {
    attribute,
    version: Number(attribute.version) || 0,
    array: attribute.array
  };
}

function createSimulation(renderer, layout, params, geometry, resetCount = 0, initialTime = 0) {
  const gpuCompute = new GPUComputationRenderer(layout.width, layout.height, renderer);
  const positionTexture = gpuCompute.createTexture();
  const velocityTexture = gpuCompute.createTexture();
  const positionSource = writeGpuParticleBasePositions(positionTexture, geometry, layout);
  const positionData = positionTexture.image.data;
  const velocityData = velocityTexture.image.data;
  for (let index = 0; index < layout.texelCount; index += 1) {
    // Mark every slot unborn so the first zero-delta GPU step uses exactly the
    // same spawn position and velocity path as later lifecycle cycles.
    positionData[index * 4 + 3] = -1;
    velocityData[index * 4 + 3] = deterministicSeed(index);
  }
  positionTexture.needsUpdate = true;
  velocityTexture.needsUpdate = true;

  const positionVariable = gpuCompute.addVariable('texturePosition', POSITION_SHADER, positionTexture);
  const velocityVariable = gpuCompute.addVariable('textureVelocity', VELOCITY_SHADER, velocityTexture);
  gpuCompute.setVariableDependencies(positionVariable, [positionVariable, velocityVariable]);
  gpuCompute.setVariableDependencies(velocityVariable, [positionVariable, velocityVariable]);

  const sharedUniforms = {
    uDeltaTime: { value: 0 },
    uTime: { value: 0 },
    uDrag: { value: params.drag },
    uDamping: { value: params.damping },
    uTurbulence: { value: params.turbulence },
    uCurl: { value: params.curl },
    uForce: { value: new THREE.Vector3(params.forceX, params.forceY, params.forceZ) },
    uAttraction: { value: params.attraction },
    uMaxVelocity: { value: params.maxVelocity },
    uLife: { value: params.life },
    uParticleCount: { value: layout.particleCount },
    uEmitterMode: { value: params.emitter.mode === 'burst' ? 2 : params.emitter.mode === 'continuous' ? 1 : 0 },
    uEmitterRate: { value: params.emitter.rate },
    uEmitterBurstCount: { value: params.emitter.burstCount },
    uEmitterStartTime: { value: params.emitter.startTime },
    uEmitterDuration: { value: params.emitter.duration },
    uEmitterLoop: { value: params.emitter.loop ? 1 : 0 },
    uEmitterLoopInterval: { value: params.emitter.loopInterval },
    uEmitterDirection: {
      value: new THREE.Vector3(params.emitter.directionX, params.emitter.directionY, params.emitter.directionZ)
    },
    uEmitterSpeed: { value: params.emitter.speed },
    uEmitterSpread: { value: params.emitter.spread },
    uEmitterPositionSpread: { value: params.emitter.positionSpread },
    uEmitterSeed: { value: params.emitter.seed },
    uLifetimeMin: { value: params.birthLife.lifetimeMin },
    uLifetimeMax: { value: params.birthLife.lifetimeMax },
    uRespawn: { value: params.birthLife.respawn ? 1 : 0 },
    uLifecycleEnabled: { value: params.emitter.enabled && params.birthLife.enabled ? 1 : 0 },
    uBasePosition: { value: positionTexture },
    uAttractorCount: { value: 0 },
    uAttractors: {
      value: Array.from({ length: MAX_GPU_PARTICLE_ATTRACTORS }, () => new THREE.Vector4())
    },
    uAttractorShape: {
      value: Array.from({ length: MAX_GPU_PARTICLE_ATTRACTORS }, () => new THREE.Vector2(1, 1))
    },
    uCollisionPlaneCount: { value: 0 },
    uCollisionPlanes: {
      value: Array.from({ length: MAX_GPU_PARTICLE_COLLISION_PLANES }, () => new THREE.Vector4(0, 1, 0, -1))
    },
    uCollisionResponse: {
      value: Array.from({ length: MAX_GPU_PARTICLE_COLLISION_PLANES }, () => new THREE.Vector2())
    }
  };
  assignComputeUniforms(positionVariable.material, sharedUniforms);
  assignComputeUniforms(velocityVariable.material, sharedUniforms);
  const error = gpuCompute.init();
  if (error) {
    gpuCompute.dispose();
    throw new Error(error);
  }
  sharedUniforms.uDeltaTime.value = 0;
  sharedUniforms.uTime.value = initialTime;
  gpuCompute.compute();
  return {
    supported: true,
    gpuCompute,
    positionVariable,
    velocityVariable,
    uniforms: sharedUniforms,
    basePositionTexture: positionTexture,
    positionAttribute: positionSource.attribute,
    positionAttributeVersion: positionSource.version,
    positionArray: positionSource.array,
    historyTargets: [],
    historyCopyMaterial: null,
    historyCursor: -1,
    historyCaptureCount: 0,
    lastHistoryTime: Number.NaN,
    layout,
    resetCount,
    computeFrames: 0,
    computeSteps: 0,
    initializationSteps: 1,
    lastDelta: 0,
    lastTime: Number.NaN,
    resetVersion: params.resetVersion,
    geometry: null,
    error: ''
  };
}

function createHistoryTarget(layout) {
  const target = new THREE.WebGLRenderTarget(layout.width, layout.height, {
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    format: THREE.RGBAFormat,
    type: THREE.FloatType,
    depthBuffer: false,
    stencilBuffer: false
  });
  target.texture.generateMipmaps = false;
  target.texture.name = 'particle-feedback-history';
  return target;
}

function disposeHistoryTargets(state) {
  (state?.historyTargets || []).forEach((target) => target.dispose());
  if (state) {
    state.historyTargets = [];
    state.historyCursor = -1;
    state.historyCaptureCount = 0;
    state.lastHistoryTime = Number.NaN;
  }
}

function ensureHistoryTargets(state, trail, numericTime) {
  const capacity = trail.enabled && trail.opacity > 0 ? trail.samples : 0;
  if (state.historyTargets.length === capacity) return;
  disposeHistoryTargets(state);
  if (!capacity) return;
  if (!state.historyCopyMaterial) {
    state.historyCopyMaterial = state.gpuCompute.createShaderMaterial(COPY_POSITION_SHADER, {
      uSource: { value: null }
    });
  }
  state.historyTargets = Array.from({ length: capacity }, () => createHistoryTarget(state.layout));
  state.lastHistoryTime = numericTime;
}

function captureHistoryPosition(state, captureTime) {
  const capacity = state.historyTargets.length;
  if (!capacity) return false;
  state.historyCursor = (state.historyCursor + 1) % capacity;
  state.historyCopyMaterial.uniforms.uSource.value = state.gpuCompute
    .getCurrentRenderTarget(state.positionVariable)
    .texture;
  state.gpuCompute.doRenderTarget(state.historyCopyMaterial, state.historyTargets[state.historyCursor]);
  state.historyCaptureCount = Math.min(capacity, state.historyCaptureCount + 1);
  state.lastHistoryTime = captureTime;
  return true;
}

function disposeSimulation(state) {
  disposeHistoryTargets(state);
  state?.historyCopyMaterial?.dispose?.();
  if (state?.gpuCompute) {
    state.gpuCompute.dispose();
  }
}

function stateKey(scope, nodeId) {
  return `${scope || 'viewport'}\u0000${nodeId || 'particle-feedback'}`;
}

export class GpuParticleFeedbackManager {
  constructor() {
    this.rendererStates = new WeakMap();
  }

  getRendererStates(renderer) {
    let states = this.rendererStates.get(renderer);
    if (!states) {
      states = new Map();
      this.rendererStates.set(renderer, states);
    }
    return states;
  }

  release(renderer, scope, nodeId) {
    const states = this.rendererStates.get(renderer);
    const key = stateKey(scope, nodeId);
    const state = states?.get(key);
    if (!state) return false;
    disposeSimulation(state);
    states.delete(key);
    return true;
  }

  prune(renderer, scope, activeNodeIds = []) {
    const states = this.rendererStates.get(renderer);
    if (!states) return 0;
    const prefix = `${scope || 'viewport'}\u0000`;
    const active = new Set(activeNodeIds.map((id) => stateKey(scope, id)));
    let released = 0;
    [...states.entries()].forEach(([key, state]) => {
      if (key.startsWith(prefix) && !active.has(key)) {
        disposeSimulation(state);
        states.delete(key);
        released += 1;
      }
    });
    return released;
  }

  disposeRenderer(renderer) {
    const states = this.rendererStates.get(renderer);
    if (!states) return 0;
    states.forEach((state) => disposeSimulation(state));
    const count = states.size;
    states.clear();
    this.rendererStates.delete(renderer);
    return count;
  }

  step({ renderer, scope = 'viewport', nodeId = 'particle-feedback', geometry, count, time = 0, params = {} }) {
    const normalized = normalizeGpuParticleFeedbackParams(params);
    if (!normalized.enabled) {
      this.release(renderer, scope, nodeId);
      return { supported: true, enabled: false, reason: 'disabled', params: normalized };
    }
    if (!renderer || !geometry) {
      return { supported: false, enabled: false, reason: 'missing-renderer-or-geometry', params: normalized };
    }
    if (!renderer.capabilities?.isWebGL2 || renderer.capabilities.maxVertexTextures <= 0) {
      this.release(renderer, scope, nodeId);
      return { supported: false, enabled: false, reason: 'webgl2-vertex-textures-required', params: normalized };
    }

    const layout = getGpuParticleFeedbackLayout(count, renderer.capabilities.maxTextureSize);
    ensureGpuParticleFeedbackUv(geometry, layout);
    const states = this.getRendererStates(renderer);
    const key = stateKey(scope, nodeId);
    let state = states.get(key);
    const numericTime = finiteNumber(time, 0);
    let resetReason = '';
    const resetNeeded = !state ||
      state.layout?.width !== layout.width ||
      state.layout?.height !== layout.height ||
      state.geometry !== geometry ||
      state.resetVersion !== normalized.resetVersion ||
      (Number.isFinite(state.lastTime) && (numericTime < state.lastTime - 0.0001 || numericTime - state.lastTime > 0.75));

    if (resetNeeded) {
      if (!state) resetReason = 'created';
      else if (state.resetVersion !== normalized.resetVersion) resetReason = 'reset-version';
      else if (state.geometry !== geometry) resetReason = 'geometry-changed';
      else if (state.layout?.width !== layout.width || state.layout?.height !== layout.height) resetReason = 'layout-changed';
      else resetReason = 'timeline-seek';
      const resetCount = (state?.resetCount || 0) + (state ? 1 : 0);
      disposeSimulation(state);
      try {
        state = createSimulation(renderer, layout, normalized, geometry, resetCount, numericTime);
        state.geometry = geometry;
      } catch (error) {
        state = {
          supported: false,
          layout,
          geometry,
          resetVersion: normalized.resetVersion,
          resetCount,
          lastTime: numericTime,
          error: error?.message || String(error)
        };
      }
      states.set(key, state);
    }

    if (!state.supported) {
      return {
        supported: false,
        enabled: false,
        reason: 'float-feedback-unavailable',
        error: state.error,
        width: layout.width,
        height: layout.height,
        particleCount: layout.particleCount,
        params: normalized
      };
    }

    const positionAttribute = geometry.getAttribute?.('position');
    const positionVersion = Number(positionAttribute?.version) || 0;
    if (
      positionAttribute &&
      (
        state.positionAttribute !== positionAttribute ||
        state.positionAttributeVersion !== positionVersion ||
        state.positionArray !== positionAttribute.array
      )
    ) {
      const positionSource = writeGpuParticleBasePositions(state.basePositionTexture, geometry, layout);
      state.positionAttribute = positionSource.attribute;
      state.positionAttributeVersion = positionSource.version;
      state.positionArray = positionSource.array;
    }

    const rawDelta = Number.isFinite(state.lastTime) ? Math.max(0, numericTime - state.lastTime) : 0;
    const scaledDelta = Math.min(rawDelta * normalized.timeScale, 0.2);
    const stepCount = scaledDelta > 0.000001 ? normalized.substeps : 0;
    const stepDelta = stepCount ? scaledDelta / stepCount : 0;
    ensureHistoryTargets(state, normalized.trail, numericTime - scaledDelta);
    state.uniforms.uDrag.value = normalized.drag;
    state.uniforms.uDamping.value = normalized.damping;
    state.uniforms.uTurbulence.value = normalized.turbulence;
    state.uniforms.uCurl.value = normalized.curl;
    state.uniforms.uForce.value.set(normalized.forceX, normalized.forceY, normalized.forceZ);
    state.uniforms.uAttraction.value = normalized.attraction;
    state.uniforms.uMaxVelocity.value = normalized.maxVelocity;
    state.uniforms.uLife.value = normalized.life;
    state.uniforms.uParticleCount.value = layout.particleCount;
    state.uniforms.uEmitterMode.value = normalized.emitter.mode === 'burst'
      ? 2
      : normalized.emitter.mode === 'continuous'
        ? 1
        : 0;
    state.uniforms.uEmitterRate.value = normalized.emitter.rate;
    state.uniforms.uEmitterBurstCount.value = normalized.emitter.burstCount;
    state.uniforms.uEmitterStartTime.value = normalized.emitter.startTime;
    state.uniforms.uEmitterDuration.value = normalized.emitter.duration;
    state.uniforms.uEmitterLoop.value = normalized.emitter.loop ? 1 : 0;
    state.uniforms.uEmitterLoopInterval.value = normalized.emitter.loopInterval;
    state.uniforms.uEmitterDirection.value.set(
      normalized.emitter.directionX,
      normalized.emitter.directionY,
      normalized.emitter.directionZ
    );
    state.uniforms.uEmitterSpeed.value = normalized.emitter.speed;
    state.uniforms.uEmitterSpread.value = normalized.emitter.spread;
    state.uniforms.uEmitterPositionSpread.value = normalized.emitter.positionSpread;
    state.uniforms.uEmitterSeed.value = normalized.emitter.seed;
    state.uniforms.uLifetimeMin.value = normalized.birthLife.lifetimeMin;
    state.uniforms.uLifetimeMax.value = normalized.birthLife.lifetimeMax;
    state.uniforms.uRespawn.value = normalized.birthLife.respawn ? 1 : 0;
    state.uniforms.uLifecycleEnabled.value = normalized.emitter.enabled && normalized.birthLife.enabled ? 1 : 0;
    state.uniforms.uAttractorCount.value = normalized.attractors.length;
    state.uniforms.uAttractors.value.forEach((uniformValue, index) => {
      const attractor = normalized.attractors[index];
      uniformValue.set(
        attractor?.centerX || 0,
        attractor?.centerY || 0,
        attractor?.centerZ || 0,
        attractor?.strength || 0
      );
      state.uniforms.uAttractorShape.value[index].set(
        attractor?.radius || 1,
        attractor?.falloff || 1
      );
    });
    state.uniforms.uCollisionPlaneCount.value = normalized.collisionPlanes.length;
    state.uniforms.uCollisionPlanes.value.forEach((uniformValue, index) => {
      const plane = normalized.collisionPlanes[index];
      uniformValue.set(
        plane?.normalX || 0,
        plane?.normalY ?? 1,
        plane?.normalZ || 0,
        plane?.offset ?? -1
      );
      state.uniforms.uCollisionResponse.value[index].set(
        plane?.restitution || 0,
        plane?.friction || 0
      );
    });
    state.uniforms.uDeltaTime.value = stepDelta;
    for (let index = 0; index < stepCount; index += 1) {
      const substepStartTime = numericTime - scaledDelta + stepDelta * index;
      if (
        state.historyTargets.length &&
        (
          state.historyCaptureCount === 0 ||
          substepStartTime - state.lastHistoryTime >= normalized.trail.interval - 0.000001
        )
      ) {
        captureHistoryPosition(state, substepStartTime);
      }
      state.uniforms.uTime.value = substepStartTime + stepDelta;
      state.gpuCompute.compute();
    }
    if (stepCount) state.computeFrames += 1;
    state.computeSteps += stepCount;
    state.lastDelta = rawDelta;
    state.lastTime = numericTime;
    state.resetVersion = normalized.resetVersion;

    const bytesPerTexel = 4 * 4;
    const pingPongByteLength = layout.texelCount * bytesPerTexel * 4;
    const basePositionByteLength = layout.texelCount * bytesPerTexel;
    const trailByteLength = state.historyTargets.length * layout.texelCount * bytesPerTexel;
    const stateByteLength = pingPongByteLength + basePositionByteLength + trailByteLength;
    const historyTextures = getGpuParticleTrailHistoryIndices(
      state.historyCursor,
      state.historyCaptureCount,
      state.historyTargets.length
    ).map((index) => state.historyTargets[index].texture);
    return {
      supported: true,
      enabled: true,
      reason: resetReason || 'running',
      reset: Boolean(resetReason),
      resetCount: state.resetCount,
      width: layout.width,
      height: layout.height,
      texelCount: layout.texelCount,
      particleCount: layout.particleCount,
      pingPongByteLength,
      basePositionByteLength,
      trailByteLength,
      stateByteLength,
      stateSpace: 'model-local-position',
      lifecycleTimeModel: 'absolute-cycle-v1',
      lifecycleSeekDeterministic: true,
      motionSeekDeterministic: false,
      positionTexture: state.gpuCompute.getCurrentRenderTarget(state.positionVariable).texture,
      velocityTexture: state.gpuCompute.getCurrentRenderTarget(state.velocityVariable).texture,
      historyTextures,
      historySampleCount: historyTextures.length,
      historyCapacity: state.historyTargets.length,
      computeFrames: state.computeFrames,
      computeSteps: state.computeSteps,
      initializationSteps: state.initializationSteps,
      frameSteps: stepCount,
      delta: rawDelta,
      params: normalized
    };
  }
}
