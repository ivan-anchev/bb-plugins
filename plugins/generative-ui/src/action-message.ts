// Turns a UI block's @ToAssistant action into the user message bb sends to the
// thread: the button's message, then each answered field, then any hidden
// context the agent attached to the button.
import type { ActionEvent } from "@openuidev/react-lang";

export function formatActionMessage({ humanFriendlyMessage, formState, params }: ActionEvent): string {
  const answers = answeredFields(formState ?? {}).map(([name, value]) => `- ${name}: ${value}`);
  const sections = [humanFriendlyMessage, answers.join("\n"), contextLine(params.context)];
  return sections.filter((section) => section !== "").join("\n\n");
}

type Answer = readonly [name: string, value: string];

// OpenUI's form state holds forms (`{ form: { field: { value, componentType } } }`),
// fields outside any form (`{ field: { value, componentType } }`) and
// `$variables` bound to inputs (`{ $plan: "Pro" }`). All of them are answers.
function answeredFields(formState: Record<string, unknown>): Answer[] {
  return Object.entries(formState).flatMap(([name, entry]): Answer[] => {
    if (isField(entry)) return answer(name, entry.value);
    if (isForm(entry)) return Object.entries(entry).flatMap(([field, { value }]) => answer(field, value));
    return answer(name.replace(/^\$/, ""), entry);
  });
}

function answer(name: string, value: unknown): Answer[] {
  const text = formatValue(value);
  return text === "" ? [] : [[name, text]];
}

// Inputs written through useStateField (checkbox and switch groups among them)
// store `componentType: undefined`.
interface Field {
  value: unknown;
  componentType: string | undefined;
}

function isField(entry: unknown): entry is Field {
  return isRecord(entry) && "componentType" in entry && "value" in entry;
}

function isForm(entry: unknown): entry is Record<string, Field> {
  return isRecord(entry) && Object.values(entry).every(isField);
}

// Inputs store strings, numbers, dates, lists (chips, sliders) and
// `{ item: checked }` maps (checkbox and switch groups).
function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return formatDate(value);
  if (Array.isArray(value)) return formatSelection(value.map(formatValue).filter((item) => item !== ""));
  if (isRecord(value) && Object.values(value).every((item) => typeof item === "boolean")) {
    return formatSelection(Object.keys(value).filter((key) => value[key]));
  }
  if (isRecord(value)) return JSON.stringify(value);
  return String(value).trim();
}

// A selection reaches form state only once the user touches it: chips store
// `[]` when the last one is deselected, and checkbox and switch groups store
// every item once any is toggled. An empty one is a deliberate "none".
function formatSelection(selected: string[]): string {
  return selected.length === 0 ? "none" : selected.join(", ");
}

function formatDate(date: Date): string {
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function contextLine(context: unknown): string {
  return context === undefined ? "" : `Context: ${JSON.stringify(context)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date);
}
