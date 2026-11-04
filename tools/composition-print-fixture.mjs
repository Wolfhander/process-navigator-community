import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {masterModels} from './master-data.mjs';
import {collectInstructionPackage,instructionPackageHtml} from '../frontend/process-navigator-ui/src/instruction-package.ts';

const models=masterModels();
const root=structuredClone(models[0]);
const kinds=['startEvent','exclusiveGateway','parallelGateway','inclusiveGateway','eventBasedGateway','complexGateway','intermediateCatchEvent','boundaryEvent','subProcess','callActivity','endEvent'];
root.nodes.push(...kinds.map((bpmnType,i)=>({
  id:'print-'+i,name:bpmnType+' — '+('длинное название для проверки переноса '.repeat(i===5?16:1)),
  bpmnType,type:'task',laneId:'print-lane',x:-180+i*155,y:400,width:70,height:60,
})));
root.lanes.push({id:'print-lane',name:'Дорожка проверки специальных обозначений',y:375,height:150},{id:'empty',name:'Пустая резервная дорожка',y:750,height:110});
root.edges.push({id:'print-return',sourceId:'print-10',targetId:'print-0',label:'Возврат на начало',points:[{x:1370,y:430},{x:1430,y:430},{x:1430,y:545},{x:-220,y:545},{x:-220,y:430},{x:-180,y:430}]});
const bundle=await collectInstructionPackage(root,'Мастер-данные печати',{},async id=>{
  const model=models.find(model=>model.id===id);
  if(!model)throw new Error('Не найдена мастер-модель: '+id);
  return model;
},new AbortController().signal,2);
if(bundle.issues.length)throw new Error(bundle.issues.join('\n'));
writeFileSync(resolve(process.argv[2]),instructionPackageHtml(bundle,true),{flag:'wx'});
