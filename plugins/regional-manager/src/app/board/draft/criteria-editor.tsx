// A draft's done-criteria as a list of fields, 1 to 12, each growing to show its whole text. Enter
// starts the next criterion and Shift+Enter breaks the line, as in bb's composer, where Enter ends
// what you are writing; Backspace at a criterion's start joins it to the one above.
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { useId, useRef, type KeyboardEvent } from "react";
import { flushSync } from "react-dom";
import { MAX_CRITERIA, MAX_CRITERION_CHARS } from "../../../model/crew.ts";
import { Button } from "../../ui/button.tsx";
import { GrowingTextarea } from "../../ui/growing-textarea.tsx";
import { added, hasRoom, joined, removed, split, typed, type CriterionField, type Edited } from "./criteria.ts";

type CriteriaEditorProps = { fields: readonly CriterionField[]; onChange(fields: CriterionField[]): void };

export function CriteriaEditor({ fields, onChange }: CriteriaEditorProps) {
  const ids = useId();
  const textareas = useRef(new Map<number, HTMLTextAreaElement>());

  // why flushSync: the field that takes focus may be one this edit mounts.
  function apply({ fields: next, focus }: Edited) {
    flushSync(() => onChange(next));
    const textarea = textareas.current.get(focus.key);
    textarea?.focus();
    textarea?.setSelectionRange(focus.caret, focus.caret);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>, index: number) {
    if (event.nativeEvent.isComposing) return;
    const { selectionStart: start, selectionEnd: end } = event.currentTarget;
    if (event.key === "Enter" && !(event.shiftKey || event.metaKey || event.ctrlKey || event.altKey)) {
      // A full list takes no new line either: Enter never breaks one.
      event.preventDefault();
      const edit = split(fields, index, start, end);
      if (edit !== null) apply(edit);
    } else if (event.key === "Backspace" && start === 0 && end === 0) {
      const edit = joined(fields, index);
      if (edit === null) return;
      event.preventDefault();
      apply(edit);
    }
  }

  return (
    <div role="group" aria-labelledby={`${ids}-label`} className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <h3 id={`${ids}-label`} className="text-xs font-medium whitespace-nowrap text-muted-foreground">
          Done when
        </h3>
        {/* why not on touch: a touch keyboard has no Shift+Enter. Screen readers read it as each field's description. */}
        <p id={`${ids}-keys`} className="text-xs text-muted-foreground pointer-coarse:hidden">
          Enter adds a criterion · Shift+Enter breaks the line
        </p>
      </div>
      <ol className="flex flex-col gap-1.5">
        {fields.map((field, index) => (
          <li key={field.key} className="flex items-start gap-2">
            <span aria-hidden className="mt-px w-4 shrink-0 py-1.5 text-right text-xs leading-6 text-muted-foreground tabular-nums sm:leading-5">
              {index + 1}.
            </span>
            <GrowingTextarea
              ref={(textarea) => {
                if (textarea === null) return;
                textareas.current.set(field.key, textarea);
                return () => void textareas.current.delete(field.key);
              }}
              value={field.text}
              aria-label={`Done criterion ${index + 1}`}
              aria-describedby={`${ids}-keys`}
              maxLength={MAX_CRITERION_CHARS}
              onChange={(event) => onChange(typed(fields, field.key, event.target.value))}
              onKeyDown={(event) => onKeyDown(event, index)}
              placeholder="Checkable by running something"
            />
            {fields.length > 1 && (
              <Button variant="ghost" size="sm" aria-label={`Remove done criterion ${index + 1}`} onClick={() => apply(removed(fields, index))}>
                <Icon name="X" aria-hidden />
              </Button>
            )}
          </li>
        ))}
      </ol>
      <div className="pl-6">
        {hasRoom(fields) ? (
          <Button variant="ghost" size="sm" onClick={() => apply(added(fields))}>
            <Icon name="Plus" aria-hidden />
            Add a criterion
          </Button>
        ) : (
          <p className="py-1.5 text-xs text-muted-foreground">A crew has {MAX_CRITERIA} done-criteria at most.</p>
        )}
      </div>
    </div>
  );
}
