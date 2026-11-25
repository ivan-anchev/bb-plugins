// A regional manager as the Managers view draws it beyond its thread: its avatar, which only the
// Regional Manager plugin keeps. Read through that plugin's published `coordinators`
// (its skills/crew-board/SKILL.md), parsed with this copy of its schema: a plugin imports nothing
// from another.
import { z } from "zod";
import { HUES } from "./project-hue.ts";

/** The plugin that starts regional managers, and owns their looks. */
export const REGIONAL_MANAGER = "regional-manager";

/** A regional manager's own thread: the Regional Manager plugin's only top-level kind (its agents and checks are its children). */
export function isManagerThread(t: { originPluginId: string | null; parentThreadId: string | null }): boolean {
  return t.originPluginId === REGIONAL_MANAGER && t.parentThreadId === null;
}

/** blob-avatar's 21 shapes, which the Regional Manager's picker offers. */
const SHAPES = ["circle", "pebble", "squircle", "capsule", "triangle", "diamond", "hexagon", "star", "cloud", "droplet", "heart", "ghost", "cat", "bear", "bunny", "amoeba", "flower", "clover", "leaf", "gem", "bubble"] as const;

/** The friendly faces a manager can wear. */
const EXPRESSIONS = ["neutral", "happy", "content", "curious", "attentive", "determined"] as const;

/** A still blob in one of the 12 identity hues, the same hues as the project tiles. */
const avatarSchema = z.object({ kind: z.literal("blob"), shape: z.enum(SHAPES), hue: z.enum(HUES), expression: z.enum(EXPRESSIONS) });
export type Avatar = z.infer<typeof avatarSchema>;

/** What the Managers view reads of one started manager; the rest of the record is dropped. */
export const managerLookSchema = z.object({ threadId: z.string().min(1), avatar: avatarSchema });
export type ManagerLook = z.infer<typeof managerLookSchema>;

/** The `coordinators` read's output, as far as the Managers view reads it: one look a manager's thread. */
export const coordinatorsReadSchema = z.object({
  coordinators: z.array(managerLookSchema).refine((looks) => new Set(looks.map(({ threadId }) => threadId)).size === looks.length, "Each manager's thread appears once"),
});
