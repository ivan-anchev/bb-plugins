import manifest from "../package.json" with { type: "json" };

export const DISPLAY_NAME: string = manifest.bb.name;
