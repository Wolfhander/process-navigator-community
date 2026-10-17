import { useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { createProcess } from './api';
import type { ProcessImportResult } from './types';

type Props = { onClose: () => void; onCreated: (result: ProcessImportResult) => void };

export function CreateProcessDialog({ onClose, onCreated }: Props) {
  const [name, setName] = useState('');
  const [id, setId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const valid = useMemo(() => !!name.trim() && (!id.trim() || /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(id.trim())), [id, name]);

  const submit = async () => {
    setBusy(true); setError('');
    try { onCreated(await createProcess({ name: name.trim(), id: id.trim() || undefined })); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось создать процесс.'); }
    finally { setBusy(false); }
  };

  return <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}><section className="create-process-dialog" role="dialog" aria-modal="true">
    <header><div><span className="eyebrow">Каталог процессов</span><h2>Создать процесс</h2><p>Будет создан нейтральный черновик BPMN 2.0. Подразделения, владельца и ответственных вы назначите после моделирования процесса.</p></div><button className="dialog-close" onClick={onClose}><X size={17}/></button></header>
    <div className="create-process-fields">
      <label>Название<input autoFocus value={name} onChange={event => setName(event.target.value)} placeholder="Например, Согласование договора"/></label>
      <label>Технический идентификатор<input value={id} onChange={event => setId(event.target.value)} placeholder="Можно оставить пустым"/><small>Если поле пустое, система создаст уникальный идентификатор автоматически. Для ручного значения используйте латинские буквы, цифры, точку, дефис и подчёркивание.</small></label>
    </div>
    {error && <div className="organization-error">{error}</div>}
    <footer><button onClick={onClose}>Отмена</button><button className="primary" disabled={!valid || busy} onClick={submit}><Plus size={15}/>{busy ? 'Создаём…' : 'Создать и открыть редактор'}</button></footer>
  </section></div>;
}
