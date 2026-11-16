// The product's name, read from package.json's `bb.name`, its one home. It titles the rail entry
// and heads every wake message. Prose that names the thread itself says "regional manager" in
// sentence case. why: tools, tables and RPC methods are named for their role (crew_catch_up,
// roles), never for the product, so they don't follow a rename.
import manifest from "../package.json" with { type: "json" };

export const DISPLAY_NAME: string = manifest.bb.name;
