// How the user tells regional managers apart: a name, an optional description and an avatar. The
// name is the thread's title, which bb keeps, so renaming either renames both; the plugin keeps
// the description and the avatar (avatar.ts).
import { z } from "zod";
import { avatarSchema } from "./avatar.ts";

export const NAME_MAX = 80;
export const DESCRIPTION_MAX = 500;

/** A profile as the user gives it, on the New page or in an edit. `description` null: none. */
export const profileSchema = z.object({
  name: z.string().trim().min(1).max(NAME_MAX),
  description: z.string().trim().min(1).max(DESCRIPTION_MAX).nullable(),
  avatar: avatarSchema,
});
export type Profile = z.infer<typeof profileSchema>;
