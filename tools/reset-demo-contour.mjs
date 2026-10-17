import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { processes as templates, buildBpmn, contextFor } from './generate-demo-showcase.mjs';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const flow = (source, target, label) => ({ source, target, label });
const channel = (kind, label, direction, systemName, documentName) => ({ kind, label, direction, systemName, documentName, flow: 'primary' });

export function createDemoContour() {
  const models = structuredClone(templates);
  const production = models.find(model => model.id === 'demo-showcase-l2-production');
  const gateway = (id, type, laneId, column, name = '') => ({ id, type, laneId, column, name, description: 'Демонстрационная маршрутизация', channels: [] });
  production.steps.splice(1, 0, gateway('Gateway_ParallelSplit', 'parallelGateway', 'Lane_Dispatch', 1));
  production.steps.splice(3, 0, { id: 'Task_PrepareWarehouse', name: 'Подготовить склад к приёмке', laneId: 'Lane_StockProd', column: 2, description: 'Проверить свободное место и подготовить адрес хранения.', channels: [channel('paper', 'Лист подготовки', 'output', null, 'Лист готовности склада')] });
  production.steps.splice(4, 0, gateway('Gateway_ParallelJoin', 'parallelGateway', 'Lane_Qc', 3));
  production.steps.find(step => step.id === 'Task_Manufacture').column = 2;
  production.flows = [flow('StartEvent', 'Task_ProductionOrder'), flow('Task_ProductionOrder', 'Gateway_ParallelSplit'), flow('Gateway_ParallelSplit', 'Task_Manufacture'), flow('Gateway_ParallelSplit', 'Task_PrepareWarehouse'), flow('Task_Manufacture', 'Gateway_ParallelJoin'), flow('Task_PrepareWarehouse', 'Gateway_ParallelJoin'), flow('Gateway_ParallelJoin', 'Task_Quality'), flow('Task_Quality', 'Task_TransferStock'), flow('Task_TransferStock', 'EndEvent')];

  const intake = {
    id: 'demo-showcase-l3-request', name: 'Демо: проверка заявки на обеспечение', level: 3, parent: 'demo-showcase-l2-procurement', classification: 'Обеспечивающий', owner: 'ОПиКЗ', ownerEntity: 'plant', ownerUnit: '1.2.4',
    purpose: 'Показать проверку полноты заявки и управляемую доработку.', trigger: 'Получена заявка на обеспечение', triggerOptions: ['Электронная почта', 'Телефон', 'Служебная записка'], result: 'Заявка проверена, лимит подтверждён',
    lanes: [{ id: 'Lane_Request', name: 'УСЗ', entity: 'plant', unit: '1.6' }, { id: 'Lane_Check', name: 'ОПиКЗ', entity: 'plant', unit: '1.2.4' }, { id: 'Lane_Limit', name: 'ФЭУ', entity: 'communications', unit: '2.2' }],
    steps: [
      { id: 'Task_CreateRequest', name: 'Уточнить и записать заявку', laneId: 'Lane_Request', description: 'Зафиксировать изделие, количество, дату и основание потребности.', channels: [channel('email', 'Запрос заказчика', 'input', null, 'Заявка на обеспечение')] },
      { id: 'Task_ReviewRequest', name: 'Проверить полноту заявки', laneId: 'Lane_Check', description: 'Проверить заполнение реквизитов и определить необходимость уточнения.', channels: [channel('system', 'Проверка заявки', 'work', '1С:ERP', 'Заявка на обеспечение')] },
      gateway('Gateway_RequestValid', 'exclusiveGateway', 'Lane_Check', 2, 'Заявка полна?'),
      { id: 'Task_ApproveBudget', name: 'Подтвердить лимит обеспечения', laneId: 'Lane_Limit', description: 'Сверить потребность с доступным лимитом; отметить результат проверки.', channels: [channel('system', 'Проверка лимита', 'output', '1С:ERP', 'Подтверждение лимита')] }
    ],
    flows: [flow('StartEvent', 'Task_CreateRequest'), flow('Task_CreateRequest', 'Task_ReviewRequest'), flow('Task_ReviewRequest', 'Gateway_RequestValid'), flow('Gateway_RequestValid', 'Task_CreateRequest', 'Нет — уточнить'), flow('Gateway_RequestValid', 'Task_ApproveBudget', 'Да'), flow('Task_ApproveBudget', 'EndEvent')]
  };
  models.find(model => model.id === 'demo-showcase-l2-procurement').steps[0].linkedProcessId = intake.id;
  models.push(intake);
  const warehouse = {
    id: 'demo-showcase-l3-warehouse', name: 'Демо: приёмка и отражение поступления', level: 3, parent: 'demo-showcase-l2-procurement', classification: 'Обеспечивающий', owner: 'СХ', ownerEntity: 'plant', ownerUnit: '1.2.5',
    purpose: 'Разделить физическую приёмку, системную обработку и финансовое отражение.', trigger: 'Груз и сопроводительные документы поступили', result: 'Приёмка и финансовый учёт сверены',
    lanes: [{ id: 'Lane_Receive', name: 'СХ', entity: 'plant', unit: '1.2.5' }, { id: 'Lane_Operator', name: 'ИТ', entity: 'communications', unit: '2.3' }, { id: 'Lane_Accounting', name: 'БУ', entity: 'communications', unit: '2.4' }],
    steps: [
      { id: 'Task_PhysicalReceipt', type: 'manualTask', name: 'Проверить груз и документы', laneId: 'Lane_Receive', description: 'Сверить фактическое количество и комплект бумажных документов.', channels: [channel('paper', 'Документы поставщика', 'input', null, 'УПД и сертификаты')] },
      { id: 'Task_ReceiptOrder', type: 'userTask', name: 'Оформить приходный ордер', laneId: 'Lane_Receive', description: 'Записать фактическую приёмку в складском контуре.', channels: [channel('system', 'Рабочее место кладовщика', 'output', '1С:ERP', 'Приходный ордер на товары')] },
      { id: 'Task_SystemNotice', type: 'serviceTask', name: 'Зарегистрировать ордер и подготовить извещение', laneId: 'Lane_Operator', description: 'Моделируемое действие ERP: зарегистрировать ордер и подготовить извещение бухгалтерии. В демо результат подтверждается вручную; подключение к ERP отсутствует.', channels: [channel('system', 'Извещение о приёмке', 'output', '1С:ERP', 'Извещение бухгалтерии')] },
      { id: 'Task_Accounting', type: 'userTask', name: 'Отразить финансовое поступление', laneId: 'Lane_Accounting', description: 'Сверить ордер, УПД и документ приобретения; физический и финансовый факт проверяются раздельно.', channels: [channel('system', 'Рабочее место бухгалтера', 'output', '1С:ERP', 'Приобретение товаров и услуг'), { ...channel('paper', 'Оригинал УПД', 'output', null, 'Подписанный УПД'), flow: 'parallel' }] }
    ]
  };
  models.find(model => model.id === 'demo-showcase-l2-procurement').steps.at(-1).linkedProcessId = warehouse.id;
  // Parent activities reference the child's documents; they do not create a second copy.
  for (const item of models.find(model => model.id === 'demo-showcase-l2-procurement').steps.at(-1).channels) item.direction = 'work';
  for (const item of production.steps.find(step => step.id === 'Task_TransferStock').channels.filter(item => item.kind === 'paper')) item.direction = 'work';
  models.push(warehouse);

  const entityNames = { corporation: 'Демо — Управляющая компания «Вектор»', plant: 'Демо — Завод «Орион»', communications: 'Демо — Сервисный центр «Контур»' };
  const names = { '0.1': 'Дирекция группы', '1': 'Дирекция завода', '1.6': 'Управление сопровождения заказов', '1.4': 'Конструкторский отдел', '1.2.4': 'Отдел планирования и контроля закупок', '1.7': 'Производственная дирекция', '1.7.1': 'Отдел конструкторского сопровождения производства', '1.7.2': 'Технологический отдел', '1.3': 'Управление качества', '1.3.3': 'Отдел стандартизации и системы менеджмента качества', '1.2.1': 'Отдел закупки материалов', '1.2.5': 'Складское хозяйство', '1.7.5.1': 'Сборочный цех', '1.3.2': 'Отдел технического контроля', '1.3.5': 'Испытательная лаборатория', '2.2': 'Финансово-экономическое управление', '2.3': 'Управление информационных технологий', '2.4': 'Бухгалтерия' };
  const legalEntities = Object.entries(entityNames).map(([id, name]) => {
    const lanes = models.flatMap(model => model.lanes).filter(lane => lane.entity === id);
    const units = [...new Map(lanes.map(lane => [lane.unit, { id: lane.unit, name: names[lane.unit], shortName: lane.name === 'Корпорация' ? 'ДГ' : lane.name === 'РуководствоПроизводства' ? 'ДЗ' : lane.name, managerPosition: 'Руководитель подразделения' }])).values()];
    return { id, name, description: 'Вымышленная организация для демонстрации и испытаний; не данные предприятия.', units, directions: [{ id: 'demo-showcase', name: 'Демонстрационный контур', description: 'Измерительный модуль: от запроса до поставки и учёта.', icon: 'planning', processIds: models.filter(model => model.lanes.some(lane => lane.entity === id)).map(model => model.id) }] };
  });
  for (const model of models) {
    for (const lane of model.lanes) lane.name = legalEntities.find(entity => entity.id === lane.entity).units.find(unit => unit.id === lane.unit).shortName;
    model.owner = legalEntities.find(entity => entity.id === model.ownerEntity).units.find(unit => unit.id === model.ownerUnit).shortName;
  }
  models[0].name = 'Демо-контур: заказ и поставка измерительного модуля';
  const organization = { id: 'demo-vector-group', name: 'Демонстрационная группа «Вектор»', description: 'Синтетический учебный контур Process Navigator. Все организации и данные вымышлены.', legalEntities, crossCompanyProcesses: models.map(model => ({ processId: model.id, legalEntityIds: [...new Set(model.lanes.map(lane => lane.entity))], laneOrganizations: model.lanes.map(lane => ({ laneId: lane.id, legalEntityId: lane.entity, department: lane.name, unitId: lane.unit, displayNameMode: 'short' })), description: `Демонстрационный уровень ${model.level}; модель создана для испытаний.` })) };
  const files = new Map([['organization.json', json(organization)]]);
  const registry = new Map();
  for (const model of models) {
    const context = contextFor(model);
    context.version = model.id === 'demo-showcase-l3-warehouse' ? '1.4' : '1.0';
    if (model.id === 'demo-showcase-l3-warehouse') context.passport.sourceRequirements = [
      { id: 'receipt-inspection', text: 'Учебное описание: выполнить физическую приёмку до оформления ордера.', source: 'Учебный сценарий приёмки', locator: 'Раздел приёмки', elementIds: ['Task_PhysicalReceipt', 'Task_ReceiptOrder'], checkSequence: true },
      { id: 'receipt-open-question', text: 'Учебный пример для сверки: определить порядок передачи бумажного извещения. Пункт намеренно оставлен без привязки до уточнения.', source: 'Учебный сценарий приёмки', elementIds: [] },
    ];
    const tasks = model.steps.filter(step => !step.type?.endsWith('Gateway'));
    const inputName = `${model.name.replace('Демо: ', '')}: исходное задание`;
    const resultName = step => `${model.name.replace('Демо: ', '')} — ${step.name.toLowerCase()}`;
    context.passport.inputs = [inputName];
    context.passport.scope = 'Демонстрационный контур: вымышленные данные. Исходник сценария: tools/reset-demo-contour.mjs. Операции внешних систем подтверждаются вручную.';
    tasks.forEach((step, index) => {
      const item = context.elements[step.id];
      item.inputs = [index ? resultName(tasks[index - 1]) : inputName];
      item.expectedResult = resultName(step);
      item.instruction = `${step.description} Используйте входы и каналы в карточке; приложите демонстрационный результат. Для доработки укажите причину возврата. Все сведения синтетические.`;
      item.workDuration = step.type === 'serviceTask' ? '5 минут' : '2 часа';
      item.waitDuration = '0 часов';
      item.duration = item.workDuration;
      item.executionMode = step.type === 'manualTask' ? 'manual' : step.type === 'serviceTask' ? 'system' : 'external';
      item.systemName = step.channels.find(channel => channel.systemName)?.systemName;
      if (model.id === 'demo-showcase-l3-warehouse') {
        item.executorKind = step.type === 'serviceTask' ? 'system' : 'human';
        if (step.type === 'userTask') item.executionMode = 'system';
        if (step.id === 'Task_SystemNotice') item.evidence = [
          { status: 'fact', statement: 'В учебном сценарии ERP моделируется как исполнитель подготовки извещения. Реального подключения нет.', source: 'tools/reset-demo-contour.mjs', locator: 'warehouse.steps / Task_SystemNotice', author: 'Демонстрационный сценарий' },
          { status: 'assumption', statement: 'Учебное допущение: извещение готовится сразу после регистрации ордера.', source: 'Учебный сценарий приёмки', author: 'Демонстрационный сценарий' },
          { status: 'question', statement: 'Пример вопроса для обследования: нужен ли бумажный экземпляр извещения бухгалтерии?', source: 'Учебный сценарий приёмки', author: 'Демонстрационный сценарий' },
        ];
      }
      item.informationObjects = [];
    });
    // A boundary event records arrival of external inputs; it does not invent an internal producer.
    const externalInputs = [...new Set([inputName, ...tasks.flatMap(step => step.channels.filter(channel => channel.direction === 'input').map(channel => channel.documentName).filter(Boolean))])];
    context.elements.StartEvent.expectedResult = externalInputs.join('; ');
    context.elements.StartEvent.description = `${model.trigger}. Внешняя граница демо: получены ${externalInputs.join(', ')}.`;
    context.elements.EndEvent.inputs = [...new Set([model.result, ...tasks.flatMap(step => [resultName(step), ...step.channels.filter(channel => channel.direction === 'output').map(channel => channel.documentName).filter(Boolean)])])];
    for (const step of model.steps.filter(step => step.type?.endsWith('Gateway'))) context.elements[step.id] = { description: step.name || 'Синхронизация ветвей', artifacts: [], actions: [] };
    if (model.id === production.id) {
      context.elements.Task_Manufacture.actions = [{ id: 'record-shift-result', label: 'Зафиксировать результат сменного задания', kind: 'manual' }];
      context.elements.Task_PrepareWarehouse.inputs = [...context.elements.Task_Manufacture.inputs];
      context.elements.Task_Quality.inputs = [context.elements.Task_Manufacture.expectedResult, context.elements.Task_PrepareWarehouse.expectedResult];
    }
    if (model.id === 'demo-showcase-l2-engineering') bind(context.elements.Task_EngineeringApprove, 'demo-approved-documentation', 'Утверждённый комплект КД и ТД', 'Output');
    if (model.id === 'demo-showcase-l2-procurement') bind(context.elements.Task_ReceiveStock, 'demo-materials-available', 'Материалы и ПКИ доступны производству', 'Output');
    if (model.id === production.id) {
      bind(context.elements.Task_ProductionOrder, 'demo-approved-documentation', 'Утверждённый комплект КД и ТД', 'Input');
      bind(context.elements.Task_ProductionOrder, 'demo-materials-available', 'Материалы и ПКИ доступны производству', 'Input');
    }
    files.set(`${model.id}.bpmn`, buildBpmn(model));
    files.set(`${model.id}.context.json`, json(context));
  }
  function bind(element, objectId, name, role) {
    element.informationObjects.push({ objectId, name, role, required: true, version: '1.0' });
    registry.set(objectId, { id: objectId, name, kind: 'Result', version: '1.0', lifecycleState: 'Active', aliases: [name] });
  }
  files.set('InformationObjects/registry.json', json([...registry.values()]));
  return { models, organization, files };
}

export function resetDemoContour(repoRoot, apply = false) {
  const root = fs.realpathSync(repoRoot);
  const data = path.join(root, 'backend', 'ProcessNavigator.Api', 'Data');
  if (!fs.existsSync(path.join(root, 'backend', 'ProcessNavigator.Api', 'ProcessNavigator.Api.csproj'))) throw new Error('Process Navigator repository was not found.');
  if (fs.realpathSync(data) !== data) throw new Error('Data path must not be a symbolic link or junction.');
  const removableDirectories = new Set(['Drafts', 'Versions', 'Passports', 'Assignments', 'Executions', 'Commands', 'Comments', 'Notifications', 'InformationObjects', 'ImportReports', 'ImportSelectionSets', 'Artifacts', 'Audit']);
  const targets = fs.readdirSync(data, { withFileTypes: true }).filter(entry => entry.isDirectory() ? removableDirectories.has(entry.name) : entry.name === 'organization.json' || entry.name.endsWith('.bpmn') || entry.name.endsWith('.context.json')).map(entry => path.join(data, entry.name));
  for (const target of targets) {
    if (path.dirname(target) !== data || fs.lstatSync(target).isSymbolicLink()) throw new Error(`Unsafe reset target: ${target}`);
    assertNoLinks(target);
  }
  const contour = createDemoContour();
  if (!apply) return { preview: true, root, targets: targets.map(target => path.basename(target)), processCount: contour.models.length, organizationCount: contour.organization.legalEntities.length };
  const stamp = `${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}-${process.pid}`;
  const backup = path.join(root, 'artifacts', 'demo-reset', stamp);
  fs.mkdirSync(backup, { recursive: true });
  // Complete and verify every backup before touching a live file.
  for (const target of targets) fs.cpSync(target, path.join(backup, path.basename(target)), { recursive: true, errorOnExist: true, force: false });
  for (const target of targets) verifyCopy(target, path.join(backup, path.basename(target)));
  const staging = path.join(backup, 'new-contour');
  for (const [relative, content] of contour.files) {
    const destination = path.join(staging, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, content);
    if (relative.endsWith('.json')) JSON.parse(fs.readFileSync(destination, 'utf8'));
  }
  fs.writeFileSync(path.join(backup, 'reset-manifest.json'), json({ createdAt: new Date().toISOString(), root, targets: targets.map(target => path.basename(target)), newProcessIds: contour.models.map(model => model.id) }));
  try {
    for (const target of targets) fs.rmSync(target, { recursive: true });
    for (const entry of fs.readdirSync(staging)) fs.cpSync(path.join(staging, entry), path.join(data, entry), { recursive: true });
  } catch (error) {
    // Restore original targets; keep the backup even when rollback succeeds.
    for (const relative of contour.files.keys()) fs.rmSync(path.join(data, relative), { force: true });
    for (const target of targets) fs.cpSync(path.join(backup, path.basename(target)), target, { recursive: true, force: true });
    throw error;
  }
  return { preview: false, root, backup, processes: contour.models.length, organizations: contour.organization.legalEntities.length };
}

function assertNoLinks(target) {
  if (fs.lstatSync(target).isSymbolicLink()) throw new Error(`Link inside reset target: ${target}`);
  if (fs.statSync(target).isDirectory()) for (const entry of fs.readdirSync(target)) assertNoLinks(path.join(target, entry));
}
function verifyCopy(source, destination) {
  if (fs.statSync(source).isDirectory()) for (const entry of fs.readdirSync(source)) verifyCopy(path.join(source, entry), path.join(destination, entry));
  else if (!fs.readFileSync(source).equals(fs.readFileSync(destination))) throw new Error(`Backup verification failed: ${source}`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const repoIndex = args.indexOf('--repo');
  if (repoIndex >= 0 && (!args[repoIndex + 1] || args[repoIndex + 1].startsWith('--'))) throw new Error('--repo requires a repository path.');
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--repo') { index++; continue; }
    if (args[index] !== '--apply') throw new Error(`Unknown argument: ${args[index]}`);
  }
  console.log(json(resetDemoContour(repoIndex >= 0 ? args[repoIndex + 1] : repository, args.includes('--apply'))));
}
