export const OPERATOR_RESOURCE_LIFETIME_SCHEMA_VERSION = 1;

function finiteCount(value, fallback = 0) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function resourceLabel(resource, fallback) {
  return String(resource?.id || resource?.name || fallback || 'managed-resource');
}

export class OperatorResourceLifetimeError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'OperatorResourceLifetimeError';
    this.details = details;
  }
}

export class OperatorResourceLifetime {
  constructor(options = {}) {
    this.isManagedResource = typeof options.isManagedResource === 'function'
      ? options.isManagedResource
      : (resource) => Boolean(resource && typeof resource === 'object' && typeof resource.release === 'function');
    this.releaseResource = typeof options.releaseResource === 'function'
      ? options.releaseResource
      : (resource) => resource.release();
    this.entries = new Map();
    this.serial = 0;
    this.scope = 'default';
    this.frame = 0;
    this.aborted = false;
    this.stats = this.createStats();
  }

  createStats() {
    return {
      publications: 0,
      aliasPublications: 0,
      plannedConsumers: 0,
      consumedConsumers: 0,
      releases: 0,
      zeroConsumerReleases: 0,
      peakActiveResources: 0
    };
  }

  beginFrame(options = {}) {
    if ([...this.entries.values()].some((entry) => !entry.released)) {
      throw new OperatorResourceLifetimeError('Cannot begin a resource lifetime frame with active resources.');
    }
    this.entries.clear();
    this.scope = String(options.scope || 'default');
    this.frame = finiteCount(options.frame);
    this.aborted = false;
    this.stats = this.createStats();
    return this;
  }

  visit(value, callback) {
    if (Array.isArray(value)) {
      value.forEach((item) => this.visit(item, callback));
      return;
    }
    if (this.isManagedResource(value)) {
      callback(value);
    }
  }

  publish(options = {}) {
    const consumerCount = finiteCount(options.consumerCount);
    this.visit(options.value, (resource) => {
      let entry = this.entries.get(resource);
      if (entry?.released) {
        throw new OperatorResourceLifetimeError(
          `Cannot republish released resource ${entry.id}.`,
          { resourceId: entry.id, nodeId: String(options.nodeId || ''), portId: String(options.portId || '') }
        );
      }
      if (!entry) {
        const id = resourceLabel(resource, `${this.scope}:${this.frame}:resource:${++this.serial}`);
        entry = {
          id,
          resource,
          kind: String(resource?.kind || 'resource'),
          producerNodeId: String(options.nodeId || resource?.producerNodeId || ''),
          producerPortId: String(options.portId || resource?.producerPortId || ''),
          remainingConsumers: 0,
          publicationCount: 0,
          released: false,
          releaseReason: '',
          releasedByNodeId: ''
        };
        this.entries.set(resource, entry);
      } else {
        this.stats.aliasPublications += 1;
      }
      entry.publicationCount += 1;
      entry.remainingConsumers += consumerCount;
      this.stats.publications += 1;
      this.stats.plannedConsumers += consumerCount;
      this.stats.peakActiveResources = Math.max(
        this.stats.peakActiveResources,
        [...this.entries.values()].filter((item) => !item.released).length
      );
      if (entry.remainingConsumers === 0) {
        this.releaseEntry(entry, 'zero-consumer-output', options.nodeId);
        this.stats.zeroConsumerReleases += 1;
      }
    });
    return options.value;
  }

  consume(options = {}) {
    const count = Math.max(1, finiteCount(options.count, 1));
    this.visit(options.value, (resource) => {
      const entry = this.entries.get(resource);
      if (!entry || entry.released) {
        throw new OperatorResourceLifetimeError(
          `Cannot consume unpublished or released resource ${resourceLabel(resource)}.`,
          {
            resourceId: resourceLabel(resource),
            nodeId: String(options.nodeId || ''),
            portId: String(options.portId || '')
          }
        );
      }
      if (entry.remainingConsumers < count) {
        throw new OperatorResourceLifetimeError(
          `Resource ${entry.id} consumer count underflow.`,
          { resourceId: entry.id, remainingConsumers: entry.remainingConsumers, requested: count }
        );
      }
      entry.remainingConsumers -= count;
      this.stats.consumedConsumers += count;
      if (entry.remainingConsumers === 0) {
        this.releaseEntry(entry, 'last-consumer', options.nodeId);
      }
    });
    return options.value;
  }

  releaseEntry(entry, reason, nodeId = '') {
    if (entry.released) {
      return;
    }
    this.releaseResource(entry.resource, {
      reason,
      nodeId: String(nodeId || ''),
      entry,
      lifetime: this
    });
    entry.released = true;
    entry.releaseReason = String(reason || 'release');
    entry.releasedByNodeId = String(nodeId || '');
    this.stats.releases += 1;
  }

  abort(options = {}) {
    this.aborted = true;
    for (const entry of this.entries.values()) {
      if (!entry.released) {
        this.releaseEntry(entry, 'abort', options.nodeId);
      }
    }
    return this.getStats();
  }

  endFrame(options = {}) {
    const active = [...this.entries.values()].filter((entry) => !entry.released);
    if (active.length && options.strict !== false) {
      throw new OperatorResourceLifetimeError(
        `Resource lifetime ended frame ${this.frame} with ${active.length} active resource(s).`,
        { activeResourceIds: active.map((entry) => entry.id) }
      );
    }
    if (active.length) {
      this.abort();
    }
    return this.getStats();
  }

  getStats() {
    const entries = [...this.entries.values()];
    return {
      schemaVersion: OPERATOR_RESOURCE_LIFETIME_SCHEMA_VERSION,
      scope: this.scope,
      frame: this.frame,
      managedResourceCount: entries.length,
      activeResourceCount: entries.filter((entry) => !entry.released).length,
      aborted: this.aborted,
      ...this.stats,
      entries: entries.map((entry) => ({
        id: entry.id,
        kind: entry.kind,
        producerNodeId: entry.producerNodeId,
        producerPortId: entry.producerPortId,
        remainingConsumers: entry.remainingConsumers,
        publicationCount: entry.publicationCount,
        released: entry.released,
        releaseReason: entry.releaseReason,
        releasedByNodeId: entry.releasedByNodeId
      }))
    };
  }
}
