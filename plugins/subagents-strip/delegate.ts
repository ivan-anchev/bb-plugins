// The canonical delegate: one record per subagent, whatever the provider and
// wherever it lives in bb.
import type { StepRow, TaskUsage } from "./bb.ts";

export type DelegateId = string & { readonly __brand: "DelegateId" };

export type Delegate = {
  /** A delegation's first callId, or a child thread's id. */
  id: DelegateId;
  /** Where the delegate lives in bb, and so what Open thread opens. */
  origin: DelegateOrigin;
  /** The provider running it: the thread's own for a delegation, the child's own for a child thread. */
  providerId: string;
  /** The parent turn that started it, the strip's scope key. null = that turn is outside the loaded timeline. */
  turnId: string | null;
  title: string;
  startedAt: number;
  /** Rows in order (see steps.ts). null = the provider sends none (ACP); [] = none yet. */
  steps: readonly StepRow[] | null;
  /** Only background-task events carry usage; null otherwise (Codex rows, child threads). */
  usage: TaskUsage | null;
  state: DelegateState;
};

// why: a union, not a flag plus an optional threadId, so a child thread always names the thread it opens.
// `threadId` repeats `id` on purpose: `id` is opaque identity (keys, tab params), `threadId` is the bb thread.
export type DelegateOrigin =
  /** A delegation row in this thread's timeline; its transcript is its child rows. */
  | { kind: "delegation" }
  /** A bb thread whose parentThreadId is this thread. */
  | { kind: "child-thread"; threadId: string };

export type DelegateState =
  | { status: "running" }
  | { status: "completed"; endedAt: number; report: string | null }
  | { status: "failed"; endedAt: number; error: string | null }
  | { status: "stopped"; endedAt: number };

export type DelegateStatus = DelegateState["status"];

/** What `useThreadDelegates` hands every component. */
export type ThreadDelegates =
  | { status: "loading" }
  | { status: "ready"; delegates: readonly Delegate[] }
  | { status: "failed"; message: string };
