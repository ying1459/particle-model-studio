import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OperatorResourcePool,
  OperatorResourcePoolError,
  createOperatorPoolKey,
  normalizeOperatorPoolDescriptor
} from '../src/core/operator-resource-pool.js';

test('pool descriptors normalize deterministically across property order', () => {
  const left = { kind: 'render-target', width: 640.8, height: 360.2, depthBuffer: true, format: 'rgba16f' };
  const right = { format: 'rgba16f', depthBuffer: true, height: 360.2, width: 640.8, kind: 'render-target' };
  assert.equal(createOperatorPoolKey(left), createOperatorPoolKey(right));
  assert.deepEqual(normalizeOperatorPoolDescriptor(left), {
    kind: 'render-target',
    byteLength: 0,
    depthBuffer: true,
    format: 'rgba16f',
    height: 360,
    width: 640
  });
});

test('adopted resources are leased and reused across frames without allocation', () => {
  const target = { name: 'preallocated' };
  const descriptor = { kind: 'render-target', width: 320, height: 180, depthBuffer: true };
  const pool = new OperatorResourcePool({ name: 'post-targets' });
  pool.adopt(target, descriptor, { label: 'scene' });

  pool.beginFrame({ scope: 'viewport', frame: 1 });
  const first = pool.acquire(descriptor, { ownerNodeId: 'particle-render' });
  assert.equal(first.resource, target);
  assert.equal(first.allocated, false);
  first.release();
  assert.equal(pool.endFrame().activeLeaseCount, 0);

  pool.beginFrame({ scope: 'export', frame: 2 });
  const second = pool.acquire({ depthBuffer: true, height: 180, width: 320, kind: 'render-target' });
  second.release();
  const stats = pool.endFrame();
  assert.equal(stats.reuses, 1);
  assert.equal(stats.totalReuses, 2);
  assert.equal(stats.totalAllocations, 0);
});

test('concurrent matching leases allocate overflow once and reuse it later', () => {
  let created = 0;
  const descriptor = { kind: 'buffer', byteLength: 4096, usage: 'storage' };
  const pool = new OperatorResourcePool({
    name: 'buffers',
    create: () => ({ id: `buffer-${++created}` })
  });
  pool.beginFrame({ frame: 1 });
  const first = pool.acquire(descriptor);
  const second = pool.acquire(descriptor);
  assert.notEqual(first.resource, second.resource);
  assert.equal(pool.getStats().allocations, 2);
  first.release();
  second.release();
  pool.endFrame();

  pool.beginFrame({ frame: 2 });
  const reused = pool.acquire(descriptor);
  assert.equal(reused.allocated, false);
  reused.release();
  assert.equal(pool.endFrame().totalAllocations, 2);
  assert.equal(created, 2);
});

test('reference counts and strict frame boundaries detect leaked leases', () => {
  const pool = new OperatorResourcePool({
    create: () => ({})
  }).beginFrame({ frame: 4 });
  const lease = pool.acquire({ kind: 'data', byteLength: 64 });
  assert.equal(pool.retain(lease), 2);
  assert.equal(lease.release(), 1);
  assert.throws(() => pool.endFrame(), OperatorResourcePoolError);
  assert.equal(lease.release(), 0);
  assert.doesNotThrow(() => pool.endFrame());
});

test('dispose owns factory allocations but preserves adopted resources by default', () => {
  const disposed = [];
  const adopted = { id: 'adopted' };
  const pool = new OperatorResourcePool({
    create: () => ({ id: 'owned' }),
    dispose: (resource) => disposed.push(resource.id)
  });
  pool.adopt(adopted, { kind: 'texture', width: 1, height: 1 });
  pool.beginFrame({ frame: 1 });
  const adoptedLease = pool.acquire({ kind: 'texture', width: 1, height: 1 });
  const ownedLease = pool.acquire({ kind: 'texture', width: 1, height: 1 });
  adoptedLease.release();
  ownedLease.release();
  pool.endFrame();
  pool.dispose();
  assert.deepEqual(disposed, ['owned']);
});
