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
    const rows = db().prepare("SELECT id, avatar FROM coordinators ORDER BY created_at, rowid").all().map((row) => pictureRowSchema.parse(row));
    const taken = rows.flatMap(({ avatar }) => blobOf(avatar) ?? []);
    const update = db().prepare("UPDATE coordinators SET avatar = ? WHERE id = ?");
    for (const { id } of rows.filter(({ avatar }) => iconSchema.safeParse(decoded(avatar)).success)) {
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
  if (choice.kind === "blob") return choice;
  const stored = db().prepare("SELECT avatar FROM coordinators").all().map((row) => storedAvatarSchema.parse(row).avatar);
  return freeLook(randomStart(), stored.flatMap((json) => blobOf(json) ?? []));
}

/**
 * A regional manager's row with its avatar column read. why the fallback: one this release can't
 * draw, as a kind a later release stored or text that isn't JSON, reads as the look its id seeds
 * rather than hiding every manager from the list, and stays as stored.
 */
export const withAvatar = <Row extends { id: CoordinatorId; avatar: string }>({ avatar, ...row }: Row): Omit<Row, "avatar"> & { avatar: Avatar } => ({
  ...row,
  avatar: blobOf(avatar) ?? freeLook(seedOf(row.id), []),
});

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

const pictureRowSchema = z.object({ id: z.string(), avatar: z.string() });
const storedAvatarSchema = z.object({ avatar: z.string() });
