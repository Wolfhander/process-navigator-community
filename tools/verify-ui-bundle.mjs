import { readdirSync, statSync } from 'node:fs';
import assert from 'node:assert/strict';

const assets = new URL('../frontend/process-navigator-ui/dist/assets/', import.meta.url);
const files = readdirSync(assets).filter(name => name.endsWith('.js'));
assert.ok(files.length > 0, 'Build UI before checking its bundle');
for (const name of files) assert.ok(statSync(new URL(name, assets)).size <= 600_000, `JavaScript chunk exceeds 600 kB: ${name}`);
for (const module of ['DevelopmentRoadmapPage', 'PortfolioAnalyticsDialog', 'ImportDialog', 'OrganizationAdminDialog', 'ProcessSchedulePage']) {
  assert.ok(files.some(name => name.startsWith(module + '-')), `Missing deferred module: ${module}`);
}
console.log(`Bundle check passed: ${files.length} JS chunks, each within 600 kB.`);
