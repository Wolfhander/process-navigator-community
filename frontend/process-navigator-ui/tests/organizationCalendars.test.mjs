import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createElement,Fragment} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {transformWithOxc} from 'vite';
import {scheduleCsv} from '../src/schedule-export.ts';
const code=(await transformWithOxc(readFileSync(new URL('../src/CalendarProfileEditor.tsx',import.meta.url),'utf8'),'CalendarProfileEditor.tsx',{jsx:{runtime:'classic'}})).code.replace(/^import[^\n]*\n/gm,'').replaceAll('export const ','const ').replaceAll('export function ','function ');
const Editor=new Function('React',code+';return CalendarProfileEditor;')({createElement,Fragment});
const calendar={workdayStart:'22:00',workdayEnd:'06:00',workingDays:[1,2,3,4,5],nonWorkingDates:[],utcOffsetMinutes:180,timeZoneId:'Europe/Berlin'};
test('calendar editor shows night policy, seasonal zone and disables fixed offset',()=>{
 const html=renderToStaticMarkup(createElement(Editor,{value:calendar,onChange(){}}));
 for(const text of ['22:00','06:00','Europe/Berlin','ночная смена','дате начала смены','осенний повтор'])assert.ok(html.includes(text),text);
 assert.match(html,/disabled="" type="number"/);
});
function find(tree,fn){if(Array.isArray(tree))return tree.map(t=>find(t,fn)).find(Boolean);if(!tree||typeof tree!=='object')return;return fn(tree)?tree:find(tree.props?.children,fn);}
test('enabling own profile clones supplied default and does not mutate organization',()=>{
 let changed;const tree=Editor({defaults:calendar,onChange:v=>changed=v});
 find(tree,n=>n.type==='input'&&n.props.type==='checkbox').props.onChange({target:{checked:true}});
 assert.deepEqual(changed,calendar);assert.notEqual(changed,calendar);changed.workingDays.push(0);assert.equal(calendar.workingDays.length,5);
});
test('calendar summary text and provenance are escaped',()=>{
 const html=renderToStaticMarkup(createElement(Editor,{label:'<script>bad</script>',onChange(){}}));
 assert.doesNotMatch(html,/<script>/);assert.match(html,/&lt;script&gt;/);
});
test('schedule CSV preserves step dates, calendar source and named zone',()=>{
 const result={direction:'Forward',anchorDate:'2026-11-09T21:00Z',assumptions:{...calendar,useOrganizationCalendars:true,durationScalePercent:100,transferDelayHours:0,includeWaitTime:true},
 processes:[{processId:'p',processName:'Процесс',startAt:'2026-11-09T21:00Z',endAt:'2026-11-10T01:00Z',durationHours:4,isDateReliable:true,uncertaintyReasons:[],slackHours:0,steps:[{elementId:'step',calendarSource:'Подразделение · Europe/Berlin',startAt:'2026-11-09T21:00Z',endAt:'2026-11-10T01:00Z'}]}]};
 const csv=scheduleCsv(result);for(const text of ['Оргкалендари','Шаг ID','Europe/Berlin','2026-11-10T01:00Z'])assert.ok(csv.includes(text),text);
});
