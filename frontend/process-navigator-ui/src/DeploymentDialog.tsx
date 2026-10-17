import { useEffect, useState } from 'react';
import { Boxes, Building2, CheckCircle2, Cpu, Database, Network, Server, X } from 'lucide-react';
import { loadDeploymentProfile } from './api';
import type { DeploymentProfile, DeploymentSystem } from './types';
import './deployment.css';

type Props = { onClose: () => void };

const systemIcon = (system: DeploymentSystem) => {
  if (system.id === 'kompas') return <Cpu size={18}/>;
  if (system.id === 'zup') return <Building2 size={18}/>;
  if (system.id === 'plm') return <Boxes size={18}/>;
  if (system.id === 'cpm') return <Database size={18}/>;
  return <Server size={18}/>;
};

export function DeploymentDialog({ onClose }: Props) {
  const [profile, setProfile] = useState<DeploymentProfile>();
  const [error, setError] = useState('');

  useEffect(() => {
    loadDeploymentProfile().then(setProfile).catch(reason => setError(reason instanceof Error ? reason.message : 'Не удалось загрузить схему размещения.'));
  }, []);

  return <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <section className="deployment-dialog" role="dialog" aria-modal="true" aria-label="Размещение Process Navigator">
      <header><div><span className="eyebrow">Архитектура внедрения</span><h2>Process Navigator внутри 1С</h2><p>Целевая схема для закрытого контура предприятия. Все компоненты размещаются на внутренних серверах.</p></div><button className="dialog-close" onClick={onClose}><X size={17}/></button></header>
      {!profile ? <div className="editor-loading"><div className="loader"/>{error || 'Загружаем схему размещения…'}</div> : <div className="deployment-content">
        <section className="deployment-decision"><div className="deployment-decision-icon"><Network size={23}/></div><div><span>Рекомендуемый вариант</span><h3>Расширение-оболочка + внутренний веб-сервис</h3><p>{profile.description}</p><strong>Основное приложение: {profile.hostApplication}</strong></div></section>
        <div className="deployment-flow" aria-label="Схема размещения"><span>Пользователь 1С</span><i>→</i><span>Расширение ERP</span><i>→</i><span>Process Navigator</span><i>↔</i><span>Системы группы</span></div>
        <section><div className="deployment-section-title"><h3>Информационный ландшафт</h3><span>{profile.systems.length} систем</span></div><div className="deployment-systems">{profile.systems.map(system => <article key={system.id} className={system.status === 'Primary' ? 'is-primary' : ''}><div className="deployment-system-icon">{systemIcon(system)}</div><div className="deployment-system-main"><div><h4>{system.name}</h4><span>{system.status === 'Primary' ? 'Основная' : 'Следующий контур'}</span></div><p>{system.role}</p><dl><div><dt>Подключение</dt><dd>{system.connection}</dd></div><div><dt>Источник данных</dt><dd>{system.ownership}</dd></div></dl></div></article>)}</div></section>
        <section className="deployment-principles"><h3>Границы ответственности</h3>{profile.principles.map(principle => <p key={principle}><CheckCircle2 size={15}/><span>{principle}</span></p>)}</section>
        <div className="deployment-note"><strong>Почему не полная перепись на языке 1С?</strong><span>BPMN-редактор и интерактивный Canvas уже являются веб-компонентами. Расширение 1С даст нативную точку входа, единый контекст и команды ERP, сохранив обновляемость типовой конфигурации и единую кодовую базу.</span></div>
      </div>}
    </section>
  </div>;
}
