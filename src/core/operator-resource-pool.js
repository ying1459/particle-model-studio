export const OPERATOR_RESOURCE_POOL_SCHEMA_VERSION = 1;

function finiteInteger(value, fallback = 0) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function normalizeDescriptorValue(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeDescriptorValue);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined && typeof item !== 'function')
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalizeDescriptorValue(item)])
    );
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === 'boolean' || typeof value === 'string' || value === null) {
    return value;
  }
  return String(value ?? '');
}

export function normalizeOperatorPoolDescriptor(descriptor = {}) {
  const normalized = normalizeDescriptorValue(descriptor);
  return {
    kind: String(normalized.kind || 'resource'),
    ...normalized,
    width: finiteInteger(normalized.width),
    height: finiteInteger(normalized.height),
    byteLength: finiteInteger(normalized.byteLength)
  };
}

export function createOperatorPoolKey(descriptor = {}) {
  return JSON.stringify(normalizeOperatorPoolDescriptor(descriptor));
}

export class OperatorResourcePoolError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'OperatorResourcePoolError';
    this.details = details;
  }
}

export class OperatorResourcePool {
  constructor(options = {}) {
    this.name = String(options.name || 'operator-resource-pool');
    this.createResource = typeof options.create === 'function' ? options.create : null;
    this.disposeResource = typeof options.dispose === 'function' ? options.dispose : null;
    this.resetResource = typeof options.reset === 'function' ? options.reset : null;
    this.entries = [];
    this.leases = new Map();
    this.entrySerial = 0;
    this.leaseSerial = 0;
    this.frame = 0;
    this.scope = 'default';
    this.totalAllocations = 0;
    this.totalReuses = 0;
    this.totalReleases = 0;
    this.frameStats = this.createFrameStats();
  }

  createFrameStats() {
    return {
      acquisitions: 0,
      allocations: 0,
      reuses: 0,
      releases: 0,
      peakActiveLeases: 0
    };
  }

  beginFrame(options = {}) {
    if (this.leases.size) {
      throw new OperatorResourcePoolError(
        `Pool ${this.name} cannot begin a new frame with ${this.leases.size} active lease(s).`,
        { activeLeaseIds: [...this.leases.keys()] }
      );
    }
    this.scope = String(options.scope || 'default');
    this.frame = finiteInteger(options.frame);
    this.frameStats = this.createFrameStats();
    return this;
  }

  adopt(resource, descriptor = {}, options = {}) {
    if (!resource || typeof resource !== 'object') {
      throw new OperatorResourcePoolError('Cannot adopt an empty resource.');
    }
    if (this.entries.some((entry) => entry.resource === resource)) {
      throw new OperatorResourcePoolError('Resource is already registered in this pool.');
    }
    const normalized = normalizeOperatorPoolDescriptor(descriptor);
    const entry = {
      id: `${this.name}:entry:${++this.entrySerial}`,
      key: createOperatorPoolKey(normalized),
      descriptor: normalized,
      resource,
      owned: Boolean(options.owned),
      label: String(options.label || ''),
      refCount: 0,
      acquisitionCount: 0,
      lastScope: '',
      lastFrame: 0
    };
    this.entries.push(entry);
    return entry.id;
  }

  acquire(descriptor = {}, options = {}) {
    const normalized = normalizeOperatorPoolDescriptor(descriptor);
    const key = createOperatorPoolKey(normalized);
    let entry = this.entries.find((item) => item.key === key && item.refCount === 0);
    let allocated = false;
    if (!entry) {
      if (!this.createResource) {
        throw new OperatorResourcePoolError(
          `Pool ${this.name} has no free resource for ${key} and no factory.`,
          { descriptor: normalized }
        );
      }
      const resource = this.createResource(normalized, {
        pool: this,
        ownerNodeId: String(options.ownerNodeId || ''),
        label: String(options.label || '')
      });
      if (!resource || typeof resource !== 'object') {
        throw new OperatorResourcePoolError(`Pool ${this.name} factory returned an invalid resource.`);
      }
      const entryId = this.adopt(resource, normalized, {
        owned: true,
        label: options.label
      });
      entry = this.entries.find((item) => item.id === entryId);
      allocated = true;
      this.totalAllocations += 1;
      this.frameStats.allocations += 1;
    } else {
      this.totalReuses += 1;
      this.frameStats.reuses += 1;
      this.resetResource?.(entry.resource, normalized, { pool: this, entry });
    }
    entry.refCount += 1;
    entry.acquisitionCount += 1;
    entry.lastScope = this.scope;
    entry.lastFrame = this.frame;
    const leaseId = `${this.name}:lease:${++this.leaseSerial}`;
    const lease = {
      id: leaseId,
      entryId: entry.id,
      resource: entry.resource,
      descriptor: { ...normalized },
      ownerNodeId: String(options.ownerNodeId || ''),
      label: String(options.label || entry.label || ''),
      allocated,
      released: false,
      release: () => this.release(leaseId)
    };
    this.leases.set(leaseId, lease);
    this.frameStats.acquisitions += 1;
    this.frameStats.peakActiveLeases = Math.max(this.frameStats.peakActiveLeases, this.leases.size);
    return lease;
  }

  retain(leaseOrId) {
    const leaseId = typeof leaseOrId === 'string' ? leaseOrId : leaseOrId?.id;
    const lease = this.leases.get(leaseId);
    if (!lease || lease.released) {
      throw new OperatorResourcePoolError(`Cannot retain inactive lease ${leaseId || ''}.`);
    }
    const entry = this.entries.find((item) => item.id === lease.entryId);
    entry.refCount += 1;
    return entry.refCount;
  }

  release(leaseOrId) {
    const leaseId = typeof leaseOrId === 'string' ? leaseOrId : leaseOrId?.id;
    const lease = this.leases.get(leaseId);
    if (!lease || lease.released) {
      throw new OperatorResourcePoolError(`Cannot release inactive lease ${leaseId || ''}.`);
    }
    const entry = this.entries.find((item) => item.id === lease.entryId);
    entry.refCount = Math.max(0, entry.refCount - 1);
    if (entry.refCount > 0) {
      return entry.refCount;
    }
    lease.released = true;
    this.leases.delete(leaseId);
    this.totalReleases += 1;
    this.frameStats.releases += 1;
    return 0;
  }

  endFrame(options = {}) {
    const strict = options.strict !== false;
    if (this.leases.size && strict) {
      throw new OperatorResourcePoolError(
        `Pool ${this.name} ended frame ${this.frame} with ${this.leases.size} leaked lease(s).`,
        { activeLeaseIds: [...this.leases.keys()] }
      );
    }
    if (!strict) {
      [...this.leases.keys()].forEach((leaseId) => {
        const lease = this.leases.get(leaseId);
        const entry = this.entries.find((item) => item.id === lease.entryId);
        entry.refCount = 1;
        this.release(leaseId);
      });
    }
    return this.getStats();
  }

  getStats() {
    return {
      schemaVersion: OPERATOR_RESOURCE_POOL_SCHEMA_VERSION,
      name: this.name,
      scope: this.scope,
      frame: this.frame,
      entryCount: this.entries.length,
      ownedEntryCount: this.entries.filter((entry) => entry.owned).length,
      adoptedEntryCount: this.entries.filter((entry) => !entry.owned).length,
      activeLeaseCount: this.leases.size,
      totalAllocations: this.totalAllocations,
      totalReuses: this.totalReuses,
      totalReleases: this.totalReleases,
      ...this.frameStats,
      entries: this.entries.map((entry) => ({
        id: entry.id,
        key: entry.key,
        descriptor: { ...entry.descriptor },
        owned: entry.owned,
        label: entry.label,
        refCount: entry.refCount,
        acquisitionCount: entry.acquisitionCount,
        lastScope: entry.lastScope,
        lastFrame: entry.lastFrame
      }))
    };
  }

  dispose(options = {}) {
    if (this.leases.size && !options.force) {
      throw new OperatorResourcePoolError(
        `Pool ${this.name} cannot dispose with active leases.`,
        { activeLeaseIds: [...this.leases.keys()] }
      );
    }
    if (options.force) {
      this.endFrame({ strict: false });
    }
    this.entries.forEach((entry) => {
      if (entry.owned || options.includeAdopted) {
        this.disposeResource?.(entry.resource, entry.descriptor, { pool: this, entry });
      }
    });
    this.entries = [];
    this.leases.clear();
  }
}
