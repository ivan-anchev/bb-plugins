// A spinning arc on a faint ring, for work in progress, decoration only: what is in progress is
// said in text beside it, or in its button's name. An svg drawn in its colour, so it reads on any
// fill, and a theme that styles a button by its lone icon (Zeron's round send) styles it the same.
const SIZES = {
  default: "size-3.5",
  small: "size-2.5",
  /** An icon's, where it stands in for one. */
  icon: "size-4",
} as const;

const TONES = {
  muted: "text-muted-foreground",
  /** Its parent's ink, as on a filled button. */
  inherit: "",
} as const;

type SpinnerProps = { size?: keyof typeof SIZES; tone?: keyof typeof TONES };

export function Spinner({ size = "default", tone = "muted" }: SpinnerProps) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      className={`shrink-0 animate-spin motion-reduce:animate-none ${SIZES[size]} ${TONES[tone]}`}
    >
      <circle cx="8" cy="8" r="6.5" strokeOpacity="0.25" />
      <path d="M8 1.5a6.5 6.5 0 0 1 6.5 6.5" strokeLinecap="round" />
    </svg>
  );
}
