import { useMemo, useState } from 'react';
import type { ProcessModel, ProcessNode } from './types';
import { buildProcessInstruction } from './process-instruction';
import { inspectReadability } from './process-readability';
import './process-instruction.css';

export function ProcessInstructionPage({ process, edition, onBack, onSelect }: { process: ProcessModel; edition?: string; onBack: () => void; onSelect: (node: ProcessNode) => void }) {
  const [query, setQuery] = useState('');
  const [laneId, setLaneId] = useState('');
  const built = useMemo(() => {
    try { return { data: buildProcessInstruction(process), error: '' }; }
    catch (cause) { return { data: undefined, error: cause instanceof Error ? cause.message : 'Не удалось построить инструкцию.' }; }
  }, [process]);
  const data = built.data;
  const readability = useMemo(() => inspectReadability(process), [process]);
  const labels = { startEvent: 'Начало', endEvent: 'Завершение', exclusiveGateway: 'Исключающий шлюз', parallelGateway: 'Параллельный шлюз', task: 'Действие' };
  const channelKinds = { system: 'система', email: 'электронная почта', paper: 'бумага', phone: 'телефон', memo: 'служебная записка', meeting: 'совещание', other: 'другой канал' };
  const channelDirections = { input: 'вход', work: 'работа', output: 'выход' };
  const channelFlows = { primary: 'основной', alternative: 'альтернативный', parallel: 'параллельный' };
  const link = (id: string) => { const node = data?.nodes.get(id); return node ? <button onClick={() => onSelect(node)}>{node.name || id} · {labels[node.type]}</button> : <span>Отсутствует: {id}</span>; };
  const transitions = (node: ProcessNode) => <div className="instruction-transitions"><div><h4>Входящие переходы</h4>{process.edges.filter(edge => edge.targetId === node.id).map(edge => <p key={edge.id}>{link(edge.sourceId)}{edge.label ? ' · ' + edge.label : ''}</p>)}</div><div><h4>Исходящие переходы</h4>{process.edges.filter(edge => edge.sourceId === node.id).map(edge => <p key={edge.id}>{edge.label ? edge.label + ' → ' : ''}{link(edge.targetId)}</p>)}</div></div>;
  const needle = query.trim().toLocaleLowerCase('ru-RU');
  const tasks = data?.tasks.filter(node => (!laneId || node.laneId === laneId) && (!needle ||
    [node.id, node.name, node.instruction, node.description, node.systemName, node.expectedResult, ...(node.inputs ?? []), ...(node.informationObjects ?? []).map(item => item.name)].join(' ').toLocaleLowerCase('ru-RU').includes(needle))) ?? [];
  return <main className="feature-page instruction-page"><div className="feature-page-shell">
    <nav className="feature-breadcrumb"><button onClick={onBack}>← К схеме процесса</button><span>›</span><strong>Рабочая инструкция</strong></nav>
    <header><span className="eyebrow">{edition ?? (process.status === 'Published' ? 'Опубликованная модель' : process.status === 'Draft' ? 'Черновик' : process.status)} · версия {process.version} · {process.id}</span><h1>{process.name}</h1><p>Представление текущей открытой редакции. Не меняет схему, статусы или доступность действий экземпляра. Фильтр скрывает карточки, но не меняет маршрут.</p></header>
    {built.error && <p role="alert">{built.error}</p>}
    <details className="instruction-card"><summary>Читаемость схемы · рекомендаций: {readability.advice.length}</summary><p>Подсказки по геометрии, не ошибки BPMN и не запрет сохранения. Дочерние схемы и фактическое отображение шрифтов здесь не проверяются.</p>
      {!readability.advice.length && <p>Эвристики не нашли замечаний. Это не подтверждает визуальную читаемость: проверьте схему на своём экране.</p>}
      {readability.advice.map(item => <section key={item.code}><h3>{item.message}</h3>{item.nodeIds.slice(0, 30).map((id, index) => { const node = process.nodes.find(candidate => candidate.id === id); return node ? <button key={index} onClick={() => onSelect(node)}>{node.name || id} · {id}</button> : null; })}{item.nodeIds.length > 30 && <p>Показаны первые 30 из {item.nodeIds.length} элементов этой группы.</p>}</section>)}
    </details>
    {data && <>
      <section className="instruction-notice"><p>Карточки сгруппированы по минимальному расстоянию от начала для обзора. Это не обязательная последовательность: выбирайте ветви и параллельную работу по переходам схемы.</p>
        <p>Требуемые статусы документов и правила действий при исключении показываются только если они описаны в инструкции или условиях; отдельные структурированные поля пока не реализованы.</p>
        {!data.hasStart && <p>Начальное событие отсутствует. Группировка начинается от элементов без входящих стрелок и не подтверждает корректность запуска.</p>}
        {data.hasCycle && <p>В маршруте есть цикл: повторный проход нельзя представить одноразовым линейным списком.</p>}
        {!!data.unreachable.length && <p>Не достижимы от найденных начал: {data.unreachable.length} действий. Они сохранены в инструкции с предупреждением.</p>}
        {!!data.broken.length && <p>Оборванных переходов: {data.broken.length}. Выполните проверку модели.</p>}
      </section>
      <div className="instruction-filters"><label>Найти действие<input value={query} onChange={event => setQuery(event.target.value)} placeholder="Название, ID, инструкция, система…"/></label><label>Дорожка<select value={laneId} onChange={event => setLaneId(event.target.value)}><option value="">Все дорожки</option>{process.lanes.map(lane => <option key={lane.id} value={lane.id}>{lane.name}</option>)}</select></label><span>Показано {Math.min(tasks.length, 200)} из {data.tasks.length}</span></div>
      <details className="instruction-card"><summary>События, условия и развилки ({process.nodes.filter(node => node.type !== 'task').length})</summary>{process.nodes.filter(node => node.type !== 'task').slice(0, 200).map(node => <article key={node.id}><h3>{node.name || node.id} · {labels[node.type]}</h3>{node.type === 'parallelGateway' && <p>Параллельные ветви — не альтернативы. Условия синхронизации смотрите на схеме.</p>}{transitions(node)}</article>)}{process.nodes.filter(node => node.type !== 'task').length > 200 && <p>Показаны первые 200 событий/шлюзов. Остальные доступны на схеме.</p>}</details>
      {tasks.length > 200 && <p>Показаны первые 200 из {tasks.length} найденных действий. Уточните поиск или дорожку; сама модель не ограничивается этим числом.</p>}
      {tasks.slice(0, 200).map(node => <article className="instruction-card" key={node.id}><header><div><small>{node.id} · {process.lanes.find(lane => lane.id === node.laneId)?.name ?? 'Дорожка не определена'}</small><h2>{node.name || 'Без названия'}</h2></div><button onClick={() => onSelect(node)}>Открыть действие на схеме</button></header>
        {data.unreachable.includes(node.id) && <p className="instruction-warning">Нет пути от найденного начала. Не считайте это подтверждённым рабочим маршрутом.</p>}
        <div className="instruction-fields"><section><h3>Как выполнить</h3><p>{node.instruction || node.description || 'Инструкция не заполнена.'}</p><p>Исполнитель: {node.executorKind === 'system' ? 'информационная система' : node.executorKind === 'human' ? 'сотрудник' : 'не уточнён'}{node.systemName ? ' · ' + node.systemName : ''}</p><p>Ответственный: {node.responsible || 'не указан'}.</p><p>Норма: {node.duration || 'не указана'}{node.workDuration ? ' · работа: ' + node.workDuration : ''}{node.waitDuration ? ' · ожидание: ' + node.waitDuration : ''}</p></section>
          <section><h3>Входы и результат</h3><p>Входы: {node.inputs?.length ? node.inputs.join('; ') : 'не заполнены'}.</p><p>Ожидаемый результат: {node.expectedResult || 'не заполнен'}.</p><p>Критерий завершения: {node.completionCriteria || 'не заполнен'}.</p></section></div>
        {!!node.informationObjects?.length && <section><h3>Документы и результаты</h3><ul>{node.informationObjects.map((object, index) => <li key={index}>{object.name} · {object.role === 'Input' ? 'вход' : object.role === 'Output' ? 'выход' : 'справочный'} · {object.required ? 'обязательный' : 'необязательный'}{object.version ? ' · версия ' + object.version : ''}{object.condition ? ' · условие: ' + object.condition : ''}</li>)}</ul></section>}
        {!!node.channels?.length && <section><h3>Рабочее место и каналы</h3><ul>{node.channels.map(channel => <li key={channel.id}>{channel.label} · {channelKinds[channel.kind]} · {channelDirections[channel.direction]} · {channelFlows[channel.flow]}{channel.systemName ? ' · ' + channel.systemName : ''}{channel.documentName ? ' · ' + channel.documentName : ''}</li>)}</ul></section>}
        {!!node.actions?.length && <section><h3>Предусмотренные действия</h3><ul>{node.actions.map(action => <li key={action.id}>{action.label} · {action.kind}</li>)}</ul><p>Для выполнения откройте исходный шаг: здесь команды не запускаются.</p></section>}
        {!!node.artifacts?.length && <section><h3>Материалы редакции</h3><ul>{node.artifacts.map((artifact, index) => <li key={index}>{artifact.name} · {artifact.kind} · {artifact.version}</li>)}</ul><p>Открывайте материалы из карточки шага; их доступность здесь не подтверждается.</p></section>}
        {node.linkedProcessId && <p>Есть детализация: {node.linkedProcessId}. Раскройте её на исходной схеме; инструкция не смешивает редакции дочерних процессов.</p>}
        <section><h3>Отклонения и уточнения</h3>{node.evidence?.filter(item => item && item.status !== 'fact').map((item, index) => <p key={index}>{item.status === 'question' ? 'Вопрос' : 'Допущение'}: {item.statement}</p>)}<p>Автоматической инструкции при исключении нет. Если правила не описаны, уточните у владельца процесса; условия переходов ниже не подменяются предположениями.</p></section>
        {transitions(node)}
      </article>)}
      {!tasks.length && <p>Нет действий, соответствующих фильтру.</p>}
    </>}
  </div></main>;
}
