// The Computer glyph: Lucide's monitor (ISC). bb's icon set has no monitor, so app.tsx registers this one
// under MONITOR_ICON for the Computer tab and its New tab row.

export const MONITOR_ICON = "boat-sandbox-monitor";

export function MonitorIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect width="20" height="14" x="2" y="3" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  );
}
