import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowLeft, BookmarkPlus, CheckCircle2, Download, FileArchive, FileJson2, FileSpreadsheet, FileUp, Trash2, Upload, X } from 'lucide-react';
import { deleteProcessTableSelectionSet, downloadProcessTableExport, downloadProcessTableImportReport, downloadProcessTableTemplate, importProcess, importProcessPackage, importProcessTable, loadProcessTableSelectionSets, previewProcessTable, replaceDraft, saveProcessTableSelectionSet } from './api';
import type { ProcessImportResult, ProcessPackageImportResult, ProcessSummary, ProcessTableImportResult, ProcessTablePreview, ProcessTablePreviewItem, ProcessTableSelectionSet, ProcessTableStepIdMapping } from './types';

type Props = {
  onClose: () => void;
  onImported: (result: ProcessImportResult) => void;
  onPackageImported?: (result: ProcessPackageImportResult) => void;
  onTableImported?: (result: ProcessTableImportResult) => void;
  processId?: string;
  initialExportProcessId?: string;
  catalog: ProcessSummary[];
  page?: boolean;
};

export function ImportDialog({ onClose, onImported, onPackageImported, onTableImported, processId, initialExportProcessId, catalog, page = false }: Props) {
  const [mode, setMode] = useState<'single' | 'package' | 'table'>('single');
  const [bpmnFile, setBpmnFile] = useState<File>();
  const [contextFile, setContextFile] = useState<File>();
  const [packageFile, setPackageFile] = useState<File>();
  const [tableFile, setTableFile] = useState<File>();
  const [tablePreview, setTablePreview] = useState<ProcessTablePreview>();
  const [selectedProcessIds, setSelectedProcessIds] = useState<string[]>([]);
  const [confirmedRemovalIds, setConfirmedRemovalIds] = useState<string[]>([]);
  const [acceptedRenameKeys, setAcceptedRenameKeys] = useState<string[]>([]);
  const [selectionSets, setSelectionSets] = useState<ProcessTableSelectionSet[]>([]);
  const [selectionSetId, setSelectionSetId] = useState('');
  const [selectionSetName, setSelectionSetName] = useState('');
  const [selectionSetNotice, setSelectionSetNotice] = useState('');
  const [tableResult, setTableResult] = useState<ProcessTableImportResult>();
  const [result, setResult] = useState<ProcessImportResult>();
  const [packageResult, setPackageResult] = useState<ProcessPackageImportResult>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [exportProcessId, setExportProcessId] = useState(
    initialExportProcessId && catalog.some(item => item.id === initialExportProcessId) ? initialExportProcessId : catalog[0]?.id ?? '');
  const [includeDescendants, setIncludeDescendants] = useState(true);

  useEffect(() => {
    if (processId) return;
    const controller = new AbortController();
    loadProcessTableSelectionSets(controller.signal).then(setSelectionSets)
      .catch(reason => { if (reason.name !== 'AbortError') setError(reason instanceof Error ? reason.message : 'Не удалось загрузить сохранённые наборы.'); });
    return () => controller.abort();
  }, [processId]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true); setError(''); setResult(undefined); setPackageResult(undefined);
    try {
      if (mode === 'package' && !processId) {
        if (!packageFile) return;
        setPackageResult(await importProcessPackage(packageFile));
      } else {
        if (!bpmnFile) return;
        setResult(processId ? await replaceDraft(processId, bpmnFile, contextFile) : await importProcess(bpmnFile, contextFile));
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось импортировать процессы.'); }
    finally { setBusy(false); }
  };

  const completed = result || packageResult || tableResult;
  const renameKey = (processId: string, incomingStepId: string, existingStepId: string) => `${processId}\u001f${incomingStepId}\u001f${existingStepId}`;
  const acceptedMappings: ProcessTableStepIdMapping[] = tablePreview?.processes.filter(item => selectedProcessIds.includes(item.id)).flatMap(item => (item.renameSuggestions ?? [])
    .filter(suggestion => acceptedRenameKeys.includes(renameKey(item.id, suggestion.incomingStepId, suggestion.existingStepId)))
    .map(suggestion => ({ processId: item.id, incomingStepId: suggestion.incomingStepId, existingStepId: suggestion.existingStepId }))) ?? [];
  const remainingRemovalCount = (item: ProcessTablePreviewItem) => Math.max(0, item.removedStepCount - acceptedMappings.filter(mapping => mapping.processId === item.id).length);
  const pendingRemovalConfirmation = tablePreview?.processes.some(item =>
    selectedProcessIds.includes(item.id) && remainingRemovalCount(item) > 0 && !confirmedRemovalIds.includes(item.id)) ?? false;
  const applySelectionSet = () => {
    if (!tablePreview) return;
    const set = selectionSets.find(item => item.id === selectionSetId);
    if (!set) { setSelectionSetNotice('Выберите сохранённый набор.'); return; }
    const byId = new Map(tablePreview.processes.map(item => [item.id.toLocaleLowerCase(), item]));
    const applicable = set.processIds.map(id => byId.get(id.toLocaleLowerCase()))
      .filter((item): item is ProcessTablePreviewItem => !!item && !item.errorCount).map(item => item.id);
    const missing = set.processIds.filter(id => !byId.has(id.toLocaleLowerCase()));
    const blocked = set.processIds.filter(id => (byId.get(id.toLocaleLowerCase())?.errorCount ?? 0) > 0);
    setSelectedProcessIds(applicable); setConfirmedRemovalIds([]); setAcceptedRenameKeys([]);
    setSelectionSetNotice(`Применён набор «${set.name}»: выбрано ${applicable.length}.` +
      (missing.length ? ` Нет в книге: ${missing.join(', ')}.` : '') +
      (blocked.length ? ` Не выбраны из-за ошибок: ${blocked.join(', ')}.` : ''));
  };
  const saveSelectionSet = async () => {
    if (!selectionSetName.trim()) { setSelectionSetNotice('Укажите название набора.'); return; }
    if (!selectedProcessIds.length) { setSelectionSetNotice('Сначала выберите хотя бы один процесс.'); return; }
    setBusy(true); setError('');
    try {
      const saved = await saveProcessTableSelectionSet(selectionSetName, selectedProcessIds);
      setSelectionSets(current => [...current.filter(item => item.id !== saved.id), saved].sort((a, b) => a.name.localeCompare(b.name, 'ru')));
      setSelectionSetId(saved.id); setSelectionSetName(''); setSelectionSetNotice(`Набор «${saved.name}» сохранён для текущего пользователя.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось сохранить набор.'); }
    finally { setBusy(false); }
  };
  const removeSelectionSet = async () => {
    const set = selectionSets.find(item => item.id === selectionSetId);
    if (!set || !window.confirm(`Удалить сохранённый набор «${set.name}»?`)) return;
    setBusy(true); setError('');
    try { await deleteProcessTableSelectionSet(set.id); setSelectionSets(current => current.filter(item => item.id !== set.id)); setSelectionSetId(''); setSelectionSetNotice(`Набор «${set.name}» удалён.`); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось удалить набор.'); }
    finally { setBusy(false); }
  };
  const content = <section className={`import-dialog${page ? ' import-page-content' : ''}`} role={page ? 'region' : 'dialog'} aria-modal={page ? undefined : true} aria-labelledby="import-title">
      {!page && <button className="icon-button dialog-close" onClick={onClose} aria-label="Закрыть"><X size={18}/></button>}
      <span className="eyebrow">Репозиторий процессов</span>
      <h2 id="import-title">{processId ? 'Заменить BPMN черновика' : 'Импортировать процессы'}</h2>
      <p>{mode === 'package' ? 'Пакет будет проверен, а все новые процессы сохранены как черновики. Существующие процессы останутся без изменений.' : mode === 'table' ? 'Заполните процессы, шаги, связи, оргпривязки и каналы в едином шаблоне Excel.' : 'Схема проверяется и сохраняется только при отсутствии критических ошибок.'}</p>

      {!processId && !completed && <div className="import-mode-tabs">
        <button type="button" className={mode === 'single' ? 'is-active' : ''} onClick={() => setMode('single')}>Один BPMN</button>
        <button type="button" className={mode === 'package' ? 'is-active' : ''} onClick={() => setMode('package')}>Пакет ZIP</button>
        <button type="button" className={mode === 'table' ? 'is-active' : ''} onClick={() => setMode('table')}>Таблица Excel</button>
      </div>}

      {!completed && mode === 'table' && !processId && !tablePreview && <div className="table-import-intro">
        <FileSpreadsheet size={34}/><h3>Шаблон для описания процессов</h3>
        <p>Пустая книга содержит формулы проверки и актуальные справочники организаций и подразделений. Чтобы получить заполненный пример, выберите корневой демонстрационный процесс ниже и выгрузите его вместе со вложенными процессами.</p>
        <div className="table-import-actions"><button className="secondary-button" onClick={async () => { setBusy(true); setError(''); try { await downloadProcessTableTemplate(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось скачать шаблон.'); } finally { setBusy(false); } }}><Download size={18}/>Скачать шаблон</button></div>
        <div className="table-export-panel">
          <div><strong>Выгрузить существующий процесс</strong><small>Полученную книгу можно дополнить, проверить и загрузить обратно.</small></div>
          <select value={exportProcessId} onChange={event => setExportProcessId(event.target.value)} aria-label="Процесс для выгрузки">
            {catalog.map(item => <option value={item.id} key={item.id}>{item.name} · {item.id}</option>)}
          </select>
          <label><input type="checkbox" checked={includeDescendants} onChange={event => setIncludeDescendants(event.target.checked)}/> Включить все вложенные процессы</label>
          <button className="secondary-button" disabled={!exportProcessId || busy} onClick={async () => { setBusy(true); setError(''); try { await downloadProcessTableExport(exportProcessId, includeDescendants); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось выгрузить процесс.'); } finally { setBusy(false); } }}><Download size={18}/>{busy ? 'Готовим…' : 'Выгрузить в Excel'}</button>
        </div>
        <label className="file-field table-file-field"><FileSpreadsheet size={21}/><span><strong>Заполненная таблица</strong><small>{tableFile?.name ?? 'Файл .xlsx, до 10 МБ'}</small></span><input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={event => { setTableFile(event.target.files?.[0]); setTablePreview(undefined); setSelectedProcessIds([]); setConfirmedRemovalIds([]); setAcceptedRenameKeys([]); setSelectionSetNotice(''); }}/></label>
        <button className="import-submit" disabled={!tableFile || busy} onClick={async () => { if (!tableFile) return; setBusy(true); setError(''); try { const preview = await previewProcessTable(tableFile); setTablePreview(preview); setSelectedProcessIds(preview.processes.filter(item => !item.errorCount).map(item => item.id)); setConfirmedRemovalIds([]); setAcceptedRenameKeys([]); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось проверить таблицу.'); } finally { setBusy(false); } }}><Upload size={18}/>{busy ? 'Проверяем…' : 'Проверить таблицу без загрузки'}</button>
        {error && <div className="import-message is-error"><AlertTriangle size={18}/><span>{error}</span></div>}
        <small>Проверка не изменяет процессы. Программа покажет новые и существующие модели, пропущенные поля и ошибочные ссылки.</small>
        <small>Лист «Основания» переносит источники и вопросы шагов; лист «Сверка» — пункты исходного описания и их привязки. Каждый лист заменяет соответствующие сведения процессов книги, включая удаление отсутствующих. Чтобы сохранить прежние сведения без изменений, удалите соответствующий лист целиком.</small>
      </div>}

      {!completed && mode === 'table' && tablePreview && <div className="table-preview-result">
        <div className={`table-preview-summary${tablePreview.errorCount ? ' has-errors' : ''}`}><FileSpreadsheet size={28}/><div><h3>{tablePreview.errorCount ? 'Таблица требует исправления' : 'Структура таблицы корректна'}</h3><p>{tablePreview.processCount} процессов · {tablePreview.stepCount} шагов · {tablePreview.channelCount} каналов</p></div></div>
        <div className="table-preview-metrics"><span><strong>{tablePreview.newProcessCount}</strong> новых</span><span><strong>{tablePreview.existingProcessCount}</strong> обновляемых</span><span className={tablePreview.errorCount ? 'is-error' : ''}><strong>{tablePreview.errorCount}</strong> ошибок</span><span><strong>{tablePreview.warningCount}</strong> предупреждений</span></div>
        <section className="table-selection-sets" aria-label="Сохранённые наборы выбора"><div className="table-selection-set-heading"><BookmarkPlus size={18}/><span><strong>Наборы выбора</strong><small>Сохраняются отдельно для каждого пользователя и применяются к повторным версиям книги.</small></span></div><div className="table-selection-set-controls"><select value={selectionSetId} onChange={event => { setSelectionSetId(event.target.value); setSelectionSetNotice(''); }} aria-label="Сохранённый набор"><option value="">Выберите набор…</option>{selectionSets.map(item => <option value={item.id} key={item.id}>{item.name} · {item.processIds.length}</option>)}</select><button type="button" disabled={!selectionSetId || busy} onClick={applySelectionSet}>Применить</button><button type="button" className="is-danger" disabled={!selectionSetId || busy} onClick={removeSelectionSet} aria-label="Удалить выбранный набор"><Trash2 size={15}/></button></div><div className="table-selection-set-save"><input value={selectionSetName} maxLength={120} onChange={event => setSelectionSetName(event.target.value)} placeholder="Название нового набора"/><button type="button" disabled={!selectedProcessIds.length || busy} onClick={saveSelectionSet}><BookmarkPlus size={15}/>Сохранить текущий выбор</button></div>{selectionSetNotice && <p>{selectionSetNotice}</p>}</section>
        <div className="table-selection-toolbar"><strong>Выбрано {selectedProcessIds.length} из {tablePreview.processes.length}</strong><span><button type="button" onClick={() => { setSelectedProcessIds(tablePreview.processes.filter(item => !item.errorCount).map(item => item.id)); setSelectionSetNotice(''); }}>Выбрать доступные</button><button type="button" onClick={() => { setSelectedProcessIds([]); setSelectionSetNotice(''); }}>Снять выбор</button></span></div>
        <div className="table-preview-processes">{tablePreview.processes.map(item => <div className={selectedProcessIds.includes(item.id) ? 'is-selected' : ''} key={item.id}>
          <label className="table-process-selector" title={item.errorCount ? 'Сначала исправьте ошибки этого процесса' : 'Загрузить этот процесс'}><input type="checkbox" checked={selectedProcessIds.includes(item.id)} disabled={!!item.errorCount} onChange={event => setSelectedProcessIds(current => event.target.checked ? [...current, item.id] : current.filter(id => id !== item.id))}/></label>
          <span className={`table-process-status is-${item.status.toLowerCase()}`}>{item.status === 'New' ? 'Новый' : 'Изменение'}</span>
          <strong>{item.name || item.id}</strong>
          <small>Уровень {item.level ?? '—'} · {item.stepCount} шагов · {item.channelCount} каналов</small>
          <em>{item.errorCount ? `${item.errorCount} ошибок` : item.warningCount ? `${item.warningCount} предупреждений` : 'Замечаний нет'}</em>
          <div className="table-change-counts">
            {!!item.addedStepCount && <span className="is-added">+{item.addedStepCount} шагов</span>}
            {!!item.modifiedStepCount && <span className="is-modified">~{item.modifiedStepCount} шагов</span>}
            {!!item.removedStepCount && <span className="is-removed">−{item.removedStepCount} шагов</span>}
            {!!item.unchangedStepCount && <span>{item.unchangedStepCount} без изменений</span>}
            {item.processChanged && <span className="is-modified">изменён паспорт</span>}
          </div>
          {!!item.fieldChanges?.length && <details className="table-change-details"><summary>Подробное сравнение ({item.fieldChanges.length})</summary><div className="table-field-changes">{item.fieldChanges.map((change, index) => <article className={`is-${change.kind.toLowerCase()}`} key={`${item.id}:${change.elementId}:${change.field}:${index}`}>
            <header><span>{change.scope === 'Process' ? 'Процесс' : change.scope === 'Step' ? 'Шаг' : change.scope === 'Transition' ? 'Связи' : 'Каналы'}</span><strong>{change.elementName || change.elementId || item.name}</strong><em>{change.kind === 'Added' ? 'Добавление' : change.kind === 'Removed' ? 'Удаление' : change.field}</em></header>
            <div><span><small>Было</small>{change.oldValue || '—'}</span><b>→</b><span><small>Станет</small>{change.newValue || '—'}</span></div>
          </article>)}</div></details>}
          {!!item.renameSuggestions?.length && <div className="table-rename-suggestions"><strong>Возможна смена технического ID</strong><p>Если это тот же шаг, подтвердите сопоставление. Программа сохранит прежний ID, историю и положение элемента, а ссылки из таблицы перенаправит автоматически.</p>{item.renameSuggestions.map(suggestion => { const key = renameKey(item.id, suggestion.incomingStepId, suggestion.existingStepId); return <label className={acceptedRenameKeys.includes(key) ? 'is-accepted' : ''} key={key}><input type="checkbox" checked={acceptedRenameKeys.includes(key)} disabled={!selectedProcessIds.includes(item.id)} onChange={event => setAcceptedRenameKeys(current => event.target.checked ? [...current, key] : current.filter(value => value !== key))}/><span><code>{suggestion.incomingStepId}</code><b>→</b><code>{suggestion.existingStepId}</code><em>{suggestion.incomingStepName}</em></span></label>; })}</div>}
          {remainingRemovalCount(item) > 0 && selectedProcessIds.includes(item.id) && <label className="table-removal-confirmation"><input type="checkbox" checked={confirmedRemovalIds.includes(item.id)} onChange={event => setConfirmedRemovalIds(current => event.target.checked ? [...current, item.id] : current.filter(id => id !== item.id))}/><span><strong>Подтвердить удаление {remainingRemovalCount(item)} {remainingRemovalCount(item) === 1 ? 'шага' : 'шагов'}</strong><small>Эти шаги не сопоставлены и отсутствуют в загружаемой таблице, поэтому будут удалены из черновика.</small></span></label>}
        </div>)}</div>
        {!!tablePreview.issues.length && <div className="table-preview-issues">{tablePreview.issues.map((issue, index) => <div className={issue.severity === 'Error' ? 'is-error' : 'is-warning'} key={`${issue.sheet}:${issue.row}:${issue.column}:${index}`}><AlertTriangle size={15}/><span><strong>{issue.sheet}, строка {issue.row || '—'}{issue.column ? `, «${issue.column}»` : ''}</strong>{issue.message}</span></div>)}</div>}
        <p className="table-import-confirmation">После подтверждения программа создаст резервную копию, затем создаст или полностью обновит только выбранные черновики. Остальные процессы из книги и опубликованные версии не изменятся.</p>
        {error && <div className="import-message is-error"><AlertTriangle size={18}/><span>{error}</span></div>}
        {pendingRemovalConfirmation && <div className="import-message is-warning"><AlertTriangle size={18}/><span>Подтвердите удаление шагов во всех выбранных процессах. Пока подтверждения нет, загрузка заблокирована.</span></div>}
        <div className="dialog-actions"><button className="secondary-button" onClick={() => { setTablePreview(undefined); setSelectedProcessIds([]); setConfirmedRemovalIds([]); setAcceptedRenameKeys([]); setSelectionSetNotice(''); setError(''); }}>Выбрать другой файл</button><button className="import-submit" disabled={!selectedProcessIds.length || busy || pendingRemovalConfirmation || tablePreview.issues.some(issue => issue.severity === 'Error' && (issue.row === 0 || (!!issue.processId && selectedProcessIds.includes(issue.processId))))} onClick={async () => { if (!tableFile) return; setBusy(true); setError(''); try { setTableResult(await importProcessTable(tableFile, selectedProcessIds, confirmedRemovalIds, acceptedMappings)); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось создать черновики.'); } finally { setBusy(false); } }}><Upload size={18}/>{busy ? 'Создаём резервную копию…' : `Создать/обновить выбранные (${selectedProcessIds.length})`}</button></div>
      </div>}

      {!completed && mode !== 'table' && <form onSubmit={submit}>
        {mode === 'package' && !processId ? <label className="file-field"><FileArchive size={21}/><span><strong>Пакет процессов</strong><small>{packageFile?.name ?? 'ZIP с папками bpmn и passports, до 50 МБ'}</small></span><input type="file" accept=".zip,application/zip" required onChange={event => setPackageFile(event.target.files?.[0])}/></label> : <>
          <label className="file-field"><FileUp size={21}/><span><strong>BPMN 2.0 XML</strong><small>{bpmnFile?.name ?? 'Обязательный файл .bpmn, до 2 МБ'}</small></span><input type="file" accept=".bpmn,application/xml,text/xml" required onChange={event => setBpmnFile(event.target.files?.[0])}/></label>
          <label className="file-field"><FileJson2 size={21}/><span><strong>Контекст Process Navigator</strong><small>{contextFile?.name ?? 'Необязательный файл .json, до 2 МБ'}</small></span><input type="file" accept=".json,application/json" onChange={event => setContextFile(event.target.files?.[0])}/></label>
        </>}
        {error && <div className="import-message is-error"><AlertTriangle size={18}/><span><strong>Импорт отклонён</strong>{error}</span></div>}
        <button className="import-submit" disabled={(mode === 'package' ? !packageFile : !bpmnFile) || busy}><Upload size={18}/>{busy ? 'Проверяем…' : mode === 'package' ? 'Проверить и импортировать пакет' : 'Проверить и импортировать'}</button>
      </form>}

      {result && <div className="import-result"><CheckCircle2 size={30}/><h3>{result.process.name}</h3><p>Процесс импортирован: {result.process.nodeCount} элементов, {result.process.laneCount} дорожек.</p>{result.warnings.map(warning => <div className="import-message is-warning" key={warning}><AlertTriangle size={17}/>{warning}</div>)}<button className="import-submit" onClick={() => onImported(result)}>Открыть процесс</button></div>}
      {packageResult && <div className="import-result package-import-result"><CheckCircle2 size={30}/><h3>Пакет обработан</h3><p>Всего: {packageResult.total}. Импортировано: {packageResult.imported}. Пропущено: {packageResult.skipped}. Ошибок: {packageResult.failed}.</p><div className="package-import-list">{packageResult.items.filter(item => item.status !== 'Imported').map(item => <div className={`package-import-item is-${item.status.toLowerCase()}`} key={item.fileName}><strong>{item.fileName.split('/').at(-1)}</strong><span>{item.error ?? item.warnings.join(' ')}</span></div>)}</div><button className="import-submit" onClick={() => onPackageImported?.(packageResult)}>Открыть каталог процессов</button></div>}
      {tableResult && <div className="import-result table-import-complete"><CheckCircle2 size={30}/><h3>Черновики сформированы</h3><p>Создано: {tableResult.created}. Обновлено: {tableResult.updated}. Сопоставлено ID шагов: {tableResult.appliedStepIdMappings}. Опубликованные редакции не изменялись.</p><small>Резервная копия: {tableResult.backupFileName}</small>{tableResult.reportFileName && <button className="secondary-button" onClick={async () => { try { await downloadProcessTableImportReport(tableResult.reportFileName!); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось скачать протокол импорта.'); } }}><Download size={18}/>Скачать протокол импорта</button>}<div className="package-import-list">{tableResult.processes.map(item => <div className="package-import-item" key={item.id}><strong>{item.name}</strong><span>{item.status === 'Created' ? 'Новый черновик' : 'Черновик обновлён'} · {item.nodeCount} элементов · {item.laneCount} дорожек</span></div>)}</div>{error && <div className="import-message is-error"><AlertTriangle size={18}/><span>{error}</span></div>}<button className="import-submit" onClick={() => onTableImported?.(tableResult)}>{page ? 'Вернуться к рабочему пространству' : 'Открыть каталог процессов'}</button></div>}
    </section>;
  if (!page) return <div className="modal-backdrop" role="presentation" onMouseDown={event => event.target === event.currentTarget && onClose()}>{content}</div>;
  return <main className="feature-page import-page"><div className="feature-page-shell"><nav className="feature-breadcrumb" aria-label="Путь раздела"><button onClick={onClose}><ArrowLeft size={16}/>Рабочее пространство</button><span>›</span><strong>Импорт процессов</strong></nav>{content}</div></main>;
}
