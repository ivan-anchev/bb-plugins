// The one OpenUI library this plugin ships: UI blocks render with it, and the
// skill teaches agents its spec. Both come from OpenUI unmodified.
import { openuiLibrary, openuiPromptOptions } from "@openuidev/react-ui/genui-lib";

export const library = openuiLibrary;

/** Fence languages bb hands to the renderer. `openui` is the one agents are taught; `openui-lang` is OpenUI's own name for it. */
export const UI_BLOCK_LANGUAGES = ["openui", "openui-lang"] as const;

/**
 * The component spec agents read in the skill: OpenUI's stock prompt for this
 * library, minus its preamble, which demands that the whole reply be OpenUI
 * Lang. In bb a block is one fence inside an ordinary Markdown reply.
 */
export function componentSpec(): string {
  return library.prompt({ ...openuiPromptOptions, preamble: "" }).trim();
}
