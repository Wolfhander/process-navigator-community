import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
const base=new URL('../master-data/v1/',import.meta.url);
export const masterSpec=JSON.parse(fs.readFileSync(new URL('spec.json',base),'utf8'));
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
export function masterModels(spec=masterSpec){
  return spec.processIds.map((id,index)=>{
    const count=index===0||index===4?2:1;
    const entities=index===0?spec.organizations.slice(0,2):[spec.organizations[index%3]];
    const lanes=entities.map((entity,i)=>({id:'lane-'+i,name:entity.units[0].name,y:40+i*220,height:220}));
    const nodes=[{id:'start',type:'startEvent',name:'Начало',laneId:'lane-0',x:80,y:120,width:36,height:36}];
    for(let i=0;i<count;i++){
      const lane=index===0?i:0;
      nodes.push({id:'task-'+(i+1),type:'task',bpmnType:'userTask',name:index===0?(i?'Принять пакет данных':'Подготовить пакет данных'):index===4?(i?'Проверить чертёж':'Разработать чертёж'):'Подготовить детализацию',
        laneId:'lane-'+lane,x:220+i*300,y:100+lane*220,width:190,height:80,executorKind:'human',duration:i?'4 часа':'2 часа',workDuration:i?'4 часа':'2 часа',waitDuration:'0 часов',
        description:'Синтетический шаг эталона MD-001.',instruction:'Проверить входные данные и зарегистрировать результат.',inputs:['Задание MD-001'],expectedResult:'Результат шага MD-001',completionCriteria:'Результат доступен получателю',
        ...(index<4?{linkedProcessId:spec.processIds[index+1]}:{}),
        informationObjects:index===0?[{objectId:spec.document.id,name:spec.document.name,role:i?'Input':'Output',required:true,version:spec.document.version}]:[],
        ...(index===0&&i===1?{workRules:[{kind:'document',objectId:spec.document.id,requiredState:spec.document.requiredState},{kind:'exception',condition:'Нет подтверждения подписи',response:'Вернуть автору',responsible:'Координатор заказа'}]}:{}),
        artifacts:index===0?[{name:spec.document.name,kind:'Инструкция',version:'1.0',reference:'artifact:md-001'}]:[],
        channels:[{id:'channel-'+i,kind:'system',label:'Учебная система',systemName:'Учебная PLM',direction:'work',flow:'primary'}]
      });
    }
    const last=nodes.at(-1);
    nodes.push({id:'end',type:'endEvent',name:'Готово',laneId:last.laneId,x:last.x+300,y:last.y+20,width:36,height:36});
    const edges=nodes.slice(1).map((node,i)=>{const source=nodes[i];const a={x:source.x+source.width,y:source.y+source.height/2},b={x:node.x,y:node.y+node.height/2},mid=(a.x+b.x)/2;return{id:'flow-'+i,sourceId:source.id,targetId:node.id,points:[a,{x:mid,y:a.y},{x:mid,y:b.y},b]};});
    return{id,name:spec.processNames[index],version:spec.version,owner:entities[0].units[0].name,ownerLegalEntityId:entities[0].id,ownerUnitId:entities[0].units[0].id,status:'Published',lanes,nodes,edges,
      passport:{level:index,classification:'Основной',...(index?{parentProcessId:spec.processIds[index-1]}:{}),purpose:'Учебный эталон MD-001',scope:'Только синтетические данные',trigger:'Получено задание MD-001',result:'Результат MD-001 доступен получателю'}};
  });
}
export function masterOrganization(models=masterModels()){
  return{id:'md-group',name:'Учебная группа MD',description:'Синтетические мастер-данные',legalEntities:masterSpec.organizations.map(entity=>({...entity,description:'Вымышленная организация',directions:[{id:entity.id+'-main',name:'Учебные процессы',description:'',icon:'factory',processIds:models.filter(model=>model.ownerLegalEntityId===entity.id).map(model=>model.id)}],units:entity.units.map(unit=>({...unit,shortName:unit.name,managerPosition:'Учебный руководитель'}))})),
    crossCompanyProcesses:models.map(model=>({processId:model.id,description:'Учебная оргпривязка',legalEntityIds:[...new Set(model.lanes.map((_,i)=>model.id===masterSpec.processIds[0]?masterSpec.organizations[i].id:model.ownerLegalEntityId))],laneOrganizations:model.lanes.map((lane,i)=>({laneId:lane.id,legalEntityId:model.id===masterSpec.processIds[0]?masterSpec.organizations[i].id:model.ownerLegalEntityId,unitId:model.id===masterSpec.processIds[0]?masterSpec.organizations[i].units[0].id:model.ownerUnitId,department:lane.name,displayNameMode:'full'}))}))};
}
export function masterFiles(){
  const models=masterModels(),files=new Map();
  const json=value=>JSON.stringify(value,null,2)+'\n';
  for(const model of models){
    const shapes=[...model.lanes.map(lane=>({id:lane.id,x:30,y:lane.y,width:1050,height:lane.height})),...model.nodes];
    const xml='<b:definitions xmlns:b="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI"><b:process id="'+escape(model.id)+'" name="'+escape(model.name)+'"><b:laneSet id="lanes">'+model.lanes.map(lane=>'<b:lane id="'+lane.id+'" name="'+escape(lane.name)+'">'+model.nodes.filter(node=>node.laneId===lane.id).map(node=>'<b:flowNodeRef>'+node.id+'</b:flowNodeRef>').join('')+'</b:lane>').join('')+'</b:laneSet>'+model.nodes.map(node=>'<b:'+(node.bpmnType||node.type)+' id="'+node.id+'" name="'+escape(node.name)+'"/>').join('')+model.edges.map(edge=>'<b:sequenceFlow id="'+edge.id+'" sourceRef="'+edge.sourceId+'" targetRef="'+edge.targetId+'"/>').join('')+'</b:process><bi:BPMNDiagram id="diagram"><bi:BPMNPlane id="plane" bpmnElement="'+model.id+'">'+shapes.map(shape=>'<bi:BPMNShape id="'+shape.id+'-shape" bpmnElement="'+shape.id+'"><dc:Bounds x="'+shape.x+'" y="'+shape.y+'" width="'+shape.width+'" height="'+shape.height+'"/></bi:BPMNShape>').join('')+model.edges.map(edge=>'<bi:BPMNEdge id="'+edge.id+'-edge" bpmnElement="'+edge.id+'">'+edge.points.map(point=>'<di:waypoint x="'+point.x+'" y="'+point.y+'"/>').join('')+'</bi:BPMNEdge>').join('')+'</bi:BPMNPlane></bi:BPMNDiagram></b:definitions>';
    const elements=Object.fromEntries(model.nodes.map(({id,type,bpmnType,name,laneId,x,y,width,height,...context})=>[id,context]));
    files.set('Data/'+model.id+'.bpmn',xml);
    files.set('Data/'+model.id+'.context.json',json({version:model.version,owner:model.owner,ownerLegalEntityId:model.ownerLegalEntityId,ownerUnitId:model.ownerUnitId,status:model.status,passport:model.passport,elements}));
  }
  files.set('Data/organization.json',json(masterOrganization(models)));
  files.set('Data/Artifacts/md-001/artifact.json',json({id:'md-001',name:masterSpec.document.name,kind:'Учебный образец',currentVersion:'1.0',versions:[{version:'1.0',fileName:'MD-001.md',contentType:'text/markdown',size:Buffer.byteLength(fs.readFileSync(new URL('documents/MD-001.md',base),'utf8')),uploadedAt:'2026-10-17T00:00:00Z',approved:false}]}));
  files.set('Data/Artifacts/md-001/versions/1.0/content.bin',fs.readFileSync(new URL('documents/MD-001.md',base),'utf8'));
  return files;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  const key=process.argv[2];
  if(key==='--instruction-html'){
    const {collectInstructionPackage,instructionPackageHtml}=await import('../frontend/process-navigator-ui/src/instruction-package.ts');
    const models=masterModels();
    const bundle=await collectInstructionPackage(models[0],'Эталон v1',{},async id=>models.find(model=>model.id===id),new AbortController().signal);
    console.log(JSON.stringify(instructionPackageHtml(bundle)));
  }else console.log(JSON.stringify(key?masterFiles().get(key):[...masterFiles().keys()]));
}
