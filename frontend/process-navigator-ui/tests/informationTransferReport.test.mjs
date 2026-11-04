import test from 'node:test';
import assert from 'node:assert/strict';
import {informationTransfers} from '../src/information-transfers.ts';
import {explicitTransferChannels,filterTransfers,summarizeTransfers,transferFacts,transferPage,transferCsv} from '../src/information-transfer-report.ts';
const occurrence=(processId,elementId)=>({processId,processName:processId,scope:'Step',elementId,elementName:elementId,required:true,version:'2',condition:'После проверки'});
const object={id:'doc',name:'Чертёж',version:'2',lifecycleState:'Active',producers:[occurrence('cad','a'),occurrence('cad','b')],consumers:[occurrence('erp','c'),occurrence('erp','d')],externalSource:'Клиент'};
const rows=informationTransfers([object]).rows;
const models={cad:{nodes:[{id:'a',laneId:'l',channels:[{id:'mail',label:'=почта',kind:'email',direction:'output',documentName:'=чертёж'}],systemName:'PLM'},{id:'b',laneId:'l'}]},erp:{nodes:[{id:'c',laneId:'r',systemName:'ERP'},{id:'d',laneId:'r'}]}};
const facts=transferFacts(rows,models);
const meta={generatedAt:'2026-10-31',registryGeneratedAt:'2026-10-30',query:'',built:4,limited:false,modelLimit:false,failures:[]};
test('explicit channels are separated from generic channels and scoped to endpoint direction',()=>{
  const linked=structuredClone(models);
  const source={...rows[0].source,direction:'Producer'};
  linked.cad.nodes[0].channels.push(
    {id:'exact',label:'Бумажный оригинал',kind:'paper',direction:'output',flow:'parallel',objectId:'doc'},
    {id:'wrong',label:'Вход',kind:'email',direction:'input',objectId:'doc'},
    {id:'other',label:'Тот же заголовок',kind:'paper',direction:'output',objectId:'other'});
  const row={...rows[0],source};
  const resolved=transferFacts([row],linked);
  assert.deepEqual(explicitTransferChannels('doc',source,resolved).map(c=>c.id),['exact']);
  const [header,data]=parseCsv(transferCsv([row],resolved,meta));
  assert.match(data[header.indexOf('Источник: Каналы объекта по ID')],/^exact:.*Бумажный оригинал$/);
  assert.match(data[header.indexOf('Источник: Каналы этапа')],/Тот же заголовок/);
});
function parseCsv(csv){
  const rows=[];let row=[],cell='',quoted=false;
  for(let i=1;i<csv.length;i++){const c=csv[i];if(c==='"'){if(quoted&&csv[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(!quoted&&c===';'){row.push(cell);cell='';}else if(!quoted&&c==='\r'&&csv[i+1]==='\n'){row.push(cell);rows.push(row);row=[];cell='';i++;}else cell+=c;}
  return rows;
}
test('summary counts unique endpoints rather than pair multiplicity and never merges equal names with different IDs',()=>{
  const extra={...object,id:'other',producers:[],consumers:[occurrence('erp','c')]};
  const groups=summarizeTransfers(informationTransfers([object,extra]).rows);
  assert.deepEqual(groups.map(g=>[g.id,g.pairs,g.sources,g.targets,g.missingSource,g.missingTarget]),[['doc',4,2,2,false,false],['other',1,0,1,true,false]]);
});
test('search covers exact identifiers, versions, conditions, external parties and channel labels',()=>{
  assert.equal(filterTransfers(rows,'cad',facts).length,4);
  assert.equal(filterTransfers(rows,'=ПОЧТА',facts).length,2);
  assert.equal(filterTransfers(rows,'Клиент',facts).length,4);
  assert.equal(filterTransfers(rows,'После проверки',facts).length,4);
  assert.equal(filterTransfers(rows,'нет такого',facts).length,0);
});
test('external parties are searchable and exported without fabricating internal endpoints',()=>{
  const parties=[{direction:'source',role:'supplier',name:'Завод',channel:'Портал'},{direction:'recipient',role:'regulator',name:'Регулятор'}];
  const row={...rows[0],target:undefined,object:{...object,externalParties:parties}};
  assert.equal(filterTransfers([row],'Портал',facts).length,1);
  const [header,record]=parseCsv(transferCsv([row],facts,meta));
  assert.deepEqual(JSON.parse(record[header.indexOf('Внешние участники JSON')]),parties);
  assert.equal(record[header.indexOf('Получатель: Сведения модели')],'Не указан в реестре');
});
test('pagination does not truncate export and resets stale page indices safely',()=>{
  const many=Array.from({length:1000},(_,i)=>({...rows[0],object:{...object,id:String(i)}}));
  assert.equal(transferPage(many,0).rows.length,100);assert.equal(transferPage(many,9).rows[0].object.id,'900');
  assert.equal(transferPage([],19).index,0);
  assert.equal(parseCsv(transferCsv(many,transferFacts(many,models),{...meta,built:1000,limited:true})).length,1001);
});
test('CSV includes per-side fields, full selection, explicit unavailable facts and generation scope',()=>{
  const csv=parseCsv(transferCsv(rows,transferFacts(rows,{cad:models.cad}),{...meta,limited:true,modelLimit:true,failures:['erp']}));
  const field=(record,name)=>record[csv[0].indexOf(name)];
  assert.equal(csv.length,5);assert.ok(csv.every(r=>r.length===csv[0].length));
  assert.equal(field(csv[1],'Источник: ID этапа'),'a');assert.equal(field(csv[1],'Получатель: Сведения модели'),'Недоступны');
  assert.equal(field(csv[1],'Предел пар'),'Достигнут');assert.equal(field(csv[1],'Недоступные сведения'),'erp');
  assert.match(field(csv[1],'Область'),/не факт передачи/);
});
test('CSV safely quotes formulas, separators, quotes and embedded newlines',()=>{
  const dangerous={...rows[0],object:{...object,name:' \t=HYPERLINK("bad")',externalSource:'один;два\n"три"'}};
  const csv=parseCsv(transferCsv([dangerous],facts,{...meta,query:'@bad'}));
  const at=name=>csv[1][csv[0].indexOf(name)];
  assert.equal(at('Объект'),"' \t=HYPERLINK(\"bad\")");assert.equal(at('Поиск'),"'@bad");assert.equal(at('Внешний источник'),'один;два\n"три"');
});
test('an empty export retains limits and query instead of pretending to cover an entire fund',()=>{
  const csv=parseCsv(transferCsv([],new Map(),{...meta,query:'не найдено',limited:true}));
  assert.equal(csv.length,2);assert.equal(csv[1][csv[0].indexOf('Найдено пар')],'0');assert.equal(csv[1][csv[0].indexOf('Предел пар')],'Достигнут');
});
test('missing and unavailable endpoints remain different in both summary and CSV',()=>{
  const incomplete=informationTransfers([{...object,producers:[]}]).rows;
  const csv=parseCsv(transferCsv(incomplete,new Map(),meta));
  assert.equal(csv[1][csv[0].indexOf('Источник: Сведения модели')],'Не указан в реестре');
  assert.equal(csv[1][csv[0].indexOf('Получатель: Сведения модели')],'Недоступны');
});
