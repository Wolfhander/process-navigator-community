import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const root = new URL('../../../', import.meta.url);
const launcher = readFileSync(new URL('Start-ProcessNavigator.ps1', root), 'utf8');
test('consumer launcher never commits or uploads local data', () => {
  assert.doesNotMatch(launcher, /git\s+(?:add|commit|push)\b/i);
  assert.match(launcher, /'remote', 'set-url', '--push', 'origin', 'DISABLED'/);
  assert.match(launcher, /'pull', '--ff-only'/);
  assert.match(launcher, /Runtime data already exists; import was not performed/);
  assert.match(launcher, /Get-FileHash/);
  assert.match(launcher, /sourcePath = Join-Path \$HomePath 'source'/);
  assert.match(launcher, /runtimePath = Join-Path \$HomePath 'runtime'/);
  assert.match(launcher, /startTicks/);
  assert.match(launcher, /CommandLine.IndexOf\(\$expectedDll/);
});
test('public snapshot retains history as documents, not old repository objects', () => {
  const history = readFileSync(new URL('docs/engineering-timeline.md', root), 'utf8');
  assert.match(history, /\| 131 \|/);
  assert.doesNotMatch(history, /[a-f0-9]{40}|@[a-z0-9.-]+\.[a-z]{2,}/i);
  const readme = readFileSync(new URL('README.md', root), 'utf8');
  assert.match(readme, /данные.*отдельно/);
});
