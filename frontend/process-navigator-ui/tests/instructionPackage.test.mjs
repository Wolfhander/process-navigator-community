import test from 'node:test';
import assert from 'node:assert/strict';
import {collectInstructionPackage,instructionPackageHtml} from '../src/instruction-package.ts';
const model=(id,children=[])=>({id,name:id,version:'1',status:'Published',lanes:[],edges:[],nodes:children.map((child,i)=>({id:id+i,name:'Шаг '+i,type:'task',linkedProcessId:child}))});
const signal=()=>new AbortController().signal;
test('collection retains repeated child occurrences, caches reads and uses selected versions',async()=>{
  const root=model('root',['a','a']);const child=model('a',['b']);const leaf=model('b');
  const calls=[];const before=JSON.stringify(root);
  const result=await collectInstructionPackage(root,'Архив',{'a':'2'},async(id,version)=>{calls.push([id,version]);return id==='a'?{...child,version:'2'}:leaf;},signal());
  assert.deepEqual(result.entries.map(e=>e.model.id),['root','a','b','a','b']);
  assert.deepEqual(calls,[['a','2'],['b',undefined]]);
  assert.equal(result.issues.length,0);assert.equal(result.entries[0].edition,'Архив');
  assert.equal(JSON.stringify(root),before);
});
test('cycles, failures, wrong versions and draft fallback remain explicit',async()=>{
  const result=await collectInstructionPackage(model('root',['root','missing','draft','wrong']),'Черновик',{},async id=>{
    if(id==='missing')throw Error('Недоступно');
    return {...model(id==='wrong'?'other':id),status:id==='draft'?'Draft':'Published'};
  },signal());
  assert.equal(result.entries.length,1);assert.equal(result.issues.length,4);
  assert.match(result.issues[0],/цикл/);
  const pinned=await collectInstructionPackage(model('root',['a']),'Действующая',{a:'9'},async()=>model('a'),signal());
  assert.match(pinned.issues[0],/другая модель/);
});
test('cancellation never converts an aborted read into a successful partial package',async()=>{
  const controller=new AbortController();
  await assert.rejects(()=>collectInstructionPackage(model('r',['a']),'root',{},async()=>{controller.abort();return model('a');},controller.signal),/отменён/);
});
test('depth, inclusion, request and reference limits stop reads and record omissions',async()=>{
  let calls=0;
  const result=await collectInstructionPackage(model('root',Array.from({length:250},(_,i)=>'c'+i)),'root',{},async id=>{calls++;return model(id);},signal());
  assert.ok(calls<=40);assert.ok(result.entries.length<=40);assert.ok(result.issues.length);
  const deep=await collectInstructionPackage(model('0',['1']),'root',{},async id=>model(id,[String(Number(id)+1)]),signal());
  assert.equal(deep.entries.length,8);assert.match(deep.issues[0],/глубины/);
});
test('node budget and duplicate identifiers do not silently yield a complete document',async()=>{
  const huge={...model('big'),nodes:Array.from({length:10001},(_,i)=>({id:String(i)}))};
  const result=await collectInstructionPackage(huge,'root',{},async()=>{throw Error('no load');},signal());
  assert.equal(result.entries.length,0);assert.ok(result.issues.length);
  const duplicate={...model('dup'),nodes:[{id:'x'},{id:'x'}]};
  assert.match((await collectInstructionPackage(duplicate,'root',{},async()=>duplicate,signal())).issues[0],/повторяются/);
});
test('HTML includes every element and edge, escapes hostile text, and never creates executable links',()=>{
  const process=model('<script>alert(1)</script>');
  process.nodes=Array.from({length:201},(_,i)=>({id:'n'+i,name:'Элемент '+i,type:i===0?'parallelGateway':'task',instruction:'Текст '+i,artifacts:[{name:'Материал',reference:'javascript:alert(1)'}]}));
  process.edges=[{id:'return',sourceId:'n200',targetId:'n0',label:'Нет <img src=x onerror=alert(1)>'},{id:'broken',sourceId:'n0',targetId:'gone'}];
  const html=instructionPackageHtml({entries:[{model:process,path:[process.name],edition:'Архив'}],issues:['Ошибка <script>'],capturedAt:'now'});
  assert.match(html,/Элемент 200/);assert.match(html,/Текст 200/);assert.match(html,/ОБРЫВ ССЫЛКИ/);assert.match(html,/Параллельный шлюз/);
  assert.match(html,/НЕПОЛНЫЙ ДОКУМЕНТ/);assert.match(html,/Content-Security-Policy/);
  assert.doesNotMatch(html,/<script>|<img|href=|onclick=/);
  assert.match(html,/&lt;script&gt;/);
});
test('oversized report is rejected rather than truncated',()=>{
  const process={...model('p'),nodes:[{id:'a',name:'a',type:'task',instruction:'x'.repeat(8000001)}]};
  assert.throws(()=>instructionPackageHtml({entries:[{model:process,path:['p'],edition:'root'}],issues:[],capturedAt:'now'}),/8 млн/);
});
