// Creates only synthetic in-memory files; callers choose their isolated output folder.
export function scheduleIterationFiles(spec){
 const files=new Map();
 const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
 function add(id,name,nodes,edges){
  const bpmn='<?xml version="1.0" encoding="UTF-8"?>'+
  '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI"><bpmn:process id="'+id+'" name="'+escape(name)+'">'+
  '<bpmn:laneSet id="ls"><bpmn:lane id="lane" name="Учебный отдел">'+nodes.map(n=>'<bpmn:flowNodeRef>'+n.id+'</bpmn:flowNodeRef>').join('')+'</bpmn:lane></bpmn:laneSet>'+
  nodes.map(n=>'<bpmn:'+n.type+' id="'+n.id+'" name="'+escape(n.name)+'"/>').join('')+
  edges.map(([edge,s,t])=>'<bpmn:sequenceFlow id="'+edge+'" sourceRef="'+s+'" targetRef="'+t+'"/>').join('')+'</bpmn:process>'+
  '<bpmndi:BPMNDiagram id="diagram"><bpmndi:BPMNPlane id="plane" bpmnElement="'+id+'">'+
  [['lane',0,0,2000,300],...nodes.map((n,i)=>[n.id,80+i*170,100,120,80])].map(([n,x,y,w,h])=>'<bpmndi:BPMNShape id="'+n+'-di" bpmnElement="'+n+'"><dc:Bounds x="'+x+'" y="'+y+'" width="'+w+'" height="'+h+'"/></bpmndi:BPMNShape>').join('')+
  edges.map(([edge,s,t])=>'<bpmndi:BPMNEdge id="'+edge+'-di" bpmnElement="'+edge+'"><di:waypoint x="'+(200+nodes.findIndex(n=>n.id===s)*170)+'" y="140"/><di:waypoint x="'+(80+nodes.findIndex(n=>n.id===t)*170)+'" y="140"/></bpmndi:BPMNEdge>').join('')+'</bpmndi:BPMNPlane></bpmndi:BPMNDiagram></bpmn:definitions>';
  const context={version:'1.0',status:'Published',owner:'Учебный отдел',elements:Object.fromEntries(nodes.filter(n=>n.type==='task').map(n=>[n.id,{
   workDuration:n.hours+' час',informationObjects:n.output?[{objectId:spec.objectId,name:'Комплект учебных чертежей',role:'Output'}]:n.input?[{objectId:spec.objectId,name:'Комплект учебных чертежей',role:'Input'}]:[]
  }]))};
  files.set(id+'.bpmn',bpmn);files.set(id+'.context.json',JSON.stringify(context));
 }
 add(spec.id,spec.name,spec.nodes,spec.edges);
 add(spec.receiverId,'Учебная приёмка комплекта',[{id:'rs',type:'startEvent',name:'Комплект поступил'},{id:'use',type:'task',name:'Принять комплект',hours:spec.receiverHours,input:true},{id:'re',type:'endEvent',name:'Комплект принят'}],[['ru','rs','use'],['ue','use','re']]);
 return files;
}
