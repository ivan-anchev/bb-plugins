// The card's plan, as Zeron's todo panel has it (P:1259-1289, Z:ds/composer_dock.luau:1645-1700): "Todo
// done/total", then the steps in their order. Past six it folds to three, the step in progress and one
// either side, with "N earlier" / "N later" opening the rest. Pure.
import type { PluginBrowserBbSdk } from "@get-bb/plugin-sdk/app";

/** bb's plan for a thread under way (its `pendingTodos`), typed as `status.get` answers it; the timeline summary the card reads answers the same. */
export type Todos = NonNullable<Awaited<ReturnType<PluginBrowserBbSdk["status"]["get"]>>["pendingTodos"]>;

export type StepState = "done" | "doing" | "pending";
export type PlanStep = { id: string; text: string; state: StepState };

/** What the card shows: the count, and the steps shown with how many are folded before and after them. */
export type PlanView = { done: number; total: number; earlier: number; steps: readonly PlanStep[]; later: number };

// Z:ds/composer_dock.luau:170
const FOLD_PAST = 6;
const FOLD_TO = 3;

/** The plan as the card shows it, folded unless `open`; null for a plan with no steps. */
export function foldPlan(todos: Todos, open: boolean): PlanView | null {
  const steps = todos.items.map((item) => ({ id: item.id, text: item.text, state: stepState(item.status) }));
  if (steps.length === 0) return null;
  const done = steps.filter((step) => step.state === "done").length;
  if (open || steps.length <= FOLD_PAST) return { done, total: steps.length, earlier: 0, steps, later: 0 };

  const from = Math.max(0, Math.min(focusOf(steps) - 1, steps.length - FOLD_TO));
  const to = from + FOLD_TO;
  return { done, total: steps.length, earlier: from, steps: steps.slice(from, to), later: steps.length - to };
}

// ------------------------------------------------------------------ layer 2

/** The step in progress, else the first pending, else (all done) the second to last, so the last three show. */
function focusOf(steps: readonly PlanStep[]): number {
  const doing = steps.findIndex((step) => step.state === "doing");
  if (doing >= 0) return doing;
  const pending = steps.findIndex((step) => step.state === "pending");
  return pending >= 0 ? pending : steps.length - 2;
}

function stepState(status: Todos["items"][number]["status"]): StepState {
  switch (status) {
    case "completed":
      return "done";
    case "in_progress":
      return "doing";
    case "pending":
      return "pending";
    default:
      status satisfies never;
      // why: a status a newer bb adds reads as not done yet rather than breaking the card.
      return "pending";
  }
}
