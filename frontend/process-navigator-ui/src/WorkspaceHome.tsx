import { ArrowRight, BarChart3, BookOpen, Building2, CalendarClock, ClipboardList, Database, FileClock, FilePlus2, Files, History, ListChecks, Network, PlugZap, Settings2, Upload, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ProcessSummary } from './types';
import type { ReactNode } from 'react';
export type HomeAction = 'map' | 'catalog' | 'catalogAudit' | 'evidenceRegister' | 'informationObjects' | 'schedule' | 'analytics' | 'settings' | 'version' | 'syncLanes' | 'directionMatrix' | 'create' | 'import' | 'importHistory' | 'organization' | 'users' | 'audit' | 'deployment' | 'integration' | 'help';
type Props = { settings: boolean; groupName: string; catalog: ProcessSummary[]; can: (permission: string) => boolean; onAction: (action: HomeAction) => void; children?: ReactNode };
export function WorkspaceHome({ settings, groupName, catalog, can, onAction, children }: Props) {
  const cards: { action: HomeAction; title: string; description: string; icon: LucideIcon; permission?: string }[] = settings ? [
    { action: 'organization', title: 'Группа и оргструктура', description: 'Юридические лица, подразделения, направления и название группы.', icon: Building2, permission: 'system.manage' },
    { action: 'directionMatrix', title: 'Распределение процессов', description: 'Назначить направления нескольким процессам в общей таблице.', icon: ClipboardList, permission: 'system.manage' },
    { action: 'syncLanes', title: 'Обновить дорожки черновиков', description: 'Привести названия дорожек к актуальным подразделениям после изменения оргструктуры.', icon: Network, permission: 'system.manage' },
    { action: 'users', title: 'Пользователи и роли', description: 'Учётные записи, права и принадлежность к подразделениям.', icon: Users, permission: 'users.manage' },
    { action: 'importHistory', title: 'История импорта из Excel', description: 'Результаты загрузок, резервные копии и подробные CSV-протоколы.', icon: FileClock, permission: 'process.import' },
    { action: 'audit', title: 'Аудит изменений', description: 'Журнал действий и экспорт истории.', icon: ListChecks, permission: 'system.manage' },
    { action: 'version', title: 'Версии программы', description: 'Текущая сборка и история добавлений, изменений и исправлений.', icon: History },
    { action: 'deployment', title: 'Размещение и обслуживание', description: 'Автономная поставка, резервные копии и восстановление.', icon: Database, permission: 'system.manage' },
    { action: 'integration', title: 'Интеграция с 1С', description: 'Настройка подключения. Для локальной работы не требуется.', icon: PlugZap, permission: 'system.manage' },
    { action: 'help', title: 'Руководство пользователя', description: 'Работа с моделями, версиями и исполнением.', icon: BookOpen },
  ] : [
    { action: 'map', title: 'Бизнес-процессы', description: 'Карта группы компаний, направления и организационная структура.', icon: Building2 },
    { action: 'catalog', title: 'Каталог моделей', description: 'Поиск процессов, черновики и иерархия моделей.', icon: ClipboardList },
    { action: 'catalogAudit', title: 'Проверка процессов', description: 'Ошибки маршрутов, привязок и описаний во всём каталоге.', icon: ListChecks, permission: 'process.diagram.edit' },
    { action: 'evidenceRegister', title: 'Источники и вопросы', description: 'Факты, предположения и вопросы по шагам действующих моделей и черновиков.', icon: BookOpen },
    { action: 'informationObjects', title: 'Документы и результаты', description: 'Источники, получатели и разрывы сквозных передач между процессами.', icon: Files },
    { action: 'schedule', title: 'Расчёт сроков', description: 'Прямой и обратный расчёт цепочки процессов по нормам шагов и передаваемым документам.', icon: CalendarClock },
    { action: 'analytics', title: 'Аналитика', description: 'Показатели портфеля, качество описания и фактическое выполнение.', icon: BarChart3, permission: 'analytics.view' },
    { action: 'settings', title: 'Настройки', description: 'Администрирование и обслуживание в одном разделе.', icon: Settings2 },
  ];
  return <main className="workspace-home"><div className="home-content"><span className="eyebrow">Process Navigator · {groupName}</span><h1>{settings ? 'Настройки и обслуживание' : 'Рабочее пространство'}</h1><p className="home-lead">{settings ? 'Служебные функции доступны здесь и не занимают место при работе со схемами.' : 'От карты предприятия — к модели процесса, исполнению и анализу.'}</p>
    {!settings && <><div className="home-stats"><span><strong>{catalog.length}</strong>моделей в каталоге</span><span><strong>{catalog.filter(p => p.status === 'Published').length}</strong>опубликовано</span><span><strong>{catalog.filter(p => p.hasDraft || p.status === 'Draft').length}</strong>процессов с черновиком</span></div><div className="home-quick">{can('process.import') && <><button onClick={() => onAction('create')}><FilePlus2 size={17}/>Новый процесс</button><button onClick={() => onAction('import')}><Upload size={17}/>Импорт моделей</button></>}<button onClick={() => onAction('help')}><BookOpen size={17}/>Как работать</button></div></>}
    <div className="home-cards">{cards.filter(card => !card.permission || can(card.permission)).map(card => <button key={card.action} onClick={() => onAction(card.action)}><card.icon size={25}/><strong>{card.title}</strong><span>{card.description}</span><ArrowRight className="home-arrow" size={20}/></button>)}</div>
    {!settings && children}
  </div></main>;
}
