// The card: a header, six months of merged PRs as a calendar grid (one cell
// per day, weeks as columns, newest on the right), and two captions.
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { levelScale, weekday, type Day } from "./days.ts";
import { dayFormat, monthFormat, plural } from "./format.ts";
import { useScrub } from "./useScrub.tsx";

export function ActivityCard(props: { days: readonly Day[]; today: number; caption: string }) {
  const { days, today } = props;
  const weeks = Math.ceil(days.length / 7);
  const level = levelScale(days.map((d) => d.prs));
  const scrub = useScrub({
    count: days.length,
    describe: (i) => describeDay(days[i]!),
  });

  return (
    <div className="hp-card ag-card" ref={scrub.rootRef}>
      <div className="hp-head">
        <Icon name="GithubLogo" className="hp-icon" aria-hidden />
        <span>Activity</span>
      </div>

      <div
        {...scrub.plotProps}
        className="ag-grid"
        role="img"
        aria-label={`PRs merged per day, last ${weeks} weeks. Use arrow keys to read each day.`}
        style={{ gridTemplateColumns: `repeat(${weeks}, minmax(0, 1fr))` }}
      >
        {days.map((d, i) => (
          <span
            key={d.start}
            data-i={i}
            data-level={level(d.prs)}
            data-active={scrub.active === i ? "" : undefined}
            data-today={d.start === today ? "" : undefined}
            className="ag-cell"
            style={{ gridRow: weekday(d.start) + 1, gridColumn: Math.floor(i / 7) + 1 }}
          />
        ))}
      </div>

      <div className="ag-foot">
        <span className="hp-caption">{props.caption}</span>
        <span className="hp-caption ag-range">
          {monthFormat.format(days[0]!.start)} – {monthFormat.format(today)}
        </span>
      </div>
      {scrub.tooltip}
    </div>
  );
}

function describeDay(d: Day): string {
  return d.prs === 0
    ? `${dayFormat.format(d.start)} · No PRs merged`
    : `${dayFormat.format(d.start)} · ${plural(d.prs, "PR")} merged · ${plural(d.lines, "line")}`;
}
