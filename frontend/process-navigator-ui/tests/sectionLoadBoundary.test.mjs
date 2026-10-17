import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformWithOxc } from 'vite';
import { Component, createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const compiled = await transformWithOxc(readFileSync(new URL('../src/SectionLoadBoundary.tsx', import.meta.url), 'utf8'), 'SectionLoadBoundary.tsx', { jsx: { runtime: 'classic' } });
const code = compiled.code.replace(/import[^;]+from "react";/g, '').replace(/export class /g, 'class ');
const Boundary = new Function('Component', 'React', code + '\nreturn SectionLoadBoundary;')(Component, { createElement });

test('section load failure offers a route home without losing the application shell', () => {
  let returned = false;
  const boundary = new Boundary({ children: 'section', onHome: () => { returned = true; } });
  assert.equal(boundary.render(), 'section');
  boundary.state = Boundary.getDerivedStateFromError(new Error('module unavailable'));
  const fallback = boundary.render();
  assert.match(renderToStaticMarkup(fallback), /role="alert"/);
  fallback.props.children[2].props.onClick();
  assert.equal(returned, true);
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.ok(app.indexOf('</header>') < app.indexOf('<SectionLoadBoundary'));
  assert.match(app, /key=\{`\$\{sectionVisit\}/);
});
