// A diff Pierre can't draw (a patch it rejects, an option it throws on) shows a notice in its own
// place: without a boundary, the throw takes down the plugin's whole page.
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
