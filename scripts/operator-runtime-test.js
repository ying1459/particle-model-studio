import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OperatorGraphRuntime,
  OperatorRuntimeError
} from '../src/core/operator-runtime.js';
import { OperatorResourceLifetime } from '../src/core/operator-resource-lifetime.js';

const definitions = {
  'test.source': {
    type: 'test.source',
    inputs: [],
    outputs: [{ id: 'value', type: 'signal' }]
  },
  'test.add': {
    type: 'test.add',
    inputs: [{ id: 'value', type: 'signal' }],
    outputs: [{ id: 'value', type: 'signal' }]
  },
  'test.output': {
    type: 'test.output',
    inputs: [{ id: 'value', type: 'signal' }],
    outputs: []
  },
  'test.feedback': {
    type: 'test.feedback',
    inputs: [{ id: 'previous', type: 'signal', required: false }],
    outputs: [{ id: 'value', type: 'signal' }]
  }
};

function createMathGraph(add = 2) {
  return {
    schemaVersion: 1,
    nodes: [
      { id: 'source', type: 'test.source', params: { value: 3 } },
      { id: 'add', type: 'test.add', params: { add } },
      { id: 'output', type: 'test.output' }
    ],
    edges: [
      { id: 'source-add', from: { node: 'source', port: 'value' }, to: { node: 'add', port: 'value' } },
      { id: 'add-output', from: { node: 'add', port: 'value' }, to: { node: 'output', port: 'value' } }
    ]
  };
}

test('runtime caches stable nodes and re-executes changed downstream nodes', () => {
  const calls = { source: 0, add: 0, output: 0 };
  const runtime = new OperatorGraphRuntime({
    definitions,
    executors: {
      'test.source': ({ node }) => {
        calls.source += 1;
        return { value: node.params.value };
      },
      'test.add': ({ node, inputs }) => {
        calls.add += 1;
        return { value: inputs.value + node.params.add };
      },
      'test.output': ({ inputs, context }) => {
        calls.output += 1;
        context.values.push(inputs.value);
        return {};
      }
    }
  });
  const context = { values: [] };

  const first = runtime.execute(createMathGraph(2), { context });
  const second = runtime.execute(createMathGraph(2), { context });
  const changed = runtime.execute(createMathGraph(5), { context });

  assert.deepEqual(first.executedNodeIds, ['source', 'add', 'output']);
  assert.deepEqual(second.executedNodeIds, []);
  assert.deepEqual(second.cacheHitNodeIds, ['source', 'add', 'output']);
  assert.deepEqual(changed.executedNodeIds, ['add', 'output']);
  assert.deepEqual(calls, { source: 1, add: 2, output: 2 });
  assert.deepEqual(context.values, [5, 8]);
});

test('explicit dirtiness propagates downstream through the compiled graph', () => {
  const runtime = new OperatorGraphRuntime({
    definitions,
    executors: {
      'test.source': ({ node }) => ({ value: node.params.value }),
      'test.add': ({ node, inputs }) => ({ value: inputs.value + node.params.add }),
      'test.output': () => ({})
    }
  });
  runtime.execute(createMathGraph());
  const result = runtime.execute(createMathGraph(), { dirtyNodeIds: ['source'] });

  assert.deepEqual(result.executedNodeIds, ['source', 'add', 'output']);
});

test('always-dirty executors keep real-time branches live', () => {
  let sourceValue = 0;
  const runtime = new OperatorGraphRuntime({
    definitions,
    executors: {
      'test.source': {
        alwaysDirty: true,
        execute: () => ({ value: ++sourceValue })
      },
      'test.add': ({ node, inputs }) => ({ value: inputs.value + node.params.add }),
      'test.output': () => ({})
    }
  });

  runtime.execute(createMathGraph());
  const second = runtime.execute(createMathGraph());
  assert.deepEqual(second.executedNodeIds, ['source', 'add', 'output']);
  assert.equal(runtime.getNodeOutput('add', 'value'), 4);
});

test('targeted execution cooks only ancestors of the requested output', () => {
  const graph = {
    schemaVersion: 1,
    nodes: [
      { id: 'source', type: 'test.source', params: { value: 3 } },
      { id: 'unused', type: 'test.add', params: { add: 100 } },
      { id: 'output', type: 'test.output' }
    ],
    edges: [
      { id: 'source-output', from: { node: 'source', port: 'value' }, to: { node: 'output', port: 'value' } },
      { id: 'source-unused', from: { node: 'source', port: 'value' }, to: { node: 'unused', port: 'value' } }
    ]
  };
  const calls = [];
  const runtime = new OperatorGraphRuntime({
    definitions,
    executors: {
      'test.source': ({ node }) => {
        calls.push('source');
        return { value: node.params.value };
      },
      'test.add': ({ inputs, node }) => {
        calls.push('unused');
        return { value: inputs.value + node.params.add };
      },
      'test.output': ({ inputs }) => {
        calls.push(`output:${inputs.value}`);
        return {};
      }
    }
  });

  const result = runtime.execute(graph, { targetNodeIds: ['output'] });
  assert.deepEqual(result.executedNodeIds, ['source', 'output']);
  assert.deepEqual(result.demandedNodeIds, ['source', 'output']);
  assert.deepEqual(result.skippedUndemandedNodeIds, ['unused']);
  assert.deepEqual(calls, ['source', 'output:3']);
});

test('feedback edges expose the previous frame value and dirty the next frame', () => {
  const graph = {
    schemaVersion: 1,
    nodes: [{ id: 'accumulator', type: 'test.feedback' }],
    edges: [{
      id: 'history',
      from: { node: 'accumulator', port: 'value' },
      to: { node: 'accumulator', port: 'previous' },
      feedback: true
    }]
  };
  const runtime = new OperatorGraphRuntime({
    definitions,
    executors: {
      'test.feedback': ({ inputs }) => ({ value: Number(inputs.previous || 0) + 1 })
    }
  });

  const first = runtime.execute(graph);
  const second = runtime.execute(graph);
  const third = runtime.execute(graph);
  assert.equal(runtime.getNodeOutput('accumulator', 'value'), 3);
  assert.equal(first.feedbackUpdates.length, 1);
  assert.deepEqual(second.executedNodeIds, ['accumulator']);
  assert.deepEqual(third.executedNodeIds, ['accumulator']);
});

test('missing and asynchronous executors fail with actionable diagnostics', () => {
  const missing = new OperatorGraphRuntime({ definitions, executors: {} });
  assert.throws(() => missing.execute(createMathGraph()), OperatorRuntimeError);

  const asyncRuntime = new OperatorGraphRuntime({
    definitions,
    executors: {
      'test.source': async () => ({ value: 1 }),
      'test.add': () => ({ value: 1 }),
      'test.output': () => ({})
    }
  });
  assert.throws(
    () => asyncRuntime.execute(createMathGraph()),
    (error) => error instanceof OperatorRuntimeError && error.message.includes('Promise')
  );
});

test('runtime releases aliased managed outputs after their last demanded consumer', () => {
  const branchDefinitions = {
    ...definitions,
    'test.passthrough': {
      type: 'test.passthrough',
      inputs: [{ id: 'value', type: 'signal' }],
      outputs: [{ id: 'value', type: 'signal' }]
    }
  };
  const graph = {
    schemaVersion: 1,
    nodes: [
      { id: 'source', type: 'test.source' },
      { id: 'passthrough', type: 'test.passthrough' },
      { id: 'direct-output', type: 'test.output' },
      { id: 'alias-output', type: 'test.output' }
    ],
    edges: [
      { id: 'source-pass', from: { node: 'source', port: 'value' }, to: { node: 'passthrough', port: 'value' } },
      { id: 'source-direct', from: { node: 'source', port: 'value' }, to: { node: 'direct-output', port: 'value' } },
      { id: 'pass-output', from: { node: 'passthrough', port: 'value' }, to: { node: 'alias-output', port: 'value' } }
    ]
  };
  let releases = 0;
  const resource = {
    id: 'managed-signal',
    release() {
      releases += 1;
    }
  };
  const lifetime = new OperatorResourceLifetime().beginFrame({ scope: 'test', frame: 1 });
  const runtime = new OperatorGraphRuntime({
    definitions: branchDefinitions,
    executors: {
      'test.source': { alwaysDirty: true, execute: () => ({ value: resource }) },
      'test.passthrough': ({ inputs }) => ({ value: inputs.value }),
      'test.output': () => ({})
    }
  });

  const result = runtime.execute(graph, {
    targetNodeIds: ['direct-output', 'alias-output'],
    context: { resourceLifetime: lifetime }
  });
  const stats = lifetime.endFrame();
  assert.equal(releases, 1);
  assert.equal(stats.aliasPublications, 1);
  assert.equal(stats.plannedConsumers, 3);
  assert.equal(stats.consumedConsumers, 3);
  assert.equal(stats.activeResourceCount, 0);
  assert.equal(result.resourceLifetime.releases, 1);
});

test('released frame outputs invalidate runtime cache before the next cook', () => {
  let sourceCalls = 0;
  const runtime = new OperatorGraphRuntime({
    definitions,
    executors: {
      'test.source': () => {
        sourceCalls += 1;
        let released = false;
        return {
          value: {
            id: `frame-resource-${sourceCalls}`,
            get released() {
              return released;
            },
            release() {
              released = true;
            }
          }
        };
      },
      'test.add': ({ inputs }) => ({ value: inputs.value }),
      'test.output': { alwaysDirty: true, execute: () => ({}) }
    }
  });

  const firstLifetime = new OperatorResourceLifetime().beginFrame({ frame: 1 });
  runtime.execute(createMathGraph(), { context: { resourceLifetime: firstLifetime } });
  firstLifetime.endFrame();
  const secondLifetime = new OperatorResourceLifetime().beginFrame({ frame: 2 });
  const second = runtime.execute(createMathGraph(), { context: { resourceLifetime: secondLifetime } });
  secondLifetime.endFrame();

  assert.equal(sourceCalls, 2);
  assert.deepEqual(second.executedNodeIds, ['source', 'add', 'output']);
});
