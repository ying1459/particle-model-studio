import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OPERATOR_GRAPH_SCHEMA_VERSION,
  OperatorGraphError,
  compileOperatorGraph,
  createCreatorOperatorGraph,
  normalizeOperatorGraph,
  validateOperatorGraph
} from '../src/core/operator-graph.js';

test('creator graph is valid and produces a stable execution plan', () => {
  const graph = createCreatorOperatorGraph({
    options: {
      particleCount: 20000,
      pointSize: 3,
      dissolve: 0.45,
      feedbackStrength: 1.25,
      feedbackTurbulence: 1.4,
      feedbackDrag: 0.8,
      glowRadius: 120,
      glowExposure: 1.1
    },
    camera: {
      dofEnabled: true,
      aperture: 2.8,
      focusDistance: 8,
      bokehScale: 3.1,
      highlightGain: 1.25,
      blades: 9,
      roundness: 0.68
    },
    quality: {
      mode: 'high',
      level: 'high',
      profile: { glowLayers: 3, bloomScale: 0.4, dofSamples: 48 }
    },
    model: { name: 'pagoda.glb', loaded: true }
  });
  const validation = validateOperatorGraph(graph);
  const plan = compileOperatorGraph(graph);

  assert.equal(graph.schemaVersion, OPERATOR_GRAPH_SCHEMA_VERSION);
  assert.equal(validation.valid, true);
  assert.equal(validation.errors.length, 0);
  assert.deepEqual(plan.executionNodeIds, plan.order);
  assert.ok(plan.order.indexOf('flow-dissolve') < plan.order.indexOf('multi-glow'));
  assert.ok(plan.order.indexOf('flow-dissolve') < plan.order.indexOf('particle-force'));
  assert.ok(plan.order.indexOf('particle-force') < plan.order.indexOf('particle-return'));
  assert.ok(plan.order.indexOf('particle-return') < plan.order.indexOf('particle-emitter'));
  assert.ok(plan.order.indexOf('particle-emitter') < plan.order.indexOf('particle-birth-life'));
  assert.ok(plan.order.indexOf('particle-birth-life') < plan.order.indexOf('particle-feedback'));
  assert.ok(plan.order.indexOf('flow-dissolve') < plan.order.indexOf('particle-feedback'));
  assert.ok(plan.order.indexOf('particle-feedback') < plan.order.indexOf('particle-render'));
  assert.ok(plan.order.indexOf('particle-render') < plan.order.indexOf('viewport-dof'));
  assert.equal(plan.order.at(-1), 'viewport-output');
  const feedback = graph.nodes.find((node) => node.id === 'particle-feedback');
  const force = graph.nodes.find((node) => node.id === 'particle-force');
  const returnForce = graph.nodes.find((node) => node.id === 'particle-return');
  const emitter = graph.nodes.find((node) => node.id === 'particle-emitter');
  const birthLife = graph.nodes.find((node) => node.id === 'particle-birth-life');
  const depthOfField = graph.nodes.find((node) => node.id === 'viewport-dof');
  assert.equal(feedback.params.strength, 1.25);
  assert.equal(feedback.params.enabled, false);
  assert.equal(feedback.params.turbulence, 0);
  assert.equal(feedback.params.drag, 0.8);
  assert.equal(force.params.turbulence, 1.4);
  assert.equal(returnForce.params.strength, 0.48);
  assert.equal(emitter.params.mode, 'all');
  assert.equal(emitter.params.burstCount, 20000);
  assert.deepEqual([birthLife.params.lifetimeMin, birthLife.params.lifetimeMax], [3.96, 7.04]);
  assert.equal(depthOfField.params.samples, 48);
  assert.equal(depthOfField.params.bokehScale, 3.1);
  assert.equal(depthOfField.params.highlightGain, 1.25);
  assert.equal(depthOfField.params.blades, 9);
  assert.equal(depthOfField.params.roundness, 0.68);
  const flow = graph.nodes.find((node) => node.id === 'flow-dissolve');
  assert.equal(flow.params.flowStyle, 'fluid-ribbon');
  assert.equal(flow.params.flowCharacter, 0.28);
});

test('type mismatches are rejected with structured diagnostics', () => {
  const graph = createCreatorOperatorGraph();
  graph.edges.find((edge) => edge.id === 'render-to-glow').from.port = 'depth';
  const validation = validateOperatorGraph(graph);

  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.code === 'edge.type-mismatch'));
  assert.throws(() => compileOperatorGraph(graph), OperatorGraphError);
});

test('same-frame cycles fail while an explicit feedback edge is delayed', () => {
  const definitions = {
    'test.signal': {
      type: 'test.signal',
      label: 'Signal',
      category: 'Test',
      inputs: [{ id: 'input', type: 'signal', required: false, multiple: false }],
      outputs: [{ id: 'output', type: 'signal', required: true, multiple: false }]
    }
  };
  const makeGraph = (feedback) => ({
    schemaVersion: 1,
    nodes: [
      { id: 'a', type: 'test.signal' },
      { id: 'b', type: 'test.signal' }
    ],
    edges: [
      { id: 'a-b', from: { node: 'a', port: 'output' }, to: { node: 'b', port: 'input' } },
      { id: 'b-a', from: { node: 'b', port: 'output' }, to: { node: 'a', port: 'input' }, feedback }
    ]
  });

  const cyclic = validateOperatorGraph(makeGraph(false), { definitions });
  assert.equal(cyclic.valid, false);
  assert.ok(cyclic.errors.some((error) => error.code === 'graph.cycle'));

  const feedbackGraph = makeGraph(true);
  const feedbackValidation = validateOperatorGraph(feedbackGraph, { definitions });
  const plan = compileOperatorGraph(feedbackGraph, { definitions, dirtyNodeIds: ['b'] });
  assert.equal(feedbackValidation.valid, true);
  assert.deepEqual(plan.feedbackBindings.map((binding) => binding.edgeId), ['b-a']);
  assert.deepEqual(plan.nextFrameDirtyNodeIds, ['a']);
});

test('incremental scheduling propagates dirtiness only downstream', () => {
  const graph = createCreatorOperatorGraph();
  const plan = compileOperatorGraph(graph, { dirtyNodeIds: ['flow-dissolve', 'missing-node'] });

  assert.deepEqual(plan.executionNodeIds, [
    'flow-dissolve',
    'particle-force',
    'particle-return',
    'particle-emitter',
    'particle-birth-life',
    'particle-feedback',
    'particle-render',
    'multi-glow',
    'viewport-dof',
    'viewport-output'
  ]);
  assert.deepEqual(plan.ignoredDirtyNodeIds, ['missing-node']);
  assert.equal(plan.executionNodeIds.includes('scene-camera'), false);
});

test('normalization is immutable and fills graph defaults', () => {
  const source = {
    nodes: [{ id: 'model', type: 'asset.model-input', position: { x: '12', y: 5 } }],
    edges: []
  };
  const normalized = normalizeOperatorGraph(source);
  normalized.nodes[0].position.x = 99;

  assert.equal(source.nodes[0].position.x, '12');
  assert.equal(normalized.format, 'particle-model-studio-operator-graph');
  assert.equal(normalized.schemaVersion, 1);
  assert.equal(normalized.nodes[0].enabled, true);
});

test('unsupported graph formats are not silently normalized away', () => {
  const graph = createCreatorOperatorGraph();
  graph.format = 'unknown-graph-format';
  const validation = validateOperatorGraph(graph);

  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.code === 'graph.format'));
});
