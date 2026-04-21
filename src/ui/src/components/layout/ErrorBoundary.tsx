import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import styles from "./ErrorBoundary.module.css";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("React error boundary caught:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className={styles.root}>
          <h2 className={styles.heading}>Something went wrong</h2>
          <pre className={styles.message}>{this.state.error.message}</pre>
          <pre className={styles.stack}>{this.state.error.stack}</pre>
          <button
            onClick={() => this.setState({ error: null })}
            className={styles.retryBtn}
          >
            {/* Only useful for transient render errors. If the error is caused
                by corrupted store state, the same crash will recur immediately. */}
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
