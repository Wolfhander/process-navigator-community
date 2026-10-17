import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformWithOxc } from 'vite';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const source = readFileSync(new URL('../src/StepEvidence.tsx', import.meta.url), 'utf8');
const compiled = await transformWithOxc(source, 'StepEvidence.tsx', { jsx: { runtime: 'classic' } });
const exports = new Function('React', compiled.code.replace(/export\s*\{[^}]*\};?/gs, '').replace(/export function /g, 'function ') + '\nreturn { StepEvidenceList };')({ createElement });

test('step evidence renders absent, null and empty API values without crashing', () => {
  for (const entries of [undefined, null, []]) {
    assert.equal(renderToStaticMarkup(createElement(exports.StepEvidenceList, { entries })), '');
  }
});

test('step evidence still renders populated sources', () => {
  const markup = renderToStaticMarkup(createElement(exports.StepEvidenceList, {
    entries: [{ status: 'fact', statement: 'Test statement', source: 'Test source' }],
  }));
  assert.match(markup, /Test statement/);
  assert.match(markup, /Test source/);
});
