import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  title: string;
  hint?: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/** Contém falhas de renderização, preservando o restante da aplicação. */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[HydroBIM] ${this.props.title}`, error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="error-panel" role="alert">
        <strong>{this.props.title}</strong>
        {this.props.hint && <span>{this.props.hint}</span>}
        <code>{error.message}</code>
        <button type="button" className="btn" onClick={() => this.setState({ error: null })}>
          Tentar novamente
        </button>
      </div>
    );
  }
}
