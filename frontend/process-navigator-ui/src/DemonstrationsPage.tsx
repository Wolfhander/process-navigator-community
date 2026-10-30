import {useState} from 'react';
import source from '../../../docs/development-decomposition.md?raw';
import scenarios from './demonstration-scenarios.json';
import {parseDevelopmentRoadmap} from './development-roadmap';
import {demonstrationCoverage,selectDemonstrations,readDemonstrationScenarios} from './demonstrations';
import {isSectionAvailable,type AppSection} from './section-location';
import type {ProcessSummary} from './types';
import './demonstrations.css';
const steps=parseDevelopmentRoadmap(source).flatMap(stage=>stage.steps);
const cases=readDemonstrationScenarios(scenarios);
export function DemonstrationsPage({catalog,permissions,onBack,onSection,onProcess}:{catalog:ProcessSummary[];permissions:string[];onBack:()=>void;onSection:(section:AppSection)=>void;onProcess:(id:string)=>void}) {
  const [query,setQuery]=useState('');
  const [error,setError]=useState('');
  const coverage=demonstrationCoverage(steps,cases),visible=selectDemonstrations(steps,cases,query);
  function download(){
    setError('');
    try{
      const report={schemaVersion:1,generatedAt:new Date().toISOString(),scope:'Описание сценариев, не результат их выполнения',query,covered:coverage.done.length-coverage.missing.length,total:coverage.done.length,missing:coverage.missing.map(s=>s.id),duplicates:coverage.duplicates,stale:coverage.stale,scenarios:visible};
      const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='process-navigator-demonstrations.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }catch{setError('Не удалось выгрузить матрицу демонстраций.');}
  }
  return <main className="feature-page"><div className="feature-page-shell demonstration-page">
    <nav className="feature-breadcrumb" aria-label="Путь раздела"><button onClick={onBack}>← Версии программы</button><span>›</span><strong>Матрица демонстраций</strong></nav>
    <h1>Как проверить реализованные функции</h1>
    <p>Матрица демонстраций: для каждого завершённого пункта дорожной карты указаны модель, действия и ожидаемый результат. Это план показа, а не отметка о том, что вы выполнили сценарий.</p>
    <p role="status">Покрыто {coverage.done.length-coverage.missing.length} из {coverage.done.length} завершённых пунктов · сценариев {cases.length}.</p>
    <p>Для изменений, выполнения экземпляров и сброса используйте отдельный учебный контур. Страница ничего не создаёт, не сбрасывает и не запускает автоматически. Протоколы могут относиться к отдельному мастер-набору, а не к текущим данным.</p>
    {!!(coverage.missing.length||coverage.duplicates.length||coverage.stale.length)&&<p role="alert">Матрица требует актуализации: без сценария {coverage.missing.map(s=>s.id).join(', ')||'нет'}; повторы {coverage.duplicates.join(', ')||'нет'}; несогласованные пункты {coverage.stale.join(', ')||'нет'}.</p>}
    <div className="demonstration-controls"><label>Найти функцию или сценарий <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Номер пункта, функция, модель…"/></label><button onClick={download}>Скачать выбранную матрицу JSON</button></div>
    {error&&<p role="alert">{error}</p>}
    <p>Показано пунктов: {visible.reduce((sum,s)=>sum+s.steps.length,0)}.</p>
    {visible.map(s=><section className="demonstration-case" key={s.id}>
      <h2>{s.title}</h2><p>Профиль для показа: {s.role}. Назначения сотрудников и данные экземпляров настраиваются в отдельной копии.</p>
      {s.page!=='demonstrations'&&<button disabled={!isSectionAvailable(s.page,permissions)} onClick={()=>onSection(s.page)}>Открыть раздел для показа</button>}
      {!isSectionAvailable(s.page,permissions)&&<p>Раздел недоступен текущему профилю. Матрица не расширяет права.</p>}
      <h3>Демо-модели</h3><ul>{s.models.map(id=>{const model=catalog.find(m=>m.id===id);const allowed=!!model&&permissions.includes('process.view')&&(model.status!=='Draft'||permissions.some(p=>p==='process.context.edit'||p==='process.diagram.edit'));return <li key={id}>{model&&allowed?<button onClick={()=>onProcess(id)}>{model.name}</button>:<span>{model?'Модель недоступна текущему профилю':'Модель отсутствует в текущем контуре'}</span>} <code>{id}</code></li>;})}</ul>
      <h3>Шаги показа</h3><ol>{s.actions.map((action,i)=><li key={i}>{action}</li>)}</ol>
      <h3>Ожидаемый результат по функциям</h3><ul>{s.steps.map(step=><li key={step.id}><strong>{step.id}. {step.title}</strong><p>{s.expected[String(step.id)]}</p></li>)}</ul>
      <details><summary>Основания и протоколы</summary><ul>{s.evidence.map(path=><li key={path}><a href={'https://github.com/Wolfhander/process-navigator-community/blob/main/'+path.split('/').map(encodeURIComponent).join('/')} target="_blank" rel="noreferrer">{path}</a></li>)}</ul></details>
    </section>)}
    {!visible.length&&<p>По заданному запросу сценариев нет.</p>}
  </div></main>;
}
