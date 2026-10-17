import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWorkspace, visitProcess, toggleFavorite, workspaceKey, personalProcessLists } from '../src/personalWorkspace.ts';

test('empty, malformed and unexpected saved data are safe', () => {
  for (const value of [null, '{broken', 'null', '42', '[]']) {
    assert.deepEqual(parseWorkspace(value), { favorites: [], recent: [], filter: 'recent' });
  }
  assert.deepEqual(parseWorkspace('{"favorites":["a","a",null,5,""],"recent":["b"],"filter":"bad"}'), { favorites: ['a'], recent: ['b'], filter: 'recent' });
});
test('recent visits deduplicate, move to front and retain only 20', () => {
  let data = parseWorkspace(null);
  for (let i = 0; i < 25; i++) data = visitProcess(data, `p${i}`);
  assert.equal(data.recent.length, 20);
  data = visitProcess(data, 'p10');
  assert.equal(data.recent[0], 'p10');
  assert.equal(data.recent.length, 20);
  assert.equal(new Set(data.recent).size, 20);
});
test('favorites toggle without changing history or mutating original state', () => {
  const initial = visitProcess(parseWorkspace(null), 'p1');
  const starred = toggleFavorite(initial, 'p2');
  assert.deepEqual(initial.favorites, []);
  assert.deepEqual(starred.favorites, ['p2']);
  assert.deepEqual(toggleFavorite(starred, 'p2'), initial);
});
test('users have distinct storage keys; saved filter roundtrips', () => {
  assert.notEqual(workspaceKey('user/1'), workspaceKey('user%2F1'));
  assert.equal(parseWorkspace(JSON.stringify({ filter: 'favorites' })).filter, 'favorites');
});
test('deleted models and unavailable drafts do not appear in personal lists', () => {
  const catalog = [{ id: 'draft', name: 'Б', status: 'Draft' }, { id: 'published', name: 'А', status: 'Published' }];
  const state = { favorites: ['missing', 'draft', 'published'], recent: ['draft', 'missing', 'published'], filter: 'all' };
  for (const list of Object.values(personalProcessLists(catalog, state, false))) assert.deepEqual(list.map(p => p.id), ['published']);
  assert.deepEqual(personalProcessLists(catalog, state, true).recent.map(p => p.id), ['draft', 'published']);
  assert.deepEqual(personalProcessLists(catalog, state, true).all.map(p => p.id), ['published', 'draft']);
});
