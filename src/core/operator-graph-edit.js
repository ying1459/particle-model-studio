import {
  BUILTIN_OPERATOR_DEFINITIONS,
  OperatorGraphError,
  cloneOperatorGraph,
  normalizeOperatorGraph,
  validateOperatorGraph
} from './operator-graph.js';

export class OperatorGraphEditError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'OperatorGraphEditError';
    this.details = details;
  }
}

function definitionFor(type, definitions = BUILTIN_OPERATOR_DEFINITIONS) {
  const definition = definitions?.[type];
  if (!definition) {
    throw new OperatorGraphEditError(`Unknown operator type: ${type}.`, { type });
  }
  return definition;
}

function uniqueId(prefix, usedIds) {
  const safePrefix = String(prefix || 'item')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'item';
  if (!usedIds.has(safePrefix)) {
    return safePrefix;
  }
  let index = 2;
  while (usedIds.has(`${safePrefix}-${index}`)) {
    index += 1;
  }
  return `${safePrefix}-${index}`;
}

function asCustomGraph(inputGraph) {
  const graph = normalizeOperatorGraph(inputGraph);
  graph.metadata = { ...graph.metadata, mode: 'graph', synchronized: false };
  return graph;
}

function assertNode(graph, nodeId) {
  const node = graph.nodes.find((item) => item.id === String(nodeId));
  if (!node) {
    throw new OperatorGraphEditError(`Unknown operator node: ${nodeId}.`, { nodeId });
  }
  return node;
}

function assertEditedGraph(graph, definitions) {
  const validation = validateOperatorGraph(graph, { definitions });
  if (!validation.valid) {
    throw new OperatorGraphError(validation.errors[0]?.message || 'Invalid operator graph edit.', validation);
  }
  return graph;
}

function portFor(definition, direction, portId) {
  return definition?.[direction]?.find((port) => port.id === String(portId));
}

function portsCompatible(output, input) {
  return output.type === 'any' || input.type === 'any' || output.type === input.type;
}

export function addOperatorNode(inputGraph, type, options = {}) {
  const definitions = options.definitions || BUILTIN_OPERATOR_DEFINITIONS;
  const definition = definitionFor(type, definitions);
  const graph = asCustomGraph(inputGraph);
  const usedIds = new Set(graph.nodes.map((node) => node.id));
  const preferredId = options.id || String(type).split('.').at(-1) || 'node';
  const id = uniqueId(preferredId, usedIds);
  graph.nodes.push({
    id,
    type: definition.type || type,
    label: options.label || definition.label,
    position: {
      x: Math.max(0, Math.round(Number(options.position?.x) || 0)),
      y: Math.max(0, Math.round(Number(options.position?.y) || 0))
    },
    params: options.params && typeof options.params === 'object'
      ? structuredClone(options.params)
      : structuredClone(definition.defaultParams || {}),
    enabled: options.enabled !== false,
    bypass: Boolean(options.bypass),
    metadata: options.metadata && typeof options.metadata === 'object' ? structuredClone(options.metadata) : {}
  });
  return { graph: assertEditedGraph(graph, definitions), nodeId: id };
}

export function duplicateOperatorNode(inputGraph, nodeId, options = {}) {
  const sourceGraph = normalizeOperatorGraph(inputGraph);
  const source = assertNode(sourceGraph, nodeId);
  return addOperatorNode(sourceGraph, source.type, {
    ...options,
    label: options.label || `${source.label || source.type} Copy`,
    position: options.position || {
      x: Number(source.position.x) + 36,
      y: Number(source.position.y) + 36
    },
    params: structuredClone(source.params),
    enabled: source.enabled,
    bypass: source.bypass,
    metadata: source.metadata
  });
}

export function removeOperatorNode(inputGraph, nodeId, options = {}) {
  const graph = asCustomGraph(inputGraph);
  assertNode(graph, nodeId);
  if (options.protectedNodeIds?.includes(String(nodeId))) {
    throw new OperatorGraphEditError(`Operator node ${nodeId} is protected.`, { nodeId });
  }
  graph.nodes = graph.nodes.filter((node) => node.id !== String(nodeId));
  graph.edges = graph.edges.filter((edge) => edge.from.node !== String(nodeId) && edge.to.node !== String(nodeId));
  return assertEditedGraph(graph, options.definitions);
}

export function moveOperatorNode(inputGraph, nodeId, position) {
  const graph = asCustomGraph(inputGraph);
  const node = assertNode(graph, nodeId);
  node.position = {
    x: Math.max(0, Math.round(Number(position?.x) || 0)),
    y: Math.max(0, Math.round(Number(position?.y) || 0))
  };
  return graph;
}

export function updateOperatorNodeParams(inputGraph, nodeId, patch, options = {}) {
  const graph = asCustomGraph(inputGraph);
  const node = assertNode(graph, nodeId);
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new OperatorGraphEditError('Operator parameter patch must be an object.', { nodeId });
  }
  node.params = options.replace ? structuredClone(patch) : { ...node.params, ...structuredClone(patch) };
  return graph;
}

export function setOperatorNodeBypass(inputGraph, nodeId, bypass) {
  const graph = asCustomGraph(inputGraph);
  assertNode(graph, nodeId).bypass = Boolean(bypass);
  return graph;
}

export function connectOperatorPorts(inputGraph, connection, options = {}) {
  const definitions = options.definitions || BUILTIN_OPERATOR_DEFINITIONS;
  const graph = asCustomGraph(inputGraph);
  const fromNode = assertNode(graph, connection?.from?.node);
  const toNode = assertNode(graph, connection?.to?.node);
  const output = portFor(definitionFor(fromNode.type, definitions), 'outputs', connection?.from?.port);
  const input = portFor(definitionFor(toNode.type, definitions), 'inputs', connection?.to?.port);
  if (!output || !input) {
    throw new OperatorGraphEditError('Cannot connect a missing operator port.', {
      from: connection?.from,
      to: connection?.to
    });
  }
  if (!portsCompatible(output, input)) {
    throw new OperatorGraphEditError(`Cannot connect ${output.type} to ${input.type}.`, {
      fromType: output.type,
      toType: input.type
    });
  }

  const duplicate = graph.edges.find((edge) => (
    edge.from.node === fromNode.id &&
    edge.from.port === output.id &&
    edge.to.node === toNode.id &&
    edge.to.port === input.id
  ));
  if (duplicate) {
    return { graph, edgeId: duplicate.id, replacedEdgeIds: [] };
  }

  const replacedEdgeIds = [];
  if (!input.multiple && options.replaceInput !== false) {
    graph.edges = graph.edges.filter((edge) => {
      const replace = edge.to.node === toNode.id && edge.to.port === input.id;
      if (replace) replacedEdgeIds.push(edge.id);
      return !replace;
    });
  }
  const edgeId = uniqueId(
    options.id || `${fromNode.id}-${output.id}-to-${toNode.id}-${input.id}`,
    new Set(graph.edges.map((edge) => edge.id))
  );
  graph.edges.push({
    id: edgeId,
    from: { node: fromNode.id, port: output.id },
    to: { node: toNode.id, port: input.id },
    enabled: options.enabled !== false,
    feedback: Boolean(options.feedback),
    metadata: options.metadata && typeof options.metadata === 'object' ? structuredClone(options.metadata) : {}
  });
  return {
    graph: assertEditedGraph(graph, definitions),
    edgeId,
    replacedEdgeIds
  };
}

export function disconnectOperatorEdge(inputGraph, edgeId, options = {}) {
  const graph = asCustomGraph(inputGraph);
  const previousLength = graph.edges.length;
  graph.edges = graph.edges.filter((edge) => edge.id !== String(edgeId));
  if (graph.edges.length === previousLength) {
    throw new OperatorGraphEditError(`Unknown operator edge: ${edgeId}.`, { edgeId });
  }
  return assertEditedGraph(graph, options.definitions);
}

export class OperatorGraphHistory {
  constructor(graph, options = {}) {
    this.limit = Math.max(2, Math.floor(Number(options.limit) || 80));
    this.reset(graph);
  }

  reset(graph) {
    this.entries = [cloneOperatorGraph(graph)];
    this.index = 0;
    return this.current();
  }

  current() {
    return cloneOperatorGraph(this.entries[this.index]);
  }

  commit(graph) {
    const next = cloneOperatorGraph(graph);
    if (JSON.stringify(next) === JSON.stringify(this.entries[this.index])) {
      return this.current();
    }
    this.entries = this.entries.slice(0, this.index + 1);
    this.entries.push(next);
    if (this.entries.length > this.limit) {
      this.entries.shift();
    }
    this.index = this.entries.length - 1;
    return this.current();
  }

  canUndo() {
    return this.index > 0;
  }

  canRedo() {
    return this.index < this.entries.length - 1;
  }

  undo() {
    if (this.canUndo()) this.index -= 1;
    return this.current();
  }

  redo() {
    if (this.canRedo()) this.index += 1;
    return this.current();
  }
}
