// Each regional manager's avatar as stored: a look chosen once (avatar.ts), as JSON in the avatar
// column. Managers pictured by an older release's look, one of bb's icons or a blob in a retired hue
// or with another face than neutral, get one of this release's as the store opens.
import { z } from "zod";
import { avatarSchema, freeLook, HUE_NAMES, randomStart, seedOf, startOf, type Avatar, type AvatarChoice } from "../../model/profile/avatar.ts";
import type { CoordinatorId } from "../../model/role.ts";
import type { Db } from "./rows.ts";

/**
 * Gives every regional manager still pictured by an older release's look one of this release's, in the
 * order they were created, so none shares a look with another, in one transaction: an icon manager the
 * first free look from its id's seed, and an older blob (a retired hue, or a face other than neutral)
 * its shape in its hue, or the closest of this release's, with the neutral face, or the next free look
 * from there when another manager has that. Idempotent: a manager with this release's look is never
 * rewritten, so a second run changes nothing. why from the id, never the name: the name is bb's
 * thread title, and a rename must not change the avatar.
 */
export function upgradeOldLooks(db: Db): void {
  db().transaction(() => {
    const rows = db().prepare("SELECT id, avatar FROM coordinators ORDER BY created_at, rowid").all().map((row) => lookRowSchema.parse(row));
    const oldLookOf = (json: string) => (blobOf(json) === null ? (oldLookSchema.safeParse(decoded(json)).data ?? null) : null);
    const taken = rows.filter(({ avatar }) => oldLookOf(avatar) === null).map(({ id, avatar }) => visibleLook(id, avatar));
    const update = db().prepare("UPDATE coordinators SET avatar = ? WHERE id = ?");
    for (const { id, avatar } of rows) {
      const old = oldLookOf(avatar);
      if (old === null) continue;
      const look = freeLook(old.kind === "icon" ? seedOf(id) : startOf(old), taken);
      update.run(JSON.stringify(look), id);
      taken.push(look);
    }
  })();
}

/**
 * The look a new regional manager is saved with: the one chosen, as given; for `auto`, the first from
 * a random start that no manager stored now has. Call it inside the insert's transaction, so two
 * creates never both take the look that was free when they began.
 */
export function lookFor(db: Db, choice: AvatarChoice): Avatar {
  // why on `auto`: any other kind is a look chosen, as a later kind would be too, and is saved as given.
  if (choice.kind !== "auto") return choice;
  const rows = db().prepare("SELECT id, avatar FROM coordinators").all().map((row) => lookRowSchema.parse(row));
  return freeLook(randomStart(), rows.map(({ id, avatar }) => visibleLook(id, avatar)));
}

/** A regional manager's row with its avatar column read as the look it is drawn with (visibleLook). */
export const withAvatar = <Row extends { id: CoordinatorId; avatar: string }>({ avatar, ...row }: Row): Omit<Row, "avatar"> & { avatar: Avatar } => ({
  ...row,
  avatar: visibleLook(row.id, avatar),
});

/**
 * The look a regional manager's row is drawn with: its stored blob, or, for one this release can't
 * draw (a kind a later release stored, or text that isn't JSON), the look its id seeds, which stays
 * as stored rather than hiding every manager from the list. why one reading: the list, `auto` picks
 * and the icon upgrade all read rows through it, so a row counts as taken by the look it shows.
 */
const visibleLook = (id: string, json: string): Avatar => blobOf(json) ?? freeLook(seedOf(id), []);

const blobOf = (json: string): Avatar | null => avatarSchema.safeParse(decoded(json)).data ?? null;

/** The column's JSON; null for text that isn't JSON, which then reads as an avatar this release can't draw. */
function decoded(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/** The hues earlier releases offered and this one doesn't. The others (blue, amber, teal, orange, pink) kept their names, and now draw in the user's colour. */
const RETIRED_HUES = ["violet", "emerald", "sky", "rose", "lime", "indigo", "cyan"] as const;

/** Each retired hue's closest of this release's. */
const CLOSEST_HUE: Record<(typeof RETIRED_HUES)[number], Avatar["hue"]> = { violet: "purple", emerald: "green", sky: "teal", rose: "red", lime: "green", indigo: "blue", cyan: "teal" };

/**
 * A look an older release stored: one of bb's icons, from before blobs, or a blob in a hue or with a
 * face of the releases before the user's palette and neutral faces. Read only where avatarSchema fails.
 */
const oldLookSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("icon") }),
  // why the transform: a retired hue reads as its closest of this release's.
  avatarSchema.extend({ hue: z.union([z.enum(HUE_NAMES), z.enum(RETIRED_HUES).transform((hue) => CLOSEST_HUE[hue])]), expression: z.string() }),
]);

const lookRowSchema = z.object({ id: z.string(), avatar: z.string() });
