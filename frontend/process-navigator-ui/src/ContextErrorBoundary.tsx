import { Component, type ReactNode } from 'react';

type Props = { children: ReactNode; onClose: () => void };

/** Keep a failed step card from taking down navigation and the diagram. */
export class ContextErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() { return { failed: true }; }

  render() {
    if (!this.state.failed) return this.props.children;
    return <aside className="context" role="alert">
      <h2>Не удалось открыть карточку этапа</h2>
      <p>Схема остаётся доступной. Закройте карточку и выберите другой этап. Данные процесса не изменены.</p>
      <button onClick={this.props.onClose}>Вернуться к схеме</button>
    </aside>;
  }
}
