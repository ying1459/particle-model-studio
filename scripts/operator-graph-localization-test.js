import assert from 'node:assert/strict';
import test from 'node:test';
import { BUILTIN_OPERATOR_DEFINITIONS } from '../src/core/operator-graph.js';
import {
  operatorCategoryLabel,
  operatorNodeLabel,
  operatorParamLabel,
  operatorParamOptions,
  operatorPortLabel,
  operatorPortTypeLabel
} from '../src/ui/operator-graph-localization.js';

test('all built-in nodes and categories have understandable Chinese display labels', () => {
  for (const definition of Object.values(BUILTIN_OPERATOR_DEFINITIONS)) {
    const nodeLabel = operatorNodeLabel(definition.type, definition.label);
    const categoryLabel = operatorCategoryLabel(definition.category);
    assert.match(nodeLabel, /[\u3400-\u9fff]/, `${definition.type} is missing a Chinese node label`);
    assert.match(categoryLabel, /[\u3400-\u9fff]/, `${definition.category} is missing a Chinese category label`);
  }
});

test('built-in ports and their data types have Chinese display labels', () => {
  for (const definition of Object.values(BUILTIN_OPERATOR_DEFINITIONS)) {
    for (const port of [...definition.inputs, ...definition.outputs]) {
      assert.match(operatorPortLabel(port.id), /[\u3400-\u9fff]/, `${port.id} is missing a Chinese port label`);
      assert.match(operatorPortTypeLabel(port.type), /[\u3400-\u9fff]/, `${port.type} is missing a Chinese type label`);
    }
  }
});

test('important editable parameters and enum choices are localized without changing stored values', () => {
  const keys = [
    'particleCount',
    'dissolve',
    'dissolveTurbulence',
    'strength',
    'lifetimeMin',
    'glowRadius',
    'glowExposure',
    'aperture',
    'focusDistance',
    'bokehScale'
  ];
  keys.forEach((key) => assert.match(operatorParamLabel(key), /[\u3400-\u9fff]/));

  const emitterModes = operatorParamOptions('simulation.emitter', 'mode');
  assert.deepEqual(emitterModes.map((item) => item.value), ['all', 'continuous', 'burst']);
  assert.ok(emitterModes.every((item) => /[\u3400-\u9fff]/.test(item.label)));
  assert.equal(operatorParamOptions('post.glow', 'glowRadius'), null);
});
