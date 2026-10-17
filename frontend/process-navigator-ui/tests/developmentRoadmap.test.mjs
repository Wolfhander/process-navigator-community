import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDevelopmentRoadmap, roadmapProgress } from '../src/development-roadmap.ts';

test('roadmap contains every numbered step once, directly from the maintained plan', () => {
  const stages = parseDevelopmentRoadmap(readFileSync(new URL('../../../docs/development-decomposition.md', import.meta.url), 'utf8'));
  const steps = stages.flatMap(stage => stage.steps);
  assert.deepEqual(steps.map(step => step.id), Array.from({ length: 103 }, (_, i) => i + 1));
  assert.ok(steps.every(step => step.detail && step.title));
  assert.equal(steps.filter(step => step.status === 'later').length, 4);
});

test('partial completion and acceptance are not counted as completed', () => {
  const steps = parseDevelopmentRoadmap('## Этап\n1. **Один — готово.** Проверено\n2. **Два — готово базово.** Ещё работа\n3. **Три — проверить на данных.** Приёмка\n4. **Четыре.** В планах').flatMap(stage => stage.steps);
  assert.deepEqual(steps.map(step => step.status), ['done', 'partial', 'verify', 'planned']);
  assert.deepEqual(roadmapProgress(steps), { done: 1, total: 4, percent: 25 });
  assert.equal(roadmapProgress([]).percent, 0);
});
