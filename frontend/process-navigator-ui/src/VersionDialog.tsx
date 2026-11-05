import {WorkspaceToolPage} from './WorkspaceToolPage';
import {pageReadRequest} from './page-read-request';
import {PageReadState} from './PageReadState';
import { useEffect, useState } from 'react';
import { Clock3, X } from 'lucide-react';
import { loadVersions } from './api';
import type { ProcessVersion } from './types';

const statusName: Record<ProcessVersion['status'], string> = {
  Published: 'Действует', Draft: 'Черновик', Archived: 'Архив'
};

export function VersionDialog({ processId, processName, onClose, onOpen }: { processId: string; processName: string; onClose: () => void; onOpen: (version: ProcessVersion) => void }) {
  const [versions, setVersions] = useState<ProcessVersion[]>();
  const [error, setError] = useState('');
  const [revision,setRevision]=useState(0);
  useEffect(() => {setVersions(undefined);setError('');return pageReadRequest(signal=>loadVersions(processId,signal),setVersions,setError);}, [processId,revision]);
  return <WorkspaceToolPage title="История версий процесса" onBack={onClose}>
    <section className="import-dialog version-dialog" role="region" aria-labelledby="version-title">
      <button className="icon-button dialog-close" onClick={onClose} aria-label="Закрыть"><X size={18}/></button>
      <span className="eyebrow">История процесса</span><h2 id="version-title">{processName}</h2>
      {!versions&&<PageReadState error={error} loading="Загружаем редакции…" onRetry={()=>setRevision(n=>n+1)}/>}
      {versions&&!versions.length&&<p role="status">Доступных редакций нет. Вернитесь к каталогу и проверьте выбранный процесс.</p>}
      {versions && <div className="version-list">{versions.map(version => <button type="button" className={`version-row is-${version.status.toLowerCase()}`} key={`${version.status}-${version.version}`} onClick={() => onOpen(version)}><Clock3 size={18}/><div><strong>Версия {version.version}</strong><small>{new Date(version.createdAt).toLocaleString('ru-RU')}</small></div><span>{statusName[version.status]}</span></button>)}</div>}
    </section>
  </WorkspaceToolPage>;
}
