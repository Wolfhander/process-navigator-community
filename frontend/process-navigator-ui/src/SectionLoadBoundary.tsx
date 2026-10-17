import { Component, type ReactNode } from 'react';

export class SectionLoadBoundary extends Component<{ children: ReactNode; onHome: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return <main className="state-page" role="alert"><h1>Не удалось открыть раздел</h1><p>Возможно, файлы программы обновились или временно недоступны. Сообщение относится к отображению интерфейса. Вернитесь на главную или обновите страницу после сохранения работы в других разделах.</p><button onClick={this.props.onHome}>На главную</button><button onClick={() => window.location.reload()}>Обновить страницу</button></main>;
  }
}
