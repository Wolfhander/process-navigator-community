import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createDemoContour, resetDemoContour } from '../../../tools/reset-demo-contour.mjs';

test('fresh demo resolves every organization, unit and child process reference', () => {
  const { models, organization, files } = createDemoContour();
  assert.equal(models.length, 10);
  const ids = new Set(models.map(model => model.id));
  for (const model of models) {
    const context = JSON.parse(files.get(`${model.id}.context.json`));
    for (const lane of model.lanes) assert.ok(organization.legalEntities.find(entity => entity.id === lane.entity)?.units.some(unit => unit.id === lane.unit));
    for (const step of model.steps) if (step.linkedProcessId) {
      assert.ok(ids.has(step.linkedProcessId));
      assert.equal(models.find(child => child.id === step.linkedProcessId).level, model.level + 1);
    }
    for (const step of model.steps.filter(step => !step.type?.endsWith('Gateway'))) {
      assert.ok(context.elements[step.id].inputs.length);
      assert.ok(context.elements[step.id].expectedResult);
    }
  }
});

test('demo distinguishes system processing, human work and financial receipt', () => {
  const { files } = createDemoContour();
  const xml = files.get('demo-showcase-l3-warehouse.bpmn');
  assert.match(xml, /bpmn:serviceTask/);
  assert.match(xml, /bpmn:userTask/);
  assert.match(xml, /bpmn:manualTask/);
  const context = JSON.parse(files.get('demo-showcase-l3-warehouse.context.json'));
  assert.equal(context.elements.Task_SystemNotice.executionMode, 'system');
  assert.match(context.elements.Task_SystemNotice.description, /подтверждается вручную/);
});

test('reset previews, backs up old data and removes process history without changing users or keys', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pn-demo-reset-'));
  const data = path.join(root, 'backend', 'ProcessNavigator.Api', 'Data');
  fs.mkdirSync(path.join(data, 'Drafts'), { recursive: true });
  fs.mkdirSync(path.join(data, 'Users'));
  fs.mkdirSync(path.join(data, 'Keys'));
  fs.mkdirSync(path.join(data, 'SchedulePlans'));
  fs.writeFileSync(path.join(data, 'SchedulePlans', 'example.json'), 'plan-history');
  fs.writeFileSync(path.join(data, '..', 'ProcessNavigator.Api.csproj'), '<Project/>');
  fs.writeFileSync(path.join(data, 'organization.json'), '{"name":"old"}');
  fs.writeFileSync(path.join(data, 'old.bpmn'), '<old/>');
  fs.writeFileSync(path.join(data, 'Drafts', 'old.context.json'), '{}');
  fs.writeFileSync(path.join(data, 'Users', 'users.json'), 'users');
  fs.writeFileSync(path.join(data, 'Keys', 'key.xml'), 'key');
  try {
    assert.equal(resetDemoContour(root).preview, true);
    assert.ok(fs.existsSync(path.join(data, 'old.bpmn')));
    const result = resetDemoContour(root, true);
    assert.equal(fs.readFileSync(path.join(result.backup, 'old.bpmn'), 'utf8'), '<old/>');
    assert.ok(!fs.existsSync(path.join(data, 'old.bpmn')));
    assert.ok(!fs.existsSync(path.join(data, 'Drafts')));
    assert.ok(!fs.existsSync(path.join(data, 'SchedulePlans')));
    assert.equal(fs.readFileSync(path.join(result.backup, 'SchedulePlans', 'example.json'), 'utf8'), 'plan-history');
    assert.equal(fs.readFileSync(path.join(data, 'Users', 'users.json'), 'utf8'), 'users');
    assert.equal(fs.readFileSync(path.join(data, 'Keys', 'key.xml'), 'utf8'), 'key');
    assert.equal(fs.readdirSync(data).filter(file => file.endsWith('.bpmn')).length, 10);
    resetDemoContour(root, true);
    assert.equal(fs.readdirSync(data).filter(file => file.endsWith('.bpmn')).length, 10);
  } finally {
    assert.equal(path.dirname(root), fs.realpathSync(os.tmpdir()));
    fs.rmSync(root, { recursive: true });
  }
});
