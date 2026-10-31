import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformWithOxc } from 'vite';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const compiled = await transformWithOxc(readFileSync(new URL('../src/ScheduleServerArchive.tsx', import.meta.url), 'utf8'), 'ScheduleServerArchive.tsx', { jsx: { runtime: 'classic' } });
const code = compiled.code.replace(/import[^;]+;/g, '').replace('export function ', 'function ');
const item = { id: 'a', name: '<script>plan</script>', savedAt: '2026-10-17T09:00Z', processCount: 2, startAt: '2026-10-17T09:00Z', endAt: '2026-10-17T17:00Z', complete: false };
function setup(items, load = async () => ({}), restore = () => {}, check=async()=>({}), replay=async()=>({}),initialReplay) {
  const state = [items, '', false, '', '',undefined,initialReplay],updates={};let index=0;
  let cleanup;
  const Component = new Function('React', 'useState', 'useEffect', 'useRef', 'listServerSchedules', 'loadServerSchedule','checkServerSchedule','replayServerSchedule', code + '\nreturn ScheduleServerArchive;')(
    { createElement }, () => {const i=index++;return[state[i],v=>{updates[i]=v;}];}, effect => { cleanup = effect(); }, value => ({ current: value }),
    () => { throw Error('No background list request during render'); }, load,check,replay);
  return { tree: Component({ dirty: false, busy: false, onRestore: restore }),updates, cleanup: () => cleanup?.() };
}
function find(element, predicate) {
  if (Array.isArray(element)) return element.map(child => find(child, predicate)).find(Boolean);
  if (!element || typeof element !== 'object') return undefined;
  return predicate(element) ? element : find(element.props?.children, predicate);
}
test('server archive is explicit about scope and does not fetch every render', () => {
  const html = renderToStaticMarkup(setup([]).tree);
  assert.match(html, /тому же серверу с тем же профилем/);
  assert.match(html, /не облачная синхронизация/);
  assert.match(html, /Доступных архивных расчётов нет/);
});
test('archived names are escaped, preliminary results remain labelled', () => {
  const html = renderToStaticMarkup(setup([item]).tree);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /предварительный расчёт/);
  assert.match(html, /Открыть и сверить актуальность/);
});
test('loading snapshot after profile unmount cannot restore it into another profile', async () => {
  let resolve, restored = 0;
  const pending = new Promise(done => { resolve = done; });
  const app = setup([item], () => pending, () => { restored++; });
  find(app.tree, node => node.type === 'button' && node.props.children === 'Открыть и сверить актуальность').props.onClick();
  app.cleanup(); resolve({ id: 'a' });
  await new Promise(done => setImmediate(done));
  assert.equal(restored, 0);
});

test('opening restores historical dates then automatically checks live freshness without applying new result',async()=>{
 const events=[],snapshot={id:'a',result:{endAt:'old'}},report={status:'Changed',currentResult:{endAt:'new'}};
 const app=setup([item],async()=>{events.push('load');return snapshot;},s=>events.push(s.result.endAt),async()=>{events.push('check');return report;});
 find(app.tree,n=>n.type==='button'&&n.props.children==='Открыть и сверить актуальность').props.onClick();
 await new Promise(done=>setImmediate(done));
 assert.deepEqual(events,['load','old','check']);assert.equal(app.updates[5],report);
});
test('freshness failure leaves restored history and reports error rather than claiming currency',async()=>{
 let restored=0;const app=setup([item],async()=>({id:'a'}),()=>restored++,async()=>{throw Error('Network unavailable');});
 find(app.tree,n=>n.type==='button'&&n.props.children==='Открыть и сверить актуальность').props.onClick();
 await new Promise(done=>setImmediate(done));assert.equal(restored,1);assert.equal(app.updates[3],'Network unavailable');assert.equal(app.updates[5],undefined);assert.match(app.updates[4],/актуальность не установлена/);
});
test('frozen replay is explicit, serialized, and does not restore or overwrite displayed calculation',async()=>{
 let calls=0,restored=0,resolve;
 const app=setup([item],undefined,()=>restored++,undefined,()=>{calls++;return new Promise(r=>{resolve=r;});});
 const button=find(app.tree,n=>n.type==='button'&&n.props.children==='Повторить по сохранённым исходникам');
 button.props.onClick();button.props.onClick();assert.equal(calls,1);const report={status:'Reproduced'};resolve(report);
 await new Promise(done=>setImmediate(done));assert.equal(app.updates[6],report);assert.equal(restored,0);
});
test('unmounted profile ignores late frozen replay response',async()=>{
 let resolve;const app=setup([item],undefined,undefined,undefined,()=>new Promise(r=>{resolve=r;}));
 find(app.tree,n=>n.type==='button'&&n.props.children==='Повторить по сохранённым исходникам').props.onClick();
 app.cleanup();resolve({status:'Reproduced'});await new Promise(done=>setImmediate(done));assert.equal(app.updates[6],undefined);
});
test('replay outcomes are distinct and server messages are escaped',()=>{
 for(const [status,label]of [['Reproduced','Результат воспроизведён'],['Different','Результат отличается'],['Unavailable','Повторение недоступно']]){
   const html=renderToStaticMarkup(setup([],undefined,undefined,undefined,undefined,{status,snapshotId:'a',checkedAt:'2026-10-31T09:00Z',messages:['<script>bad</script>']}).tree);
   assert.ok(html.includes(label));assert.match(html,/&lt;script&gt;bad/);assert.doesNotMatch(html,/<script>/);
 }
});
test('late automatic freshness response is discarded after profile unmount',async()=>{
 let resolve;const app=setup([item],async()=>({id:'a'}),undefined,()=>new Promise(r=>{resolve=r;}));
 find(app.tree,n=>n.type==='button'&&n.props.children==='Открыть и сверить актуальность').props.onClick();
 await new Promise(done=>setImmediate(done));app.cleanup();resolve({status:'Current'});await new Promise(done=>setImmediate(done));assert.equal(app.updates[5],undefined);
});
