import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, BadgeCheck, Boxes, Building2, Database, Factory, FileText, Gavel, Landmark, MessagesSquare, PackageOpen, Settings2, Shapes, ShoppingCart, Truck, UsersRound, Workflow, Wrench } from 'lucide-react';
import { loadOrganization } from './api';
import { OrganizationTree } from './OrganizationTree';
import { ProcessArchitecture } from './ProcessArchitecture';
import { ProcessDecompositionMap } from './ProcessDecompositionMap';
import type { BusinessDirection, OrganizationMap, ProcessSummary } from './types';
import './enterprise-map.css';

type Props = { catalog: ProcessSummary[]; onOpenProcess: (processId: string) => void; onOpenCatalog: () => void; canManage?: boolean; onManage?: (organization: OrganizationMap) => void; onCreate?: () => void; onImport?: () => void };
const icons = { landmark: Landmark, finance: Landmark, planning: Shapes, procurement: ShoppingCart, production: Factory, warehouse: PackageOpen, legal: Gavel, communications: MessagesSquare, quality: BadgeCheck, logistics: Truck, 'master-data': Database, technology: Wrench, documents: FileText };
const directionIcon = (direction: BusinessDirection) => icons[direction.icon as keyof typeof icons] ?? Boxes;

export function EnterpriseMap({ catalog, onOpenProcess, onOpenCatalog, canManage, onManage, onCreate, onImport }: Props) {
  const [organization, setOrganization] = useState<OrganizationMap>();
  const [selectedEntityId, setSelectedEntityId] = useState<string>();
  const [entityView, setEntityView] = useState<'directions' | 'architecture' | 'structure'>('directions');
  const [groupView, setGroupView] = useState<'companies' | 'decomposition'>('companies');
  const [error, setError] = useState('');
  useEffect(() => { const controller = new AbortController(); loadOrganization(controller.signal).then(value => setOrganization({ ...value, crossCompanyProcesses: value.crossCompanyProcesses.filter(process => new Set(process.legalEntityIds).size > 1) })).catch(reason => reason.name !== 'AbortError' && setError(reason.message)); return () => controller.abort(); }, []);
  const processById = useMemo(() => new Map(catalog.map(process => [process.id, process])), [catalog]);
  const selectedEntity = organization?.legalEntities.find(entity => entity.id === selectedEntityId);

  if (error) return <main className="enterprise-map enterprise-state"><Building2 size={30}/><h1>Карта группы недоступна</h1><p>{error}</p></main>;
  if (!organization) return <main className="enterprise-map enterprise-state"><div className="loader"/><p>Загружаем структуру группы…</p></main>;

  return <main className="enterprise-map">
    <div className="home-quick" style={{ maxWidth: 1500, margin: '0 auto 24px' }}><button onClick={onOpenCatalog}>Каталог всех процессов</button>{onCreate && <button onClick={onCreate}>+ Новый процесс</button>}{onImport && <button onClick={onImport}>Импорт моделей</button>}</div>
    <section className="enterprise-intro">
      <div>{selectedEntity && <button className="map-back" onClick={() => setSelectedEntityId(undefined)}><ArrowLeft size={15}/>Вся группа</button>}<span className="eyebrow">{selectedEntity ? 'Юридическое лицо' : 'Карта группы компаний'}</span><h1>{selectedEntity?.name ?? organization.name}</h1><p>{selectedEntity?.description ?? organization.description}</p></div>
      <div className="enterprise-summary"><button onClick={onOpenCatalog} title="Открыть каталог процессов"><Workflow size={20}/><strong>{catalog.length}</strong><small>процессов в каталоге</small></button><span><Building2 size={20}/><strong>{organization.legalEntities.length}</strong><small>юридических лица</small></span></div>
      {canManage && !selectedEntity && <button className="map-manage" onClick={() => onManage?.(organization)}><Settings2 size={15}/>Настройки группы и оргструктуры</button>}
    </section>

    {!selectedEntity && <nav className="entity-view-tabs group-view-tabs"><button className={groupView === 'companies' ? 'is-active' : ''} onClick={() => setGroupView('companies')}>Юридические лица и направления</button><button className={groupView === 'decomposition' ? 'is-active' : ''} onClick={() => setGroupView('decomposition')}>Уровни и детализация</button></nav>}
    {!selectedEntity && groupView === 'companies' && <>
      <section className="legal-entity-grid" aria-label="Юридические лица группы">{organization.legalEntities.map(entity => {
        const processIds = new Set(entity.directions.flatMap(direction => direction.processIds));
        organization.crossCompanyProcesses.filter(process => process.legalEntityIds.includes(entity.id)).forEach(process => processIds.add(process.processId));
        return <button className="legal-entity-card" key={entity.id} onClick={() => { setSelectedEntityId(entity.id); setEntityView('directions'); }}><span className="legal-entity-icon"><Building2 size={24}/></span><span><strong>{entity.name}</strong><small>{entity.description}</small><em>{entity.directions.length} направлений · {entity.units?.length ?? 0} подразделений · {processIds.size} процессов</em></span><ArrowRight size={20}/></button>;
      })}</section>
      <section className="cross-company"><header><span><UsersRound size={20}/></span><div><h2>Сквозные процессы группы</h2><p>Процессы, в которых совместно участвуют несколько юридических лиц.</p></div></header>{organization.crossCompanyProcesses.map(link => {
        const process = processById.get(link.processId); if (!process) return null;
        return <button key={link.processId} onClick={() => onOpenProcess(link.processId)}><span><strong>{process.name}</strong><small>{link.description}</small><em>{link.legalEntityIds.map(id => organization.legalEntities.find(entity => entity.id === id)?.name).filter(Boolean).join(' → ')}</em></span><ArrowRight size={19}/></button>;
      })}</section>
    </>}
    {!selectedEntity && groupView === 'decomposition' && <ProcessDecompositionMap onOpenProcess={onOpenProcess}/>}

    {selectedEntity && <nav className="entity-view-tabs"><button className={entityView === 'directions' ? 'is-active' : ''} onClick={() => setEntityView('directions')}>Направления и процессы</button>{selectedEntity.id === 'plant' && <button className={entityView === 'architecture' ? 'is-active' : ''} onClick={() => setEntityView('architecture')}>Архитектура процессов <span>23</span></button>}<button className={entityView === 'structure' ? 'is-active' : ''} onClick={() => setEntityView('structure')}>Организационная структура <span>{selectedEntity.units?.length ?? 0}</span></button></nav>}
    {selectedEntity && entityView === 'architecture' && <ProcessArchitecture catalog={catalog} onOpenProcess={onOpenProcess}/>}
    {selectedEntity && entityView === 'structure' && <section className="entity-structure"><OrganizationTree units={selectedEntity.units ?? []}/></section>}
    {selectedEntity && entityView === 'directions' && <section className="direction-grid" aria-label={`Направления ${selectedEntity.name}`}>{selectedEntity.directions.map(direction => {
      const processes = direction.processIds.map(id => processById.get(id)).filter((item): item is ProcessSummary => !!item); const Icon = directionIcon(direction);
      return <article className={`direction-card${processes.length ? ' has-processes' : ''}`} key={direction.id}><header><span className="direction-icon"><Icon size={21}/></span><div><h2>{direction.name}</h2><p>{direction.description}</p></div></header><div className="direction-processes">{processes.map(process => <button key={process.id} onClick={() => onOpenProcess(process.id)}><span><strong>{process.name}</strong><small>Версия {process.version} · {process.nodeCount} элементов · {process.laneCount} ролей</small></span><ArrowRight size={18}/></button>)}{!processes.length && <div className="direction-empty"><span>Процессы ещё не описаны</span><small>Направление подготовлено для дальнейшего наполнения.</small></div>}</div></article>;
    })}</section>}
  </main>;
}
