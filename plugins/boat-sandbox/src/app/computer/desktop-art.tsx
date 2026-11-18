// The Computer card's picture: a placeholder desktop (a browser window, a terminal in front of it, a dock)
// on a dotted wallpaper. Every colour is a bb theme token, so it follows the user's theme.
import { useId, type CSSProperties } from "react";

const MONO: CSSProperties = { fontFamily: "var(--font-mono)", fontSize: 7.5 };

/** Fills and strokes take `var()` only through `style`, not as SVG attributes. */
const paint = (fill: string, stroke?: string): CSSProperties => ({ fill: `var(${fill})`, ...(stroke === undefined ? {} : { stroke: `var(${stroke})` }) });

export function DesktopArt() {
  // why useId: a split layout draws one card per pane, and pattern ids are page-global.
  const dots = useId();
  return (
    <svg viewBox="0 0 320 120" className="block h-auto w-full" aria-hidden>
      <defs>
        <pattern id={dots} width="10" height="10" patternUnits="userSpaceOnUse">
          <circle cx="5" cy="5" r="0.9" style={paint("--border")} />
        </pattern>
      </defs>
      <rect width="320" height="120" fill={`url(#${dots})`} />
      <BrowserWindow />
      <Terminal />
      <Dock />
    </svg>
  );
}

function BrowserWindow() {
  return (
    <g>
      <rect x="50.5" y="14.5" width="156" height="80" rx="6" style={paint("--card", "--border")} />
      <path d="M50.5 27.5h156" style={paint("--border", "--border")} />
      {[60, 67, 74].map((cx) => <circle key={cx} cx={cx} cy="21" r="2" style={paint("--subtle-foreground")} />)}
      <rect x="86" y="18.5" width="84" height="5" rx="2.5" style={paint("--muted")} />
      <rect x="62" y="37" width="58" height="6" rx="3" style={paint("--subtle-foreground")} />
      {[{ y: 50, width: 120 }, { y: 58, width: 104 }, { y: 66, width: 112 }, { y: 74, width: 76 }].map(({ y, width }) => (
        <rect key={y} x="62" y={y} width={width} height="4" rx="2" style={paint("--muted")} />
      ))}
    </g>
  );
}

function Terminal() {
  return (
    <g>
      <rect x="150.5" y="44.5" width="116" height="54" rx="6" style={paint("--background", "--border")} />
      <text x="160" y="61" style={{ ...MONO, ...paint("--muted-foreground") }}>~ $ npm test</text>
      <text x="160" y="73" style={{ ...MONO, ...paint("--success") }}>✓ 24 passed</text>
      <text x="160" y="85" style={{ ...MONO, ...paint("--muted-foreground") }}>~ $</text>
      <rect x="178" y="79" width="4.5" height="8" style={paint("--foreground")} />
    </g>
  );
}

function Dock() {
  const icons = ["--subtle-foreground", "--file-accent", "--muted-foreground", "--subtle-foreground"];
  return (
    <g>
      <rect x="124.5" y="103.5" width="71" height="12" rx="4" style={paint("--surface-raised", "--border")} />
      {icons.map((fill, index) => <rect key={index} x={133 + index * 15} y="106" width="7" height="7" rx="2" style={paint(fill)} />)}
    </g>
  );
}
