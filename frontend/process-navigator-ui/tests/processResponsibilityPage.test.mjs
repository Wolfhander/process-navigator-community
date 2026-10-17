import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformWithOxc } from 'vite';
import { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildResponsibilityView } from '../src/process-responsibility.ts';
const source = await transformWithOxc(readFileSync(new URL('../src/ProcessResponsibilityPage.tsx',import.meta.url),'utf8'),'ProcessResponsibilityPage.tsx',{ jsx:{ runtime:'classic' } });
const code = source.code.replace(/import[^;]+;/g,'').replace('export function ','function ');
const process = { id:'p', name:'Процесс', version:'1', lanes:[{ id:'a',name:'<script>Отдел</script>' }], nodes:[{ id:'one',type:'task',name:'Действие',laneId:'a' }], edges:[] };
function render(error = '') {
  const values = [undefined,error,0,'',''];
  const Page = new Function('React','useState','useEffect','useMemo','buildResponsibilityView',code+'\nreturn ProcessResponsibilityPage;')(
    { createElement,Fragment },()=>[values.shift(),()=>{}],()=>{},callback=>callback(),buildResponsibilityView);
  return renderToStaticMarkup(Page({ process,edition:'Архивная версия',onBack:()=>{},onSelect:()=>{ throw Error('No automatic navigation'); } }));
}
test('read-only responsibility page distinguishes current directories from historical schema and receipt facts', () => {
  const html = render();
  assert.match(html,/Архивная версия/); assert.match(html,/не исторический снимок/);
  assert.match(html,/не факт исполнения или подтверждение приёмки/);
  assert.match(html,/Это не означает их отсутствие/); assert.doesNotMatch(html,/<script>/);
});
test('organization error preserves route and retry instead of treating unknown mappings as confirmed', () => {
  const html = render('Справочник недоступен');
  assert.match(html,/role="alert"/); assert.match(html,/Обновить оргструктуру/); assert.match(html,/Действие/);
});
