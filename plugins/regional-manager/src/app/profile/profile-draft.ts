// A profile as the user is typing it: the fields' text as typed, read as a profile only once it is one.
import { z } from "zod";
import { avatarSchema, freeLook, STARTS, type Avatar } from "../../model/profile/avatar.ts";
import { profileSchema, type Profile } from "../../model/profile/profile.ts";
import type { CoordinatorId } from "../../model/role.ts";

/** What the fields hold. `description`: as typed, empty for none. */
const profileDraftSchema = z.object({ name: z.string(), description: z.string(), avatar: avatarSchema });
export type ProfileDraft = z.infer<typeof profileDraftSchema>;

/**
 * The fields as the browser keeps them. why the avatar may be null: fields kept by an earlier release
 * hold an avatar this one can't draw (one of bb's icons), and their name and description are still
 * what the user typed, so they are kept, and the avatar is filled in where they are read (withLook).
 */
export const storedDraftSchema = profileDraftSchema.extend({ avatar: avatarSchema.nullable().catch(null) });
export type StoredDraft = z.infer<typeof storedDraftSchema>;

/** The kept fields, with `look` as their avatar when theirs couldn't be read. */
export const withLook = (draft: StoredDraft, look: Avatar): ProfileDraft => ({ ...draft, avatar: draft.avatar ?? look });

/** A new regional manager's fields: no name, no description, and the first look from `start` that none of `taken` has. */
export const newDraft = (start: number, taken: readonly Avatar[]): ProfileDraft => ({ name: "", description: "", avatar: freeLook(start, taken) });

/** Where a new or shuffled look starts from: any of the looks, with any face. */
export const randomStart = (): number => Math.floor(Math.random() * STARTS);

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
