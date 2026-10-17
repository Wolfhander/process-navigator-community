import { useEffect, useState } from 'react';
import { Clock3, LoaderCircle, X } from 'lucide-react';
import { loadVersions } from './api';
import type { ProcessVersion } from './types';

const statusName: Record<ProcessVersion['status'], string> = {
  Published: 'Действует', Draft: 'Черновик', Archived: 'Архив'
};

export function VersionDialog({ processId, processName, onClose, onOpen }: { processId: string; processName: string; onClose: () => void; onOpen: (version: ProcessVersion) => void }) {
  const [versions, setVersions] = useState<ProcessVersion[]>();
  const [error, setError] = useState('');
  useEffect(() => { loadVersions(processId).then(setVersions).catch(reason => setError(reason instanceof Error ? reason.message : 'Ошибка загрузки')); }, [processId]);
  return <div className="modal-backdrop" role="presentation" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <section className="import-dialog version-dialog" role="dialog" aria-modal="true" aria-labelledby="version-title">
      <button className="icon-button dialog-close" onClick={onClose} aria-label="Закрыть"><X size={18}/></button>
      <span className="eyebrow">История процесса</span><h2 id="version-title">{processName}</h2>
      {!versions && !error && <div className="version-loading"><LoaderCircle className="spin" size={22}/>Загружаем редакции…</div>}
      {error && <div className="import-message is-error">{error}</div>}
      {versions && <div className="version-list">{versions.map(version => <button type="button" className={`version-row is-${version.status.toLowerCase()}`} key={`${version.status}-${version.version}`} onClick={() => onOpen(version)}><Clock3 size={18}/><div><strong>Версия {version.version}</strong><small>{new Date(version.createdAt).toLocaleString('ru-RU')}</small></div><span>{statusName[version.status]}</span></button>)}</div>}
    </section>
  </div>;
}
