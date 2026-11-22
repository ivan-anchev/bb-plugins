import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { Execution } from "../../model/execution.ts";

type Threads = BbPluginApi["sdk"]["threads"];
type ExecutionOptions = NonNullable<Awaited<ReturnType<Threads["defaultExecutionOptions"]>>>;

/** The parts of bb the read uses, down to the fields it reads. */
export type ThreadExecutionBb = {
  sdk: {
    threads: {
      list(args: { threadIds: string[]; includeHidden: true; limit: number }): Promise<{ id: string; providerId: string }[]>;
      /** The model, reasoning level and service tier of the thread's latest turn; null before its first. */
      defaultExecutionOptions(args: { threadId: string }): Promise<Pick<ExecutionOptions, "model" | "reasoningLevel" | "serviceTier"> | null>;
    };
  };
};

/**
 * What a child of the thread inherits from it: what it runs on now, and its service tier. why the
 * tier beside the execution: a spawn carries it as bb's own setting, and nothing stores or names it.
 */
export type Inherited = { execution: Execution; serviceTier: ExecutionOptions["serviceTier"] };

/** What the thread runs on now, with its service tier, or null when bb lists no such thread or has no turn of it on record. */
export async function inheritedFrom(bb: ThreadExecutionBb, threadId: string): Promise<Inherited | null> {
  const [[thread], options] = await Promise.all([bb.sdk.threads.list({ threadIds: [threadId], includeHidden: true, limit: 1 }), bb.sdk.threads.defaultExecutionOptions({ threadId })]);
  if (thread === undefined || options === null) return null;
  return { execution: { providerId: thread.providerId, model: options.model, reasoningLevel: options.reasoningLevel }, serviceTier: options.serviceTier };
}

/** What the thread runs on, or null when bb lists no such thread or has no turn of it on record. */
export async function threadExecution(bb: ThreadExecutionBb, threadId: string): Promise<Execution | null> {
  return (await inheritedFrom(bb, threadId))?.execution ?? null;
}
