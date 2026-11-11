// A GitHub label: one of the PR's labels, or the one a label event added or removed. Pure zod.
import { z } from "zod";

/** A GitHub label; `color` is a CSS hex color, `#rrggbb`. */
export const labelSchema = z.object({ name: z.string(), color: z.string() });
export type Label = z.infer<typeof labelSchema>;

/** A label as gh and GitHub's GraphQL API serve it, with its color as hex without the `#`. */
export const ghLabelSchema = z.object({ name: z.string(), color: z.string() }).transform(({ name, color }): Label => ({ name, color: `#${color}` }));
