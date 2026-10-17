import { CheckCheck, MessageSquareText, X } from 'lucide-react';
import type { UserNotification } from './types';
import './notification.css';

type Props = { notifications: UserNotification[]; onClose: () => void; onReadAll: () => void; onOpen: (notification: UserNotification) => void };

export function NotificationDialog({ notifications, onClose, onReadAll, onOpen }: Props) {
  const unread = notifications.filter(item => !item.readAt).length;
  return <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <section className="notification-dialog" role="dialog" aria-modal="true" aria-label="Уведомления">
      <header><div><span className="eyebrow">Рабочие события</span><h2>Уведомления</h2><p>{unread ? `Непрочитанных: ${unread}` : 'Новых уведомлений нет'}</p></div><button className="dialog-close" onClick={onClose}><X size={17}/></button></header>
      {unread > 0 && <button className="notification-read-all" onClick={onReadAll}><CheckCheck size={15}/>Прочитать все</button>}
      <div className="notification-list">
        {notifications.map(item => <button key={item.id} className={item.readAt ? '' : 'is-unread'} onClick={() => onOpen(item)}>
          <span className="notification-icon"><MessageSquareText size={17}/></span><span><strong>{item.title}</strong><p>{item.message}</p><small>{item.processName}{item.elementName ? ` · ${item.elementName}` : ''} · {new Date(item.createdAt).toLocaleString('ru-RU')}</small></span>
        </button>)}
        {!notifications.length && <div className="notification-empty"><CheckCheck size={28}/><strong>Всё просмотрено</strong><span>Здесь появятся упоминания и важные события процессов.</span></div>}
      </div>
    </section>
  </div>;
}
