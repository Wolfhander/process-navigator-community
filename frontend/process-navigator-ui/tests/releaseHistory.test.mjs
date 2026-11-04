import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {transformWithOxc} from 'vite';

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

test('compatibility notes are version-specific and distinguish known cases from missing metadata',()=>{
  const notes=releases.filter(release=>release.dataCompatibility);
  assert.deepEqual(new Set(notes.map(release=>release.dataCompatibility.kind)),new Set(['unchanged','additive','manual']));
  for(const {dataCompatibility:note} of notes) for(const field of ['scope','upgrade','rollback']) assert.ok(note[field]?.trim());
  assert.equal(releases[0].dataCompatibility.kind,'unchanged');
  assert.equal(releases.find(release=>release.version==='0.2.0-preview.95-dev').dataCompatibility,undefined);
});

test('version journal renders upgrade and rollback notes and focuses the selected card without a hash link',async()=>{
  const compiled=await transformWithOxc(readFileSync(path.join(root,'src/AppVersionPage.tsx'),'utf8'),'AppVersionPage.tsx',{jsx:{runtime:'classic'}});
  const code=compiled.code.replace(/^import[^\n]*\n/gm,'').replace('export function ','function ');
  const iconNames=['ArrowLeft','CheckCircle2','Clock3','GitBranch','History','MinusCircle','PencilLine','PlusCircle','Wrench'];
  const calls=[];
  const doc={getElementById:id=>{calls.push(id);return {focus:options=>calls.push(options),scrollIntoView:options=>calls.push(options)};}};
  const Page=new Function('React','packageInfo','history','document',...iconNames,code+';return AppVersionPage;')({createElement},packageInfo,releases,doc,...iconNames.map(()=>()=>null));
  const tree=Page({onBack(){},onRoadmap(){}});
  const html=renderToStaticMarkup(tree);
  assert.match(html,/При обновлении/);assert.match(html,/При откате/);
  assert.match(html,/совместимость в журнале не описана/);
  assert.match(html,/id="release-0.2.0-preview.93-dev" tabindex="-1"/);
  assert.doesNotMatch(html,/href="#release-/);
  const find=item=>Array.isArray(item)?item.map(find).find(Boolean):item?.type==='button'&&item.props.children?.includes?.('0.2.0-preview.93-dev')?item:item?.props?find(item.props.children):undefined;
  find(tree).props.onClick();
  assert.deepEqual(calls,['release-0.2.0-preview.93-dev',{preventScroll:true},{block:'start'}]);
});
