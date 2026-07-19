export const DEFAULT_FLOW_STYLE = 'fluid-ribbon';
export const DEFAULT_FLOW_CHARACTER = 0.28;
export const DEFAULT_FLOW_DIRECTION_PRESET = 'auto';

export const FLOW_STYLE_IDS = Object.freeze({
  'fluid-ribbon': 0,
  'weathered-dust': 1,
  'energy-burst': 2
});

export const FLOW_STYLES = Object.freeze(Object.keys(FLOW_STYLE_IDS));
export const FLOW_DIRECTION_PRESETS = Object.freeze([
  'auto',
  'left',
  'right',
  'up',
  'down',
  'forward',
  'backward',
  'custom'
]);

export const FLOW_STYLE_PRESETS = Object.freeze({
  'fluid-ribbon': Object.freeze({
    noise: 0.24,
    noiseScale: 2.2,
    swirl: 0.16,
    dissolveSpread: 1.8,
    dissolveEdgeWidth: 0.24,
    dissolveTurbulence: 0.85,
    dissolveCurl: 1.6,
    dissolveMist: 0.22,
    dissolveLift: 0.18,
    organicFlow: 0.72,
    edgeBreak: 0.28,
    filamentLength: 1.7,
    filamentCurl: 1.4
  }),
  'weathered-dust': Object.freeze({
    noise: 0.52,
    noiseScale: 1.15,
    swirl: 0.06,
    dissolveSpread: 1.25,
    dissolveEdgeWidth: 0.32,
    dissolveTurbulence: 1.3,
    dissolveCurl: 0.55,
    dissolveMist: 0.84,
    dissolveLift: 0.38,
    organicFlow: 0.34,
    edgeBreak: 0.72,
    filamentLength: 0.3,
    filamentCurl: 0.4
  }),
  'energy-burst': Object.freeze({
    noise: 0.42,
    noiseScale: 1.35,
    swirl: 0.32,
    dissolveSpread: 3.2,
    dissolveEdgeWidth: 0.14,
    dissolveTurbulence: 1.75,
    dissolveCurl: 2.25,
    dissolveMist: 0.42,
    dissolveLift: 0.12,
    organicFlow: 0.46,
    edgeBreak: 0.54,
    filamentLength: 0.9,
    filamentCurl: 1.75
  })
});

const FLOW_DIRECTION_VECTORS = Object.freeze({
  auto: Object.freeze([0.82, 0.18, -0.22]),
  left: Object.freeze([-1, 0, 0]),
  right: Object.freeze([1, 0, 0]),
  up: Object.freeze([0, 1, 0]),
  down: Object.freeze([0, -1, 0]),
  forward: Object.freeze([0, 0, 1]),
  backward: Object.freeze([0, 0, -1])
});

const FLOW_SHAPING_FIELDS = Object.freeze(Object.keys(FLOW_STYLE_PRESETS[DEFAULT_FLOW_STYLE]));

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function normalizeFlowStyle(value, fallback = DEFAULT_FLOW_STYLE) {
  return FLOW_STYLES.includes(value) ? value : fallback;
}

export function normalizeFlowCharacter(value, fallback = DEFAULT_FLOW_CHARACTER) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? clamp(numeric, 0, 1) : fallback;
}

export function normalizeFlowDirectionPreset(value, fallback = DEFAULT_FLOW_DIRECTION_PRESET) {
  return FLOW_DIRECTION_PRESETS.includes(value) ? value : fallback;
}

export function getFlowStyleId(value, options = {}) {
  if (options.legacy && value === undefined) {
    return -1;
  }
  return FLOW_STYLE_IDS[normalizeFlowStyle(value)];
}

export function getFlowQualityDetail(value) {
  if (value === 'low' || Number(value) <= 1) {
    return 1;
  }
  if (value === 'high' || Number(value) >= 3) {
    return 3;
  }
  return 2;
}

export function resolveFlowDirectionVector(preset, fallback = FLOW_DIRECTION_VECTORS.auto) {
  const normalized = normalizeFlowDirectionPreset(preset);
  const source = normalized === 'custom' ? fallback : FLOW_DIRECTION_VECTORS[normalized];
  const vector = Array.isArray(source) ? source.slice(0, 3).map(Number) : [...FLOW_DIRECTION_VECTORS.auto];
  if (vector.length !== 3 || vector.some((value) => !Number.isFinite(value))) {
    return [...FLOW_DIRECTION_VECTORS.auto];
  }
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  if (length < 0.000001) {
    return [...FLOW_DIRECTION_VECTORS.auto];
  }
  return vector.map((value) => value / length);
}

export function applyFlowStylePreset(options = {}, style = options.flowStyle) {
  const flowStyle = normalizeFlowStyle(style);
  return {
    ...options,
    ...FLOW_STYLE_PRESETS[flowStyle],
    flowStyle
  };
}

export function normalizeFlowEffectOptions(options = {}, settings = {}) {
  const creator = settings.creator !== false;
  const hasDirection = ['dissolveDirectionX', 'dissolveDirectionY', 'dissolveDirectionZ']
    .some((field) => Number.isFinite(Number(options[field])));
  const flowStyle = creator
    ? normalizeFlowStyle(options.flowStyle)
    : options.flowStyle === undefined
      ? undefined
      : normalizeFlowStyle(options.flowStyle);
  return {
    ...options,
    ...(flowStyle === undefined ? {} : { flowStyle }),
    flowCharacter: normalizeFlowCharacter(options.flowCharacter),
    flowDirectionPreset: normalizeFlowDirectionPreset(
      options.flowDirectionPreset,
      hasDirection ? 'custom' : DEFAULT_FLOW_DIRECTION_PRESET
    )
  };
}

export function getFlowShapingFields() {
  return [...FLOW_SHAPING_FIELDS];
}

export function advanceFlowPhase(phase, deltaSeconds, speed) {
  const current = Number.isFinite(Number(phase)) ? Number(phase) : 0;
  const delta = Math.max(0, Number(deltaSeconds) || 0);
  const rate = Math.max(0, Number(speed) || 0);
  return current + delta * rate;
}

export function integrateLinearSpeed(timeSeconds, keyframes = [], fallbackSpeed = 0) {
  const time = Math.max(0, Number(timeSeconds) || 0);
  const fallback = Math.max(0, Number(fallbackSpeed) || 0);
  const points = keyframes
    .map((keyframe) => ({
      time: Math.max(0, Number(keyframe?.time) || 0),
      value: Math.max(0, Number(keyframe?.value) || 0)
    }))
    .sort((a, b) => a.time - b.time);
  if (!points.length) {
    return time * fallback;
  }

  let area = 0;
  let cursor = 0;
  let speed = points[0].value;
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    if (point.time <= cursor) {
      speed = point.value;
      continue;
    }
    const segmentEnd = Math.min(time, point.time);
    if (segmentEnd > cursor) {
      if (index === 0) {
        area += (segmentEnd - cursor) * speed;
      } else {
        const previous = points[index - 1];
        const duration = Math.max(point.time - previous.time, 0.000001);
        const startT = clamp((cursor - previous.time) / duration, 0, 1);
        const endT = clamp((segmentEnd - previous.time) / duration, 0, 1);
        const startSpeed = previous.value + (point.value - previous.value) * startT;
        const endSpeed = previous.value + (point.value - previous.value) * endT;
        area += (segmentEnd - cursor) * (startSpeed + endSpeed) * 0.5;
      }
      cursor = segmentEnd;
    }
    if (time <= point.time) {
      return area;
    }
    speed = point.value;
  }
  if (time > cursor) {
    area += (time - cursor) * speed;
  }
  return area;
}
