import { Component, type ReactNode } from "react";
import { Notice } from "../ui/notice.tsx";

type State = { failed: boolean };

export class DiffErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  render() {
    return this.state.failed ? <Notice tone="error">This diff couldn't be drawn.</Notice> : this.props.children;
  }
}
