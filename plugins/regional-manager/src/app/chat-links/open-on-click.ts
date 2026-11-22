// A press on an issue link opens the issue's tab in its regional manager's side panel, which is where
// an issue lives: in the pane the link is in, when that is the manager's; from any other pane, or
// with ⌘ or Ctrl, the manager's thread opens in a split, as bb's own links do, or comes forward where
// it shows, and the pane showing it opens the tab (panes.tsx). The press is the plugin's before
// bb's, which would follow the link: caught on the way down, and kept from bb. A press with Shift or
// Alt, and a link to a manager the plugin doesn't know of, or doesn't know of yet, are bb's, which
// follows it to the panel (issue-landing.tsx).
import { experimental_useRpcQuery, useBbNavigate } from "@get-bb/plugin-sdk/app";
import { useEffect } from "react";
import { coordinatorContract as contract } from "../../contract.ts";
import { useIssueLinkAt } from "./decorated-links.ts";
import { openIssueTabIn, threadOfPane } from "./panes.tsx";

export function useOpenOnClick(): void {
  const navigate = useBbNavigate();
  const linkAt = useIssueLinkAt();
  const coordinators = experimental_useRpcQuery({ contract, method: "coordinators", input: {} }).data?.coordinators;
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const found = linkAt(event.target);
      const managerThread = coordinators?.find(({ id }) => id === found?.link.coordinatorId)?.threadId;
      if (found === null || managerThread === undefined || event.button !== 0 || event.shiftKey || event.altKey) return;
      event.preventDefault();
      event.stopPropagation();
      openIssueTabIn(managerThread, found.link.issueId);
      const inPlace = !event.metaKey && !event.ctrlKey && threadOfPane(found.anchor) === managerThread;
      if (!inPlace) navigate.toThread(managerThread, { split: true });
    };
    // why capturing: React's listeners, and so bb's, sit on its root, under the document.
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [coordinators, navigate, linkAt]);
}
