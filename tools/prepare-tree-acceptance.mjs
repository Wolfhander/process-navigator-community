import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const folder=path.join(root,'artifacts/tree-acceptance-20261030');
const addDepth=process.argv[2]==='--add-depth';
if(fs.existsSync(folder)&&!addDepth)throw Error('Use a fresh acceptance directory; existing data is not overwritten.');
const spec=JSON.parse(fs.readFileSync(path.join(root,'master-data/tree-cases.json'),'utf8'));
function deepFixtures(){
  const templateXml=fs.readFileSync(path.join(root,'master-data/v1/reference/Data/md-engineering.bpmn'),'utf8');
  const templateContext=JSON.parse(fs.readFileSync(path.join(root,'master-data/v1/reference/Data/md-engineering.context.json'),'utf8'));
  for(let i=0;i<spec.deepModelCount;i++){
    const id='tree-deep-'+i;
    const file=path.join(folder,'Data/'+id+'.bpmn');
    if(fs.existsSync(file))throw Error('Depth fixture already exists: '+id);
    const context=structuredClone(templateContext);
    context.passport.level=Math.min(i,20);context.passport.parentProcessId=i?'tree-deep-'+(i-1):undefined;
    if(i+1<spec.deepModelCount)context.elements['task-1'].linkedProcessId='tree-deep-'+(i+1);
    else delete context.elements['task-1'].linkedProcessId;
    fs.writeFileSync(file,templateXml.replaceAll('md-engineering',id).replace('name="Подготовка решения"','name="Глубокая ветвь '+i+'"'));
    fs.writeFileSync(path.join(folder,'Data/'+id+'.context.json'),JSON.stringify(context,null,2));
  }
}
if(addDepth){deepFixtures();console.log('Added isolated depth fixtures.');process.exit(0);}
fs.mkdirSync(folder,{recursive:true});
fs.cpSync(path.join(root,'master-data/v1/reference/Data'),path.join(folder,'Data'),{recursive:true});
const ids=['tree-start',...Array.from({length:spec.callCount},(_,i)=>'tree-task-'+i),'tree-end'];
const nodes=ids.map((id,i)=>({id,type:i===0?'startEvent':i===ids.length-1?'endEvent':'userTask',name:i===0?'Начало':i===ids.length-1?'Завершение':'Вызов '+(i-1),x:80+(i%20)*220,y:80+Math.floor(i/20)*140}));
const flows=ids.slice(1).map((id,i)=>({id:'tree-flow-'+i,source:ids[i],target:id}));
const xml='<b:definitions xmlns:b="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI"><b:process id="tree-root" name="Тест большого дерева"><b:laneSet id="tree-lanes"><b:lane id="tree-lane" name="Планирование">'+ids.map(id=>'<b:flowNodeRef>'+id+'</b:flowNodeRef>').join('')+'</b:lane></b:laneSet>'+nodes.map(n=>'<b:'+n.type+' id="'+n.id+'" name="'+n.name+'"/>').join('')+flows.map(e=>'<b:sequenceFlow id="'+e.id+'" sourceRef="'+e.source+'" targetRef="'+e.target+'"/>').join('')+'</b:process><bi:BPMNDiagram id="tree-diagram"><bi:BPMNPlane id="tree-plane" bpmnElement="tree-root"><bi:BPMNShape id="tree-lane-shape" bpmnElement="tree-lane"><dc:Bounds x="30" y="40" width="4600" height="22000"/></bi:BPMNShape>'+nodes.map(n=>'<bi:BPMNShape id="'+n.id+'-shape" bpmnElement="'+n.id+'"><dc:Bounds x="'+n.x+'" y="'+n.y+'" width="180" height="80"/></bi:BPMNShape>').join('')+flows.map((e,i)=>'<bi:BPMNEdge id="'+e.id+'-shape" bpmnElement="'+e.id+'"><di:waypoint x="'+(nodes[i].x+180)+'" y="'+(nodes[i].y+40)+'"/><di:waypoint x="'+nodes[i+1].x+'" y="'+(nodes[i+1].y+40)+'"/></bi:BPMNEdge>').join('')+'</bi:BPMNPlane></bi:BPMNDiagram></b:definitions>';
fs.writeFileSync(path.join(folder,'Data/tree-root.bpmn'),xml);
fs.writeFileSync(path.join(folder,'Data/tree-root.context.json'),JSON.stringify({version:'1.0',status:'Published',owner:'Планирование',passport:{level:0,classification:'Основной',trigger:'Учебная проверка',inputs:['Задание'],result:'Проверено',outputs:['Результат']},elements:Object.fromEntries(ids.slice(1,-1).map(id=>[id,{linkedProcessId:spec.sharedId,inputs:['Учебное задание'],expectedResult:'Проверено',description:'Синтетический вызов для проверки больших деревьев.'}]))},null,2));
deepFixtures();
console.log('Prepared isolated master catalog with '+spec.callCount+' repeated calls: '+folder);
