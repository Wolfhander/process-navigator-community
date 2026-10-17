import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageInfo = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const releases = JSON.parse(readFileSync(path.join(root, 'src/release-history.json'), 'utf8'));
const backendProject = readFileSync(path.resolve(root, '../../backend/ProcessNavigator.Api/ProcessNavigator.Api.csproj'), 'utf8');

test('current application version is consistent across UI, API and history', () => {
  assert.equal(releases[0].version, packageInfo.version);
  assert.match(backendProject, new RegExp(`<Version>${packageInfo.version.replaceAll('.', '\\.')}</Version>`));
  assert.ok(releases[0].date === null || /^\d{4}-\d{2}-\d{2}$/.test(releases[0].date));
});

test('each application release has unique version and documented changes', () => {
  assert.equal(new Set(releases.map(release => release.version)).size, releases.length);
  for (const release of releases) {
    assert.ok(release.stage);
    assert.ok(release.date === null || /^\d{4}-\d{2}-\d{2}$/.test(release.date));
    assert.ok(['added', 'changed', 'fixed', 'removed'].every(key => Array.isArray(release[key])));
    assert.ok(release.added.length + release.changed.length + release.fixed.length + release.removed.length > 0);
  }
});
