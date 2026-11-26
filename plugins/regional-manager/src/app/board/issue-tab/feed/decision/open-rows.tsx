// An open question's rows in its card: a numbered row per option, the one the regional manager
// recommended tagged so, then a last numbered row for the user's own words, whose Send shows once
// they type. Pressing a row, or its number while focus is in the card, answers with it; while the
// answer sends, its row says so and the others dim. None is ever disabled, so focus stays put, and
// when the rows leave, the card takes the focus they held.
import { useState, type KeyboardEvent } from "react";
import { MAX_ANSWER_CHARS, type AskedDecision, type DecisionId } from "../../../../../model/decision.ts";
import type { CoordinatorId } from "../../../../../model/role.ts";
import { Button } from "../../../../ui/button.tsx";
import { handFocusTo } from "../../../../ui/focus-hand-off.ts";
import { GrowingTextarea } from "../../../../ui/growing-textarea.tsx";
import { useAnswerDraft } from "../../../answer-draft.ts";

type OpenRowsProps = {
  coordinatorId: CoordinatorId;
  decision: AskedDecision;
  /** The answer on its way, null for none. */
  sent: string | null;
  /** Sends an answer; whether it went (not while another is on its way). */
  send(text: string): boolean;
};

// why a module constant: a stable ref runs its cleanup only as the rows leave, while focus is still in them.
const handFocusToCard = handFocusTo((rows) => rows.closest<HTMLElement>(".rmi-decision"));

export function OpenRows({ coordinatorId, decision, sent, send }: OpenRowsProps) {
  const { options, recommended } = decision;
  // The row whose answer is on its way, by its number. why kept, not matched by the answer's words:
  // words typed in the last row may be an option's too, and the row that sent them says so.
  const [pressed, setPressed] = useState<number | null>(null);
  const busy = sent !== null;
  const sendingRow = busy ? pressed : null;
  const sendFrom = (number: number) => (text: string) => {
    if (send(text)) setPressed(number);
  };
  const own = options.length + 1;
  return (
    <ul ref={handFocusToCard} aria-label="Options" className="rmi-q-rows" data-busy={busy || undefined}>
      {options.map((option, index) => (
        <li key={option}>
          <OptionRow number={index + 1} option={option} recommended={option === recommended} busy={busy} sending={sendingRow === index + 1} onPress={() => sendFrom(index + 1)(option)} />
        </li>
      ))}
      <li>
        <OwnWordsRow coordinatorId={coordinatorId} decisionId={decision.id} number={own} alone={options.length === 0} busy={busy} sending={sendingRow === own} send={sendFrom(own)} />
      </li>
    </ul>
  );
}

/**
 * A key pressed while focus is in an open question's card: 1–N press that option's row, N+1 goes to
 * the field for the user's own words, and ↑/↓ move between the rows. The field keeps the keys typed
 * into it, but ↑ at its start goes back up to the options.
 */
export function pressAnswerKey(event: KeyboardEvent<HTMLElement>): void {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  // why by their shortcut: every row, and nothing else in the card, names the key that reaches it.
  const rows = [...event.currentTarget.querySelectorAll<HTMLElement>("[aria-keyshortcuts]")];
  const row = rowFor(event, rows);
  if (row === undefined) return;
  event.preventDefault();
  // why: bb's own shortcuts must not take a key that answered the question.
  event.stopPropagation();
  if (/^[1-9]$/.test(event.key) && row instanceof HTMLButtonElement) row.click();
  else row.focus();
}

/** The row a key reaches from where focus is now, if any. */
function rowFor(event: KeyboardEvent<HTMLElement>, rows: readonly HTMLElement[]): HTMLElement | undefined {
  const field = event.target instanceof HTMLTextAreaElement ? event.target : null;
  // why by the whole row: focus on the last row's Send is on that row too.
  const at = rows.findIndex((row) => rowOf(row).contains(document.activeElement));
  if (field === null && /^[1-9]$/.test(event.key)) return rows[Number(event.key) - 1];
  if (field === null && event.key === "ArrowDown") return rows[at + 1];
  if (event.key === "ArrowUp" && (field === null || caretAtStart(field)) && at > 0) return rows[at - 1];
  return undefined;
}

/** The row a row's shortcut element sits in: an option's button is its row; the field sits in the last row's form. */
const rowOf = (keyed: HTMLElement): Element => keyed.closest(".rmi-q-row") ?? keyed;

const caretAtStart = (field: HTMLTextAreaElement): boolean => field.selectionStart === 0 && field.selectionEnd === 0;

type OptionRowProps = { number: number; option: string; recommended: boolean; busy: boolean; sending: boolean; onPress(): void };

function OptionRow({ number, option, recommended, busy, sending, onPress }: OptionRowProps) {
  return (
    // why aria-disabled, not disabled: a disabled button drops focus to the page while the answer sends.
    <button type="button" className="rmi-q-row" aria-keyshortcuts={String(number)} aria-disabled={busy} data-sending={sending || undefined} onClick={onPress}>
      <RowKey number={number} sending={sending} />
      <span className="rmi-q-label">{option}</span>
      {sending ? <Sending /> : recommended && <span className="rmi-q-tag">Recommended</span>}
    </button>
  );
}

type OwnWordsRowProps = { coordinatorId: CoordinatorId; decisionId: DecisionId; number: number; alone: boolean; busy: boolean; sending: boolean; send(text: string): void };

/** The user's own words: a field the browser keeps until the answer lands, wherever it was typed. `alone`: the question offers no options. */
function OwnWordsRow({ coordinatorId, decisionId, number, alone, busy, sending, send }: OwnWordsRowProps) {
  const { draft, type, onKeyDown } = useAnswerDraft(coordinatorId, decisionId, send);
  return (
    <form
      className="rmi-q-row rmi-q-own"
      data-sending={sending || undefined}
      onSubmit={(event) => {
        event.preventDefault();
        send(draft);
      }}
    >
      <RowKey number={number} sending={sending} />
      <GrowingTextarea
        value={draft}
        onChange={(event) => type(event.target.value)}
        onKeyDown={onKeyDown}
        readOnly={busy}
        maxLength={MAX_ANSWER_CHARS}
        aria-keyshortcuts={String(number)}
        aria-label={alone ? "Your answer" : "Your answer, in your own words"}
        placeholder={alone ? "Type your answer" : "Something else…"}
      />
      {sending && <Sending />}
      {/* why kept while it sends: focus on it would drop to the page. */}
      {draft.trim() !== "" && (
        <Button type="submit" variant="default" size="xs" aria-disabled={busy}>
          Send
        </Button>
      )}
    </form>
  );
}

/** A row's number, or a spinner while its answer sends. */
function RowKey({ number, sending }: { number: number; sending: boolean }) {
  return (
    <span className="rmi-q-key" aria-hidden>
      {/* why motion-safe: under Reduce motion the ring stands still, and the row's Sending… says it. */}
      {sending ? <span className="rmi-q-spin motion-safe:animate-spin" /> : number}
    </span>
  );
}

const Sending = () => (
  <span role="status" className="rmi-q-side">
    Sending…
  </span>
);
