// Two shapes, one boundary: SubmitReviewInput is the agent's wire format (the spec's schema,
// exactly); Guide is the canonical stored form, which only validateSubmission produces.
import { z } from "zod";
import { hunkIdSchema } from "../diff/diff-schema.ts";

const text = z.string().trim().min(1);
// A file is named by its exact path, which may begin or end with spaces: never trimmed.
const path = z.string().min(1);
const prioritySchema = z.enum(["p0", "p1", "p2"]);
const sideSchema = z.enum(["new", "old"]);

// ---- wire format: the tool's parameters ----

const hunkRefInputSchema = z.strictObject({
  file: path.describe("The file's path, exactly as the hunk list prints it."),
  hunk: text.describe('The hunk\'s range header as the hunk list prints it, e.g. "@@ -18,9 +18,19 @@", or "whole file" for a file listed that way.'),
  collapsed: text.optional().describe("A one-line reason to show this hunk folded, for code that needs no reading."),
});

export const submitReviewInputSchema = z.strictObject({
  overview: z.strictObject({
    problem: text.describe("What was wrong, or why the PR exists."),
    approach: text.describe("How the PR solves it."),
    behaviour: z
      .strictObject({ before: z.array(text).min(1), after: z.array(text).min(1) })
      .optional()
      .describe("Only when behaviour actually changes."),
  }),
  steps: z
    .array(
      z.strictObject({
        title: text,
        explanation: text.describe("What this code does and why it matters."),
        forYou: text.optional().describe("A decision only the reviewer can make."),
        hunks: z.array(hunkRefInputSchema).min(1),
      }),
    )
    .min(1)
    .max(7)
    .describe("1 to 7 steps, in reading order."),
  hidden: z
    .array(
      z.union([
        z.strictObject({ file: path, hunk: text, reason: text }),
        z.strictObject({ files: z.array(path).min(1), reason: text }),
      ]),
    )
    .describe("Hunks or whole files left out of the steps, each with a reason."),
  findings: z.array(
    z.strictObject({
      file: path,
      line: z.number().int().positive().describe("A line inside one of the file's hunks."),
      side: sideSchema.optional().describe('"old" only for a removed line; defaults to "new".'),
      priority: prioritySchema,
      title: text,
      body: text,
    }),
  ),
});
export type SubmitReviewInput = z.infer<typeof submitReviewInputSchema>;

// ---- canonical stored form ----

const guideHunkSchema = z.object({ file: z.string(), hunk: hunkIdSchema, collapsed: z.string().nullable() });
export type GuideHunk = z.infer<typeof guideHunkSchema>;

const guideStepSchema = z.object({
  title: z.string(),
  explanation: z.string(),
  forYou: z.string().nullable(),
  hunks: z.array(guideHunkSchema).min(1),
});
export type GuideStep = z.infer<typeof guideStepSchema>;

const hiddenItemSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("hunk"), file: z.string(), hunk: hunkIdSchema, reason: z.string() }),
  z.object({ kind: z.literal("files"), files: z.array(z.string()).min(1), reason: z.string() }),
]);
export type HiddenItem = z.infer<typeof hiddenItemSchema>;

const findingSchema = z.object({
  file: z.string(),
  line: z.number().int().positive(),
  side: sideSchema,
  /** The hunk whose range holds `line` on `side`, resolved at validation. */
  hunk: hunkIdSchema,
  priority: prioritySchema,
  title: z.string(),
  body: z.string(),
});
export type Finding = z.infer<typeof findingSchema>;

export const guideSchema = z.object({
  overview: z.object({
    problem: z.string(),
    approach: z.string(),
    behaviour: z.object({ before: z.array(z.string()), after: z.array(z.string()) }).nullable(),
  }),
  steps: z.array(guideStepSchema).min(1).max(7),
  hidden: z.array(hiddenItemSchema),
  findings: z.array(findingSchema),
});
export type Guide = z.infer<typeof guideSchema>;
