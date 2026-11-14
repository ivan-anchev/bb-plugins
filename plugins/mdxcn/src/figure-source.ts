import { parse as parseYaml } from "yaml";

/**
 * A figure fence's body, read: the props from its YAML front matter and the
 * Markdown after it. This is mdxcn's Comark block format without the `::tag`
 * lines, because the fence's language already names the figure.
 */
export type FigureSource =
  | { ok: true; props: Record<string, unknown>; body: string }
  | { ok: false; error: string };

const OPENS_FRONT_MATTER = /^---[ \t]*(?:\r?\n|$)/;
const FRONT_MATTER = /^---[ \t]*\r?\n((?:[\s\S]*?\r?\n)?)---[ \t]*(?:\r?\n|$)/;

export function readFigureSource(code: string): FigureSource {
  if (!OPENS_FRONT_MATTER.test(code)) {
    return { ok: true, props: {}, body: code };
  }

  const match = FRONT_MATTER.exec(code);
  if (!match) {
    return { ok: false, error: "The front matter opened with --- never closes." };
  }

  const props = parseProps(match[1] ?? "");
  return typeof props === "string"
    ? { ok: false, error: props }
    : { ok: true, props, body: code.slice(match[0].length) };
}

/** The props mapping, or why the YAML isn't one. */
function parseProps(yaml: string): Record<string, unknown> | string {
  let value: unknown;
  try {
    value = parseYaml(yaml);
  } catch (error) {
    return `The front matter isn't valid YAML: ${(error as Error).message}`;
  }
  if (value === null || value === undefined) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    return "The front matter must be a YAML mapping of props.";
  }
  return value as Record<string, unknown>;
}
