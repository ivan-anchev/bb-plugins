// The brief goes after whatever the user already has in the composer, so Start thread never
// overwrites a draft. `composer.replace` does not move mention ranges, so this is the one place the
// brief's are shifted.
import type { ComposerDraftReplacement, ComposerDraftSnapshot } from "@get-bb/plugin-sdk/app";
import type { Brief } from "../../contract.ts";

export function appendToDraft(current: ComposerDraftSnapshot, brief: Brief): ComposerDraftReplacement {
  const head = current.text.trimEnd();
  const lead = head === "" ? "" : `${head}\n\n`;
  return {
    text: lead + brief.text,
    mentions: [...current.mentions, ...brief.mentions.map((mention) => ({ ...mention, from: mention.from + lead.length, to: mention.to + lead.length }))],
    attachments: [...current.attachments, ...brief.attachments],
  };
}
