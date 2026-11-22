import type { PluginAppCommands } from "@get-bb/plugin-sdk/app";
import { stripShown } from "../host/strip-mount.ts";
import { tabs } from "./tabs.ts";

export function registerTabCommands(commands: PluginAppCommands): void {
  const canStep = () => stripShown() && tabs.canStep();
  commands.register({
    id: "next-tab",
    title: "Next tab",
    defaultShortcut: { key: "Tab", control: true },
    isAvailable: canStep,
    run: () => tabs.step(1),
  });
  commands.register({
    id: "previous-tab",
    title: "Previous tab",
    defaultShortcut: { key: "Tab", control: true, shift: true },
    isAvailable: canStep,
    run: () => tabs.step(-1),
  });
  for (let n = 1; n <= 9; n++) {
    commands.register({
      id: `go-to-tab-${n}`,
      title: `Go to tab ${n}`,
      defaultShortcut: { key: String(n), alt: true },
      isAvailable: () => stripShown() && tabs.has(n),
      run: () => tabs.goTo(n),
    });
  }
}
