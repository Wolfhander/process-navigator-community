import { useEffect, useState } from 'react';
import { analyticsMetrics, analyticsPresetKey, defaultAnalyticsSelection, readAnalyticsPresets, writeAnalyticsPresets, type AnalyticsPreset, type AnalyticsSelection, type AnalyticsMetric } from './analytics-workspace';

type Props = { profileId: string; current: AnalyticsSelection; loadedAt: string; count: number; total: number; onChange: (value: AnalyticsSelection) => void; onExport: (scope: 'portfolio' | 'processes') => void };
export function AnalyticsWorkspaceControls({ profileId, current, loadedAt, count, total, onChange, onExport }: Props) {
  const key = analyticsPresetKey(profileId);
  const [presets, setPresets] = useState<AnalyticsPreset[]>([]);
  const [selected, setSelected] = useState('');
  const [name, setName] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    try { const result = readAnalyticsPresets(window.localStorage, key); setPresets(result.presets); setNotice(result.error); }
    catch { setNotice('Хранилище браузера недоступно. Представления работают только до закрытия страницы.'); }
  }, [key]);
  function persist(next: AnalyticsPreset[]) {
    try { const error = writeAnalyticsPresets(window.localStorage, key, next); if (error) { setNotice(error); return false; } }
    catch { setNotice('Хранилище браузера недоступно; настройки не сохранены.'); return false; }
    setPresets(next); setNotice('Сохранено в этом браузере для текущего профиля.'); return true;
  }
  function save() {
    const clean = name.trim();
    if (!clean || clean.length > 80) { setNotice('Задайте название от 1 до 80 символов.'); return; }
    const same = presets.find(p => p.name.toLocaleLowerCase('ru') === clean.toLocaleLowerCase('ru'));
    const preset = { id: same?.id ?? crypto.randomUUID(), name: clean, selection: { ...current, metrics: [...current.metrics] } };
    if (persist([...presets.filter(p => p.id !== preset.id), preset])) setSelected(preset.id);
  }
  return <details className="portfolio-workspace"><summary>Представления, показатели и выгрузка</summary>
    <p>Настройки сохраняются только в этом браузере отдельно для пользователя. Они не меняют данные и права. Поиск и фильтр относятся только к списку процессов; обзорные диаграммы остаются по всему портфелю.</p>
    <div className="portfolio-workspace-row">
      <label>Сохранённое представление<select aria-label="Сохранённое представление" value={selected} onChange={e => { setSelected(e.target.value); setName(presets.find(p => p.id === e.target.value)?.name ?? ''); }}><option value="">Выберите представление</option>{presets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <button disabled={!selected} onClick={() => { const preset = presets.find(p => p.id === selected); if (preset) { onChange({ ...preset.selection, metrics: [...preset.selection.metrics] }); setNotice('Представление применено.'); } }}>Применить</button>
      <button disabled={!selected} onClick={() => { if (persist(presets.filter(p => p.id !== selected))) { setSelected(''); setName(''); } }}>Удалить представление</button>
      <label>Название<input aria-label="Название представления" maxLength={80} value={name} onChange={e => setName(e.target.value)} /></label>
      <button onClick={save}>Сохранить текущие настройки</button>
      <button onClick={() => onChange({ ...defaultAnalyticsSelection, metrics: [...defaultAnalyticsSelection.metrics] })}>Сбросить текущий вид</button>
    </div>
    <fieldset><legend>Карточки обзора и показатели выгрузки портфеля</legend><div className="portfolio-metric-choices">{Object.entries(analyticsMetrics).map(([id, label]) => <label key={id}><input type="checkbox" checked={current.metrics.includes(id as AnalyticsMetric)} disabled={current.metrics.length === 1 && current.metrics[0] === id} onChange={e => onChange({ ...current, metrics: e.target.checked ? [...current.metrics, id as AnalyticsMetric] : current.metrics.filter(key => key !== id) })}/>{label}</label>)}</div></fieldset>
    <p>Данные загружены (UTC): {loadedAt || 'ещё не загружены'}. Список: {count} из {total}. CSV содержит область, дату загрузки, фильтры, методику и все строки расшифровки. Отсутствующее время цикла не заменяется нулём.</p>
    <div className="portfolio-workspace-row"><button disabled={!loadedAt} onClick={() => onExport('processes')}>CSV: отфильтрованные процессы ({count})</button><button disabled={!loadedAt} onClick={() => onExport('portfolio')}>CSV: показатели всего портфеля</button></div>
    {notice && <p role="status">{notice}</p>}
  </details>;
}
