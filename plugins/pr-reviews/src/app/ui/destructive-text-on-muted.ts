// Red text on bb's `bg-muted` surface, such as a finding card. Text on the page keeps `text-destructive-text`.
// why the mix: bb's --destructive-text reads 4.00:1 on --muted in the default dark theme, under the
// 4.5:1 small text needs. Three parts of it to one of the foreground keeps its hue, reads 4.79:1
// there and 7.33:1 in light, and follows a custom theme's foreground.
export const DESTRUCTIVE_TEXT_ON_MUTED = "text-[color-mix(in_oklab,var(--destructive-text)_75%,var(--foreground))]";
