// The bar under the guide. On the overview it starts the walkthrough; on a step it reads
// `‹ n / N ›`, and each arrow's tooltip names where it leads.
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { Button } from "../ui/button.tsx";
import { Tooltip } from "../ui/tooltip.tsx";
import type { Walkthrough } from "./use-walkthrough.ts";

export function Controller({ walkthrough }: { walkthrough: Walkthrough }) {
  const { place, total, next, previous } = walkthrough;
  return (
    <nav aria-label="Walkthrough" className="flex shrink-0 items-center justify-center gap-1.5 px-7 pt-2.5 pb-3.5">
      {place.kind === "overview" ? (
        <Button variant="primary" onClick={next}>
          Start the walkthrough · {total} {total === 1 ? "step" : "steps"}
        </Button>
      ) : (
        <>
          <Arrow icon="ChevronLeft" label="Previous" leadsTo={place.previousTitle} shortcut="←" onClick={previous} />
          <span aria-live="polite" className="min-w-16 text-center text-[13px] tabular-nums text-muted-foreground">
            {place.number} / {total}
          </span>
          <Arrow icon="ChevronRight" label="Next" leadsTo={place.nextTitle ?? "Back to the overview"} shortcut="→" onClick={next} />
        </>
      )}
    </nav>
  );
}

type ArrowProps = { icon: string; label: string; leadsTo: string; shortcut: string; onClick(): void };

function Arrow({ icon, label, leadsTo, shortcut, onClick }: ArrowProps) {
  return (
    <Tooltip
      content={
        <>
          {leadsTo}
          <kbd className="ml-2 font-sans text-muted-foreground">{shortcut}</kbd>
        </>
      }
    >
      {(describedBy) => (
        <Button variant="ghost" aria-label={label} aria-describedby={describedBy} onClick={onClick}>
          <Icon name={icon} className="size-4" aria-hidden />
        </Button>
      )}
    </Tooltip>
  );
}
