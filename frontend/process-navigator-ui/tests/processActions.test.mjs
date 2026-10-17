import assert from 'node:assert/strict';
import test from 'node:test';
import { actionLaunchTarget, normalizedActionKind, safeNavigationTarget } from '../src/process-actions.ts';

test('action kinds are normalized but unknown values stay unsupported', () => {
  assert.equal(normalizedActionKind(' Manual '), 'manual');
  assert.equal(normalizedActionKind('ERP'), 'erp');
  assert.equal(normalizedActionKind('script'), undefined);
});

test('navigation accepts application, web and mail links only', () => {
  assert.equal(safeNavigationTarget('/processes/demo'), '/processes/demo');
  assert.equal(safeNavigationTarget('https://example.org/form'), 'https://example.org/form');
  assert.equal(safeNavigationTarget('mailto:office@example.org'), 'mailto:office@example.org');
  assert.equal(safeNavigationTarget('//host/share'), undefined);
  assert.equal(safeNavigationTarget('javascript:alert(1)'), undefined);
  assert.equal(safeNavigationTarget('C:\\documents\\file.pdf'), undefined);
});

test('file actions only open through the artifact repository resolver', () => {
  const resolver = reference => reference.startsWith('artifact:') ? `/api/files/${reference.slice(9)}` : undefined;
  assert.equal(actionLaunchTarget({ id: 'a', label: 'Файл', kind: 'file', target: 'artifact:instruction' }, resolver), '/api/files/instruction');
  assert.equal(actionLaunchTarget({ id: 'b', label: 'Файл', kind: 'file', target: 'C:\\temp\\file.pdf' }, resolver), undefined);
  assert.equal(actionLaunchTarget({ id: 'c', label: 'Вручную', kind: 'manual', target: 'https://example.org' }, resolver), undefined);
});
