import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { loadOrganization, loadProcess } from './api';
import type { InformationObject, InformationObjectIssue, InformationObjectOccurrence, OrganizationMap, ProcessModel } from './types';
import { informationObjectVersions, occurrenceDetails } from './information-object-detail';

type Props = { item: InformationObject; issues: InformationObjectIssue[]; onBack: () => void; onOpen: (occurrence: InformationObjectOccurrence) => void };

export function InformationObjectDetailPage({ item, issues, onBack, onOpen }: Props) {
  const [models, setModels] = useState<Record<string, ProcessModel>>({});
  const [organization, setOrganization] = useState<OrganizationMap>();
  const [loading, setLoading] = useState(true);
  const [failures, setFailures] = useState<string[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setModels({}); setFailures([]); setOrganization(undefined);
    const ids = [...new Set([...item.producers, ...item.consumers, ...item.references].map(value => value.processId))];
    const errors: string[] = [];
    const loaded: Record<string, ProcessModel> = {};
    let next = 0;
    const worker = async () => {
      while (next < ids.length && !controller.signal.aborted) {
        const id = ids[next++];
        try { loaded[id] = await loadProcess(id, controller.signal); }
        catch { if (!controller.signal.aborted) errors.push(id); }
      }
    };
    const org = loadOrganization(controller.signal).then(value => { if (!controller.signal.aborted) setOrganization(value); }).catch(() => { if (!controller.signal.aborted) errors.push('Оргструктура'); });
    Promise.all([org, ...Array.from({ length: Math.min(3, ids.length) }, worker)]).then(() => {
      if (!controller.signal.aborted) { setModels(loaded); setFailures(errors); setLoading(false); }
    });
    return () => controller.abort();
  }, [item.id]);
  const versions = informationObjectVersions(item);
  const lifecycle = { Observed: 'Наблюдаемый', Draft: 'Черновик', Active: 'Действующий', Archived: 'Архивный' }[item.lifecycleState];
  const groups = [{ title: 'Создают', values: item.producers }, { title: 'Получают', values: item.consumers }, { title: 'Упоминают', values: item.references }];
  return <main className="feature-page information-registry"><div className="feature-page-shell">
    <nav className="feature-breadcrumb" aria-label="Путь документа"><button onClick={onBack}><ArrowLeft size={16}/>Документы и результаты</button><span>›</span><strong>Карточка объекта</strong></nav>
    <header className="registry-heading"><div><span className="eyebrow">{item.kind === 'Document' ? 'Документ' : 'Результат'} · {item.id}</span><h1>{item.name}</h1><p>Участие объекта в доступных моделях процессов. Это карточка реестра, а не хранилище файлов или архив редакций документа.</p></div></header>
    <section className="object-detail-facts"><article><h2>Состояние реестра</h2><p>{lifecycle} · {item.managed ? 'Принят в реестр' : 'Обнаружен автоматически'}</p><p>Связанность: {item.state}</p></article><article><h2>Встречающиеся версии</h2><p>{versions.join(' · ') || 'Не указаны'}</p><small>Версия реестра: {item.version || 'не указана'}. Это обозначения из моделей, не история файлов.</small></article><article><h2>Синонимы</h2><p>{item.aliases.join(' · ') || 'Не указаны'}</p></article></section>
    {issues.length > 0 && <section className="registry-issues" aria-label="Замечания объекта">{issues.map((issue, index) => <p key={`${issue.code}:${index}`}>{issue.message}</p>)}</section>}
    {loading && <p role="status">Загружаем сведения связанных этапов…</p>}
    {failures.length > 0 && <p role="alert">Сведения загружены частично: {failures.join(', ')}. Ссылки реестра сохранены, отсутствующие данные не подменяются предположениями.</p>}
    <p>Системы и каналы ниже относятся к этапу в целом. Их наличие не доказывает передачу именно этого документа через каждый канал.</p>
    <div className="object-detail-groups">{groups.map(group => <section key={group.title}><h2>{group.title} · {group.values.length}</h2>{group.values.map((value, index) => { const facts = occurrenceDetails(value, models[value.processId], organization); return <article key={`${value.processId}:${value.elementId}:${index}`}><button onClick={() => onOpen(value)}><strong>{value.elementName ?? value.processName}</strong><ArrowRight size={15}/></button><p>{value.processName} · {value.scope === 'Step' ? 'этап' : 'паспорт процесса'}</p><p>{value.required ? 'Обязательный' : 'Необязательный'}{value.condition ? ` при условии: ${value.condition}` : ''} · версия {value.version || 'не указана'}</p>{facts.available ? <><p>{value.scope === 'Process' ? 'Владелец процесса' : 'Ответственное подразделение'}: {facts.responsibility || 'не указано'}</p><p>Системы: {facts.systems.join(' · ') || 'не указаны'}</p>{facts.channels.length > 0 && <ul>{facts.channels.map(channel => <li key={channel.id}>{channel.label} · {channel.kind} · {channel.direction}{channel.documentName ? ` · ${channel.documentName}` : ''}</li>)}</ul>}</> : !loading && <p>Сведения этапа недоступны или этап больше не найден в модели.</p>}</article>; })}{!group.values.length && <p>Не найдены в доступных моделях.</p>}</section>)}</div>
  </div></main>;
}
