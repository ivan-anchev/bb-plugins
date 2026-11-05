# Review rules

## Always flag

- Refresh or retry paths that leave a failed read in place: Refresh and reselection must re-read failed or cached-failed results (use the SDK query's refetch), and errors must show next to any data still displayed.
- Hover- or focus-revealed popups (tooltips, hover cards) that break dismiss, hover, or focus rules: Escape must close them wherever focus is, they must stay open while hovered or while the trigger has focus, and the pointer must reach them with no dead gap between trigger and popup (WCAG 1.4.13).

## Never flag
