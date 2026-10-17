import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformWithOxc } from 'vite';
import { Component, createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const source = readFileSync(new URL('../src/ContextErrorBoundary.tsx', import.meta.url), 'utf8');
const compiled = await transformWithOxc(source, 'ContextErrorBoundary.tsx', { jsx: { runtime: 'classic' } });
const code = compiled.code.replace(/import[^;]+from "react";/g, '').replace(/export class /g, 'class ');
const Boundary = new Function('Component', 'React', code + '\nreturn ContextErrorBoundary;')(Component, { createElement });

test('step boundary preserves normal content and offers a safe close after failure', () => {
  let closed = false;
  const boundary = new Boundary({ children: 'card content', onClose: () => { closed = true; } });
  assert.equal(boundary.render(), 'card content');
  boundary.state = Boundary.getDerivedStateFromError(new Error('broken card'));
  const fallback = boundary.render();
  assert.match(renderToStaticMarkup(fallback), /role="alert"/);
  assert.match(renderToStaticMarkup(fallback), /Вернуться к схеме/);
  fallback.props.children.at(-1).props.onClick();
  assert.equal(closed, true);
  assert.equal(new Boundary({ children: 'next card' }).render(), 'next card');
});

test('selecting another process or step remounts the failed card boundary', () => {
  const panel = readFileSync(new URL('../src/ContextPanel.tsx', import.meta.url), 'utf8');
  assert.match(panel, /ContextErrorBoundary key=\{`\$\{props.processId\}:\$\{props.node\?\.id/);
});
