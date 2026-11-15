// The product's display name, read from package.json's `bb.name`, its one home: a rename is a
// one-line change there. why: tools, tables, skills and RPC methods are named for their role
// (crew_catch_up, roles, coordinating), never for the product, so a rename never touches them.
import manifest from "../package.json" with { type: "json" };

export const DISPLAY_NAME: string = manifest.bb.name;
