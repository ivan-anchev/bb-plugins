import type { ComposerDraftReplacement, ComposerDraftSnapshot } from "@get-bb/plugin-sdk/app";
import type { Brief } from "../../../contract.ts";

export function appendToDraft(current: ComposerDraftSnapshot, brief: Brief): ComposerDraftReplacement {
  const head = current.text.trimEnd();
  const lead = head === "" ? "" : `${head}\n\n`;
  return {
    text: lead + brief.text,
    mentions: [...current.mentions, ...brief.mentions.map((mention) => ({ ...mention, from: mention.from + lead.length, to: mention.to + lead.length }))],
    attachments: [...current.attachments, ...brief.attachments],
  };
}
