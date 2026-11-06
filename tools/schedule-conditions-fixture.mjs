// Synthetic, deterministic input; no real organizations, documents or credentials.
export function scheduleConditionFiles(spec){
 const nodes=[['s','startEvent','Получено задание'],['g','exclusiveGateway','Какой маршрут?'],['fast','task','Короткая разработка'],['slow','task','Расширенная разработка'],['j','exclusiveGateway','Объединить'],['end','endEvent','Результат готов']];
 const edges=[['sg','s','g'],['a','g','fast'],['b','g','slow'],['fj','fast','j'],['sj','slow','j'],['je','j','end']];
 const bpmn='<?xml version="1.0" encoding="UTF-8"?>'+
 '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI">'+
 '<bpmn:process id="'+spec.id+'" name="'+spec.name+'"><bpmn:laneSet id="ls"><bpmn:lane id="lane" name="Учебная разработка">'+nodes.map(([id])=>'<bpmn:flowNodeRef>'+id+'</bpmn:flowNodeRef>').join('')+'</bpmn:lane></bpmn:laneSet>'+
 nodes.map(([id,type,name])=>'<bpmn:'+type+' id="'+id+'" name="'+name+'"/>').join('')+edges.map(([id,s,t])=>'<bpmn:sequenceFlow id="'+id+'" sourceRef="'+s+'" targetRef="'+t+'"/>').join('')+'</bpmn:process>'+
 '<bpmndi:BPMNDiagram id="diagram"><bpmndi:BPMNPlane id="plane" bpmnElement="'+spec.id+'">'+
 [['lane',0,0,1300,300],...nodes.map(([id],i)=>[id,100+i*180,100,120,80])].map(([id,x,y,w,h])=>'<bpmndi:BPMNShape id="'+id+'-di" bpmnElement="'+id+'"><dc:Bounds x="'+x+'" y="'+y+'" width="'+w+'" height="'+h+'"/></bpmndi:BPMNShape>').join('')+
 edges.map(([id,s,t])=>'<bpmndi:BPMNEdge id="'+id+'-di" bpmnElement="'+id+'"><di:waypoint x="'+(100+nodes.findIndex(n=>n[0]===s)*180+120)+'" y="140"/><di:waypoint x="'+(100+nodes.findIndex(n=>n[0]===t)*180)+'" y="140"/></bpmndi:BPMNEdge>').join('')+'</bpmndi:BPMNPlane></bpmndi:BPMNDiagram></bpmn:definitions>';
 const context={version:'1.0',status:'Published',owner:'Учебный отдел',elements:{
  fast:{workDuration:spec.fastHours+' часа',informationObjects:[{objectId:spec.objectId,name:'Учебный чертёж',role:'Output',condition:'Если нужен комплект'}]},
  slow:{workDuration:spec.slowHours+' часов'}
 }};
 return new Map([[spec.id+'.bpmn',bpmn],[spec.id+'.context.json',JSON.stringify(context)]]);
}
