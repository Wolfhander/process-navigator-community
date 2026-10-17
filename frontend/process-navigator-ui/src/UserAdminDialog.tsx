import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, ArrowLeft, CheckCircle2, Save, ShieldCheck, UserRound, X } from 'lucide-react';
import { loadOrganization, loadUserDirectory, updateUser } from './api';
import type { OrganizationMap, UserDirectory, UserProfile } from './types';

export function UserAdminDialog({ currentUserId, onClose, onChanged, page = false }: {
  currentUserId: string;
  onClose: () => void;
  onChanged: () => Promise<void>;
  page?: boolean;
}) {
  const [directory, setDirectory] = useState<UserDirectory>();
  const [selectedId, setSelectedId] = useState('');
  const [draft, setDraft] = useState<UserProfile>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [organization, setOrganization] = useState<OrganizationMap>();

  useEffect(() => { loadUserDirectory().then(data => { setDirectory(data); setSelectedId(data.users[0]?.id ?? ''); }).catch(reason => setError(reason.message)); }, []);
  useEffect(() => { loadOrganization().then(setOrganization).catch(() => undefined); }, []);
  useEffect(() => setDraft(directory?.users.find(user => user.id === selectedId)), [directory, selectedId]);

  const save = async () => {
    if (!draft) return;
    setBusy(true); setError(''); setSaved('');
    try {
      const updated = await updateUser(draft.id, { displayName: draft.displayName, role: draft.role, isActive: draft.isActive, legalEntityId: draft.legalEntityId, unitId: draft.unitId, position: draft.position });
      setDirectory(current => current ? { ...current, users: current.users.map(user => user.id === updated.id ? updated : user) } : current);
      setDraft(updated); setSaved('Изменения сохранены.'); await onChanged();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось сохранить пользователя.'); }
    finally { setBusy(false); }
  };

  const content = <section className={`import-dialog user-admin-dialog${page ? ' user-admin-page-content' : ''}`} role={page ? 'region' : 'dialog'} aria-modal={page ? undefined : true} aria-labelledby="users-title">
      {!page && <button className="icon-button dialog-close" onClick={onClose} aria-label="Закрыть"><X size={18}/></button>}
      <span className="eyebrow">Администрирование доступа</span><h2 id="users-title">Пользователи и роли</h2>
      <p>Назначайте организационные роли и временно отключайте доступ. Набор разрешений определяется выбранной ролью.</p>
      {!directory ? <div className="editor-loading"><div className="loader"/>{error || 'Загружаем пользователей…'}</div> : <div className="user-admin-layout">
        <div className="user-list">{directory.users.map(user => <button key={user.id} className={user.id === selectedId ? 'is-selected' : ''} onClick={() => { setSelectedId(user.id); setError(''); setSaved(''); }}><UserRound size={17}/><span><strong>{user.displayName}</strong><small>{user.roleName}{!user.isActive ? ' · отключён' : ''}</small></span></button>)}</div>
        {draft && <div className="user-edit-card">
          <div className="user-edit-title"><ShieldCheck size={19}/><div><strong>{draft.displayName}</strong><small>{draft.id}</small></div></div>
          <label className="dialog-field">Имя пользователя<input maxLength={160} value={draft.displayName} onChange={event => setDraft({ ...draft, displayName: event.target.value })}/></label>
          <label className="dialog-field">Роль<select value={draft.role} onChange={event => { const role = directory.roles.find(item => item.id === event.target.value)!; setDraft({ ...draft, role: role.id, roleName: role.name, permissions: role.permissions }); }}>{directory.roles.map(role => <option key={role.id} value={role.id}>{role.name}</option>)}</select></label>
          <div className="user-organization-fields">
            <label className="dialog-field">Юридическое лицо<select value={draft.legalEntityId ?? ''} onChange={event => setDraft({ ...draft, legalEntityId: event.target.value || undefined, unitId: undefined })}><option value="">Не назначено</option>{organization?.legalEntities.map(entity => <option key={entity.id} value={entity.id}>{entity.name}</option>)}</select></label>
            <label className="dialog-field">Подразделение<select value={draft.unitId ?? ''} disabled={!draft.legalEntityId} onChange={event => setDraft({ ...draft, unitId: event.target.value || undefined })}><option value="">Не назначено</option>{organization?.legalEntities.find(entity => entity.id === draft.legalEntityId)?.units?.map(unit => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label>
          </div>
          <label className="dialog-field">Должность<input maxLength={160} placeholder="Например, специалист по закупкам" value={draft.position ?? ''} onChange={event => setDraft({ ...draft, position: event.target.value })}/></label>
          <label className="user-active-toggle"><input type="checkbox" checked={draft.isActive} disabled={draft.id === currentUserId} onChange={event => setDraft({ ...draft, isActive: event.target.checked })}/><span><strong>Учётная запись активна</strong><small>{draft.id === currentUserId ? 'Текущего пользователя нельзя отключить' : 'Отключённый пользователь не сможет войти'}</small></span></label>
          <div className="permission-list"><strong>Разрешения роли</strong>{draft.permissions.map(permission => <span key={permission}>{permission}</span>)}</div>
          {error && <div className="import-message is-error"><AlertTriangle size={17}/>{error}</div>}{saved && <div className="context-save-notice"><CheckCircle2 size={17}/>{saved}</div>}
          <button className="import-submit" disabled={busy || !draft.displayName.trim()} onClick={save}><Save size={17}/>{busy ? 'Сохраняем…' : 'Сохранить пользователя'}</button>
        </div>}
      </div>}
    </section>;
  if (!page) return createPortal(<div className="modal-backdrop" role="presentation" onMouseDown={event => event.target === event.currentTarget && onClose()}>{content}</div>, document.body);
  return <main className="feature-page user-admin-page"><div className="feature-page-shell"><nav className="feature-breadcrumb" aria-label="Путь раздела"><button onClick={onClose}><ArrowLeft size={16}/>Настройки</button><span>›</span><strong>Пользователи и роли</strong></nav>{content}</div></main>;
}
