// Show/Hide for a row the guide folds away. The row's reason sits beside it, never inside, so a
// link in the reason works on its own.
import { Button } from "../ui/button.tsx";

type ShowToggleProps = { open: boolean; subject: string; onToggle(): void };

/** A page has many rows that read "Show", so the button's name adds what it shows: "Show src/a.ts". */
export function ShowToggle({ open, subject, onToggle }: ShowToggleProps) {
  const verb = open ? "Hide" : "Show";
  return (
    <Button variant="ghost" size="small" aria-expanded={open} aria-label={`${verb} ${subject}`} onClick={onToggle}>
      {verb}
    </Button>
  );
}
