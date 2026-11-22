// A press on an issue link opens the issue's tab in its regional manager's side panel, which is where
// an issue lives: in the manager's own thread, in that pane's panel; from any other thread, the
// manager's thread opens in a split, or comes forward where it shows, with the tab open. ⌘ or Ctrl
// opens the split from the manager's thread too, as it does for bb's own links. The press is the
// plugin's before bb's, which would follow the link: caught on the way down, and kept from bb. A
// link to a manager the plugin doesn't know of, or doesn't know of yet, or a press with Shift or Alt,
// is left to bb, which follows it to the panel (issue-landing.tsx).
import { experimental_useRpcQuery, useBbNavigate } from "@get-bb/plugin-sdk/app";
import { useEffect } from "react";
import { coordinatorContract as contract } from "../../contract.ts";
import { issueLinkAt } from "./decorated-links.ts";
import { openIssueTabIn, threadOfPane } from "./panes.tsx";

export function useOpenOnClick(): void {
  const navigate = useBbNavigate();
  const coordinators = experimental_useRpcQuery({ contract, method: "coordinators", input: {} }).data?.coordinators;
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const found = issueLinkAt(event.target);
      const managerThread = coordinators?.find(({ id }) => id === found?.link.coordinatorId)?.threadId;
      if (found === null || managerThread === undefined || event.button !== 0 || event.shiftKey || event.altKey) return;
      event.preventDefault();
      event.stopPropagation();
      openIssueTabIn(managerThread, found.link.issueId);
      const split = event.metaKey || event.ctrlKey;
      if (split || threadOfPane(found.anchor) !== managerThread) navigate.toThread(managerThread, { split: true });
    };
    // why capturing: React's listeners, and so bb's, sit on its root, under the document.
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [coordinators, navigate]);
}
