import { ArrowLeft, CheckCircle2, Clock3, GitBranch, History, MinusCircle, PencilLine, PlusCircle, Wrench } from 'lucide-react';
import packageInfo from '../package.json';
import history from './release-history.json';
import './app-version.css';

type Release = {
  version: string;
  date: string | null;
  stage: string;
  added: string[];
  changed: string[];
  fixed: string[];
  removed: string[];
  dataCompatibility?: {kind:'unchanged'|'additive'|'manual';scope:string;upgrade:string;rollback:string};
};

const releases = history as Release[];
const compatibilityLabels={unchanged:'Без изменения формата',additive:'Добавлены необязательные поля',manual:'Отдельная ручная операция'} as const;
const sections = [
  { key: 'added', label: 'Добавлено', icon: PlusCircle },
  { key: 'changed', label: 'Изменено', icon: PencilLine },
  { key: 'fixed', label: 'Исправлено', icon: Wrench },
  { key: 'removed', label: 'Убрано', icon: MinusCircle },
] as const;

export function AppVersionPage({ onBack, onRoadmap,onDemonstrations }: { onBack: () => void; onRoadmap: () => void;onDemonstrations?:()=>void }) {
  const current = releases.find(release => release.version === packageInfo.version);
  return <main className="app-version-page"><div className="app-version-content">
    <button className="app-version-back" onClick={onBack}><ArrowLeft size={16}/>К настройкам</button>
    <button className="app-version-back" onClick={onRoadmap}><GitBranch size={16}/>Дорожная карта разработки</button>
    {onDemonstrations&&<button className="app-version-back" onClick={onDemonstrations}>Матрица демонстраций</button>}
    <div className="app-version-heading"><span className="eyebrow"><History size={14}/>История программы</span><h1>Версии Process Navigator</h1><p>Здесь описаны изменения самой программы. История редакций конкретного бизнес-процесса открывается кнопкой «История» на его схеме.</p></div>
    <section className="app-version-current" aria-label="Текущая версия программы"><div><span className="app-version-kicker"><GitBranch size={16}/>Текущая сборка</span><strong>{packageInfo.version}</strong><p>{current?.stage ?? 'Сведения об этой сборке не внесены в журнал изменений.'}</p></div><span className="app-version-status">{current?.date ? <CheckCircle2 size={17}/> : <Clock3 size={17}/>} {current?.date ? 'Опубликована' : 'В разработке'}</span></section>
    <section className="app-version-compatibility" aria-label="Совместимость данных">
      <h2>Совместимость данных</h2>
      <p>Перед обновлением с важными данными создайте резервную копию. При откате сначала проверьте копию отдельно. Сводка не запускает миграцию и не подтверждает совместимость всех пропущенных версий.</p>
      <ul>{releases.filter(release=>release.dataCompatibility).map(release=><li key={release.version}><button onClick={()=>{const target=document.getElementById('release-'+release.version);target?.focus({preventScroll:true});target?.scrollIntoView({block:'start'});}}>Версия {release.version} — {release.dataCompatibility?.scope}</button></li>)}</ul>
      <p>Если примечания для версии нет, совместимость в журнале не описана.</p>
    </section>
    <div className="app-version-history"><h2>Что менялось</h2>{releases.map(release => <article className="app-version-release" id={'release-'+release.version} tabIndex={-1} key={release.version}>
      <header><div><span className="eyebrow">{release.stage}</span><h3>Версия {release.version}</h3></div><time dateTime={release.date ?? undefined}>{release.date ? new Date(`${release.date}T00:00:00`).toLocaleDateString('ru-RU') : 'Текущая разработка'}</time></header>
      <div className="app-version-sections">{sections.filter(section => release[section.key].length || section.key === 'removed').map(section => <section key={section.key}><h4><section.icon size={17}/>{section.label}</h4>{release[section.key].length ? <ul>{release[section.key].map(change => <li key={change}>{change}</li>)}</ul> : <p>Удалений не зафиксировано.</p>}</section>)}</div>
      {release.dataCompatibility&&<section className="app-version-data-note"><h4>Данные: {compatibilityLabels[release.dataCompatibility.kind]}</h4><dl><dt>Область</dt><dd>{release.dataCompatibility.scope}</dd><dt>При обновлении</dt><dd>{release.dataCompatibility.upgrade}</dd><dt>При откате</dt><dd>{release.dataCompatibility.rollback}</dd></dl></section>}
    </article>)}</div>
    <p className="app-version-note">Новые записи появляются при подготовке следующей версии программы. Эта страница не обновляет приложение автоматически.</p>
  </div></main>;
}
