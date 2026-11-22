// The chevron at a disclosure's start (a handoff, a criterion): right while folded, down while open
// (issue-tab.css `.rmi-disclose`).
export function DiscloseGlyph() {
  return (
    <svg className="rmi-disclose" width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}
