// Each regional manager's avatar as stored: a look chosen once (avatar.ts), as JSON in the avatar
// column. Managers pictured by one of bb's icons before blobs get theirs as the store opens.
import { z } from "zod";
import { avatarSchema, freeLook, randomStart, seedOf, type Avatar, type AvatarChoice } from "../../model/profile/avatar.ts";
import type { CoordinatorId } from "../../model/role.ts";
import type { Db } from "./rows.ts";

/**
 * Gives every regional manager still pictured by an icon the first free look from its id's seed, in
 * the order they were created, so none shares a look with another, in one transaction. Idempotent:
 * a manager with a blob is never rewritten, so a second run changes nothing. why from the id, never
 * the name: the name is bb's thread title, and a rename must not change the avatar.
 */
export function pictureIconManagers(db: Db): void {
  db().transaction(() => {
    const rows = db().prepare("SELECT id, avatar FROM coordinators ORDER BY created_at, rowid").all().map((row) => lookRowSchema.parse(row));
    const isIcon = (json: string) => iconSchema.safeParse(decoded(json)).success;
    const taken = rows.filter(({ avatar }) => !isIcon(avatar)).map(({ id, avatar }) => visibleLook(id, avatar));
    const update = db().prepare("UPDATE coordinators SET avatar = ? WHERE id = ?");
    for (const { id } of rows.filter(({ avatar }) => isIcon(avatar))) {
      const look = freeLook(seedOf(id), taken);
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

/** An avatar of the releases before blobs: one of bb's icons. */
const iconSchema = z.object({ kind: z.literal("icon") });

const lookRowSchema = z.object({ id: z.string(), avatar: z.string() });
