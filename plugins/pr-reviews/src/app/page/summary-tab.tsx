import type { ReviewThread } from "../../comments/thread-schema.ts";
import type { PrDetail } from "../../contract.ts";
import { ActivitySection } from "../activity/activity-section.tsx";
import type { PrTarget } from "../queries.ts";
import { Prose, READING_TYPE } from "../ui/prose.tsx";
import { directImages } from "./direct-images.ts";
import { hasSidePanel, SidePanel, useSidePanelFocus } from "./side-panel.tsx";

type SummaryTabProps = { target: PrTarget; pr: PrDetail; onShowThread(thread: ReviewThread): void };

export function SummaryTab({ target, pr, onShowThread }: SummaryTabProps) {
  const sidePanel = hasSidePanel(pr);
  const sidePanelFocus = useSidePanelFocus();
  return (
    <div ref={sidePanelFocus.tab} className="@container">
      <div className={`grid max-w-[1136px] items-start gap-9 px-6 pt-6 pb-16 ${sidePanel ? WITH_SIDE_PANEL : "grid-cols-[minmax(0,1fr)]"}`}>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-10">
          <Description body={pr.body} />
          <ActivitySection target={target} pr={pr} onShowThread={onShowThread} />
        </div>
        {sidePanel && <SidePanel pr={pr} focus={sidePanelFocus} />}
      </div>
    </div>
  );
}

const WITH_SIDE_PANEL = "grid-cols-[minmax(0,1fr)_220px] @max-[600px]:grid-cols-[minmax(0,1fr)]";

function Description({ body }: { body: string }) {
  if (body.trim() === "") return <p className="text-sm text-muted-foreground">No description provided.</p>;
  return (
    <section ref={directImages} aria-label="Description" className={CONTAIN_BODY}>
      <Prose text={body} className={`${READING_TYPE} ${FULL_SIZE_IMAGES}`} />
    </section>
  );
}

const CONTAIN_BODY = "grid grid-cols-[minmax(0,1fr)] gap-2.5 overflow-x-clip [--md-table-start-offset:0px]";

const FULL_SIZE_IMAGES = "[&_img]:max-h-none";
