import assert from 'node:assert/strict';
import test from 'node:test';
import { createCreatorOperatorGraph, validateOperatorGraph } from '../src/core/operator-graph.js';
import {
  OperatorGraphEditError,
  OperatorGraphHistory,
  addOperatorNode,
  connectOperatorPorts,
  disconnectOperatorEdge,
  duplicateOperatorNode,
  removeOperatorNode,
  updateOperatorNodeParams
} from '../src/core/operator-graph-edit.js';

test('nodes can be added, duplicated, parameterized, and removed immutably', () => {
  const source = createCreatorOperatorGraph();
  const added = addOperatorNode(source, 'post.glow', { position: { x: 420, y: 520 } });
  const updated = updateOperatorNodeParams(added.graph, added.nodeId, { glowRadius: 42, glowExposure: 0.7 });
  const duplicated = duplicateOperatorNode(updated, added.nodeId);
  const removed = removeOperatorNode(duplicated.graph, added.nodeId);

  assert.equal(source.nodes.length, 13);
  assert.equal(added.graph.nodes.length, 14);
  assert.equal(updated.nodes.find((node) => node.id === added.nodeId).params.glowRadius, 42);
  assert.equal(duplicated.graph.nodes.length, 15);
  assert.equal(removed.nodes.some((node) => node.id === added.nodeId), false);
  assert.equal(validateOperatorGraph(removed).valid, true);
});

test('new lifecycle and spatial simulation nodes receive editable definition defaults', () => {
  const source = createCreatorOperatorGraph();
  const emitter = addOperatorNode(source, 'simulation.emitter');
  const birthLife = addOperatorNode(emitter.graph, 'simulation.birth-life');
  const attractor = addOperatorNode(birthLife.graph, 'simulation.attractor');
  const collision = addOperatorNode(attractor.graph, 'simulation.collision-plane');
  const trail = addOperatorNode(collision.graph, 'simulation.trail');
  const attractorNode = collision.graph.nodes.find((node) => node.id === attractor.nodeId);
  const collisionNode = collision.graph.nodes.find((node) => node.id === collision.nodeId);
  const trailNode = trail.graph.nodes.find((node) => node.id === trail.nodeId);
  const emitterNode = birthLife.graph.nodes.find((node) => node.id === emitter.nodeId);
  const birthLifeNode = attractor.graph.nodes.find((node) => node.id === birthLife.nodeId);

  assert.equal(emitterNode.params.mode, 'all');
  assert.equal(emitterNode.params.rate, 5000);
  assert.equal(emitterNode.params.seed, 1);
  assert.deepEqual(birthLifeNode.params, {
    enabled: true,
    lifetimeMin: 3.96,
    lifetimeMax: 7.04,
    respawn: true,
    fadeIn: 0,
    fadeOut: 0.35
  });

  assert.deepEqual(attractorNode.params, {
    enabled: true,
    centerX: 0,
    centerY: 0,
    centerZ: 0,
    strength: 1,
    radius: 4,
    falloff: 2
  });
  assert.deepEqual(collisionNode.params, {
    enabled: true,
    normalX: 0,
    normalY: 1,
    normalZ: 0,
    offset: -1,
    restitution: 0.45,
    friction: 0.12
  });
  assert.deepEqual(trailNode.params, {
    enabled: true,
    samples: 4,
    interval: 0.04,
    opacity: 0.38,
    fade: 1.6,
    size: 0.72
  });
});

test('connecting a single input replaces its prior edge and remains valid', () => {
  const graph = createCreatorOperatorGraph();
  const result = connectOperatorPorts(graph, {
    from: { node: 'particle-render', port: 'color' },
    to: { node: 'viewport-output', port: 'color' }
  });

  assert.deepEqual(result.replacedEdgeIds, ['dof-to-viewport']);
  assert.equal(result.graph.edges.some((edge) => edge.id === 'dof-to-viewport'), false);
  assert.equal(result.graph.edges.some((edge) => edge.id === result.edgeId), true);
  assert.equal(validateOperatorGraph(result.graph).valid, true);
});

test('invalid port types and same-frame cycles are rejected before commit', () => {
  const graph = createCreatorOperatorGraph();
  assert.throws(
    () => connectOperatorPorts(graph, {
      from: { node: 'particle-render', port: 'depth' },
      to: { node: 'multi-glow', port: 'color' }
    }),
    OperatorGraphEditError
  );
  assert.throws(
    () => connectOperatorPorts(graph, {
      from: { node: 'viewport-dof', port: 'color' },
      to: { node: 'multi-glow', port: 'color' }
    }),
    /cycle/i
  );
});

test('edges can be disconnected while required ports become warnings rather than corruption', () => {
  const graph = createCreatorOperatorGraph();
  const disconnected = disconnectOperatorEdge(graph, 'render-to-glow');
  const validation = validateOperatorGraph(disconnected);

  assert.equal(validation.valid, true);
  assert.ok(validation.warnings.some((warning) => warning.code === 'node.unconnected-input'));
});

test('graph history truncates redo after a divergent edit', () => {
  const source = createCreatorOperatorGraph();
  const history = new OperatorGraphHistory(source, { limit: 4 });
  const first = updateOperatorNodeParams(source, 'multi-glow', { glowRadius: 40 });
  const second = updateOperatorNodeParams(first, 'multi-glow', { glowRadius: 80 });
  history.commit(first);
  history.commit(second);

  assert.equal(history.undo().nodes.find((node) => node.id === 'multi-glow').params.glowRadius, 40);
  const branch = updateOperatorNodeParams(history.current(), 'multi-glow', { glowRadius: 55 });
  history.commit(branch);
  assert.equal(history.canRedo(), false);
  assert.equal(history.current().nodes.find((node) => node.id === 'multi-glow').params.glowRadius, 55);
});

test('protected nodes cannot be deleted', () => {
  assert.throws(
    () => removeOperatorNode(createCreatorOperatorGraph(), 'viewport-output', {
      protectedNodeIds: ['viewport-output']
    }),
    OperatorGraphEditError
  );
});
