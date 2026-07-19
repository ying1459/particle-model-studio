import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OperatorResourceLifetime,
  OperatorResourceLifetimeError
} from '../src/core/operator-resource-lifetime.js';

function managedResource(id, releases) {
  return {
    id,
    kind: 'texture',
    release() {
      releases.push(id);
    }
  };
}

test('lifetime preserves aliased resources until every branch consumes them', () => {
  const releases = [];
  const resource = managedResource('shared-color', releases);
  const lifetime = new OperatorResourceLifetime().beginFrame({ scope: 'viewport', frame: 4 });

  lifetime.publish({ nodeId: 'render', portId: 'color', value: resource, consumerCount: 2 });
  lifetime.publish({ nodeId: 'bypass', portId: 'color', value: resource, consumerCount: 1 });
  lifetime.consume({ nodeId: 'bypass', portId: 'color', value: resource });
  lifetime.consume({ nodeId: 'branch-output', portId: 'color', value: resource });
  assert.deepEqual(releases, []);
  lifetime.consume({ nodeId: 'bypass-output', portId: 'color', value: resource });

  const stats = lifetime.endFrame();
  assert.deepEqual(releases, ['shared-color']);
  assert.equal(stats.aliasPublications, 1);
  assert.equal(stats.plannedConsumers, 3);
  assert.equal(stats.consumedConsumers, 3);
  assert.equal(stats.activeResourceCount, 0);
});

test('zero-consumer outputs release immediately and strict end detects leaks', () => {
  const releases = [];
  const unused = managedResource('unused', releases);
  const leaked = managedResource('leaked', releases);
  const lifetime = new OperatorResourceLifetime().beginFrame({ frame: 8 });

  lifetime.publish({ nodeId: 'render', portId: 'unused', value: unused, consumerCount: 0 });
  lifetime.publish({ nodeId: 'render', portId: 'color', value: leaked, consumerCount: 1 });
  assert.deepEqual(releases, ['unused']);
  assert.throws(() => lifetime.endFrame(), OperatorResourceLifetimeError);
  const stats = lifetime.abort();
  assert.deepEqual(releases, ['unused', 'leaked']);
  assert.equal(stats.zeroConsumerReleases, 1);
  assert.equal(stats.aborted, true);
  assert.equal(stats.activeResourceCount, 0);
});
