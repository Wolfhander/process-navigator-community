import { FormEvent, useEffect, useState } from 'react';
import { MessageSquareText, Send } from 'lucide-react';
import { addElementComment, loadElementComments, loadSession } from './api';
import type { ElementComment, UserProfile } from './types';

type Props = { processId: string; elementId: string; onMessage: (message: string) => void };

export function ElementComments({ processId, elementId, onMessage }: Props) {
  const [comments, setComments] = useState<ElementComment[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [users, setUsers] = useState<UserProfile[]>([]);
  useEffect(() => { const controller = new AbortController(); loadElementComments(processId, elementId, controller.signal).then(setComments).catch(() => undefined); return () => controller.abort(); }, [processId, elementId]);
  useEffect(() => { loadSession().then(session => setUsers(session.availableUsers.filter(user => user.id !== session.currentUser.id))).catch(() => undefined); }, []);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (!text.trim() || busy) return; setBusy(true);
    try { const created = await addElementComment(processId, elementId, text); setComments(items => [...items, created]); setText(''); onMessage('Комментарий добавлен'); }
    catch (reason) { onMessage(reason instanceof Error ? reason.message : 'Не удалось добавить комментарий'); }
    finally { setBusy(false); }
  };
  return <section className="element-comments"><h3>Обсуждение <span>{comments.length}</span></h3>
    <div className="comment-list">{comments.map(comment => <article key={comment.id}><span className="comment-avatar">{comment.authorName.slice(0, 1).toUpperCase()}</span><div><header><strong>{comment.authorName}</strong><time>{new Date(comment.createdAt).toLocaleString('ru-RU')}</time></header><p>{comment.text}</p></div></article>)}{!comments.length && <div className="comments-empty"><MessageSquareText size={19}/><span>Комментариев пока нет. Оставьте полезное уточнение для участников процесса.</span></div>}</div>
    <form onSubmit={submit}><div className="mention-suggestions"><span>Упомянуть:</span>{users.map(user => <button type="button" key={user.id} onClick={() => setText(value => `${value}${value && !value.endsWith(' ') ? ' ' : ''}@${user.displayName} `)}>{user.displayName.split(' ')[0]}</button>)}</div><textarea value={text} onChange={event => setText(event.target.value)} maxLength={2000} rows={3} placeholder="Написать заметку или упомянуть сотрудника…"/><button className="comment-send" disabled={!text.trim() || busy} aria-label="Отправить комментарий"><Send size={15}/></button></form>
  </section>;
}
