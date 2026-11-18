// A verdict under its row: how many criteria passed, the commit the verifier checked them at,
// a checkout that wasn't that commit on a clean tree, what CI said about that commit, then each
// criterion with its evidence. A failed or unverifiable criterion shows its evidence; a
// passed one keeps it folded, so what needs the user is what they see first.
import { experimental_Icon as Icon, useBbNavigate } from "@get-bb/plugin-sdk/app";
import { checkoutText, NOT_CLEAN } from "../../model/verdict/checkout.ts";
import { allPassed, ciVerdictOf, failedCheckout, outcome, type CriterionResult, type Verdict } from "../../model/verdict/verdict.ts";

type Judged = Extract<Verdict, { state: "returned" | "could-not-run" }>;

export function VerdictDetail({ id, verdict }: { id: string; verdict: Judged }) {
  return (
    // why the indents only on a wide board: on a narrow one they would leave the evidence a few words a line.
    <div id={id} className="mx-1 mb-2 flex flex-col gap-2.5 rounded-lg border border-border px-3 py-2.5 @md:mr-2 @md:ml-[2.75rem]">
      {verdict.state === "returned" ? <Returned verdict={verdict} /> : <CouldNotRun verdict={verdict} />}
    </div>
  );
}

function Returned({ verdict }: { verdict: Extract<Verdict, { state: "returned" }> }) {
  const passed = verdict.criteria.filter((check) => check.result === "pass").length;
  const result = outcome(verdict);
  // why: one on its way back to the agent failed its criteria, though nobody has been told yet.
  const look = result === "pending" && !allPassed(verdict) ? FAILED : HEADLINE[result];
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className={`flex items-center gap-1.5 text-sm font-medium ${look.text}`}>
          <Icon name={look.icon} aria-hidden className={`size-4 shrink-0 ${look.iconTone}`} />
          {passed} of {verdict.criteria.length} {verdict.criteria.length === 1 ? "criterion" : "criteria"} passed
        </p>
        <VerifierLink threadId={verdict.verifierThreadId} />
      </div>
      <CheckedBy sameModel={verdict.sameModel} headSha={verdict.headSha} />
      <CheckoutLine verdict={verdict} />
      <CiLine verdict={verdict} />
      <ol className="flex flex-col gap-1">
        {verdict.criteria.map((check, i) => (
          <Criterion key={i} number={i + 1} {...check} />
        ))}
      </ol>
      {verdict.findings.length > 0 && (
        <section className="flex flex-col gap-1">
          <h3 className="text-xs font-medium text-muted-foreground">Findings</h3>
          <ul className="flex list-disc flex-col gap-0.5 pl-4 text-xs">
            {verdict.findings.map((finding, i) => (
              <li key={i} className="whitespace-pre-wrap">
                {finding}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function CouldNotRun({ verdict }: { verdict: Extract<Verdict, { state: "could-not-run" }> }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
      <p className="flex min-w-0 items-start gap-1.5 text-sm">
        <Icon name="AlertTriangle" aria-hidden className="mt-0.5 size-4 shrink-0 text-warning-text" />
        <span className="min-w-0">
          <span className="font-medium">No verdict:</span> {verdict.reason}. Nobody has checked the work against its criteria.
        </span>
      </p>
      {verdict.verifierThreadId !== null && <VerifierLink threadId={verdict.verifierThreadId} />}
    </div>
  );
}

/** The checkout as bb's git plugin read it, when it wasn't the claimed commit on a clean tree, which fails the verdict whatever its criteria say. */
function CheckoutLine({ verdict }: { verdict: Extract<Verdict, { state: "returned" }> }) {
  const failed = failedCheckout(verdict);
  if (failed === null) return null;
  return (
    <p className="flex items-start gap-1.5 text-xs text-destructive-text">
      <Icon name="X" aria-hidden className="mt-px size-3.5 shrink-0" />
      <span className="min-w-0 [overflow-wrap:anywhere]">
        {NOT_CLEAN}. {checkoutText(verdict.headSha, failed)}
      </span>
    </p>
  );
}

/** What CI said about the commit the verifier checked, once the verdict settled or while it waits for it; nothing when there was none to check. */
function CiLine({ verdict }: { verdict: Extract<Verdict, { state: "returned" }> }) {
  const ci = ciVerdictOf(verdict);
  if (ci === null) {
    if (verdict.settlement.kind !== "waiting-for-ci") return null;
    return <p className="text-xs text-muted-foreground">Every criterion passed. Waiting for CI to finish on this commit before it counts.</p>;
  }
  switch (ci.kind) {
    case "none":
      return null;
    case "pass":
      return <p className="text-xs text-muted-foreground">CI passed on #{ci.number} at this commit.</p>;
    case "no-checks":
      return <p className="text-xs text-muted-foreground">No CI checks: GitHub reported none on #{ci.number} at this commit, after the wait for them.</p>;
    case "fail":
      return (
        <p className="text-xs text-destructive-text">
          CI failed on #{ci.number} at this commit
          {ci.failedChecks.length > 0 && <>: {ci.failedChecks.join(", ")}</>}.
        </p>
      );
    case "not-checked":
      return <p className="text-xs text-warning-text">CI not checked: {ci.reason}.</p>;
    default:
      return ci satisfies never;
  }
}

/** The commit the verifier checked, and whether the check wasn't independent. why no model: the board names none (the user's rule). */
function CheckedBy({ sameModel, headSha }: { sameModel: boolean; headSha: string }) {
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
      <span>
        Checked <span className="font-mono">{headSha.slice(0, 7)}</span>
      </span>
      {sameModel && <span className="text-warning-text">· the agent's own model: no other was available</span>}
    </p>
  );
}

function Criterion({ number, criterion, result, evidence }: { number: number; criterion: string; result: CriterionResult; evidence: string }) {
  const look = LOOK[result];
  return (
    <li>
      {/* why open unless passed: a failure's evidence is what the user came for; a pass's is there on demand. */}
      <details open={result !== "pass"} className="group">
        <summary className="flex cursor-pointer list-none items-start gap-2 rounded-md px-1 py-1 hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
          {/* why leading-5 and mt-[3px]: the label and icons center on the criterion's first line, however many it wraps to. */}
          <Icon name={look.icon} aria-hidden className={`mt-[3px] size-3.5 shrink-0 ${look.iconTone}`} />
          <span className="min-w-0 flex-1 text-sm leading-5 text-pretty">{criterion}</span>
          <span className={`shrink-0 text-xs leading-5 font-medium ${look.text}`}>{look.label}</span>
          <Icon name="ChevronRight" aria-hidden className="mt-[3px] size-3.5 shrink-0 text-muted-foreground transition-transform duration-150 group-open:rotate-90 motion-reduce:transition-none" />
        </summary>
        {/* why the tab stop: long output scrolls, and the keyboard scrolls only what has focus (REVIEW.md). */}
        <pre
          tabIndex={0}
          aria-label={`Evidence for criterion ${number}`}
          className="mt-1 mb-1 max-h-56 @md:ml-6 overflow-auto rounded-md bg-muted px-2.5 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {evidence}
        </pre>
      </details>
    </li>
  );
}

type Headline = { icon: string; iconTone: string; text: string };
const NEUTRAL: Headline = { icon: "Clock", iconTone: "text-muted-foreground", text: "" };
const FAILED: Headline = { icon: "X", iconTone: "", text: "text-destructive-text" };

// why by outcome: a verdict waiting for CI is neither verified nor failed yet.
const HEADLINE: Record<ReturnType<typeof outcome>, Headline> = {
  pass: { icon: "Check", iconTone: "text-success", text: "" },
  fail: FAILED,
  "waiting-for-ci": NEUTRAL,
  pending: NEUTRAL,
  "could-not-run": FAILED,
  superseded: NEUTRAL,
  unverified: NEUTRAL,
};

// why a pass's label is muted: green text fails contrast on the page, and the icon already says it.
const LOOK: Record<CriterionResult, { icon: string; iconTone: string; label: string; text: string }> = {
  pass: { icon: "Check", iconTone: "text-success", label: "Pass", text: "text-muted-foreground" },
  fail: { icon: "X", iconTone: "text-destructive-text", label: "Fail", text: "text-destructive-text" },
  unverifiable: { icon: "AlertTriangle", iconTone: "text-warning-text", label: "Unverifiable", text: "text-warning-text" },
};

function VerifierLink({ threadId }: { threadId: string }) {
  const navigate = useBbNavigate();
  return (
    <button
      type="button"
      onClick={() => navigate.toThread(threadId)}
      className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-sm text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      Open verifier thread
      <Icon name="ArrowUpRight" aria-hidden className="size-3" />
    </button>
  );
}
