import type { PluginRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

const changeTargetSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("uncommitted") }),
  z.object({ type: z.literal("all"), mergeBaseBranch: z.string() }),
]);

const changesInputSchema = z.object({
  environmentId: z.string(),
  target: changeTargetSchema,
  ignoreWhitespace: z.boolean(),
});

const changedFileSchema = z.object({
  path: z.string(),
  previousPath: z.string().nullable(),
  changeKind: z.enum(["added", "modified", "deleted", "renamed", "copied", "type_changed"]),
  origin: z.enum(["tracked", "untracked"]),
  additions: z.number(),
  deletions: z.number(),
  binary: z.boolean(),
  loadMode: z.enum(["auto", "on_demand", "too_large"]),
  revision: z.string(),
});

const patchSchema = z.object({ path: z.string(), patch: z.string(), truncated: z.boolean() });

const notApplicableSchema = z.object({ outcome: z.literal("not_applicable"), message: z.string() });

const unavailableSchema = z.object({
  outcome: z.literal("unavailable"),
  failure: z.object({ message: z.string() }),
});

export const gitContract = {
  files: {
    input: changesInputSchema,
    output: z.discriminatedUnion("outcome", [
      z.object({
        outcome: z.literal("available"),
        files: z.array(changedFileSchema),
        truncated: z.boolean(),
        initialPatches: z.array(patchSchema),
      }),
      notApplicableSchema,
      unavailableSchema,
    ]),
  },
  patches: {
    input: z.object({ keys: z.array(z.string()) }),
    output: z.record(
      z.string(),
      z.discriminatedUnion("outcome", [
        z.object({ outcome: z.literal("available"), patch: patchSchema }),
        notApplicableSchema,
        unavailableSchema,
      ]),
    ),
  },
  status: {
    input: z.object({ keys: z.array(z.string()) }),
    output: z.record(
      z.string(),
      z.discriminatedUnion("outcome", [
        z.object({
          outcome: z.literal("available"),
          workspace: z.object({
            mergeBase: z.object({ mergeBaseBranch: z.string() }).nullable(),
          }),
        }),
        notApplicableSchema,
        unavailableSchema,
        z.object({ outcome: z.literal("failed"), message: z.string() }),
      ]),
    ),
  },
} satisfies PluginRpcContract;

export type ChangeTarget = z.infer<typeof changeTargetSchema>;
export type ChangesInput = z.infer<typeof changesInputSchema>;
export type ChangedFile = z.infer<typeof changedFileSchema>;
export type GitPatch = z.infer<typeof patchSchema>;
