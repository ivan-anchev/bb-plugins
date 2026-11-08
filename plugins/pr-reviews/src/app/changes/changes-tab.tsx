// The Changes tab: the PR's whole diff (base...head) as a file tree beside the selected file's diff,
// with Code Explorer's header. It needs no guide. The diff is read once the tab is first shown, so
// a PR opened on Summary never runs `gh pr diff`; after that the page's Refresh re-reads it.
import { useState } from "react";
import { useChanges, type PrTarget } from "../queries.ts";
import { ReadError } from "../ui/read-error.tsx";
import { ChangesPanel } from "./changes-panel.tsx";

/** `shown`: whether the Changes tab is on screen; the page keeps it mounted under another tab. */
type ChangesTabProps = { target: PrTarget; shown: boolean };

export function ChangesTab({ target, shown }: ChangesTabProps) {
  const changes = useChanges(target, useShownOnce(shown));
  return (
    <ChangesPanel
      target={target}
      changes={changes.data ?? null}
      loading={changes.isLoading}
      readError={<ReadError read={changes} what="the changes" />}
    />
  );
}

// True from the first render the tab is shown on, for good. Set during render, so the read starts
// on that same render rather than an effect later.
function useShownOnce(shown: boolean): boolean {
  const [shownOnce, setShownOnce] = useState(shown);
  if (shown && !shownOnce) setShownOnce(true);
  return shownOnce || shown;
}
