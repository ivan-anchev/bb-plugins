// The canonical delegate: one record per subagent, whatever the provider.
import type { StepRow, TaskUsage } from "./bb.ts";

export type DelegateId = string & { readonly __brand: "DelegateId" };

export type Delegate = {
  /** callId of the delegate's first delegation row. */
  id: DelegateId;
  turnId: string | null;
  title: string;
  startedAt: number;
  /** Child rows in order (see steps.ts). null = the provider sends none (ACP); [] = none yet. */
  steps: readonly StepRow[] | null;
  /** Only background-task events carry usage; null otherwise. */
  usage: TaskUsage | null;
  state: DelegateState;
};

export type DelegateState =
  | { status: "running" }
  | { status: "completed"; endedAt: number; report: string | null }
  | { status: "failed"; endedAt: number; error: string | null }
  | { status: "stopped"; endedAt: number };

export type DelegateStatus = DelegateState["status"];

/** What `useThreadDelegates` hands every component. */
export type ThreadDelegates =
  | { status: "loading" }
  | { status: "ready"; providerId: string; delegates: readonly Delegate[] }
  | { status: "failed"; message: string };
