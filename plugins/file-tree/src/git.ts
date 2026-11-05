import type { PluginRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

const changeTargetSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("uncommitted") }),
  z.object({ type: z.literal("all"), mergeBaseBranch: z.string() }),
]);

const changedFileSchema = z.object({
  path: z.string(),
  changeKind: z.enum(["added", "modified", "deleted", "renamed", "copied", "type_changed"]),
  origin: z.enum(["tracked", "untracked"]),
});

const notApplicableSchema = z.object({ outcome: z.literal("not_applicable"), message: z.string() });

const unavailableSchema = z.object({
  outcome: z.literal("unavailable"),
  failure: z.object({ message: z.string() }),
});

export const gitContract = {
  files: {
    input: z.object({
      environmentId: z.string(),
      target: changeTargetSchema,
      ignoreWhitespace: z.boolean(),
    }),
    output: z.discriminatedUnion("outcome", [
      z.object({
        outcome: z.literal("available"),
        files: z.array(changedFileSchema),
        truncated: z.boolean(),
        mergeBaseRef: z.string().nullable(),
      }),
      notApplicableSchema,
      unavailableSchema,
    ]),
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
export type ChangedFile = z.infer<typeof changedFileSchema>;
