import {
  compileOperatorGraph,
  normalizeOperatorGraph,
  validateOperatorGraph
} from './operator-graph.js';

export class OperatorRuntimeError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'OperatorRuntimeError';
    this.details = details;
  }
}

function nowMs() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function stableSerialize(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      return JSON.stringify(String(value));
    }
    return JSON.stringify(value);
  }
  if (seen.has(value)) {
    return '"[Circular]"';
  }
  seen.add(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item, seen)).join(',')}]`;
  }
  const entries = Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key], seen)}`);
  return `{${entries.join(',')}}`;
}

function topologySignature(graph) {
  return stableSerialize({
    nodes: graph.nodes.map((node) => ({ id: node.id, type: node.type, enabled: node.enabled })),
    edges: graph.edges.map((edge) => ({
      id: edge.id,
      from: edge.from,
      to: edge.to,
      enabled: edge.enabled,
      feedback: edge.feedback
    }))
  });
}

function nodeSignature(node) {
  return stableSerialize({
    type: node.type,
    params: node.params,
    enabled: node.enabled,
    bypass: node.bypass
  });
}

function normalizeExecutor(executor) {
  if (typeof executor === 'function') {
    return { execute: executor, cacheable: true, alwaysDirty: false };
  }
  if (!executor || typeof executor.execute !== 'function') {
    throw new OperatorRuntimeError('Operator executor must be a function or an object with execute().');
  }
  return {
    execute: executor.execute,
    cacheable: executor.cacheable !== false,
    alwaysDirty: Boolean(executor.alwaysDirty)
  };
}

function normalizeExecutorRegistry(executors) {
  const registry = new Map();
  if (executors instanceof Map) {
    for (const [type, executor] of executors.entries()) {
      registry.set(type, normalizeExecutor(executor));
    }
  } else if (Array.isArray(executors)) {
    for (const item of executors) {
      if (item?.type) {
        registry.set(item.type, normalizeExecutor(item));
      }
    }
  } else if (executors && typeof executors === 'object') {
    for (const [type, executor] of Object.entries(executors)) {
      registry.set(type, normalizeExecutor(executor));
    }
  }
  return registry;
}

function cloneSerializable(value) {
  if (value === undefined) {
    return undefined;
  }
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      // Runtime values may contain GPU objects; diagnostics fall back to references.
    }
  }
  return value;
}

function collectDemandedNodeIds(targetNodeIds, activeEdges, enabledNodeIds) {
  if (targetNodeIds === undefined) {
    return new Set(enabledNodeIds);
  }
  const demanded = new Set(
    (targetNodeIds || []).map(String).filter((nodeId) => enabledNodeIds.has(nodeId))
  );
  const incoming = new Map([...enabledNodeIds].map((nodeId) => [nodeId, []]));
  for (const edge of activeEdges) {
    incoming.get(edge.to.node)?.push(edge.from.node);
  }
  const queue = [...demanded];
  while (queue.length) {
    const nodeId = queue.shift();
    for (const sourceNodeId of incoming.get(nodeId) || []) {
      if (!demanded.has(sourceNodeId)) {
        demanded.add(sourceNodeId);
        queue.push(sourceNodeId);
      }
    }
  }
  return demanded;
}

function outputPortKey(nodeId, portId) {
  return `${String(nodeId)}\u0000${String(portId)}`;
}

function hasReleasedRuntimeOutput(values) {
  return Object.values(values || {}).some((value) => {
    const items = Array.isArray(value) ? value : [value];
    return items.some((item) => Boolean(
      item && typeof item === 'object' && typeof item.release === 'function' && item.released === true
    ));
  });
}

export class OperatorGraphRuntime {
  constructor(options = {}) {
    this.definitions = options.definitions;
    this.executors = normalizeExecutorRegistry(options.executors);
    this.cache = new Map();
    this.feedbackValues = new Map();
    this.pendingDirtyNodeIds = new Set();
    this.lastNodeSignatures = new Map();
    this.lastTopologySignature = '';
    this.version = 0;
    this.frame = 0;
    this.lastResult = null;
  }

  register(type, executor) {
    this.executors.set(String(type), normalizeExecutor(executor));
    this.invalidate([String(type)]);
    return this;
  }

  unregister(type) {
    this.executors.delete(String(type));
    return this;
  }

  clear() {
    this.cache.clear();
    this.feedbackValues.clear();
    this.pendingDirtyNodeIds.clear();
    this.lastNodeSignatures.clear();
    this.lastTopologySignature = '';
    this.lastResult = null;
  }

  invalidate(nodeIds) {
    const ids = new Set((nodeIds || []).map(String));
    for (const [nodeId, entry] of this.cache.entries()) {
      if (ids.has(nodeId) || ids.has(entry.type)) {
        this.cache.delete(nodeId);
        this.lastNodeSignatures.delete(nodeId);
        this.pendingDirtyNodeIds.add(nodeId);
      }
    }
  }

  getNodeOutput(nodeId, portId) {
    return this.cache.get(String(nodeId))?.values?.[portId];
  }

  getStats() {
    if (!this.lastResult) {
      return {
        frame: this.frame,
        cachedNodes: this.cache.size,
        executedNodeIds: [],
        cacheHitNodeIds: [],
        totalMs: 0,
        timings: []
      };
    }
    return cloneSerializable({
      frame: this.lastResult.frame,
      graphId: this.lastResult.graphId,
      scope: this.lastResult.scope,
      cachedNodes: this.cache.size,
      executedNodeIds: this.lastResult.executedNodeIds,
      cacheHitNodeIds: this.lastResult.cacheHitNodeIds,
      totalMs: this.lastResult.totalMs,
      timings: this.lastResult.timings,
      targetNodeIds: this.lastResult.targetNodeIds,
      demandedNodeIds: this.lastResult.demandedNodeIds,
      skippedUndemandedNodeIds: this.lastResult.skippedUndemandedNodeIds,
      feedbackUpdates: this.lastResult.feedbackUpdates,
      resourceLifetime: this.lastResult.resourceLifetime,
      pendingDirtyNodeIds: [...this.pendingDirtyNodeIds]
    });
  }

  execute(inputGraph, options = {}) {
    const startedAt = nowMs();
    const graph = normalizeOperatorGraph(inputGraph);
    const validation = validateOperatorGraph(graph, { definitions: this.definitions });
    if (!validation.valid) {
      throw new OperatorRuntimeError(
        validation.errors[0]?.message || 'Cannot execute an invalid operator graph.',
        { validation }
      );
    }

    const nextTopologySignature = topologySignature(graph);
    const topologyChanged = nextTopologySignature !== this.lastTopologySignature;
    if (topologyChanged) {
      this.cache.clear();
      this.feedbackValues.clear();
      this.pendingDirtyNodeIds.clear();
      this.lastNodeSignatures.clear();
      this.lastTopologySignature = nextTopologySignature;
    }

    const enabledNodes = graph.nodes.filter((node) => node.enabled);
    const enabledNodeIds = new Set(enabledNodes.map((node) => node.id));
    const dirtyNodeIds = new Set((options.dirtyNodeIds || []).map(String));
    for (const nodeId of this.pendingDirtyNodeIds) {
      dirtyNodeIds.add(nodeId);
    }
    this.pendingDirtyNodeIds.clear();

    for (const node of enabledNodes) {
      const executor = this.executors.get(node.type);
      if (!executor) {
        throw new OperatorRuntimeError(`No executor registered for operator type ${node.type}.`, {
          nodeId: node.id,
          nodeType: node.type
        });
      }
      const signature = nodeSignature(node);
      if (
        topologyChanged ||
        !this.cache.has(node.id) ||
        hasReleasedRuntimeOutput(this.cache.get(node.id)?.values) ||
        signature !== this.lastNodeSignatures.get(node.id) ||
        executor.alwaysDirty ||
        !executor.cacheable
      ) {
        dirtyNodeIds.add(node.id);
      }
      this.lastNodeSignatures.set(node.id, signature);
    }

    const plan = compileOperatorGraph(graph, {
      definitions: this.definitions,
      dirtyNodeIds: [...dirtyNodeIds]
    });
    const incomingByNode = new Map(enabledNodes.map((node) => [node.id, []]));
    const activeEdges = graph.edges.filter((edge) => (
      edge.enabled && enabledNodeIds.has(edge.from.node) && enabledNodeIds.has(edge.to.node)
    ));
    for (const edge of activeEdges) {
      incomingByNode.get(edge.to.node)?.push(edge);
    }

    const targetNodeIds = options.targetNodeIds === undefined
      ? undefined
      : [...new Set((options.targetNodeIds || []).map(String))];
    const demandedNodeIds = collectDemandedNodeIds(targetNodeIds, activeEdges, enabledNodeIds);
    const demandedSameFrameEdges = activeEdges.filter((edge) => (
      !edge.feedback &&
      demandedNodeIds.has(edge.from.node) &&
      demandedNodeIds.has(edge.to.node)
    ));
    const consumerCountByOutput = new Map();
    for (const edge of demandedSameFrameEdges) {
      const key = outputPortKey(edge.from.node, edge.from.port);
      consumerCountByOutput.set(key, (consumerCountByOutput.get(key) || 0) + 1);
    }

    const timings = [];
    const executedNodeIds = [];
    const executionSet = new Set(
      plan.executionNodeIds.filter((nodeId) => demandedNodeIds.has(nodeId))
    );
    const runtimeContext = options.context || {};
    const resourceLifetime = runtimeContext.resourceLifetime || null;
    this.frame += 1;

    for (const nodeId of plan.order) {
      if (!executionSet.has(nodeId)) {
        continue;
      }
      const node = graph.nodes.find((item) => item.id === nodeId);
      const executor = this.executors.get(node.type);
      const inputs = {};
      const inputVersions = {};
      const inputBindings = [];
      for (const edge of incomingByNode.get(nodeId) || []) {
        const sourceEntry = edge.feedback
          ? this.feedbackValues.get(edge.id)
          : this.cache.get(edge.from.node);
        const value = edge.feedback
          ? sourceEntry?.value
          : sourceEntry?.values?.[edge.from.port];
        const version = sourceEntry?.version || 0;
        if (!edge.feedback) {
          inputBindings.push({ edge, value });
        }
        if (inputs[edge.to.port] === undefined) {
          inputs[edge.to.port] = value;
          inputVersions[edge.to.port] = version;
        } else {
          inputs[edge.to.port] = Array.isArray(inputs[edge.to.port])
            ? [...inputs[edge.to.port], value]
            : [inputs[edge.to.port], value];
          inputVersions[edge.to.port] = Array.isArray(inputVersions[edge.to.port])
            ? [...inputVersions[edge.to.port], version]
            : [inputVersions[edge.to.port], version];
        }
      }

      const nodeStartedAt = nowMs();
      let values;
      try {
        values = executor.execute({
          node,
          inputs,
          inputVersions,
          context: runtimeContext,
          frame: this.frame,
          graph,
          plan,
          runtime: this
        });
      } catch (error) {
        throw new OperatorRuntimeError(
          `Operator ${node.id} (${node.type}) failed: ${error?.message || error}.`,
          { nodeId: node.id, nodeType: node.type, cause: error }
        );
      }
      if (values && typeof values.then === 'function') {
        throw new OperatorRuntimeError(
          `Operator ${node.id} returned a Promise in the synchronous runtime.`,
          { nodeId: node.id, nodeType: node.type }
        );
      }
      if (values === undefined) {
        values = {};
      }
      if (!values || typeof values !== 'object' || Array.isArray(values)) {
        throw new OperatorRuntimeError(
          `Operator ${node.id} must return an output object.`,
          { nodeId: node.id, nodeType: node.type }
        );
      }
      try {
        for (const [portId, value] of Object.entries(values)) {
          resourceLifetime?.publish?.({
            nodeId: node.id,
            portId,
            value,
            consumerCount: consumerCountByOutput.get(outputPortKey(node.id, portId)) || 0
          });
        }
        for (const binding of inputBindings) {
          resourceLifetime?.consume?.({
            nodeId: node.id,
            portId: binding.edge.to.port,
            sourceNodeId: binding.edge.from.node,
            sourcePortId: binding.edge.from.port,
            edgeId: binding.edge.id,
            value: binding.value
          });
        }
      } catch (error) {
        throw new OperatorRuntimeError(
          `Operator ${node.id} (${node.type}) resource lifetime failed: ${error?.message || error}.`,
          { nodeId: node.id, nodeType: node.type, cause: error }
        );
      }
      const durationMs = nowMs() - nodeStartedAt;
      const version = ++this.version;
      this.cache.set(node.id, {
        nodeId: node.id,
        type: node.type,
        values,
        version,
        inputVersions,
        durationMs,
        frame: this.frame
      });
      timings.push({ nodeId: node.id, type: node.type, durationMs: Number(durationMs.toFixed(3)), cached: false });
      executedNodeIds.push(node.id);
    }

    const feedbackUpdates = [];
    for (const edge of activeEdges.filter((item) => item.feedback)) {
      const sourceEntry = this.cache.get(edge.from.node);
      if (!sourceEntry) {
        continue;
      }
      const previous = this.feedbackValues.get(edge.id);
      const next = {
        value: sourceEntry.values?.[edge.from.port],
        version: sourceEntry.version
      };
      this.feedbackValues.set(edge.id, next);
      if (previous?.version !== next.version) {
        this.pendingDirtyNodeIds.add(edge.to.node);
        feedbackUpdates.push({ edgeId: edge.id, targetNodeId: edge.to.node, version: next.version });
      }
    }

    const cacheHitNodeIds = plan.order.filter((nodeId) => (
      demandedNodeIds.has(nodeId) && !executionSet.has(nodeId) && this.cache.has(nodeId)
    ));
    const skippedUndemandedNodeIds = plan.order.filter((nodeId) => !demandedNodeIds.has(nodeId));
    const totalMs = nowMs() - startedAt;
    this.lastResult = {
      frame: this.frame,
      graphId: graph.id,
      scope: runtimeContext.scope || 'default',
      plan,
      validation,
      executedNodeIds,
      cacheHitNodeIds,
      timings,
      totalMs: Number(totalMs.toFixed(3)),
      topologyChanged,
      targetNodeIds: targetNodeIds || [],
      demandedNodeIds: plan.order.filter((nodeId) => demandedNodeIds.has(nodeId)),
      skippedUndemandedNodeIds,
      feedbackUpdates,
      resourceLifetime: resourceLifetime?.getStats?.() || null
    };
    return this.lastResult;
  }
}
