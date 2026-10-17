import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, PlugZap, Save, ServerCog, X } from 'lucide-react';
import { loadOneCSettings, saveOneCSettings, testOneCConnection } from './api';
import type { OneCConnectionStatus, OneCIntegrationUpdate } from './types';
import './one-c-integration.css';

type Props = { onClose: () => void };

export function OneCIntegrationDialog({ onClose }: Props) {
  const [draft, setDraft] = useState<OneCIntegrationUpdate>();
  const [passwordConfigured, setPasswordConfigured] = useState(false);
  const [status, setStatus] = useState<OneCConnectionStatus>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { loadOneCSettings().then(settings => { setDraft({ enabled: settings.enabled, baseUrl: settings.baseUrl, healthPath: settings.healthPath, commandPath: settings.commandPath, username: settings.username, timeoutSeconds: settings.timeoutSeconds }); setPasswordConfigured(settings.passwordConfigured); }).catch(reason => setError(reason.message)); }, []);

  const save = async () => {
    if (!draft) return; setBusy(true); setError(''); setStatus(undefined);
    try { const saved = await saveOneCSettings(draft); setPasswordConfigured(saved.passwordConfigured); setDraft({ enabled: saved.enabled, baseUrl: saved.baseUrl, healthPath: saved.healthPath, commandPath: saved.commandPath, username: saved.username, timeoutSeconds: saved.timeoutSeconds }); setStatus({ connected: false, mode: saved.enabled ? 'OneC' : 'Demo', message: 'Настройки сохранены. Выполните проверку соединения.', checkedAt: new Date().toISOString() }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось сохранить настройки.'); } finally { setBusy(false); }
  };
  const test = async () => { setBusy(true); setError(''); try { setStatus(await testOneCConnection()); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Проверка не выполнена.'); } finally { setBusy(false); } };

  return <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}><section className="one-c-dialog" role="dialog" aria-modal="true" aria-label="Интеграция с 1С">
    <header><div><span className="eyebrow">Системная интеграция</span><h2>Подключение к 1С:ERP</h2><p>Process Navigator вызывает опубликованный HTTP-сервис внутреннего сервера 1С. Доступ в интернет не требуется.</p></div><button className="dialog-close" onClick={onClose}><X size={17}/></button></header>
    {!draft ? <div className="editor-loading"><div className="loader"/>{error || 'Загружаем настройки…'}</div> : <div className="one-c-form">
      <label className="integration-toggle"><input type="checkbox" checked={draft.enabled} onChange={event => setDraft({ ...draft, enabled: event.target.checked })}/><span><strong>Использовать реальную 1С</strong><small>{draft.enabled ? 'ERP-команды направляются в настроенный HTTP-сервис' : 'Сохраняется безопасный демонстрационный адаптер'}</small></span></label>
      <label className="dialog-field">Адрес сервера 1С<input value={draft.baseUrl} onChange={event => setDraft({ ...draft, baseUrl: event.target.value })} placeholder="http://erp-server/enterprise"/></label>
      <div className="dialog-field-grid"><label className="dialog-field">Путь проверки<input value={draft.healthPath} onChange={event => setDraft({ ...draft, healthPath: event.target.value })}/></label><label className="dialog-field">Путь команд<input value={draft.commandPath} onChange={event => setDraft({ ...draft, commandPath: event.target.value })}/></label></div>
      <div className="dialog-field-grid"><label className="dialog-field">Пользователь HTTP-сервиса<input value={draft.username} onChange={event => setDraft({ ...draft, username: event.target.value })}/></label><label className="dialog-field">Пароль<input type="password" value={draft.password ?? ''} onChange={event => setDraft({ ...draft, password: event.target.value })} placeholder={passwordConfigured ? 'Пароль сохранён; оставьте пустым' : 'Пароль'}/></label></div>
      <label className="dialog-field">Тайм-аут, секунд<input type="number" min={1} max={120} value={draft.timeoutSeconds} onChange={event => setDraft({ ...draft, timeoutSeconds: Number(event.target.value) })}/></label>
      {status && <div className={`integration-status ${status.connected ? 'is-connected' : ''}`}>{status.connected ? <CheckCircle2 size={18}/> : <ServerCog size={18}/>}<span><strong>{status.mode === 'Demo' ? 'Демонстрационный режим' : status.connected ? '1С доступна' : 'Требуется проверка'}</strong><small>{status.message}</small></span></div>}
      {error && <div className="import-message is-error"><AlertTriangle size={17}/>{error}</div>}
      <div className="integration-actions"><button onClick={test} disabled={busy}><PlugZap size={16}/>Проверить связь</button><button className="is-primary" onClick={save} disabled={busy}><Save size={16}/>Сохранить</button></div>
      <p className="integration-security">Пароль шифруется средствами ASP.NET Core Data Protection и никогда не возвращается в браузер.</p>
    </div>}
  </section></div>;
}
