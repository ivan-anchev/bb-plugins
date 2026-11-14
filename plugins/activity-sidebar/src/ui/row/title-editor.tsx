// A row's title, renamed in place: the title selected, Enter or
// leaving keeps a changed name, Escape or an empty field keeps the old one. `onDone` says whether a
// key ended it (Enter, Escape) rather than focus leaving.
import { useSdk } from "@get-bb/plugin-sdk/app";
import { useLayoutEffect, useRef } from "react";
import { toast } from "sonner";

/** Zeron's longest title. */
const MAX_TITLE = 200;

export function TitleEditor({ threadId, title, onDone }: { threadId: string; title: string; onDone(byKey: boolean): void }) {
  const sdk = useSdk();
  const input = useRef<HTMLInputElement>(null);
  const done = useRef(false);

  useLayoutEffect(() => {
    const el = input.current;
    if (el === null) return;
    el.focus({ preventScroll: true });
    el.select();
  }, []);

  // why: Enter or Escape ends it and unmounts the field, whose blur then must not commit a second time.
  const finish = (value: string, keep: boolean, byKey: boolean) => {
    if (done.current) return;
    done.current = true;
    const next = value.trim();
    if (keep && next !== "" && next !== title) {
      sdk.threads.update({ threadId, title: next }).catch(() => toast.error("Failed to rename thread."));
    }
    onDone(byKey);
  };

  return (
    <input
      ref={input}
      className="as-title-input"
      defaultValue={title}
      maxLength={MAX_TITLE}
      aria-label="Thread name"
      onKeyDown={(e) => {
        // why: the list's ↑/↓ and the host's shortcuts stay out of the field.
        e.stopPropagation();
        // why: Enter while an input method composes picks the composed text; it doesn't rename yet.
        if (e.nativeEvent.isComposing) return;
        if (e.key === "Enter") finish(e.currentTarget.value, true, true);
        else if (e.key === "Escape") finish(e.currentTarget.value, false, true);
      }}
      onBlur={(e) => finish(e.currentTarget.value, true, false)}
    />
  );
}
