// experimental_appOverlay: the Spotlight, a centred modal over any bb screen where a note is
// written. bb's host shims Radix, so this dialog shares bb's focus, dismiss and scroll-lock layer,
// and Radix gives focus back to whatever had it when the Spotlight closes.
import { experimental_useSidebarThreads } from "@get-bb/plugin-sdk/app";
import { Overlay, Portal, Root } from "@radix-ui/react-dialog";
import type { Quote } from "../../contract.ts";
import { useHoldEscape } from "../ui/hold-escape.ts";
import { PORTAL_SCOPE } from "../ui/portal-scope.ts";
import { ComposeForm } from "./compose/compose-form.tsx";
import { spotlight, useSpotlightState, type Capture } from "./spotlight-store.ts";

export function Spotlight() {
  const state = useSpotlightState();
  const open = state.kind !== "closed";
  const close = () => spotlight.close(state);
  // bb's own Esc leaves the page; while the Spotlight is open every Esc is ours.
  useHoldEscape(open);
  return (
    <Root open={open} onOpenChange={(next) => !next && close()}>
      <Portal>
        <Overlay {...PORTAL_SCOPE} className="nt-scrim" />
        {/* Mounted per opening (closing unmounts it), so every opening starts a fresh draft. */}
        {state.kind === "compose" && <Compose capture={state.capture} onSaved={close} />}
      </Portal>
    </Root>
  );
}

// ------------------------------------------------------------------ layer 2

function Compose({ capture, onSaved }: { capture: Capture | null; onSaved(): void }) {
  const quote = useQuote(capture);
  return <ComposeForm quote={quote} onSaved={onSaved} />;
}

/** The capture with its thread's title; until the sidebar's threads have loaded, the thread's id. */
function useQuote(capture: Capture | null): Quote | null {
  const { threads } = experimental_useSidebarThreads();
  if (capture === null) return null;
  const thread = threads.find((candidate) => candidate.id === capture.threadId);
  return { ...capture, threadTitle: thread?.displayTitle ?? capture.threadId };
}
