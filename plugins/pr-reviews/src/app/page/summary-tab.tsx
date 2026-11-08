// The Summary tab: the author's description, and on its right the side panel with the PR's
// reviewers, checks and labels. Below 600px the side panel drops away, and a PR with none of them
// has no side panel: either way the description takes the width. It scrolls with its tab panel.
import type { PrDetail } from "../../contract.ts";
import { PROSE_TYPE } from "../guide/page-text.tsx";
import { Prose } from "../ui/prose.tsx";
import { hasSidePanel, SidePanel, useSidePanelFocus } from "./side-panel.tsx";

// The layout tops out at the Guide overview's width (880px) plus the gap and the side panel, so the
// description runs as wide as the overview's text and the side panel stays beside it on a wide panel.
export function SummaryTab({ pr }: { pr: PrDetail }) {
  const sidePanel = hasSidePanel(pr);
  const sidePanelFocus = useSidePanelFocus();
  return (
    <div ref={sidePanelFocus.tab} className="@container">
      <div className={`grid max-w-[1136px] items-start gap-9 px-7 pt-6 pb-16 ${sidePanel ? WITH_SIDE_PANEL : "grid-cols-[minmax(0,1fr)]"}`}>
        <Description author={pr.author} body={pr.body} />
        {sidePanel && <SidePanel pr={pr} focus={sidePanelFocus} />}
      </div>
    </div>
  );
}

const WITH_SIDE_PANEL = "grid-cols-[minmax(0,1fr)_220px] @max-[600px]:grid-cols-[minmax(0,1fr)]";

function Description({ author, body }: { author: string; body: string }) {
  if (body.trim() === "") return <p className="text-sm text-muted-foreground">No description provided.</p>;
  return (
    <section aria-label="Description" className={CONTAIN_BODY}>
      <p className="text-xs text-subtle-foreground">{author} wrote</p>
      <Prose text={body} className={PROSE_TYPE} />
    </section>
  );
}

// why: the author's body is any markdown, so the column holds it in:
// - its track is `minmax(0,1fr)`: the implicit `auto` track grows to the body's widest table and
//   carries the text past the column.
// - bb lets a table break out of the text as far as the nearest ancestor that clips overflow (in
//   chat, the timeline). Clipping the column stops it there, and a zero start offset (bb's own
//   setting for indented blocks) keeps it on the text's edges, scrolling inside its own wrapper.
const CONTAIN_BODY = "grid grid-cols-[minmax(0,1fr)] gap-2.5 overflow-x-clip [--md-table-start-offset:0px]";
