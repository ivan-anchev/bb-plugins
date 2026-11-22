const SIZES = {
  default: "size-3.5",
  small: "size-2.5",
  icon: "size-4",
} as const;

const TONES = {
  muted: "text-muted-foreground",
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
