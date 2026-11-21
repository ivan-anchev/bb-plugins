// What a thread's pending interaction asks a person, in a line or a few: an agent's, passed on to
// its regional manager as waiting on the user; a verifier's, named where the plugin declined it.
import type { PluginThreadEventPayloads } from "@get-bb/plugin-sdk";

export type InteractionPayload = PluginThreadEventPayloads["interaction.pending"]["interaction"]["payload"];

/** What a pending interaction asks of a person, in a line or a few. */
export function questionOf(payload: InteractionPayload): string {
  switch (payload.kind) {
    case "user_question":
      return payload.questions.map((question) => question.prompt).join("\n");
    case "approval":
      return `Asks to approve ${subjectOf(payload.subject)}${payload.reason === null ? "" : `: ${payload.reason}`}`;
    case "plugin":
      return payload.title;
    default:
      if (isNamespaced(payload)) return payload.title;
      // why not throw: bb can send an interaction newer than this plugin's SDK, and its fields are unknown.
      payload satisfies never;
      return "Asks the user something in its thread";
  }
}

/** A provider's own interaction, named `<provider>/<kind>`, titled as a plugin's is. */
export const isNamespaced = (payload: InteractionPayload): payload is Extract<InteractionPayload, { kind: `${string}/${string}` }> => payload.kind.includes("/");

function subjectOf(subject: Extract<InteractionPayload, { kind: "approval" }>["subject"]): string {
  switch (subject.kind) {
    case "command":
      return `the command \`${subject.command}\``;
    case "file_change":
      return "a file change";
    case "permission_grant":
      return "a permission grant";
    case "plan":
      return "its plan";
    case "tool_use":
      return "a tool call";
    default:
      // why not throw: bb can send an approval newer than this plugin's SDK.
      subject satisfies never;
      return "an action";
  }
}
