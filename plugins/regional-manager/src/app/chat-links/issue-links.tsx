// Issue links in chat, experimental: a regional manager names an issue to the user as its link
// (model/issue/link), and in any message bb renders it shows as the issue's live glyph and its id,
// mid-sentence; resting on it or focusing it shows the Board's hover card, and pressing it opens the
// issue's tab beside the Board. One overlay per app window finds the links (decorated-links.ts) and
// draws each glyph into its link from the board's read, which changes as the board does, while the
// message never renders again. Without the plugin, the link reads as its id.
import "../board/issue/issue-board.css";
import "./chat-links.css";
import { createPortal } from "react-dom";
import type { IssueLink } from "../../model/issue/link/issue-link.ts";
import { IssueGlyph } from "../board/issue/status-glyph.tsx";
import { useBoardIssue } from "../board/use-board-issue.ts";
import { useDecoratedLinks } from "./decorated-links.ts";
import { LinkCard } from "./link-card.tsx";
import { useOpenOnClick } from "./open-on-click.ts";

export const issueLinks = { id: "issue-links", component: IssueLinks };

function IssueLinks() {
  const links = useDecoratedLinks();
  useOpenOnClick();
  return (
    <>
      {links.map(({ key, link, slot }) => createPortal(<LinkGlyph link={link} />, slot, String(key)))}
      <LinkCard />
    </>
  );
}

// ------------------------------------------------------------------ layer 2

/**
 * The issue's glyph and a space before its id, as its board reads now; none until the read has it,
 * for an issue its board has none of, or while the board can't be read, when a glyph would show a
 * status the plugin can't vouch for (its card says why).
 */
function LinkGlyph({ link }: { link: IssueLink }) {
  const { read, issue } = useBoardIssue(link.coordinatorId, link.issueId);
  return issue === undefined || read.error !== null ? null : (
    <>
      <IssueGlyph issue={issue} />{" "}
    </>
  );
}
