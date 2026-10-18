import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {appSections,readSectionLocation,sectionLocationHash,readAnalyticsTab,isSectionAvailable} from '../src/section-location.ts';
import {readProcessLocation} from '../src/process-location.ts';
import {analyticsViews} from '../src/analytics-views.ts';

test('every primary section roundtrips through a stable local hash; home retains legacy empty address',()=>{
  assert.equal(sectionLocationHash('home'),'');
  for(const section of appSections)assert.equal(readSectionLocation(sectionLocationHash(section)),section);
  assert.equal(appSections.length,18);
});
test('legacy process links take precedence and preserve edition, element and representation',()=>{
  const hash='#page=analytics&process=demo&step=task-1&edition=draft&view=instruction';
  assert.equal(readSectionLocation(hash),undefined);assert.deepEqual(readProcessLocation(hash),{processId:'demo',elementId:'task-1',draft:true,version:undefined,view:'instruction'});
});
test('unknown, external, duplicate and control-character sections cannot become navigation targets',()=>{
  for(const hash of ['#page=https://example.com','#page=unknown','#page=users&page=home','#page=%00users','#page=../../users','#page=',''])assert.equal(readSectionLocation(hash),'home');
});
test('all analytics tabs survive F5 and invalid tab values fall back to overview',()=>{
  for(const tab of analyticsViews)assert.equal(readAnalyticsTab(sectionLocationHash('analytics',tab)),tab);
  assert.equal(readAnalyticsTab('#page=analytics&tab=history&tab=departments'),'overview');
  assert.equal(readAnalyticsTab('#page=analytics&tab=javascript:alert(1)'),'overview');
});
test('direct page URLs mirror existing card permissions and do not grant administrator UI access',()=>{
  for(const section of ['organization','directions','auditLog','users','analytics','import','importHistory','catalogAudit'])assert.equal(isSectionAvailable(section,['process.view']),false);
  for(const section of ['home','settings','version','roadmap','map','catalog','informationObjects','help','schedule','evidenceRegister'])assert.equal(isSectionAvailable(section,['process.view']),true);
  assert.equal(isSectionAvailable('catalogAudit',['process.context.edit']),true);assert.equal(isSectionAvailable('organization',['system.manage']),true);
});
test('App restores section identity, lazy organization data and protects history while BPMN editor is open',()=>{
  const app=readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8');
  assert.match(app,/useState\(\(\) => readSectionLocation\(window.location.hash\)\)/);
  assert.match(app,/sectionLocationHash\(portfolioAnalyticsOpen/);
  assert.match(app,/locationSynchronized.current && meaningful/);
  assert.match(app,/if \(editorOpen\)\s*\{/);
  assert.match(app,/Сначала сохраните или закройте редактор/);
  assert.match(app,/homeSection === 'organization' && !organizationEditor && organizationIdentity/);
  assert.match(app,/!sectionAccessible \? <main/);
});
