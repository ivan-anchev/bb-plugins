/** A section's title: quiet small words over its rows. Issue 02 makes the shelves' titles fold. */
export function SectionTitle({ label }: { label: string }) {
  return (
    <div className="as-section-title" role="heading" aria-level={2}>
      {label}
    </div>
  );
}

/** One line in place of the rows while they load or after they fail. */
export function Notice({ text }: { text: string }) {
  return (
    <div className="as-notice" role="status">
      {text}
    </div>
  );
}
