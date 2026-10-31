import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, RefreshCw, Rocket, X, XCircle } from 'lucide-react';
import { validateDraft } from './api';
import type { ProcessValidationReport } from './types';
import './publication-validation.css';
import {ValidationProfilePanel} from './ValidationProfilePanel';
import {profileIssues,type ValidationProfile} from './validation-profiles';
import {RouteTopologySummary} from './RouteTopologySummary';

type Props = { processId: string; version: string; busy: boolean; onClose: () => void; onPublish: () => void; onSelectElement: (elementId: string) => void };

export function PublicationValidationDialog({ processId, version, busy, onClose, onPublish, onSelectElement }: Props) {
  const [report, setReport] = useState<ProcessValidationReport>();
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [profile,setProfile]=useState<ValidationProfile>('publication');
  useEffect(() => {
    const controller=new AbortController();setReport(undefined);setError('');
    validateDraft(processId,controller.signal).then(value=>{if(!controller.signal.aborted)setReport(value);}).catch(reason=>{if(!controller.signal.aborted)setError(reason instanceof Error?reason.message:'Не удалось выполнить проверку.');});
    return ()=>controller.abort();
  }, [processId, reload]);
  return <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && !busy && onClose()}>
    <section className="import-dialog publication-validation-dialog" role="dialog" aria-modal="true" aria-label="Проверка перед публикацией">
      <button className="dialog-close" onClick={onClose} disabled={busy} aria-label="Закрыть"><X size={17}/></button>
      <span className="eyebrow">Контроль качества модели</span><h2>Проверка перед публикацией</h2><p>Критические ошибки защищают действующую версию от некорректной схемы. Рекомендации можно устранить позднее.</p>
      <ValidationProfilePanel profile={profile} onChange={setProfile} input={report}/>
      <p>Здесь проверяются обязательные правила одной редакции. Это не полный аудит каталога с дополнительными замечаниями реестра документов. Кнопка публикации всегда подчиняется исходному ответу сервера, независимо от выбранного профиля.</p>
      {!report && !error && <div className="version-loading"><div className="loader"/>Проверяем BPMN, оргструктуру и контекст…</div>}
      {error && <div className="import-message is-error"><AlertTriangle size={17}/><span>{error}</span></div>}
      {report && <><div className={`validation-summary ${report.canPublish ? 'is-ready' : 'is-blocked'}`}>{report.canPublish ? <CheckCircle2 size={24}/> : <XCircle size={24}/>}<span><strong>{report.canPublish ? `Версия ${version} прошла обязательные структурные проверки` : 'Публикация пока недоступна'}</strong><small>{report.errorCount} критических ошибок · {report.warningCount} рекомендаций</small></span></div>
        <RouteTopologySummary topology={report.topology} onSelect={onSelectElement}/>
        <div className="validation-issues">{profileIssues(report.issues,profile).map((issue, index) => <button key={`${issue.code}:${issue.elementId ?? index}`} className={issue.severity === 'Error' ? 'is-error' : 'is-warning'} disabled={!issue.elementId} onClick={() => issue.elementId && onSelectElement(issue.elementId)}>{issue.severity === 'Error' ? <XCircle size={17}/> : <AlertTriangle size={17}/>}<span>{issue.message}{issue.elementName && <small>{issue.elementName}</small>}</span></button>)}{!profileIssues(report.issues,profile).length && <div className="validation-empty"><CheckCircle2 size={20}/>В выбранном профиле замечаний нет. Полные количества показаны выше.</div>}</div>
        <div className="dialog-actions validation-actions"><button onClick={() => setReload(value => value + 1)} disabled={busy}><RefreshCw size={15}/>Проверить снова</button><button className="primary" onClick={onPublish} disabled={!report.canPublish || busy}><Rocket size={15}/>{busy ? 'Публикуем…' : 'Опубликовать версию'}</button></div></>}
    </section>
  </div>;
}
