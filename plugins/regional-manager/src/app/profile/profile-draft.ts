// A profile as the user is typing it: the fields' text as typed, read as a profile only once it is one.
import { z } from "zod";
import { avatarSchema, DEFAULT_AVATAR, profileSchema, type Profile } from "../../model/profile.ts";
import type { CoordinatorId } from "../../model/role.ts";

/** What the fields hold. `description`: as typed, empty for none. */
export const profileDraftSchema = z.object({ name: z.string(), description: z.string(), avatar: avatarSchema });
export type ProfileDraft = z.infer<typeof profileDraftSchema>;

/** A new regional manager's fields: no name, no description, the plugin's own icon. */
export const EMPTY_DRAFT: ProfileDraft = { name: "", description: "", avatar: DEFAULT_AVATAR };

/** Where the browser keeps the New page's fields until the regional manager starts, as bb's composer keeps its goal. */
export const NEW_PROFILE_KEY = "coordinator-new-profile";

/** Where the browser keeps an edit of the regional manager's profile while it is open, until it is saved or cancelled. */
export const profileEditKeyOf = (coordinatorId: CoordinatorId): string => `coordinator-profile-edit:${coordinatorId}`;

/** The fields holding a profile, to edit it. */
export const draftOf = ({ name, description, avatar }: Profile): ProfileDraft => ({ name, description: description ?? "", avatar });

/** The profile the fields hold; null while it has no name. A blank description is none. */
export function profileOf({ name, description, avatar }: ProfileDraft): Profile | null {
  const parsed = profileSchema.safeParse({ name, description: description.trim() === "" ? null : description, avatar });
  return parsed.success ? parsed.data : null;
}

/** What the name field says when a save finds no name. */
export const NAME_MISSING = "Give it a name.";
