// A code review comment: a speech bubble with `< >` inside, as GitHub's code-review octicon draws
// it. bb has no such icon, so it is drawn here as bb's are: 16px, a ~1.4px round stroke in the text
// colour. Decoration only: the control it sits in carries the name.
export function CodeReviewIcon({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className}>
      <path d="M3.5 2.5h9A1.5 1.5 0 0 1 14 4v6a1.5 1.5 0 0 1-1.5 1.5h-5L4.5 14v-2.5h-1A1.5 1.5 0 0 1 2 10V4a1.5 1.5 0 0 1 1.5-1.5Z" />
      <path d="M6.5 5.25 5 7l1.5 1.75M9.5 5.25 11 7 9.5 8.75" />
    </svg>
  );
}
