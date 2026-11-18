// How the user tells regional managers apart: a name, an optional description and an avatar. The
// name is the thread's title, which bb keeps, so renaming either renames both; the plugin keeps
// the description and the avatar.
import { z } from "zod";

/**
 * The icons an avatar can be, in the order the picker shows them. Every one is a built-in bb icon,
 * so `experimental_Icon` draws it without the plugin registering a glyph.
 */
export const AVATAR_ICONS = ["Workflow", "Bot", "Brain", "Beaker", "Bug", "Code", "Terminal", "Target", "Zap", "Star", "Coffee", "Globe", "Megaphone02", "Toolbox", "Puzzle", "Layers", "ChartColumn", "SecurityCheck", "Explore", "Cloud", "Mail", "Calendar", "Laptop", "Smartphone"] as const;
type AvatarIcon = (typeof AVATAR_ICONS)[number];

/** What each icon is called aloud. */
export const AVATAR_ICON_LABELS: Record<AvatarIcon, string> = {
  Workflow: "Workflow",
  Bot: "Robot",
  Brain: "Brain",
  Beaker: "Beaker",
  Bug: "Bug",
  Code: "Code",
  Terminal: "Terminal",
  Target: "Target",
  Zap: "Lightning",
  Star: "Star",
  Coffee: "Coffee",
  Globe: "Globe",
  Megaphone02: "Megaphone",
  Toolbox: "Toolbox",
  Puzzle: "Puzzle",
  Layers: "Layers",
  ChartColumn: "Chart",
  SecurityCheck: "Shield",
  Explore: "Book",
  Cloud: "Cloud",
  Mail: "Mail",
  Calendar: "Calendar",
  Laptop: "Laptop",
  Smartphone: "Phone",
};

/** What a regional manager is pictured by. why a union of one: images and other kinds join it later. */
export const avatarSchema = z.discriminatedUnion("kind", [z.object({ kind: z.literal("icon"), icon: z.enum(AVATAR_ICONS) })]);
export type Avatar = z.infer<typeof avatarSchema>;

/** A regional manager started before profiles, or named with no other choice, has this avatar: the plugin's own icon. */
export const DEFAULT_AVATAR: Avatar = { kind: "icon", icon: "Workflow" };

export const NAME_MAX = 80;
export const DESCRIPTION_MAX = 500;

/** A profile as the user gives it, on the New page or in an edit. `description` null: none. */
export const profileSchema = z.object({
  name: z.string().trim().min(1).max(NAME_MAX),
  description: z.string().trim().min(1).max(DESCRIPTION_MAX).nullable(),
  avatar: avatarSchema,
});
export type Profile = z.infer<typeof profileSchema>;
