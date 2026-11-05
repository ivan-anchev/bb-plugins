# Review rules

Findings that came up repeatedly in review here and were fixed every time. Flag them on sight.

## Always flag

- Refresh or retry paths that leave a failed read in place: Refresh and reselection must re-read failed or cached-failed results (use the SDK query's refetch), and errors must show next to any data still displayed.
- Hover- or focus-revealed popups (tooltips, hover cards) that break dismiss, hover, or focus rules: Escape must close them wherever focus is, they must stay open while hovered or while the trigger has focus, and the pointer must reach them with no dead gap between trigger and popup (WCAG 1.4.13).
- Casts or JSON round-trips that hide a test fixture's type, such as a fake SDK or a fake row. Type the fake against what the code uses and build valid rows. The one exception: a deliberately off-type row that stands in for data from a newer host, with a comment saying why.
- A switch over a union without a compile-time exhaustiveness check. When the union is host data, the runtime fallback must return something neutral, not throw, because the host can send variants newer than the plugin's SDK.
- Async work that outlives its owner, or one shared timer or clock that lets one reader starve another. Commit cursors only after the read succeeds, clear timers and abort pulls in stop(), and treat a status-only change as a change.

## Never flag
