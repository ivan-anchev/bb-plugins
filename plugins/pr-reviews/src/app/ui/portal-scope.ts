// The attributes bb's overlay layer expects on this plugin's portaled overlays (menus,
// popovers), as code-explorer sets them.
declare const __BB_PLUGIN_ID__: string;

export const PORTAL_SCOPE = { "data-bb-portaled-overlay": "", "data-bb-plugin-root": "", "data-bb-plugin": __BB_PLUGIN_ID__ };
