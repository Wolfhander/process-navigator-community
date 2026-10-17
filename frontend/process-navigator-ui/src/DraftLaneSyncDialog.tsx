import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Network, RefreshCw, X } from 'lucide-react';
import { syncDraftLaneNames } from './api';
import type { DraftLaneSyncReport } from './types';
import './draft-lane-sync.css';

export function DraftLaneSyncDialog({ onClose, onSynced }: { onClose: () => void; onSynced: () => void }) {
  const [report, setReport] = useState<DraftLaneSyncReport>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async () => {
    setBusy(true); setError('');
    try { setReport(await syncDraftLaneNames()); onSynced(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось обновить дорожки.'); }
    finally { setBusy(false); }
  };
  return <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}><section className="draft-lane-sync-dialog" role="dialog" aria-modal="true" aria-label="Обновление дорожек черновиков">
    <header><div><span className="eyebrow">Оргструктура и BPMN</span><h2>Названия дорожек черновиков</h2><p>Система возьмёт актуальные названия подразделений из оргструктуры и применит выбранное для каждой дорожки полное или сокращённое имя.</p></div><button className="dialog-close" onClick={onClose} aria-label="Закрыть"><X size={17}/></button></header>
    <div className="draft-lane-sync-body"><div className="draft-lane-sync-notice"><Network size={21}/><span>Изменяются только редактируемые черновики. Опубликованные и архивные BPMN, идентификаторы элементов, переходы и координаты не затрагиваются. Открытые в редакторе и находящиеся на согласовании черновики будут пропущены.</span></div>
      {error && <p className="draft-lane-sync-error"><AlertTriangle size={16}/>{error}</p>}
      {report && <><div className="draft-lane-sync-summary"><CheckCircle2 size={19}/><strong>Обновлено процессов: {report.updatedProcesses}</strong><span>Переименовано дорожек: {report.renamedLanes}</span></div><div className="draft-lane-sync-list">{report.items.map(item => <article key={item.processId}><span><strong>{item.processName}</strong><small>{item.status === 'Updated' ? `Переименовано дорожек: ${item.renamedLanes}` : item.status === 'Unchanged' ? 'Названия уже актуальны' : item.reason ?? 'Пропущено'}</small></span><em className={`is-${item.status.toLowerCase()}`}>{item.status === 'Updated' ? 'Обновлён' : item.status === 'Unchanged' ? 'Без изменений' : 'Пропущен'}</em></article>)}{report.items.length === 0 && <p>Черновиков с оргпривязками пока нет.</p>}</div></>}
    </div><footer><button onClick={onClose}>{report ? 'Закрыть' : 'Отмена'}</button><button className="primary" disabled={busy} onClick={run}><RefreshCw size={15}/>{busy ? 'Проверяем…' : report ? 'Проверить повторно' : 'Обновить дорожки'}</button></footer>
  </section></div>;
}
