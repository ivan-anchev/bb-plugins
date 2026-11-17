// The Computer card in a boat thread's Info tab: a drawing of a desktop that opens the Computer page.
// Threads on any other machine show nothing.
import { experimental_InfoSection as InfoSection, experimental_useAppPanel, type ExperimentalThreadInfoProps } from "@get-bb/plugin-sdk/app";
import { COMPUTER_TAB } from "./computer-tab.tsx";
import { DesktopArt } from "./desktop-art.tsx";
import { useRunsOnBoat } from "./runs-on-boat.ts";

export function ComputerCard({ environment }: ExperimentalThreadInfoProps) {
  const panel = experimental_useAppPanel();
  if (!useRunsOnBoat(environment)) return null;
  return (
    <InfoSection label="Computer">
      <button
        type="button"
        aria-label="Open Computer, the sandbox's desktop"
        onClick={() => panel.openTab({ tab: COMPUTER_TAB })}
        className="block w-full overflow-hidden rounded-lg border border-border bg-surface-recessed text-left outline-none transition-colors hover:bg-state-hover focus-visible:ring-2 focus-visible:ring-ring"
      >
        <DesktopArt />
      </button>
    </InfoSection>
  );
}
