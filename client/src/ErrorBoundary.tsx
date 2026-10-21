import { Component, type ReactNode } from "react";

/** Shows what broke instead of a blank page, with a way back. */
export default class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("screen crashed:", error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash" dir="auto">
        <p>משהו השתבש במסך. / Something went wrong on the screen.</p>
        <code>{this.state.error.message}</code>
        <button className="primary" onClick={() => this.setState({ error: null })}>חזרה / Back</button>
      </div>
    );
  }
}
