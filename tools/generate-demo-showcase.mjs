import path from 'node:path';
import { fileURLToPath } from 'node:url';

const c = (kind, label, flow = 'primary', direction = 'work', systemName, documentName) => ({ kind, label, flow, direction, systemName, documentName });
const lane = (id, name, entity, unit) => ({ id, name, entity, unit });
const step = (id, name, laneId, description, channels, linkedProcessId) => ({ id, name, laneId, description, channels, linkedProcessId });

export const processes = [
  {
    id: 'demo-showcase-l0', name: 'Демо-контур: создание и поставка изделия', level: 0, classification: 'Основной', owner: 'Корпорация', ownerEntity: 'corporation', ownerUnit: '0.1',
    purpose: 'Показать единую карту полного жизненного цикла заказа и переход к детализации.', trigger: 'Получена стратегическая потребность в новом изделии', triggerOptions: ['Письмо заказчика', 'Решение совещания', 'Служебная записка руководителя'], result: 'Изделие поставлено, финансовый результат отражён',
    lanes: [lane('Lane_Corp', 'Корпорация', 'corporation', '0.1'), lane('Lane_Plant', 'РуководствоПроизводства', 'plant', '1'), lane('Lane_Cku', 'ФЭУ', 'communications', '2.2')],
    steps: [
      step('Task_Portfolio', 'Определить потребность и рамки заказа', 'Lane_Corp', 'Зафиксировать цель, ограничения, ожидаемый результат и приоритет.', [c('email', 'Письмо заказчика', 'alternative', 'input', null, 'Запрос заказчика'), c('memo', 'Служебная записка', 'alternative', 'input', null, 'Служебная записка'), c('meeting', 'Решение совещания', 'alternative', 'input', null, 'Протокол')], 'demo-showcase-l1'),
      step('Task_ApproveProgram', 'Утвердить запуск выполнения заказа', 'Lane_Plant', 'Подтвердить ресурсную возможность и запустить сквозной процесс.', [c('system', 'Карточка портфеля заказов', 'primary', 'work', '1С:ERP', 'Заказ клиента')]),
      step('Task_FinanceResult', 'Отразить финансовый результат', 'Lane_Cku', 'Отразить завершение поставки и итоговые показатели.', [c('system', 'Финансовый учёт', 'primary', 'output', '1С:ERP. Управление холдингом', 'Финансовый результат'), c('paper', 'Подписанный комплект закрывающих документов', 'parallel', 'output', null, 'Оригиналы документов')])
    ]
  },
  {
    id: 'demo-showcase-l1', name: 'Демо: выполнение заказа на изделие', level: 1, parent: 'demo-showcase-l0', classification: 'Основной', owner: 'УСЗ', ownerEntity: 'plant', ownerUnit: '1.6',
    purpose: 'Координировать подготовку, закупку, производство и передачу изделия.', trigger: 'Заказ включён в портфель', triggerOptions: ['Заказ зарегистрирован в ERP', 'Получено распоряжение управляющего директора'], result: 'Готовое изделие передано заказчику',
    lanes: [lane('Lane_Sales', 'УСЗ', 'plant', '1.6'), lane('Lane_Engineering', 'КО', 'plant', '1.4'), lane('Lane_Procurement', 'ОПиКЗ', 'plant', '1.2.4'), lane('Lane_Production', 'ИспДир', 'plant', '1.7')],
    steps: [
      step('Task_RegisterOrder', 'Зарегистрировать и уточнить заказ', 'Lane_Sales', 'Проверить комплектность исходных требований и зарегистрировать заказ.', [c('email', 'Письмо заказчика', 'alternative', 'input', null, 'Требования'), c('phone', 'Телефонное уточнение', 'alternative', 'input'), c('system', 'Регистрация заказа', 'primary', 'work', '1С:ERP', 'Заказ клиента')]),
      step('Task_Engineering', 'Выполнить подготовку изделия', 'Lane_Engineering', 'Разработать и выпустить конструкторско-технологический комплект.', [c('system', 'Жизненный цикл изделия', 'primary', 'work', '1С:PLM', 'Комплект КД и ТД')], 'demo-showcase-l2-engineering'),
      step('Task_Procurement', 'Обеспечить материалами и ПКИ', 'Lane_Procurement', 'Рассчитать потребность и обеспечить заказ материальными ресурсами.', [c('system', 'Потребность и закупки', 'primary', 'work', '1С:ERP', 'Заказы поставщикам')], 'demo-showcase-l2-procurement'),
      step('Task_Production', 'Изготовить и принять изделие', 'Lane_Production', 'Организовать изготовление, контроль и сдачу готового изделия.', [c('system', 'Производственный заказ', 'primary', 'work', '1С:ERP', 'Заказ на производство')], 'demo-showcase-l2-production'),
      step('Task_Deliver', 'Передать изделие заказчику', 'Lane_Sales', 'Передать изделие и комплект документов заказчику.', [c('system', 'Электронная передача', 'primary', 'output', '1С:ERP', 'Реализация'), c('paper', 'Бумажный комплект', 'parallel', 'output', null, 'Паспорт и накладная')])
    ]
  },
  {
    id: 'demo-showcase-l2-engineering', name: 'Демо: конструкторско-технологическая подготовка', level: 2, parent: 'demo-showcase-l1', classification: 'Основной', owner: 'КО', ownerEntity: 'plant', ownerUnit: '1.4',
    purpose: 'Подготовить согласованный комплект документации для производства.', trigger: 'Требования к изделию подтверждены', result: 'Комплект КД и ТД выпущен',
    lanes: [lane('Lane_Design', 'КО', 'plant', '1.4'), lane('Lane_Support', 'ОКСП', 'plant', '1.7.1'), lane('Lane_Technology', 'ТО', 'plant', '1.7.2'), lane('Lane_Quality', 'УК', 'plant', '1.3')],
    steps: [
      step('Task_Structure', 'Сформировать состав изделия', 'Lane_Design', 'Создать состав изделия и версии входящих компонентов.', [c('system', 'Состав изделия', 'primary', 'work', '1С:PLM', 'Состав изделия')]),
      step('Task_Documentation', 'Разработать комплект документации', 'Lane_Support', 'Подготовить модели, чертежи и спецификации.', [c('system', 'Конструкторские данные', 'primary', 'work', '1С:PLM', 'Комплект КД')], 'demo-showcase-l3-documentation'),
      step('Task_Technology', 'Разработать технологию изготовления', 'Lane_Technology', 'Определить операции, нормы и технологические маршруты.', [c('system', 'Технологическая подготовка', 'primary', 'work', '1С:PLM', 'Комплект ТД'), c('system', 'Передача норм', 'parallel', 'output', '1С:ERP', 'Маршрутная карта')]),
      step('Task_EngineeringApprove', 'Проверить готовность комплекта', 'Lane_Quality', 'Проверить полноту, статусы и пригодность документации.', [c('system', 'Согласование комплекта', 'primary', 'work', '1С:PLM', 'Утверждённый комплект')])
    ]
  },
  {
    id: 'demo-showcase-l3-documentation', name: 'Демо: разработка комплекта конструкторской документации', level: 3, parent: 'demo-showcase-l2-engineering', classification: 'Основной', owner: 'ОКСП', ownerEntity: 'plant', ownerUnit: '1.7.1',
    purpose: 'Разработать и выпустить комплект конструкторской документации.', trigger: 'Создана структура изделия', result: 'Комплект КД имеет статус «Выпущен»',
    lanes: [lane('Lane_Designer', 'КО', 'plant', '1.4'), lane('Lane_DesignSupport', 'ОКСП', 'plant', '1.7.1'), lane('Lane_Standard', 'ОСиСМК', 'plant', '1.3.3')],
    steps: [
      step('Task_Drawing', 'Разработать и согласовать чертёж', 'Lane_Designer', 'Подготовить геометрию, обозначения и согласование чертежа.', [c('system', 'Работа с моделью', 'primary', 'work', 'КОМПАС-3D', '3D-модель и чертёж')], 'demo-showcase-l4-drawing'),
      step('Task_Specification', 'Сформировать спецификацию', 'Lane_DesignSupport', 'Сформировать спецификацию на основе утверждённого состава.', [c('system', 'Управление спецификацией', 'primary', 'work', '1С:PLM', 'Спецификация')]),
      step('Task_NormControl', 'Провести нормоконтроль', 'Lane_Standard', 'Проверить оформление и соответствие стандартам.', [c('system', 'Электронное согласование', 'primary', 'work', '1С:PLM', 'Лист согласования'), c('paper', 'Контрольный бумажный экземпляр', 'parallel', 'work', null, 'Распечатка чертежа')]),
      step('Task_ReleaseDocs', 'Выпустить комплект КД', 'Lane_DesignSupport', 'Присвоить комплекту статус выпуска и уведомить получателей.', [c('system', 'Выпуск документации', 'primary', 'output', '1С:PLM', 'Выпущенный комплект КД'), c('email', 'Уведомление подразделений', 'parallel', 'output', null, 'Уведомление о выпуске')])
    ]
  },
  {
    id: 'demo-showcase-l4-drawing', name: 'Демо: разработка и согласование чертежа', level: 4, parent: 'demo-showcase-l3-documentation', classification: 'Основной', owner: 'КО', ownerEntity: 'plant', ownerUnit: '1.4',
    purpose: 'Показать наиболее детальный исполняемый уровень и сочетание электронных и бумажных каналов.', trigger: 'Назначено задание на разработку чертежа', triggerOptions: ['Задание создано в 1С:PLM', 'Получена служебная записка', 'Уточнение поступило по электронной почте'], result: 'Утверждённый чертёж зарегистрирован и доступен потребителям',
    lanes: [lane('Lane_Author', 'КО', 'plant', '1.4'), lane('Lane_Reviewer', 'ОКСП', 'plant', '1.7.1'), lane('Lane_Controller', 'ОСиСМК', 'plant', '1.3.3')],
    steps: [
      step('Task_Model', 'Разработать модель и чертёж', 'Lane_Author', 'Создать 3D-модель и ассоциативный чертёж.', [c('system', 'Разработка геометрии', 'primary', 'work', 'КОМПАС-3D', '3D-модель и чертёж')]),
      step('Task_RegisterPlm', 'Зарегистрировать версию', 'Lane_Author', 'Передать файл и метаданные в систему управления жизненным циклом.', [c('system', 'Регистрация версии', 'primary', 'work', '1С:PLM', 'Версия документа')]),
      step('Task_ReviewDrawing', 'Проверить технические решения', 'Lane_Reviewer', 'Проверить применимость решений в производстве.', [c('system', 'Электронное согласование', 'primary', 'work', '1С:PLM', 'Замечания'), c('email', 'Запрос уточнений', 'alternative', 'input', null, 'Письмо с замечаниями'), c('phone', 'Оперативное уточнение', 'alternative', 'input')]),
      step('Task_PaperControl', 'Провести нормоконтроль и выпустить', 'Lane_Controller', 'Проверить оформление, зафиксировать утверждение и выдать результат.', [c('system', 'Утверждение в PLM', 'primary', 'output', '1С:PLM', 'Утверждённый чертёж'), c('paper', 'Подписанный контрольный экземпляр', 'parallel', 'output', null, 'Бумажный чертёж')])
    ]
  },
  {
    id: 'demo-showcase-l2-procurement', name: 'Демо: обеспечение заказа материалами и ПКИ', level: 2, parent: 'demo-showcase-l1', classification: 'Обеспечивающий', owner: 'ОПиКЗ', ownerEntity: 'plant', ownerUnit: '1.2.4',
    purpose: 'Показать ветвь, детализация которой заканчивается на уровне 2.', trigger: 'Получена подтверждённая потребность', result: 'Материалы и ПКИ приняты и доступны производству',
    lanes: [lane('Lane_PlanBuy', 'ОПиКЗ', 'plant', '1.2.4'), lane('Lane_Buy', 'ОЗМ', 'plant', '1.2.1'), lane('Lane_FinanceBuy', 'ФЭУ', 'communications', '2.2'), lane('Lane_Stock', 'СХ', 'plant', '1.2.5')],
    steps: [
      step('Task_CalculateNeeds', 'Рассчитать дефицит', 'Lane_PlanBuy', 'Сопоставить потребность, остатки и ожидаемые поступления.', [c('system', 'Расчёт потребности', 'primary', 'work', '1С:ERP', 'Ведомость дефицита')]),
      step('Task_OrderSupplier', 'Разместить заказ поставщику', 'Lane_Buy', 'Выбрать поставщика и оформить заказ.', [c('system', 'Заказ поставщику', 'primary', 'work', '1С:ERP', 'Заказ поставщику'), c('email', 'Отправка заказа', 'parallel', 'output', null, 'Письмо поставщику')]),
      step('Task_PaymentControl', 'Подтвердить финансирование', 'Lane_FinanceBuy', 'Проверить лимит и включить платёж в план.', [c('system', 'Платёжный календарь', 'primary', 'work', '1С:ERP. Управление холдингом', 'Заявка на оплату'), c('paper', 'Оригинал договора', 'parallel', 'input', null, 'Договор')]),
      step('Task_ReceiveStock', 'Принять материалы', 'Lane_Stock', 'Проверить поставку и оформить складское поступление.', [c('system', 'Приёмка на склад', 'primary', 'output', '1С:ERP', 'Приобретение товаров и услуг'), c('paper', 'Комплект поставщика', 'parallel', 'input', null, 'УПД и сертификаты')])
    ]
  },
  {
    id: 'demo-showcase-l2-production', name: 'Демо: изготовление и приёмка изделия', level: 2, parent: 'demo-showcase-l1', classification: 'Основной', owner: 'ИспДир', ownerEntity: 'plant', ownerUnit: '1.7',
    purpose: 'Организовать выпуск изделия и передачу на склад.', trigger: 'Комплект документации выпущен, ресурсы доступны', result: 'Изделие принято ОТК и передано на склад',
    lanes: [lane('Lane_Dispatch', 'ИспДир', 'plant', '1.7'), lane('Lane_Workshop', 'Цех №10', 'plant', '1.7.5.1'), lane('Lane_Qc', 'ОТК', 'plant', '1.3.2'), lane('Lane_StockProd', 'СХ', 'plant', '1.2.5')],
    steps: [
      step('Task_ProductionOrder', 'Запустить производственный заказ', 'Lane_Dispatch', 'Сформировать маршрут и выдать производственное задание.', [c('system', 'Заказ на производство', 'primary', 'work', '1С:ERP', 'Заказ на производство')]),
      step('Task_Manufacture', 'Изготовить изделие', 'Lane_Workshop', 'Выполнить операции и отразить выработку.', [c('system', 'Сменное задание', 'primary', 'work', '1С:ERP', 'Этап производства'), c('paper', 'Маршрутный лист', 'parallel', 'work', null, 'Маршрутный лист')]),
      step('Task_Quality', 'Провести контроль качества', 'Lane_Qc', 'Выполнить контроль, испытания и оформить заключение.', [c('system', 'Результат контроля', 'primary', 'work', '1С:ERP', 'Результат контроля качества')], 'demo-showcase-l3-quality'),
      step('Task_TransferStock', 'Передать готовое изделие', 'Lane_StockProd', 'Принять изделие на склад готовой продукции.', [c('system', 'Складское поступление', 'primary', 'output', '1С:ERP', 'Поступление из производства'), c('paper', 'Паспорт изделия', 'parallel', 'output', null, 'Паспорт изделия')])
    ]
  },
  {
    id: 'demo-showcase-l3-quality', name: 'Демо: контроль и испытания изделия', level: 3, parent: 'demo-showcase-l2-production', classification: 'Основной', owner: 'ОТК', ownerEntity: 'plant', ownerUnit: '1.3.2',
    purpose: 'Показать детальную ветвь качества до уровня 3.', trigger: 'Изделие предъявлено на контроль', result: 'Заключение о соответствии зарегистрировано',
    lanes: [lane('Lane_Inspector', 'ОТК', 'plant', '1.3.2'), lane('Lane_Lab', 'ЗЛ', 'plant', '1.3.5'), lane('Lane_WorkshopFix', 'Цех №10', 'plant', '1.7.5.1')],
    steps: [
      step('Task_VisualCheck', 'Выполнить приёмочный контроль', 'Lane_Inspector', 'Проверить комплектность и основные параметры.', [c('system', 'Контрольная операция', 'primary', 'work', '1С:ERP', 'Карта контроля')]),
      step('Task_LabTest', 'Провести лабораторные испытания', 'Lane_Lab', 'Провести измерения и приложить протокол.', [c('system', 'Лабораторные результаты', 'primary', 'work', '1С:ERP', 'Протокол испытаний'), c('paper', 'Подписанный протокол', 'parallel', 'output', null, 'Оригинал протокола')]),
      step('Task_FixDefects', 'Устранить замечания', 'Lane_WorkshopFix', 'Устранить выявленные несоответствия при их наличии.', [c('memo', 'Извещение о несоответствии', 'alternative', 'input', null, 'Извещение'), c('system', 'Регистрация устранения', 'primary', 'work', '1С:ERP', 'Корректирующее действие')]),
      step('Task_QualityResult', 'Оформить заключение', 'Lane_Inspector', 'Зарегистрировать итог и передать паспорт изделия.', [c('system', 'Заключение ОТК', 'primary', 'output', '1С:ERP', 'Заключение о соответствии'), c('paper', 'Штамп и подпись ОТК', 'parallel', 'output', null, 'Паспорт изделия')])
    ]
  }
];

const xmlEscape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

export function buildBpmn(model) {
  const laneHeight = 200, laneX = 45, laneY = 40, laneWidth = Math.max(1500, 500 + model.steps.length * 300);
  const laneIndex = new Map(model.lanes.map((item, index) => [item.id, index]));
  const refs = new Map(model.lanes.map(item => [item.id, []]));
  refs.get(model.lanes[0].id).push('StartEvent');
  model.steps.forEach(item => refs.get(item.laneId).push(item.id));
  refs.get(model.lanes.at(-1).id).push('EndEvent');
  const positions = new Map();
  positions.set('StartEvent', { x: 95, y: laneY + 58, w: 42, h: 42 });
  model.steps.forEach((item, index) => positions.set(item.id, { x: 210 + (item.column ?? index) * 300, y: laneY + laneIndex.get(item.laneId) * laneHeight + 40, w: item.type?.endsWith('Gateway') ? 48 : 220, h: item.type?.endsWith('Gateway') ? 48 : 110 }));
  positions.set('EndEvent', { x: 210 + model.steps.length * 300, y: laneY + (model.lanes.length - 1) * laneHeight + 70, w: 46, h: 46 });
  const nodeIds = ['StartEvent', ...model.steps.map(item => item.id), 'EndEvent'];
  const flows = (model.flows ?? nodeIds.slice(0, -1).map((source, index) => ({ source, target: nodeIds[index + 1] }))).map((flow, index) => ({ ...flow, id: `Flow_${index + 1}` }));
  const lanesXml = model.lanes.map((item, index) => `      <bpmn:lane id="${item.id}" name="${xmlEscape(item.name)}">${refs.get(item.id).map(ref => `<bpmn:flowNodeRef>${ref}</bpmn:flowNodeRef>`).join('')}</bpmn:lane>`).join('\n');
  const refsXml = id => flows.filter(flow => flow.target === id).map(flow => `<bpmn:incoming>${flow.id}</bpmn:incoming>`).join('') + flows.filter(flow => flow.source === id).map(flow => `<bpmn:outgoing>${flow.id}</bpmn:outgoing>`).join('');
  const tasksXml = model.steps.map(item => `    <bpmn:${item.type ?? 'task'} id="${item.id}" name="${xmlEscape(item.name)}">${refsXml(item.id)}</bpmn:${item.type ?? 'task'}>`).join('\n');
  const flowsXml = flows.map(flow => `    <bpmn:sequenceFlow id="${flow.id}" sourceRef="${flow.source}" targetRef="${flow.target}"${flow.label ? ` name="${xmlEscape(flow.label)}"` : ''}/>`).join('\n');
  const laneShapes = model.lanes.map((item, index) => `    <bpmndi:BPMNShape id="${item.id}_di" bpmnElement="${item.id}" isHorizontal="true"><dc:Bounds x="${laneX}" y="${laneY + index * laneHeight}" width="${laneWidth}" height="${laneHeight}"/></bpmndi:BPMNShape>`).join('\n');
  const nodeShapes = nodeIds.map(id => { const p = positions.get(id); return `    <bpmndi:BPMNShape id="${id}_di" bpmnElement="${id}"><dc:Bounds x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}"/></bpmndi:BPMNShape>`; }).join('\n');
  const edgeShapes = flows.map(flow => { const a = positions.get(flow.source), b = positions.get(flow.target); const x1 = a.x + a.w, y1 = a.y + a.h / 2, x2 = b.x, y2 = b.y + b.h / 2, mid = Math.round((x1 + x2) / 2); const points = x2 > x1 ? [[x1,y1],[mid,y1],[mid,y2],[x2,y2]] : [[a.x+a.w/2,a.y],[a.x+a.w/2,laneY+12],[b.x+b.w/2,laneY+12],[b.x+b.w/2,b.y]]; return `    <bpmndi:BPMNEdge id="${flow.id}_di" bpmnElement="${flow.id}">${points.map(([x,y]) => `<di:waypoint x="${x}" y="${y}"/>`).join('')}${flow.label ? `<bpmndi:BPMNLabel><dc:Bounds x="${mid-50}" y="${x2 > x1 ? y1-27 : laneY+12}" width="100" height="24"/></bpmndi:BPMNLabel>` : ''}</bpmndi:BPMNEdge>`; }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="Definitions_${model.id}" targetNamespace="https://process-navigator.local/demo">
  <bpmn:process id="${model.id}" name="${xmlEscape(model.name)}" isExecutable="false">
    <bpmn:laneSet id="LaneSet_${model.id}">
${lanesXml}
    </bpmn:laneSet>
    <bpmn:startEvent id="StartEvent" name="${xmlEscape(model.trigger)}">${refsXml('StartEvent')}</bpmn:startEvent>
${tasksXml}
    <bpmn:endEvent id="EndEvent" name="${xmlEscape(model.result)}">${refsXml('EndEvent')}</bpmn:endEvent>
${flowsXml}
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diagram_${model.id}"><bpmndi:BPMNPlane id="Plane_${model.id}" bpmnElement="${model.id}">
${laneShapes}
${nodeShapes}
${edgeShapes}
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</bpmn:definitions>
`;
}

export function contextFor(model) {
  const elements = {
    StartEvent: { description: model.trigger, responsible: model.lanes[0].name, artifacts: [], actions: [] }
  };
  model.steps.forEach(item => {
    elements[item.id] = {
      description: item.description,
      responsible: model.lanes.find(value => value.id === item.laneId)?.name,
      duration: '1 рабочий день',
      inputs: item.channels.filter(channel => channel.direction === 'input').map(channel => channel.documentName ?? channel.label).concat(item.channels.some(channel => channel.direction === 'input') ? [] : ['Результат предыдущего этапа']),
      expectedResult: item.channels.filter(channel => channel.direction === 'output').map(channel => channel.documentName ?? channel.label).join('; ') || 'Результат этапа передан следующему участнику',
      completionCriteria: 'Результат зарегистрирован и доступен следующему участнику',
      instruction: 'Демонстрационная инструкция. Уточните фактические правила перед использованием процесса как рабочего.',
      workDuration: '4 часа', waitDuration: 'до 1 рабочего дня', artifacts: [], actions: [], channels: item.channels.map((channel, index) => ({ id: `${item.id}-channel-${index + 1}`, ...channel })),
      linkedProcessId: item.linkedProcessId
    };
  });
  elements.EndEvent = { description: model.result, responsible: model.lanes.at(-1).name, artifacts: [], actions: [] };
  return {
    version: '0.1', owner: model.owner, ownerLegalEntityId: model.ownerEntity, ownerUnitId: model.ownerUnit, status: 'Published',
    passport: { level: model.level, classification: model.classification, parentProcessId: model.parent, purpose: model.purpose, scope: 'Демонстрационный контур Process Navigator; не является утверждённым регламентом.', trigger: model.trigger, triggerOptions: model.triggerOptions ?? [], result: model.result, inputs: ['Исходные требования предыдущего уровня'], outputs: [model.result], systems: [...new Set(model.steps.flatMap(item => item.channels.map(channel => channel.systemName).filter(Boolean)))], documents: [...new Set(model.steps.flatMap(item => item.channels.map(channel => channel.documentName).filter(Boolean)))], relatedProcessIds: [] },
    elements
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log('Use node tools/reset-demo-contour.mjs to preview; add --apply to back up and replace demo data.');
}
