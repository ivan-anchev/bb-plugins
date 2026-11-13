// The attributes bb's overlay layer expects on a plugin's portaled overlay (focus, dismiss, stacking).
declare const __BB_PLUGIN_ID__: string;

export const PORTAL_SCOPE = { "data-bb-portaled-overlay": "", "data-bb-plugin-root": "", "data-bb-plugin": __BB_PLUGIN_ID__ };
