export function waitEventFiles(spec){
 const b='http://www.omg.org/spec/BPMN/20100524/MODEL';
 const nodes=[['s','startEvent','Запрос отправлен'],['message','receiveTask','Дождаться подтверждения комплекта'],
  ['timer','intermediateCatchEvent','Дождаться контрольного интервала'],['after','task','Передать подтверждённый комплект'],['end','endEvent','Комплект передан']];
 const edges=[['sm','s','message'],['mt','message','timer'],['ta','timer','after'],['ae','after','end']];
 const xml='<?xml version="1.0" encoding="UTF-8"?><bpmn:definitions xmlns:bpmn="'+b+'" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI"><bpmn:process id="'+spec.id+'" name="'+spec.name+'"><bpmn:laneSet id="ls"><bpmn:lane id="lane" name="Учебный отдел">'+nodes.map(([id])=>'<bpmn:flowNodeRef>'+id+'</bpmn:flowNodeRef>').join('')+'</bpmn:lane></bpmn:laneSet>'+
 nodes.map(([id,type,name])=>'<bpmn:'+type+' id="'+id+'" name="'+name+'">'+(id==='timer'?'<bpmn:timerEventDefinition id="timer_def"><bpmn:timeDuration>PT'+(spec.timerMinutes*60)+'S</bpmn:timeDuration></bpmn:timerEventDefinition>':'')+'</bpmn:'+type+'>').join('')+
 edges.map(([id,s,t])=>'<bpmn:sequenceFlow id="'+id+'" sourceRef="'+s+'" targetRef="'+t+'"/>').join('')+'</bpmn:process><bpmndi:BPMNDiagram id="diagram"><bpmndi:BPMNPlane id="plane" bpmnElement="'+spec.id+'">'+
 [['lane',0,0,1300,300],...nodes.map(([id,type],i)=>[id,100+i*220,100,type==='task'||type==='receiveTask'?170:44,type==='task'||type==='receiveTask'?80:44])].map(([id,x,y,w,h])=>'<bpmndi:BPMNShape id="'+id+'-di" bpmnElement="'+id+'"><dc:Bounds x="'+x+'" y="'+y+'" width="'+w+'" height="'+h+'"/></bpmndi:BPMNShape>').join('')+
 edges.map(([id,s,t])=>'<bpmndi:BPMNEdge id="'+id+'-di" bpmnElement="'+id+'"><di:waypoint x="'+(144+nodes.findIndex(n=>n[0]===s)*220)+'" y="122"/><di:waypoint x="'+(100+nodes.findIndex(n=>n[0]===t)*220)+'" y="122"/></bpmndi:BPMNEdge>').join('')+'</bpmndi:BPMNPlane></bpmndi:BPMNDiagram></bpmn:definitions>';
 const context={version:'1.0',status:'Published',owner:'Учебный отдел',passport:{level:0,classification:'Обеспечивающий',purpose:spec.name,trigger:'Отправлен учебный запрос',result:'Подтверждённый комплект передан'},elements:{
  message:{expectedResult:'Получено подтверждение',waitEvent:{kind:'message',source:spec.source,channel:spec.channel,messageName:spec.messageName,expectedMinutes:spec.expectedMinutes,timeoutMinutes:spec.timeoutMinutes,correlationKey:spec.correlationKey}},
  timer:{expectedResult:'Контрольный интервал истёк',waitEvent:{kind:'timer',durationMinutes:spec.timerMinutes}},
  after:{workDuration:'1 час',expectedResult:'Подтверждённый комплект передан'}
 }};
 return new Map([[spec.id+'.bpmn',xml],[spec.id+'.context.json',JSON.stringify(context)]]);
}
