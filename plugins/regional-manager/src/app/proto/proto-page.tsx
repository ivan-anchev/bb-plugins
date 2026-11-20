// PROTOTYPE (i7), throwaway: the create-first picker, at the panel's `proto/<screen>/<variant>`.
// The top picker switches screens, the bottom one variants (keys 1–N, ←/→). The screens chain the
// way i6 would: Create opens the new manager's page, a threadless row opens its page.
// Nothing outside this folder imports it but the one marked mount block in coordinator-panel.tsx.
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { useState } from "react";
import type { Profile } from "../../model/profile.ts";
import { PANEL_PATH } from "../panel/routes.ts";
import { MANAGER_VARIANTS } from "./manager-variants.tsx";
import { THREADLESS, type MockManager } from "./mock.ts";
import { NEW_VARIANTS } from "./new-variants.tsx";
import { Picker } from "./picker.tsx";
import { ROW_VARIANTS } from "./row-variants.tsx";
import "./proto.css";

const SCREENS = [
  { slug: "new", name: "New page", variants: NEW_VARIANTS.map(({ name }) => name) },
  { slug: "manager", name: "Threadless page", variants: MANAGER_VARIANTS.map(({ name }) => name) },
  { slug: "list", name: "List rows", variants: ROW_VARIANTS.map(({ name }) => name) },
] as const;

export const PROTO_PREFIX = "proto";

export function ProtoPage({ subPath }: { subPath: string }) {
  const navigate = useBbNavigate();
  const [, slug = "new", number = "1"] = subPath.split("/");
  const screenIndex = Math.max(0, SCREENS.findIndex((screen) => screen.slug === slug));
  const screen = SCREENS[screenIndex];
  const variant = Math.min(Math.max(0, Number.parseInt(number, 10) - 1 || 0), screen.variants.length - 1);
  const [manager, setManager] = useState<{ id: string; profile: Profile }>(THREADLESS);
  // Each screen remembers its variant, so the screen picker goes back to what was being looked at.
  const [chosen, setChosen] = useState<Record<string, number>>({});

  const go = (to: string, index: number) => navigate.toPluginPanel(PANEL_PATH, { subPath: `${PROTO_PREFIX}/${to}/${index + 1}`, replace: true });
  const pick = (index: number) => {
    setChosen({ ...chosen, [screen.slug]: index });
    go(screen.slug, index);
  };
  const toList = () => go("list", chosen.list ?? 0);
  const openManager = (next: { id: string; profile: Profile }) => {
    setManager(next);
    go("manager", chosen.manager ?? 0);
  };

  return (
    <div className="relative h-full min-h-0">
      {/* why keyed: switching re-mounts the variant, so each starts from its first state. */}
      <div key={`${screen.slug}/${variant}`} className="h-full min-h-0">
        {screen.slug === "new" && NEW_VARIANTS[variant]!.render({ onBack: toList, onCreated: (profile) => openManager({ id: `created-${Date.now()}`, profile }) })}
        {screen.slug === "manager" && MANAGER_VARIANTS[variant]!.render({ id: manager.id, profile: manager.profile, onProfile: (profile) => setManager({ ...manager, profile }), onBack: toList })}
        {screen.slug === "list" && ROW_VARIANTS[variant]!.render({ onOpen: (row: MockManager) => row.thread === null && openManager(row) })}
      </div>
      <Picker label="Prototype screens" names={SCREENS.map(({ name }) => name)} active={screenIndex} onSelect={(index) => go(SCREENS[index]!.slug, chosen[SCREENS[index]!.slug] ?? 0)} position="top" />
      <Picker label="Prototype variants" names={screen.variants} active={variant} onSelect={pick} keys />
    </div>
  );
}
