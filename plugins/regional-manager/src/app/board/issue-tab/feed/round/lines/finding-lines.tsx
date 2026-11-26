// An open round's findings, a line each (fold-line.tsx): its mark (mark.tsx), its severity, its title
// and, muted, its place. The reviewer's come first, each with the verifier's triage once its verdict
// returned, then the verifier's own. Hovered or focused, a line's card shows its title, severity,
// origin, place, and the verifier's word and reason; pressed, the line opens to its claim, that word
// and reason, a bug's steps, and its full path. A blocking defect the verifier found is a line of the
// same kind, among what failed the round (verdict-lines.tsx).
import { useEffect, useId, type ReactNode } from "react";
import { ownEffect, type Effect, type RoundBody } from "../../../../../../model/feed/round.ts";
import { blocksWord, severityNow, triageWord, type BlockingDefect, type Severity } from "../../../../../../model/verdict/review.ts";
import type { VerifierFinding } from "../../../../../../model/verdict/verdict.ts";
import { useEscapeToClose } from "../../../../../ui/hold-escape.ts";
import type { CardPresence } from "../../../../issue/hover-card/card-intent.ts";
import { capStyle } from "../../../../issue/hover-card/hover-card.tsx";
import { useFollowingRowPlacement } from "../../../../issue/hover-card/placement.ts";
import type { HoverCards } from "../../../../issue/hover-card/use-hover-card.ts";
import { FoldLine } from "./fold-line.tsx";
import { Mark } from "./mark.tsx";

type Finding = RoundBody["findings"][number];
type Place = Pick<Finding, "file" | "line">;

/** `cards`: the open round's one card intent, so one card shows at a time across its lines. */
export function FindingLines({ findings, own, cards }: { findings: readonly Finding[]; own: readonly VerifierFinding[]; cards: HoverCards }) {
  if (findings.length === 0 && own.length === 0) return null;
  return (
    <ul className="rmi-lines" aria-label="Findings">
      {findings.map((finding, i) => (
        <ReviewFindingLine key={`r${i}`} cardKey={`r${i}`} finding={finding} cards={cards} />
      ))}
      {own.map((finding, i) => (
        <OwnFindingLine key={`v${i}`} cardKey={`v${i}`} finding={finding} cards={cards} />
      ))}
    </ul>
  );
}

/** A blocking defect the verifier found itself: it blocks the work, as what it breaks says. */
export function DefectLine({ cardKey, defect, cards }: { cardKey: string; defect: BlockingDefect; cards: HoverCards }) {
  const said = <Said word={blocksWord(defect)} reason={null} effect="blocks" />;
  return (
    <FindingLine
      cardKey={cardKey}
      cards={cards}
      severity="must-fix"
      effect="blocks"
      title={defect.title}
      place={null}
      facts={`must-fix · ${VERIFIERS_OWN}`}
      said={said}
      detail={
        <>
          <p className="rmi-fold-claim">{defect.claim}</p>
          {said}
          {defect.steps !== null && <Steps steps={defect.steps} />}
        </>
      }
    />
  );
}

// ------------------------------------------------------------------ layer 2

const VERIFIERS_OWN = "the verifier's own";

function ReviewFindingLine({ cardKey, finding, cards }: { cardKey: string; finding: Finding; cards: HoverCards }) {
  const { title, file, line, severity, claim, origin, triage } = finding;
  const effect = triage?.effect ?? null;
  const said = triage === null ? <Said word="Not triaged yet" reason={null} effect={null} /> : <Said word={triageWord(triage)} reason={triage.reason} effect={effect} />;
  return (
    <FindingLine
      cardKey={cardKey}
      cards={cards}
      severity={severityNow(severity, triage)}
      effect={effect}
      title={title}
      place={{ file, line }}
      facts={`${severity} · ${origin}`}
      said={said}
      detail={
        <>
          <p className="rmi-fold-claim">{claim}</p>
          {said}
          {triage?.result === "anchored" && triage.steps !== null && <Steps steps={triage.steps} />}
          <p className="rmi-fold-facts">
            <PlaceText file={file} line={line} /> · {severity} · {origin}
          </p>
        </>
      }
    />
  );
}

/** A finding the verifier made itself: it never blocks, so it goes to the follow-up, or stays a nit (round.ts ownEffect). */
function OwnFindingLine({ cardKey, finding, cards }: { cardKey: string; finding: VerifierFinding; cards: HoverCards }) {
  const facts = `${finding.severity} · ${VERIFIERS_OWN}`;
  return (
    <FindingLine
      cardKey={cardKey}
      cards={cards}
      severity={finding.severity}
      effect={ownEffect(finding.severity)}
      title={finding.title}
      place={null}
      facts={facts}
      said={null}
      detail={
        <>
          <p className="rmi-fold-claim">{finding.detail}</p>
          <p className="rmi-fold-facts">{facts}</p>
        </>
      }
    />
  );
}

type FindingLineProps = {
  cardKey: string;
  cards: HoverCards;
  /** How much it matters now: a downgraded finding's new severity. */
  severity: Severity;
  effect: Effect | null;
  title: string;
  place: Place | null;
  /** Its severity as found and its origin, in a line: "must-fix · new". */
  facts: string;
  /** The verifier's word on it, and why (null: none to give). */
  said: ReactNode;
  detail: ReactNode;
};

function FindingLine({ cardKey, cards, severity, effect, title, place, facts, said, detail }: FindingLineProps) {
  const cardId = useId();
  const presence = cards.presence(cardKey);
  return (
    <FoldLine
      line={
        <>
          <Mark severity={severity} effect={effect} />
          {/* why hidden: the mark's label names the severity, with what it does. */}
          <span className="rmi-line-severity" aria-hidden>
            {severity}
          </span>
          <span className="rmi-line-title" data-effect={effect ?? undefined}>
            {title}
          </span>
          {place !== null && (
            <span className="rmi-line-place">
              <bdi dir="ltr">{placeName(place)}</bdi>
            </span>
          )}
        </>
      }
      detail={detail}
      card={{
        id: cardId,
        trigger: cards.trigger(cardKey),
        close: presence.close,
        element: cards.shown === cardKey ? <FindingCard id={cardId} presence={presence} title={title} facts={facts} place={place} said={said} /> : null,
      }}
    />
  );
}

/**
 * A finding's hover card, Activity Sidebar's (hover-card.css): its title whole, its severity and
 * origin, its full place, and the verifier's word. Placed as a board row's card is (placement.ts):
 * under its line, or above it where the panel has no room below, capped and scrolling when it fits
 * on neither side; placed again as the panel scrolls or the window resizes, and put away once its
 * line can't be seen. Escape puts it away, wherever focus is. why no tab stop when capped: its line
 * opens on press to the same words, whole.
 */
function FindingCard({ id, presence, title, facts, place, said }: { id: string; presence: CardPresence; title: string; facts: string; place: Place | null; said: ReactNode }) {
  useEffect(() => presence.mounted(), [presence]);
  useEscapeToClose(true, presence.close);
  const { ref, body, placement } = useFollowingRowPlacement(presence.close);
  return (
    <div ref={ref} id={id} role="tooltip" className="rmi-card rmi-finding-card" data-side={placement.side} style={capStyle(placement)}>
      <div ref={body} className="rmi-card-body rmi-finding-card-body">
        <p className="rmi-card-title">{title}</p>
        <p className="rmi-fold-facts">{facts}</p>
        {place !== null && (
          <p className="rmi-fold-facts">
            <PlaceText {...place} />
          </p>
        )}
        {said}
      </div>
    </div>
  );
}

/** The verifier's word on a finding, in the colour of what it does, then why. */
const Said = ({ word, reason, effect }: { word: string; reason: string | null; effect: Effect | null }) => (
  <p className="rmi-said">
    <b data-effect={effect ?? undefined}>{word}.</b>
    {reason !== null && ` ${reason}`}
  </p>
);

/** A bug's normal-use steps, numbered. */
const Steps = ({ steps }: { steps: readonly string[] }) => (
  <ol className="rmi-fold-steps" aria-label="Steps">
    {steps.map((step, i) => (
      <li key={i}>{step}</li>
    ))}
  </ol>
);

/** A place on the line: its file's name and its line, the rest of its path in its card and detail. why the whole path when it ends in a slash: its name would be empty. */
const placeName = ({ file, line }: Place): string => `${file.slice(file.lastIndexOf("/") + 1) || file}${line === null ? "" : `:${line}`}`;

/**
 * A finding's path exactly as the reviewer wrote it, then its line. why the path in an isolate of
 * its own: a bidi mark or an unclosed override inside it ends there, so it can't reorder the line
 * after it.
 */
function PlaceText({ file, line }: Place) {
  return (
    <bdi dir="ltr" className="rmi-fold-place">
      <bdi dir="ltr" className="rmi-fold-file">
        {file}
      </bdi>
      {line !== null && `:${line}`}
    </bdi>
  );
}
