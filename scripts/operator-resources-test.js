import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OperatorResourceError,
  OperatorResourceTracker,
  assertOperatorResource,
  describeOperatorResource,
  isOperatorResource
} from '../src/core/operator-resources.js';

test('resource tracker creates serializable GPU resource diagnostics without cloning handles', () => {
  const target = { width: 640, height: 360, texture: { name: 'hdr-color' } };
  const tracker = new OperatorResourceTracker().beginFrame({ scope: 'viewport', frame: 7 });
  const color = tracker.create('texture', {
    producerNodeId: 'particle-render',
    producerPortId: 'color',
    target
  });
  const depth = tracker.create('depth', {
    producerNodeId: 'particle-render',
    producerPortId: 'depth',
    target,
    texture: { name: 'depth' }
  });
  tracker.recordPass({
    nodeId: 'particle-render',
    type: 'render.particles',
    outputs: [color, depth],
    durationMs: 1.23456
  });

  assert.equal(isOperatorResource(color, 'texture'), true);
  assert.equal(color.target, target);
  assert.equal(color.texture, target.texture);
  assert.deepEqual(describeOperatorResource(color), {
    id: color.id,
    schemaVersion: 1,
    kind: 'texture',
    scope: 'viewport',
    frame: 7,
    producerNodeId: 'particle-render',
    producerPortId: 'color',
    lifetime: 'frame',
    width: 640,
    height: 360,
    count: 0,
    byteLength: 0,
    colorSpace: 'linear-hdr',
    format: 'rgba16f',
    revision: color.revision,
    metadata: {}
  });
  assert.deepEqual(tracker.getStats().passes[0].outputResourceIds, [color.id, depth.id]);
  assert.doesNotThrow(() => JSON.stringify(tracker.getStats()));
});

test('resource contracts reject unsupported kinds and mismatched inputs', () => {
  const tracker = new OperatorResourceTracker().beginFrame({ frame: 1 });
  const texture = tracker.create('texture', { width: 10, height: 10 });

  assert.throws(() => tracker.create('audio'), OperatorResourceError);
  assert.throws(() => assertOperatorResource(texture, 'depth'), OperatorResourceError);
  assert.equal(tracker.passthrough(texture, { kind: 'texture' }), texture);
});

test('beginFrame clears frame-local resources while keeping monotonic revisions', () => {
  const tracker = new OperatorResourceTracker().beginFrame({ scope: 'preview', frame: 1 });
  const first = tracker.create('texture');
  tracker.beginFrame({ scope: 'export-frame', frame: 2 });
  const second = tracker.create('texture');

  assert.equal(tracker.getStats().resourceCount, 1);
  assert.equal(second.scope, 'export-frame');
  assert.ok(second.revision > first.revision);
});

test('points resources expose serializable capacity while retaining runtime payloads', () => {
  const tracker = new OperatorResourceTracker().beginFrame({ scope: 'viewport', frame: 3 });
  const geometry = { attributes: { position: { count: 2048 } } };
  const payload = { objects: [{ name: 'runtime-only' }], parameters: { dissolve: 0.5 } };
  const points = tracker.create('points', {
    producerNodeId: 'flow-dissolve',
    producerPortId: 'points',
    geometry,
    object: payload.objects[0],
    payload,
    count: 2048,
    byteLength: 98304,
    metadata: { stage: 'flow-dissolve', dissolve: 0.5 }
  });

  assert.equal(points.geometry, geometry);
  assert.equal(points.payload, payload);
  assert.equal(points.lifetime, 'persistent');
  assert.equal(describeOperatorResource(points).count, 2048);
  assert.equal(describeOperatorResource(points).byteLength, 98304);
  assert.doesNotMatch(JSON.stringify(describeOperatorResource(points)), /runtime-only/);
});

test('recordPass references cached persistent resources in the current diagnostic frame', () => {
  const producer = new OperatorResourceTracker().beginFrame({ scope: 'viewport', frame: 1 });
  const points = producer.create('points', {
    producerNodeId: 'particle-sampler',
    count: 32
  });
  const consumer = new OperatorResourceTracker().beginFrame({ scope: 'export-frame', frame: 9 });
  consumer.recordPass({
    nodeId: 'particle-render',
    type: 'render.particles',
    inputs: [points]
  });

  assert.equal(consumer.getStats().resourceCount, 1);
  assert.equal(consumer.getStats().resources[0].id, points.id);
  assert.deepEqual(consumer.getStats().passes[0].inputResourceIds, [points.id]);
});

test('pool diagnostics are snapshotted without retaining mutable runtime state', () => {
  const tracker = new OperatorResourceTracker().beginFrame({ scope: 'viewport', frame: 6 });
  const stats = { name: 'post-targets', entryCount: 8, activeLeaseCount: 0, entries: [{ refCount: 0 }] };
  tracker.recordPoolStats(stats);
  stats.entries[0].refCount = 9;
  assert.equal(tracker.getStats().poolCount, 1);
  assert.equal(tracker.getStats().pools[0].entries[0].refCount, 0);
  assert.doesNotThrow(() => JSON.stringify(tracker.getStats()));
});

test('managed resource releases and lifetime diagnostics stay runtime-safe', () => {
  let releases = 0;
  const tracker = new OperatorResourceTracker().beginFrame({ scope: 'viewport', frame: 7 });
  const texture = tracker.create('texture', {
    producerNodeId: 'glow',
    release: () => {
      releases += 1;
    }
  });
  assert.equal(texture.release(), true);
  assert.equal(texture.release(), false);
  assert.equal(releases, 1);
  assert.equal(describeOperatorResource(texture).release, undefined);

  const lifetime = { frame: 7, activeResourceCount: 0, entries: [{ id: texture.id, released: true }] };
  tracker.recordLifetimeStats(lifetime);
  lifetime.entries[0].released = false;
  assert.equal(tracker.getStats().lifetime.entries[0].released, true);
  assert.doesNotThrow(() => JSON.stringify(tracker.getStats()));
});
