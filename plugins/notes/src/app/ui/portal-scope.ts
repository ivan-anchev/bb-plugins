// The attributes bb's overlay layer expects on this plugin's portaled overlays (the popover
// and the start menu), as code-explorer sets them. Copied from boat-sandbox and pr-reviews.
declare const __BB_PLUGIN_ID__: string;

export const PORTAL_SCOPE = { "data-bb-portaled-overlay": "", "data-bb-plugin-root": "", "data-bb-plugin": __BB_PLUGIN_ID__ };
