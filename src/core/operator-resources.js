export const OPERATOR_RESOURCE_SCHEMA_VERSION = 1;

export const OPERATOR_RESOURCE_KINDS = Object.freeze([
  'texture',
  'depth',
  'geometry',
  'points',
  'camera',
  'data'
]);

const RESOURCE_KIND_SET = new Set(OPERATOR_RESOURCE_KINDS);
const RESOURCE_BRAND = Symbol('particle-model-studio-operator-resource');
const PERSISTENT_RESOURCE_KINDS = new Set(['geometry', 'points', 'camera', 'data']);

function finiteSize(value, fallback = 1) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function finiteCount(value, fallback = 0) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function normalizeLifetime(value, kind) {
  if (value === 'frame' || value === 'persistent') {
    return value;
  }
  return PERSISTENT_RESOURCE_KINDS.has(kind) ? 'persistent' : 'frame';
}

function defaultColorSpace(kind) {
  if (kind === 'depth') return 'depth';
  if (kind === 'texture') return 'linear-hdr';
  return 'none';
}

function defaultFormat(kind) {
  if (kind === 'depth') return 'depth32';
  if (kind === 'texture') return 'rgba16f';
  if (kind === 'points') return 'points-f32';
  if (kind === 'geometry') return 'geometry';
  if (kind === 'camera') return 'camera';
  return 'data';
}

function plainMetadata(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {};
}

export class OperatorResourceError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'OperatorResourceError';
    this.details = details;
  }
}

export function isOperatorResource(value, kind) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    value[RESOURCE_BRAND] === true &&
    (!kind || value.kind === kind)
  );
}

export function assertOperatorResource(value, kind, label = 'Operator resource') {
  if (!isOperatorResource(value, kind)) {
    throw new OperatorResourceError(
      `${label} must be a ${kind || 'valid'} operator resource.`,
      { expectedKind: kind || '', actualKind: value?.kind || '' }
    );
  }
  return value;
}

export function describeOperatorResource(resource) {
  if (!isOperatorResource(resource)) {
    return null;
  }
  return {
    id: resource.id,
    schemaVersion: resource.schemaVersion,
    kind: resource.kind,
    scope: resource.scope,
    frame: resource.frame,
    producerNodeId: resource.producerNodeId,
    producerPortId: resource.producerPortId,
    lifetime: resource.lifetime,
    width: resource.width,
    height: resource.height,
    count: resource.count,
    byteLength: resource.byteLength,
    colorSpace: resource.colorSpace,
    format: resource.format,
    revision: resource.revision,
    metadata: { ...resource.metadata }
  };
}

export class OperatorResourceTracker {
  constructor() {
    this.serial = 0;
    this.revision = 0;
    this.scope = 'default';
    this.frame = 0;
    this.resources = [];
    this.passes = [];
    this.pools = [];
    this.lifetime = null;
  }

  beginFrame(options = {}) {
    this.scope = String(options.scope || 'default');
    this.frame = Math.max(0, Math.floor(Number(options.frame) || 0));
    this.resources = [];
    this.passes = [];
    this.pools = [];
    this.lifetime = null;
    return this;
  }

  create(kind, options = {}) {
    if (!RESOURCE_KIND_SET.has(kind)) {
      throw new OperatorResourceError(`Unsupported operator resource kind: ${kind}.`, { kind });
    }
    const producerNodeId = String(options.producerNodeId || 'runtime');
    const producerPortId = String(options.producerPortId || kind);
    let released = false;
    const release = typeof options.release === 'function'
      ? () => {
          if (released) return false;
          released = true;
          options.release();
          return true;
        }
      : null;
    const resource = {
      [RESOURCE_BRAND]: true,
      schemaVersion: OPERATOR_RESOURCE_SCHEMA_VERSION,
      id: `${this.scope}:${this.frame}:${producerNodeId}:${producerPortId}:${++this.serial}`,
      kind,
      scope: this.scope,
      frame: this.frame,
      producerNodeId,
      producerPortId,
      lifetime: normalizeLifetime(options.lifetime, kind),
      width: finiteSize(options.width ?? options.target?.width ?? options.texture?.image?.width),
      height: finiteSize(options.height ?? options.target?.height ?? options.texture?.image?.height),
      count: finiteCount(options.count),
      byteLength: finiteCount(options.byteLength),
      colorSpace: String(options.colorSpace || defaultColorSpace(kind)),
      format: String(options.format || defaultFormat(kind)),
      revision: ++this.revision,
      target: options.target || null,
      texture: options.texture || options.target?.texture || null,
      buffer: options.buffer || null,
      geometry: options.geometry || null,
      object: options.object || null,
      payload: options.payload || null,
      metadata: plainMetadata(options.metadata),
      release,
      get released() {
        return released;
      }
    };
    this.resources.push(resource);
    return resource;
  }

  passthrough(resource, options = {}) {
    assertOperatorResource(resource, options.kind, options.label);
    this.reference(resource);
    return resource;
  }

  reference(resource) {
    assertOperatorResource(resource);
    if (!this.resources.some((item) => item.id === resource.id)) {
      this.resources.push(resource);
    }
    return resource;
  }

  recordPass(options = {}) {
    const inputs = (options.inputs || []).filter((resource) => isOperatorResource(resource));
    const outputs = (options.outputs || []).filter((resource) => isOperatorResource(resource));
    [...inputs, ...outputs].forEach((resource) => this.reference(resource));
    const pass = {
      nodeId: String(options.nodeId || ''),
      type: String(options.type || ''),
      skipped: Boolean(options.skipped),
      reason: String(options.reason || ''),
      inputResourceIds: inputs
        .map((resource) => describeOperatorResource(resource)?.id)
        .filter(Boolean),
      outputResourceIds: outputs
        .map((resource) => describeOperatorResource(resource)?.id)
        .filter(Boolean),
      durationMs: Number(Math.max(0, Number(options.durationMs) || 0).toFixed(3))
    };
    this.passes.push(pass);
    return pass;
  }

  recordPoolStats(stats) {
    if (!stats || typeof stats !== 'object') {
      return null;
    }
    const snapshot = JSON.parse(JSON.stringify(stats));
    const index = this.pools.findIndex((item) => item.name === snapshot.name);
    if (index >= 0) {
      this.pools[index] = snapshot;
    } else {
      this.pools.push(snapshot);
    }
    return snapshot;
  }

  recordLifetimeStats(stats) {
    if (!stats || typeof stats !== 'object') {
      return null;
    }
    this.lifetime = JSON.parse(JSON.stringify(stats));
    return this.lifetime;
  }

  getStats() {
    return {
      schemaVersion: OPERATOR_RESOURCE_SCHEMA_VERSION,
      scope: this.scope,
      frame: this.frame,
      resourceCount: this.resources.length,
      passCount: this.passes.length,
      poolCount: this.pools.length,
      lifetime: this.lifetime ? JSON.parse(JSON.stringify(this.lifetime)) : null,
      resources: this.resources.map(describeOperatorResource),
      passes: this.passes.map((pass) => ({
        ...pass,
        inputResourceIds: [...pass.inputResourceIds],
        outputResourceIds: [...pass.outputResourceIds]
      })),
      pools: this.pools.map((pool) => JSON.parse(JSON.stringify(pool)))
    };
  }
}
