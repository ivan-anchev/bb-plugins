// PROTOTYPE (i7), throwaway: mock regional managers for the create-first picker. i6 wires the real
// records; nothing here is read by the plugin's real pages.
import type { PluginSidebarThreadIndicator } from "@get-bb/plugin-sdk/app";
import type { Profile } from "../../model/profile.ts";

/** A manager as i6 would list it: a profile, and its thread once its goal was sent. */
export type MockManager = {
  id: string;
  profile: Profile;
  /** Null: no thread yet (i6's threadless manager). */
  thread: { indicator: PluginSidebarThreadIndicator; project: { name: string; hue: string } } | null;
};

// why these: the worst content a real list has, the longest name and description, one with none.
export const MANAGERS: readonly MockManager[] = [
  {
    id: "m-release",
    profile: {
      name: "Release train for every bb-plugins marketplace plugin, 0.x to 1.0 with migrations",
      description: "Takes each plugin from 0.x to 1.0: audits its settings, writes the migration notes, cuts the tags and checks the marketplace listing after each release.",
      avatar: { kind: "icon", icon: "Megaphone02" },
    },
    thread: null,
  },
  { id: "m-scout", profile: { name: "Scout", description: null, avatar: { kind: "icon", icon: "Explore" } }, thread: null },
  {
    id: "m-atlas",
    profile: { name: "Atlas", description: "Builds the create-first flow and polishes the board.", avatar: { kind: "icon", icon: "Workflow" } },
    thread: { indicator: "runtime", project: { name: "bb-plugins", hue: "violet" } },
  },
  {
    id: "m-triage",
    profile: { name: "Nightly triage", description: "Reads new issues each night and files the ones worth doing.", avatar: { kind: "icon", icon: "Bug" } },
    thread: { indicator: "waiting-for-input", project: { name: "bb", hue: "emerald" } },
  },
  {
    id: "m-docs",
    profile: { name: "Docs sweep", description: null, avatar: { kind: "icon", icon: "Layers" } },
    thread: { indicator: "none", project: { name: "bb-plugins", hue: "violet" } },
  },
];

/** The threadless manager the manager-page variants show: the longest description, a real name. */
export const THREADLESS: MockManager = {
  id: "m-ledger",
  profile: {
    name: "Ledger",
    description: "Moves billing from the old invoices table to Stripe, one customer cohort at a time, and keeps the reconciliation report green.",
    avatar: { kind: "icon", icon: "ChartColumn" },
  },
  thread: null,
};
