import { useEffect, useMemo, useState } from 'react';
import { loadOrganization, loadProcess } from './api';
import { occurrenceDetails } from './information-object-detail';
import { informationTransfers } from './information-transfers';
import type { InformationObject, InformationObjectOccurrence, OrganizationMap, ProcessModel } from './types';

export function InformationTransferPage({ objects, onBack, onOpen }: { objects: InformationObject[]; onBack: () => void; onOpen: (value: InformationObjectOccurrence) => void }) {
  const [query, setQuery] = useState('');
  const [models, setModels] = useState<Record<string, ProcessModel>>({});
  const [organization, setOrganization] = useState<OrganizationMap>();
  const [loading, setLoading] = useState(true);
  const [failures, setFailures] = useState<string[]>([]);
  const result = useMemo(() => informationTransfers(objects), [objects]);
  const ids = useMemo(() => [...new Set(result.rows.flatMap(row => [row.source?.processId, row.target?.processId]).filter((id): id is string => !!id))], [result]);
  useEffect(() => {
    const controller = new AbortController();
    const loaded: Record<string, ProcessModel> = {}; const errors: string[] = []; let next = 0;
    setLoading(true); setModels({}); setOrganization(undefined); setFailures([]);
    const worker = async () => { while (next < Math.min(ids.length, 200) && !controller.signal.aborted) { const id = ids[next++]; try { loaded[id] = await loadProcess(id, controller.signal); } catch { if (!controller.signal.aborted) errors.push(id); } } };
    const org = loadOrganization(controller.signal).then(value => { if (!controller.signal.aborted) setOrganization(value); }).catch(() => { errors.push('Оргструктура'); });
    Promise.all([org, ...Array.from({ length: Math.min(3, ids.length) }, worker)]).then(() => { if (!controller.signal.aborted) { setModels(loaded); setFailures(errors); setLoading(false); } });
    return () => controller.abort();
  }, [ids]);
  const endpoint = (value?: InformationObjectOccurrence) => {
    if (!value) return <p>Не указан в реестре</p>;
    const facts = occurrenceDetails(value, models[value.processId], organization);
    return <div><button onClick={() => onOpen(value)}>{value.processName} · {value.elementName || 'Паспорт'}</button><p>{facts.responsibility || 'Подразделение не установлено'}</p><p>Системы этапа: {facts.systems.join(' · ') || 'не указаны'}</p><p>Каналы этапа: {facts.channels.map(channel => `${channel.kind}: ${channel.label}`).join(' · ') || 'не указаны'}</p><small>{value.required ? 'Обязательный' : 'Необязательный'} · {value.condition || 'условие не указано'} · версия {value.version || 'не указана'}</small>{!facts.available && <p>Сведения модели недоступны</p>}</div>;
  };
  const visible = result.rows.filter(row => {
    const facts = [row.source, row.target].flatMap(value => value ? [value.processName, value.elementName, occurrenceDetails(value, models[value.processId], organization).responsibility, ...occurrenceDetails(value, models[value.processId], organization).systems] : []);
    return [row.object.name, row.object.id, ...facts].some(value => value?.toLocaleLowerCase('ru-RU').includes(query.trim().toLocaleLowerCase('ru-RU')));
  });
  return <main className="feature-page information-registry"><div className="feature-page-shell"><nav className="feature-breadcrumb"><button onClick={onBack}>← Документы и результаты</button><span>› Матрица передач</span></nav><h1>Матрица передач</h1><p>Сопоставление источников и получателей по ID объекта. Если источников несколько, показаны возможные пары, а не подтверждённые маршруты. Системы и каналы относятся к этапам целиком, не доказывают передачу именно этого объекта.</p><label>Поиск по объекту, процессу, подразделению или системе<input value={query} onChange={event => setQuery(event.target.value)} /></label>{loading && <p role="status">Загружаются сведения этапов…</p>}{failures.length > 0 && <p role="alert">Часть сведений недоступна: {failures.join(', ')}</p>}{(result.limited || ids.length > 200) && <p role="alert">Достигнут предел: 1000 пар или 200 моделей. Уточните фильтры в реестре перед открытием матрицы.</p>}<p>Показано пар: {visible.length}</p><div className="transfer-table"><table><thead><tr><th>Документ / результат</th><th>Источник</th><th>Получатель</th></tr></thead><tbody>{visible.map((row, index) => <tr key={index}><td>{row.object.name}<p>{row.object.id}</p><p>Внешний источник: {row.object.externalSource || 'не указан'}</p><p>Внешний получатель: {row.object.externalRecipient || 'не указан'}</p>{row.object.producers.length > 1 && <strong>Несколько возможных источников</strong>}</td><td>{endpoint(row.source)}</td><td>{endpoint(row.target)}</td></tr>)}</tbody></table></div>{!visible.length && <p>Передачи по выбранным условиям не найдены.</p>}</div></main>;
}
