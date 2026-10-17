import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDevelopmentRoadmap, roadmapProgress, roadmapSubtaskProgress } from '../src/development-roadmap.ts';

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

test('nested tasks are explicit, searchable data and never inflate parent completion', () => {
  const steps=parseDevelopmentRoadmap('## Этап\n1. **Маршрут — частично готово.** Описание\n  - [x] **1.1** Навигация\n  - [!] **1.2** Визуальная приёмка\n  - [ ] **1.3** Сквозная инструкция').flatMap(s=>s.steps);
  assert.deepEqual(steps[0].subtasks.map(t=>t.status),['done','verify','planned']);
  assert.equal(roadmapProgress(steps).done,0);
  assert.deepEqual(roadmapSubtaskProgress(steps),{tracked:1,total:3,done:1,verify:1,planned:1});
});

test('wrong-parent, orphan and duplicate task identifiers fail rather than vanish silently',()=>{
  for(const text of [
    '## Этап\n  - [x] **1.1** Без пункта',
    '## Этап\n1. **Один.** План\n  - [x] **2.1** Чужой пункт',
    '## Этап\n1. **Один.** План\n  - [x] **1.1** Повтор\n  - [ ] **1.1** Повтор'
  ]) assert.throws(()=>parseDevelopmentRoadmap(text));
});

test('current roadmap retains 39 complete parent points while exposing tracked recent work',()=>{
  const steps=parseDevelopmentRoadmap(readFileSync(new URL('../../../docs/development-decomposition.md', import.meta.url),'utf8')).flatMap(s=>s.steps);
  assert.equal(roadmapProgress(steps).done,39);
  assert.deepEqual(steps.filter(s=>s.subtasks.length).map(s=>s.id),[77,98,99,100,101]);
  assert.deepEqual(roadmapSubtaskProgress(steps),{tracked:5,total:33,done:18,verify:5,planned:10});
});
