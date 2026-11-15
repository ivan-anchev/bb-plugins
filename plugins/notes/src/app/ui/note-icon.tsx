// The notes glyph: Lucide's sticky-note (ISC), the same artwork as the plugin's branding
// (sticky-note.svg). bb has no sticky note among its icons, so app.tsx registers this one under
// NOTE_ICON, and every surface, host-rendered or the plugin's own, draws it by that name.

export const NOTE_ICON = "notes-sticky-note";

export function NoteIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8Z" />
      <path d="M15 3v4a2 2 0 0 0 2 2h4" />
    </svg>
  );
}
