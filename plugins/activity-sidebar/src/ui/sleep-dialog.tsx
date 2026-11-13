// Sleep → Custom…: a day and a time of your own, from a minute ahead, opening on tomorrow at 9
// (Z:screens/shell/sidebar.luau:1523-1565). bb's host shims Radix, so the dialog shares its overlay layer.
import { Close, Content, Description, Overlay, Portal, Root, Title } from "@radix-ui/react-dialog";
import { useState, type FormEvent } from "react";
import { useMinute } from "../data/use-minute.ts";
import { customUntil, localInputValue, tomorrowMorning } from "../model/sleep.ts";
import { clock, monthDay, weekday } from "../model/time.ts";
import { PORTAL_SCOPE } from "./portal-scope.ts";

const MINUTE = 60_000;

type Props = {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** Sleep pressed on a moment still ahead. */
  onSleep(until: number): void;
  /** Opened from a menu, the dialog has no Trigger: whoever opened it says where focus goes back to. */
  onCloseAutoFocus(event: Event): void;
};

/** Sleep hands back the moment chosen; Cancel, Escape or a click outside closes. */
export function SleepDialog({ open, onOpenChange, onSleep, onCloseAutoFocus }: Props) {
  return (
    <Root open={open} onOpenChange={onOpenChange}>
      <Portal>
        <Overlay {...PORTAL_SCOPE} className="as-dialog-overlay" />
        <Content {...PORTAL_SCOPE} className="as-dialog" onCloseAutoFocus={onCloseAutoFocus}>
          <SleepForm onSleep={onSleep} />
        </Content>
      </Portal>
    </Root>
  );
}

// ------------------------------------------------------------------ layer 2

/** Mounted per opening, so each one starts again on tomorrow at 9. */
function SleepForm({ onSleep }: { onSleep(until: number): void }) {
  const now = useMinute();
  const [value, setValue] = useState(() => localInputValue(tomorrowMorning(new Date(now))));
  const until = customUntil(value, now);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    // why: checked against the present, not the list's minute, so a moment just passed is refused.
    const at = customUntil(value, Date.now());
    if (at !== null) onSleep(at);
  };

  return (
    <form className="as-dialog-form" onSubmit={submit}>
      <Title className="as-dialog-title">Sleep until</Title>
      <Description className="as-dialog-when">{until === null ? "Pick a time that's still ahead" : untilWhen(until)}</Description>
      <input
        type="datetime-local"
        className="as-dialog-input"
        aria-label="Sleep until"
        required
        value={value}
        min={localInputValue(now + MINUTE)}
        onChange={(e) => setValue(e.currentTarget.value)}
      />
      <div className="as-dialog-actions">
        <Close asChild>
          <button type="button" className="as-button">
            Cancel
          </button>
        </Close>
        <button type="submit" className="as-button" data-primary="" disabled={until === null}>
          Sleep
        </button>
      </div>
    </form>
  );
}

/** "Sat, Nov 14 at 9:00 AM": what Sleep will do (Zeron's shell.activity.sleep.until_when). */
function untilWhen(at: number): string {
  return `${weekday(at)}, ${monthDay(at)} at ${clock(at)}`;
}
