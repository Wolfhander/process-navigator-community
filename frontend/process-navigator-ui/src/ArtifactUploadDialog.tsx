import { useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, FileUp, Upload, X } from 'lucide-react';
import { uploadArtifact } from './api';
import type { Artifact } from './types';

export function ArtifactUploadDialog({ onClose, onUploaded }: { onClose: () => void; onUploaded: (artifact: Artifact) => void }) {
  const [file, setFile] = useState<File>();
  const [name, setName] = useState('');
  const [kind, setKind] = useState('Шаблон');
  const [version, setVersion] = useState('1.0');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const choose = (selected?: File) => { setFile(selected); if (selected && !name) setName(selected.name.replace(/\.[^.]+$/, '')); };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!file) return; setBusy(true); setError('');
    try {
      const uploaded = await uploadArtifact(file, name, kind, version);
      onUploaded({ name: uploaded.name, kind: uploaded.kind, version: uploaded.version, reference: uploaded.reference });
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось загрузить документ.'); }
    finally { setBusy(false); }
  };

  return createPortal(<div className="modal-backdrop" role="presentation" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <section className="import-dialog artifact-upload-dialog" role="dialog" aria-modal="true" aria-labelledby="artifact-upload-title">
      <button className="icon-button dialog-close" onClick={onClose} aria-label="Закрыть"><X size={18}/></button>
      <span className="eyebrow">Репозиторий документов</span><h2 id="artifact-upload-title">Загрузить актуальную версию</h2>
      <p>Файл сохраняется локально на сервере Process Navigator. После загрузки элемент процесса будет ссылаться на эту версию репозитория.</p>
      <form onSubmit={submit}>
        <label className="file-field"><FileUp size={21}/><span><strong>Файл документа</strong><small>{file?.name ?? 'До 20 МБ'}</small></span><input type="file" required onChange={event => choose(event.target.files?.[0])}/></label>
        <label className="dialog-field">Название<input required maxLength={200} value={name} onChange={event => setName(event.target.value)}/></label>
        <div className="dialog-field-grid"><label className="dialog-field">Тип<select value={kind} onChange={event => setKind(event.target.value)}><option>Шаблон</option><option>Инструкция</option><option>Регламент</option><option>Чек-лист</option><option>Образец</option></select></label><label className="dialog-field">Версия<input required maxLength={40} value={version} onChange={event => setVersion(event.target.value)}/></label></div>
        {error && <div className="import-message is-error"><AlertTriangle size={18}/><span>{error}</span></div>}
        <button className="import-submit" disabled={!file || !name.trim() || busy}><Upload size={18}/>{busy ? 'Загружаем…' : 'Загрузить и прикрепить'}</button>
      </form>
    </section>
  </div>, document.body);
}
