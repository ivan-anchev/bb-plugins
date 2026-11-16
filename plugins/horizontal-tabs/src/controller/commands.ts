// Tab switching from the keyboard: next and previous (wrapping) and go to tab 1–9, as rebindable bb
// commands listed in the palette under the plugin's name. A command's run happens outside React, so it
// drives the module's one controller. Each is hidden while it can do nothing: on a compact viewport, where
// the strip is hidden, and when its target tab doesn't exist.
import type { PluginAppCommands } from "@get-bb/plugin-sdk/app";
import { stripShown } from "../host/strip-mount.ts";
import { tabs } from "./tabs.ts";

export function registerTabCommands(commands: PluginAppCommands): void {
  // why control, not mod, on every platform: these are a browser's own tab keys. A bb web tab never sees
  // Ctrl+Tab, which the browser keeps (accepted in the brief); bb Desktop and Alt+N reach bb.
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
  // why tab N, Alt+9 included: VS Code's openEditorAtIndex1…9, where 9 is the ninth tab, not the last.
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
