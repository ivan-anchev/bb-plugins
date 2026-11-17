// The Computer card in a boat thread's Info tab: one tile, a drawing of a desktop above the Computer label,
// that opens the Computer page. Threads on any other machine show nothing.
import { experimental_Icon as Icon, experimental_useAppPanel, type ExperimentalThreadInfoProps } from "@get-bb/plugin-sdk/app";
import { COMPUTER_TAB } from "./computer-tab.tsx";
import { DesktopArt } from "./desktop-art.tsx";
import { MONITOR_ICON } from "./monitor-icon.tsx";
import { useRunsOnBoat } from "./runs-on-boat.ts";

export function ComputerCard({ environment }: ExperimentalThreadInfoProps) {
  const panel = experimental_useAppPanel();
  if (!useRunsOnBoat(environment)) return null;
  // why not experimental_InfoSection: its heading sits apart from the tile and folds the section when clicked.
  // data-info-section still gets the rule and spacing bb puts between its own Info sections.
  return (
    <section data-info-section="">
      <button
        type="button"
        aria-label="Open Computer, the sandbox's desktop"
        onClick={() => panel.openTab({ tab: COMPUTER_TAB })}
        className={TILE}
      >
        <span className="pointer-events-none block overflow-hidden rounded-lg bg-surface-recessed select-none">
          <DesktopArt />
        </span>
        <span className={LABEL}>
          <Icon name={MONITOR_ICON} className="size-3 shrink-0" aria-hidden />
          Computer
        </span>
      </button>
    </section>
  );
}

// Zeron's card (radius 12, 4px inset, hairline, --card fill); the drawing's radius is 12 − 4. Hover and press
// wash the whole tile from an overlay, as bb's New tab rows do: at once on the way in, over 150 ms on the way out.
const TILE = [
  "group relative flex w-full flex-col gap-1 rounded-xl border border-border bg-card p-1 text-left",
  "after:pointer-events-none after:absolute after:inset-0 after:rounded-[11px] after:transition-colors after:duration-150 after:ease-out",
  "hover:after:bg-state-hover hover:after:duration-0 active:after:bg-state-active",
  "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
].join(" ");

// bb's Info row type: 12/20, secondary ink, a 12px icon 6px from the text; full ink while the tile is engaged.
const LABEL = [
  "flex items-center gap-1.5 px-2 py-1 text-xs leading-5 text-muted-foreground transition-colors duration-150",
  "group-hover:text-foreground group-hover:duration-0 group-focus-visible:text-foreground",
].join(" ");
