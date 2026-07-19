export const OPERATOR_GRAPH_SCHEMA_VERSION = 1;

export const OPERATOR_PORT_TYPES = Object.freeze([
  'any',
  'geometry',
  'points',
  'texture',
  'depth',
  'camera',
  'scene',
  'material',
  'signal',
  'data',
  'event'
]);

const PORT_TYPE_SET = new Set(OPERATOR_PORT_TYPES);

function port(id, type, options = {}) {
  return Object.freeze({
    id,
    type,
    required: options.required !== false,
    multiple: Boolean(options.multiple)
  });
}

function definition(type, label, category, inputs = [], outputs = [], options = {}) {
  return Object.freeze({
    type,
    label,
    category,
    inputs: Object.freeze(inputs),
    outputs: Object.freeze(outputs),
    defaultParams: Object.freeze({ ...(options.defaultParams || {}) })
  });
}

export const BUILTIN_OPERATOR_DEFINITIONS = Object.freeze({
  'core.feedback': definition(
    'core.feedback',
    'Feedback',
    'Core',
    [port('input', 'any')],
    [port('output', 'any')]
  ),
  'asset.model-input': definition(
    'asset.model-input',
    'Model Input',
    'Asset',
    [],
    [port('geometry', 'geometry')]
  ),
  'geometry.particle-sampler': definition(
    'geometry.particle-sampler',
    'Particle Sampler',
    'Geometry',
    [port('geometry', 'geometry')],
    [port('points', 'points')]
  ),
  'simulation.dissolve': definition(
    'simulation.dissolve',
    'Flow Dissolve',
    'Simulation',
    [port('points', 'points')],
    [port('points', 'points')],
    {
      defaultParams: {
        flowStyle: 'fluid-ribbon',
        flowCharacter: 0.28,
        flowDirectionPreset: 'auto'
      }
    }
  ),
  'simulation.force-field': definition(
    'simulation.force-field',
    'Force Field',
    'Simulation',
    [port('points', 'points')],
    [port('points', 'points')]
  ),
  'simulation.return-force': definition(
    'simulation.return-force',
    'Return / Repel',
    'Simulation',
    [port('points', 'points')],
    [port('points', 'points')]
  ),
  'simulation.emitter': definition(
    'simulation.emitter',
    'Emitter',
    'Simulation',
    [port('points', 'points')],
    [port('points', 'points')],
    {
      defaultParams: {
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
      }
    }
  ),
  'simulation.birth-life': definition(
    'simulation.birth-life',
    'Birth / Life',
    'Simulation',
    [port('points', 'points')],
    [port('points', 'points')],
    {
      defaultParams: {
        enabled: true,
        lifetimeMin: 3.96,
        lifetimeMax: 7.04,
        respawn: true,
        fadeIn: 0,
        fadeOut: 0.35
      }
    }
  ),
  'simulation.attractor': definition(
    'simulation.attractor',
    'Attractor',
    'Simulation',
    [port('points', 'points')],
    [port('points', 'points')],
    {
      defaultParams: {
        enabled: true,
        centerX: 0,
        centerY: 0,
        centerZ: 0,
        strength: 1,
        radius: 4,
        falloff: 2
      }
    }
  ),
  'simulation.collision-plane': definition(
    'simulation.collision-plane',
    'Plane Collision',
    'Simulation',
    [port('points', 'points')],
    [port('points', 'points')],
    {
      defaultParams: {
        enabled: true,
        normalX: 0,
        normalY: 1,
        normalZ: 0,
        offset: -1,
        restitution: 0.45,
        friction: 0.12
      }
    }
  ),
  'simulation.trail': definition(
    'simulation.trail',
    'Particle Trail',
    'Simulation',
    [port('points', 'points')],
    [port('points', 'points')],
    {
      defaultParams: {
        enabled: true,
        samples: 4,
        interval: 0.04,
        opacity: 0.38,
        fade: 1.6,
        size: 0.72
      }
    }
  ),
  'simulation.feedback-particles': definition(
    'simulation.feedback-particles',
    'Particle Feedback',
    'Simulation',
    [port('points', 'points')],
    [port('points', 'points')]
  ),
  'scene.camera': definition(
    'scene.camera',
    'Camera',
    'Scene',
    [],
    [port('camera', 'camera')]
  ),
  'render.particles': definition(
    'render.particles',
    'Particle Render',
    'Render',
    [port('points', 'points'), port('camera', 'camera')],
    [port('color', 'texture'), port('depth', 'depth')]
  ),
  'post.glow': definition(
    'post.glow',
    'Multi-scale Glow',
    'Post',
    [port('color', 'texture')],
    [port('color', 'texture')]
  ),
  'post.depth-of-field': definition(
    'post.depth-of-field',
    'Depth of Field',
    'Post',
    [port('color', 'texture'), port('depth', 'depth'), port('camera', 'camera')],
    [port('color', 'texture')],
    {
      defaultParams: {
        dofEnabled: true,
        aperture: 2.8,
        focusDistance: 7.18,
        samples: 24,
        bokehScale: 2.35,
        highlightGain: 0.72,
        blades: 7,
        roundness: 0.84
      }
    }
  ),
  'output.viewport': definition(
    'output.viewport',
    'Viewport Output',
    'Output',
    [port('color', 'texture')],
    []
  )
});

export class OperatorGraphError extends Error {
  constructor(message, diagnostics) {
    super(message);
    this.name = 'OperatorGraphError';
    this.diagnostics = diagnostics;
  }
}

function cloneValue(value) {
  if (value === undefined) {
    return undefined;
  }
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function finitePosition(position) {
  return {
    x: Number.isFinite(Number(position?.x)) ? Number(position.x) : 0,
    y: Number.isFinite(Number(position?.y)) ? Number(position.y) : 0
  };
}

function normalizeNode(node, index) {
  return {
    id: String(node?.id || `node-${index + 1}`),
    type: String(node?.type || ''),
    label: typeof node?.label === 'string' ? node.label : undefined,
    position: finitePosition(node?.position),
    params: node?.params && typeof node.params === 'object' ? cloneValue(node.params) : {},
    enabled: node?.enabled !== false,
    bypass: Boolean(node?.bypass),
    metadata: node?.metadata && typeof node.metadata === 'object' ? cloneValue(node.metadata) : {}
  };
}

function normalizeEndpoint(endpoint) {
  return {
    node: String(endpoint?.node || ''),
    port: String(endpoint?.port || '')
  };
}

function normalizeEdge(edge, index) {
  return {
    id: String(edge?.id || `edge-${index + 1}`),
    from: normalizeEndpoint(edge?.from),
    to: normalizeEndpoint(edge?.to),
    enabled: edge?.enabled !== false,
    feedback: Boolean(edge?.feedback),
    metadata: edge?.metadata && typeof edge.metadata === 'object' ? cloneValue(edge.metadata) : {}
  };
}

export function normalizeOperatorGraph(graph = {}) {
  return {
    format: graph.format === undefined
      ? 'particle-model-studio-operator-graph'
      : String(graph.format),
    schemaVersion: Number(graph.schemaVersion ?? OPERATOR_GRAPH_SCHEMA_VERSION),
    id: String(graph.id || 'main'),
    name: String(graph.name || 'Main Graph'),
    nodes: Array.isArray(graph.nodes) ? graph.nodes.map(normalizeNode) : [],
    edges: Array.isArray(graph.edges) ? graph.edges.map(normalizeEdge) : [],
    metadata: graph.metadata && typeof graph.metadata === 'object' ? cloneValue(graph.metadata) : {}
  };
}

export function cloneOperatorGraph(graph) {
  return cloneValue(normalizeOperatorGraph(graph));
}

function normalizeRegistry(extraDefinitions) {
  const registry = { ...BUILTIN_OPERATOR_DEFINITIONS };
  if (extraDefinitions instanceof Map) {
    for (const [type, item] of extraDefinitions.entries()) {
      registry[type] = item;
    }
  } else if (Array.isArray(extraDefinitions)) {
    for (const item of extraDefinitions) {
      if (item?.type) {
        registry[item.type] = item;
      }
    }
  } else if (extraDefinitions && typeof extraDefinitions === 'object') {
    Object.assign(registry, extraDefinitions);
  }
  return registry;
}

function diagnostic(code, message, context = {}) {
  return { code, message, ...context };
}

function findPort(operatorDefinition, direction, portId) {
  return operatorDefinition?.[direction]?.find((item) => item.id === portId) || null;
}

function portTypesCompatible(outputType, inputType) {
  return outputType === 'any' || inputType === 'any' || outputType === inputType;
}

function detectCycle(nodeIds, edges) {
  const adjacency = new Map(nodeIds.map((id) => [id, []]));
  for (const edge of edges) {
    adjacency.get(edge.from.node)?.push(edge.to.node);
  }

  const visiting = new Set();
  const visited = new Set();
  const stack = [];
  let cycle = null;

  const visit = (nodeId) => {
    if (cycle) {
      return;
    }
    visiting.add(nodeId);
    stack.push(nodeId);
    for (const nextId of adjacency.get(nodeId) || []) {
      if (visiting.has(nextId)) {
        const start = stack.indexOf(nextId);
        cycle = [...stack.slice(Math.max(0, start)), nextId];
        return;
      }
      if (!visited.has(nextId)) {
        visit(nextId);
      }
    }
    stack.pop();
    visiting.delete(nodeId);
    visited.add(nodeId);
  };

  for (const nodeId of nodeIds) {
    if (!visited.has(nodeId)) {
      visit(nodeId);
    }
  }
  return cycle;
}

export function validateOperatorGraph(inputGraph, options = {}) {
  const errors = [];
  const warnings = [];
  if (!inputGraph || typeof inputGraph !== 'object' || Array.isArray(inputGraph)) {
    errors.push(diagnostic('graph.invalid', 'Operator graph must be an object.', { path: '' }));
    return { valid: false, errors, warnings, stats: { nodes: 0, edges: 0, feedbackEdges: 0 } };
  }

  const graph = normalizeOperatorGraph(inputGraph);
  const registry = normalizeRegistry(options.definitions);
  if (graph.format !== 'particle-model-studio-operator-graph') {
    errors.push(diagnostic('graph.format', 'Unsupported operator graph format.', { path: 'format' }));
  }
  if (graph.schemaVersion !== OPERATOR_GRAPH_SCHEMA_VERSION) {
    errors.push(diagnostic(
      'graph.schema-version',
      `Unsupported operator graph schema version: ${graph.schemaVersion}.`,
      { path: 'schemaVersion' }
    ));
  }
  if (!Array.isArray(inputGraph.nodes)) {
    errors.push(diagnostic('graph.nodes', 'Operator graph nodes must be an array.', { path: 'nodes' }));
  }
  if (!Array.isArray(inputGraph.edges)) {
    errors.push(diagnostic('graph.edges', 'Operator graph edges must be an array.', { path: 'edges' }));
  }

  const nodeById = new Map();
  const nodeDefinitionById = new Map();
  for (const node of graph.nodes) {
    if (!node.id) {
      errors.push(diagnostic('node.id', 'Every operator node needs an id.', { nodeId: node.id }));
      continue;
    }
    if (nodeById.has(node.id)) {
      errors.push(diagnostic('node.duplicate-id', `Duplicate node id: ${node.id}.`, { nodeId: node.id }));
      continue;
    }
    nodeById.set(node.id, node);
    const operatorDefinition = registry[node.type];
    if (!operatorDefinition) {
      errors.push(diagnostic('node.unknown-type', `Unknown operator type: ${node.type || '(empty)'}.`, { nodeId: node.id }));
      continue;
    }
    nodeDefinitionById.set(node.id, operatorDefinition);
    for (const direction of ['inputs', 'outputs']) {
      for (const operatorPort of operatorDefinition[direction] || []) {
        if (!PORT_TYPE_SET.has(operatorPort.type)) {
          errors.push(diagnostic(
            'definition.port-type',
            `Operator ${node.type} uses unsupported port type ${operatorPort.type}.`,
            { nodeId: node.id, portId: operatorPort.id }
          ));
        }
      }
    }
  }

  const edgeIds = new Set();
  const activeDataEdges = [];
  const enabledEdges = [];
  const inputConnections = new Map();
  for (const edge of graph.edges) {
    if (!edge.id) {
      errors.push(diagnostic('edge.id', 'Every operator edge needs an id.', { edgeId: edge.id }));
      continue;
    }
    if (edgeIds.has(edge.id)) {
      errors.push(diagnostic('edge.duplicate-id', `Duplicate edge id: ${edge.id}.`, { edgeId: edge.id }));
      continue;
    }
    edgeIds.add(edge.id);

    const sourceNode = nodeById.get(edge.from.node);
    const targetNode = nodeById.get(edge.to.node);
    if (!sourceNode) {
      errors.push(diagnostic('edge.source-node', `Missing source node: ${edge.from.node || '(empty)'}.`, { edgeId: edge.id }));
    }
    if (!targetNode) {
      errors.push(diagnostic('edge.target-node', `Missing target node: ${edge.to.node || '(empty)'}.`, { edgeId: edge.id }));
    }
    if (!sourceNode || !targetNode) {
      continue;
    }

    const output = findPort(nodeDefinitionById.get(sourceNode.id), 'outputs', edge.from.port);
    const input = findPort(nodeDefinitionById.get(targetNode.id), 'inputs', edge.to.port);
    if (!output) {
      errors.push(diagnostic(
        'edge.source-port',
        `Node ${sourceNode.id} has no output port ${edge.from.port || '(empty)'}.`,
        { edgeId: edge.id, nodeId: sourceNode.id, portId: edge.from.port }
      ));
    }
    if (!input) {
      errors.push(diagnostic(
        'edge.target-port',
        `Node ${targetNode.id} has no input port ${edge.to.port || '(empty)'}.`,
        { edgeId: edge.id, nodeId: targetNode.id, portId: edge.to.port }
      ));
    }
    if (output && input && !portTypesCompatible(output.type, input.type)) {
      errors.push(diagnostic(
        'edge.type-mismatch',
        `Cannot connect ${output.type} to ${input.type}.`,
        { edgeId: edge.id, fromType: output.type, toType: input.type }
      ));
    }
    if (!edge.enabled || !sourceNode.enabled || !targetNode.enabled) {
      continue;
    }

    enabledEdges.push(edge);
    const inputKey = `${edge.to.node}:${edge.to.port}`;
    inputConnections.set(inputKey, (inputConnections.get(inputKey) || 0) + 1);
    if (!edge.feedback) {
      activeDataEdges.push(edge);
    }
  }

  for (const [inputKey, count] of inputConnections.entries()) {
    const [nodeId, portId] = inputKey.split(':');
    const input = findPort(nodeDefinitionById.get(nodeId), 'inputs', portId);
    if (count > 1 && !input?.multiple) {
      errors.push(diagnostic(
        'edge.multiple-input',
        `Input ${inputKey} accepts only one connection.`,
        { nodeId, portId }
      ));
    }
  }

  for (const node of graph.nodes.filter((item) => item.enabled)) {
    const operatorDefinition = nodeDefinitionById.get(node.id);
    for (const input of operatorDefinition?.inputs || []) {
      if (input.required && !inputConnections.has(`${node.id}:${input.id}`)) {
        warnings.push(diagnostic(
          'node.unconnected-input',
          `Required input ${node.id}:${input.id} is not connected.`,
          { nodeId: node.id, portId: input.id }
        ));
      }
    }
  }

  const enabledNodeIds = graph.nodes.filter((node) => node.enabled).map((node) => node.id);
  const cycle = detectCycle(enabledNodeIds, activeDataEdges);
  if (cycle) {
    errors.push(diagnostic(
      'graph.cycle',
      `Operator graph contains a same-frame cycle: ${cycle.join(' -> ')}. Mark an intentional delayed edge as feedback.`,
      { nodeIds: cycle }
    ));
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    stats: {
      nodes: graph.nodes.length,
      enabledNodes: enabledNodeIds.length,
      edges: graph.edges.length,
      enabledEdges: enabledEdges.length,
      feedbackEdges: enabledEdges.filter((edge) => edge.feedback).length
    }
  };
}

export function assertOperatorGraph(graph, options = {}) {
  const diagnostics = validateOperatorGraph(graph, options);
  if (!diagnostics.valid) {
    throw new OperatorGraphError(diagnostics.errors[0]?.message || 'Invalid operator graph.', diagnostics);
  }
  return diagnostics;
}

function topologicalStages(nodes, edges) {
  const nodeOrder = new Map(nodes.map((node, index) => [node.id, index]));
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  const dependents = new Map(nodes.map((node) => [node.id, []]));
  for (const edge of edges) {
    indegree.set(edge.to.node, (indegree.get(edge.to.node) || 0) + 1);
    dependents.get(edge.from.node)?.push(edge.to.node);
  }
  for (const values of dependents.values()) {
    values.sort((a, b) => nodeOrder.get(a) - nodeOrder.get(b));
  }

  let ready = nodes.filter((node) => indegree.get(node.id) === 0).map((node) => node.id);
  const stages = [];
  while (ready.length) {
    ready.sort((a, b) => nodeOrder.get(a) - nodeOrder.get(b));
    const stage = [...ready];
    stages.push(stage);
    const nextReady = [];
    for (const nodeId of stage) {
      for (const dependentId of dependents.get(nodeId) || []) {
        const remaining = indegree.get(dependentId) - 1;
        indegree.set(dependentId, remaining);
        if (remaining === 0) {
          nextReady.push(dependentId);
        }
      }
    }
    ready = nextReady;
  }
  return { stages, dependents };
}

function uniqueStrings(values) {
  return [...new Set((values || []).map(String))];
}

export function compileOperatorGraph(inputGraph, options = {}) {
  const graph = normalizeOperatorGraph(inputGraph);
  const diagnostics = assertOperatorGraph(graph, options);
  const nodes = graph.nodes.filter((node) => node.enabled);
  const enabledNodeIds = new Set(nodes.map((node) => node.id));
  const edges = graph.edges.filter((edge) => (
    edge.enabled &&
    enabledNodeIds.has(edge.from.node) &&
    enabledNodeIds.has(edge.to.node)
  ));
  const sameFrameEdges = edges.filter((edge) => !edge.feedback);
  const feedbackEdges = edges.filter((edge) => edge.feedback);
  const { stages, dependents } = topologicalStages(nodes, sameFrameEdges);
  const order = stages.flat();

  const requestedDirtyNodeIds = options.dirtyNodeIds === undefined
    ? [...order]
    : uniqueStrings(options.dirtyNodeIds);
  const ignoredDirtyNodeIds = requestedDirtyNodeIds.filter((nodeId) => !enabledNodeIds.has(nodeId));
  const dirty = new Set(requestedDirtyNodeIds.filter((nodeId) => enabledNodeIds.has(nodeId)));
  const queue = [...dirty];
  while (queue.length) {
    const nodeId = queue.shift();
    for (const dependentId of dependents.get(nodeId) || []) {
      if (!dirty.has(dependentId)) {
        dirty.add(dependentId);
        queue.push(dependentId);
      }
    }
  }

  const executionNodeIds = order.filter((nodeId) => dirty.has(nodeId));
  const executionStages = stages
    .map((stage) => stage.filter((nodeId) => dirty.has(nodeId)))
    .filter((stage) => stage.length);
  const nextFrameDirtyNodeIds = uniqueStrings(
    feedbackEdges
      .filter((edge) => dirty.has(edge.from.node))
      .map((edge) => edge.to.node)
  );
  const dependencyMap = Object.fromEntries(nodes.map((node) => [
    node.id,
    uniqueStrings(sameFrameEdges.filter((edge) => edge.to.node === node.id).map((edge) => edge.from.node))
  ]));
  const dependentMap = Object.fromEntries(nodes.map((node) => [node.id, [...(dependents.get(node.id) || [])]]));

  return {
    graphId: graph.id,
    schemaVersion: graph.schemaVersion,
    order,
    stages,
    executionNodeIds,
    executionStages,
    requestedDirtyNodeIds,
    ignoredDirtyNodeIds,
    nextFrameDirtyNodeIds,
    dependencies: dependencyMap,
    dependents: dependentMap,
    feedbackBindings: feedbackEdges.map((edge) => ({
      edgeId: edge.id,
      from: { ...edge.from },
      to: { ...edge.to }
    })),
    diagnostics
  };
}

function pickDefined(source, keys) {
  return Object.fromEntries(keys.filter((key) => source?.[key] !== undefined).map((key) => [key, source[key]]));
}

function creatorNode(id, type, label, x, y, params = {}) {
  return { id, type, label, position: { x, y }, params };
}

function creatorEdge(id, fromNode, fromPort, toNode, toPort) {
  return {
    id,
    from: { node: fromNode, port: fromPort },
    to: { node: toNode, port: toPort }
  };
}

export function createCreatorOperatorGraph(context = {}) {
  const options = context.options || {};
  const camera = context.camera || {};
  const quality = context.quality || {};
  const graph = {
    format: 'particle-model-studio-operator-graph',
    schemaVersion: OPERATOR_GRAPH_SCHEMA_VERSION,
    id: 'creator-main',
    name: 'Creator Pipeline',
    metadata: {
      mode: 'creator',
      creatorVersion: 1,
      synchronized: true
    },
    nodes: [
      creatorNode('model-input', 'asset.model-input', 'Model', 0, 80, {
        name: context.model?.name || '',
        loaded: Boolean(context.model?.loaded)
      }),
      creatorNode('particle-sampler', 'geometry.particle-sampler', 'Particles', 220, 80, pickDefined(options, [
        'particleCount', 'pointSize', 'edgeFeather', 'sizeRandom', 'particleizeProgress',
        'modelVisibility', 'sampleCleanup', 'surfaceBias', 'seed'
      ])),
      creatorNode('flow-dissolve', 'simulation.dissolve', 'Flow Dissolve', 440, 80, {
        flowStyle: options.flowStyle ?? 'fluid-ribbon',
        flowCharacter: options.flowCharacter ?? 0.28,
        flowDirectionPreset: options.flowDirectionPreset ?? 'auto',
        ...pickDefined(options, [
          'dissolve', 'spread', 'noise', 'noiseScale', 'swirl', 'speed',
          'dissolveSpread', 'dissolveEdgeWidth', 'dissolveTurbulence', 'dissolveCurl', 'dissolveMist',
          'dissolveDirectionX', 'dissolveDirectionY', 'dissolveDirectionZ', 'dissolveLift',
          'growth', 'growthFlow', 'growthWidth', 'growthTurbulence', 'organicFlow',
          'edgeBreak', 'filamentLength', 'filamentCurl'
        ])
      }),
      creatorNode('particle-force', 'simulation.force-field', 'Force Field', 660, 80, {
        enabled: true,
        strength: 1,
        forceX: 0.02,
        forceY: 0.1,
        forceZ: -0.015,
        turbulence: options.feedbackTurbulence ?? 0.72,
        curl: 1.05
      }),
      creatorNode('particle-return', 'simulation.return-force', 'Return / Repel', 880, 80, {
        enabled: true,
        strength: 0.48
      }),
      creatorNode('particle-emitter', 'simulation.emitter', 'Emitter', 1100, 80, {
        enabled: true,
        mode: 'all',
        rate: 5000,
        burstCount: options.particleCount ?? 20000,
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
        seed: options.seed ?? 1
      }),
      creatorNode('particle-birth-life', 'simulation.birth-life', 'Birth / Life', 1320, 80, {
        enabled: true,
        lifetimeMin: 3.96,
        lifetimeMax: 7.04,
        respawn: true,
        fadeIn: 0,
        fadeOut: 0.35
      }),
      creatorNode('particle-feedback', 'simulation.feedback-particles', 'Particle Feedback', 1540, 80, {
        enabled: false,
        resetVersion: 0,
        strength: options.feedbackStrength ?? 0.72,
        dissolveCoupling: 0.88,
        drag: options.feedbackDrag ?? 1.15,
        damping: 0.16,
        turbulence: 0,
        curl: 0,
        forceX: 0,
        forceY: 0,
        forceZ: 0,
        attraction: 0,
        maxVelocity: 0.72,
        life: 5.5,
        substeps: 2,
        timeScale: 1
      }),
      creatorNode('scene-camera', 'scene.camera', 'Camera', 1540, 300, pickDefined(camera, [
        'type', 'sensorWidth', 'focalLength', 'fov', 'dofEnabled', 'aperture', 'focusDistance',
        'bokehScale', 'highlightGain', 'blades', 'roundness'
      ])),
      creatorNode('particle-render', 'render.particles', 'Particle Render', 1760, 80, {
        qualityMode: quality.mode,
        qualityLevel: quality.level,
        ...pickDefined(options, ['particleColor', 'opacity', 'emissionEnabled', 'emissionIntensity'])
      }),
      creatorNode('multi-glow', 'post.glow', 'Deep Glow', 1980, 80, {
        ...pickDefined(options, ['glowRadius', 'glowExposure']),
        layers: quality.profile?.glowLayers,
        renderScale: quality.profile?.bloomScale
      }),
      creatorNode('viewport-dof', 'post.depth-of-field', 'Depth of Field', 2200, 80, {
        ...pickDefined(camera, [
          'dofEnabled', 'aperture', 'focusDistance', 'bokehScale', 'highlightGain', 'blades', 'roundness'
        ]),
        samples: quality.profile?.dofSamples,
        bokehScale: camera.bokehScale ?? 2.35,
        highlightGain: camera.highlightGain ?? 0.72,
        blades: camera.blades ?? 7,
        roundness: camera.roundness ?? 0.84
      }),
      creatorNode('viewport-output', 'output.viewport', 'Viewport', 2420, 80, {})
    ],
    edges: [
      creatorEdge('model-to-particles', 'model-input', 'geometry', 'particle-sampler', 'geometry'),
      creatorEdge('particles-to-dissolve', 'particle-sampler', 'points', 'flow-dissolve', 'points'),
      creatorEdge('dissolve-to-force', 'flow-dissolve', 'points', 'particle-force', 'points'),
      creatorEdge('force-to-return', 'particle-force', 'points', 'particle-return', 'points'),
      creatorEdge('return-to-emitter', 'particle-return', 'points', 'particle-emitter', 'points'),
      creatorEdge('emitter-to-birth-life', 'particle-emitter', 'points', 'particle-birth-life', 'points'),
      creatorEdge('birth-life-to-feedback', 'particle-birth-life', 'points', 'particle-feedback', 'points'),
      creatorEdge('feedback-to-render', 'particle-feedback', 'points', 'particle-render', 'points'),
      creatorEdge('camera-to-render', 'scene-camera', 'camera', 'particle-render', 'camera'),
      creatorEdge('render-to-glow', 'particle-render', 'color', 'multi-glow', 'color'),
      creatorEdge('glow-to-dof', 'multi-glow', 'color', 'viewport-dof', 'color'),
      creatorEdge('depth-to-dof', 'particle-render', 'depth', 'viewport-dof', 'depth'),
      creatorEdge('camera-to-dof', 'scene-camera', 'camera', 'viewport-dof', 'camera'),
      creatorEdge('dof-to-viewport', 'viewport-dof', 'color', 'viewport-output', 'color')
    ]
  };
  assertOperatorGraph(graph);
  return normalizeOperatorGraph(graph);
}
