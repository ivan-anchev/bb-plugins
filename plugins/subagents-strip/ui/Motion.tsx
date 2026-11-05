// Status changes morph, never swap (R5): text rolls out and in with a small
// blur, digits roll, the status dot scales across. The motion lives in
// roster.css; these components keep the leaving copy until its animation ends.
import { useState } from "react";
import type { DelegateStatus } from "../delegate.ts";

/** Text that rolls the old line out and the new one in whenever it changes. */
export function RollingText({ text, className }: { text: string; className: string }) {
  const { current, leaving, drop } = useRoll(text);
  return (
    <span className={`sr-roll ${className}`}>
      {leaving.map((l) => (
        <span key={l.key} className="sr-roll-out" aria-hidden onAnimationEnd={() => drop(l.key)}>{l.value}</span>
      ))}
      <span key={current.key} className={current.key > 0 ? "sr-roll-in" : undefined} title={text}>{text}</span>
    </span>
  );
}

/** A count whose changed digits roll: up when it grows, down when it shrinks. */
export function RollingNumber({ value }: { value: number }) {
  const [last, setLast] = useState({ value, dir: "up" as Direction });
  if (last.value !== value) setLast({ value, dir: value > last.value ? "up" : "down" });
  const digits = String(value);
  return (
    <span className="sr-num">
      {/* why: keyed by length, so a count gaining a digit repaints instead of rolling misaligned columns. */}
      {[...digits].map((digit, i) => <RollingDigit key={`${digits.length}:${i}`} digit={digit} dir={last.dir} />)}
    </span>
  );
}

/** The status dot: bottom-right, cut out by a ring; a change scales the old dot out and the new one in. */
export function StatusDot({ status }: { status: DelegateStatus }) {
  const { current, leaving, drop } = useRoll(status);
  return (
    <>
      {leaving.map((l) => (
        <span key={l.key} className="sr-dot sr-dot-out" data-st={l.value} onAnimationEnd={() => drop(l.key)} />
      ))}
      <span key={current.key} className={current.key > 0 ? "sr-dot sr-dot-in" : "sr-dot"} data-st={current.value} />
    </>
  );
}

// ---------------------------------------------------------------- layer 2

type Direction = "up" | "down";
type Roll<T> = { key: number; value: T; dir: Direction };

function RollingDigit({ digit, dir }: { digit: string; dir: Direction }) {
  const { current, leaving, drop } = useRoll(digit, dir);
  return (
    <span className="sr-dg">
      {leaving.map((l) => (
        <span key={l.key} className={`sr-dg-out-${l.dir}`} aria-hidden onAnimationEnd={() => drop(l.key)}>{l.value}</span>
      ))}
      <span key={current.key} className={current.key > 0 ? `sr-dg-in-${current.dir}` : undefined}>{current.value}</span>
    </span>
  );
}

/**
 * The value now, plus earlier values still animating out. A change during
 * render re-keys the current value (so its entrance plays) and moves the old
 * one to `leaving`; its element calls `drop` when its exit animation ends.
 */
function useRoll<T>(value: T, dir: Direction = "up") {
  const [roll, setRoll] = useState<{ current: Roll<T>; leaving: readonly Roll<T>[] }>({
    current: { key: 0, value, dir },
    leaving: [],
  });
  if (roll.current.value !== value) {
    // why: the old copy leaves in the same direction the new one enters.
    setRoll({ current: { key: roll.current.key + 1, value, dir }, leaving: [...roll.leaving, { ...roll.current, dir }] });
  }
  const drop = (key: number) => setRoll((r) => ({ ...r, leaving: r.leaving.filter((l) => l.key !== key) }));
  return { current: roll.current, leaving: roll.leaving, drop };
}
