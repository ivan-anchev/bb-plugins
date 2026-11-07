// A spinning ring for work in progress, decoration only: what is in progress is said in text beside it.
const SIZES = {
  default: "size-3.5 border-2",
  small: "size-2.5 border-[1.5px]",
} as const;

export function Spinner({ size = "default" }: { size?: keyof typeof SIZES }) {
  return <span aria-hidden className={`inline-block shrink-0 animate-spin rounded-full border-muted-foreground border-t-transparent motion-reduce:animate-none ${SIZES[size]}`} />;
}
