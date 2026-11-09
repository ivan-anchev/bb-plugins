import type { PluginSettingDescriptors } from "@get-bb/plugin-sdk";
import { z } from "zod";

/** A target name, upper-cased: the stem of its `GROK_WAKE_<TARGET>_URL` and `_KEY` secrets. */
export type Target = string & { readonly __brand: "Target" };

/** The `routes` setting, parsed: section and project ids mapped to targets. */
export interface Routes {
  sections: ReadonlyMap<string, Target>;
  projects: ReadonlyMap<string, Target>;
}

const EMPTY_ROUTES_SETTING = '{"sections": {}, "projects": {}}';

const TARGET_NAME = /^[A-Za-z0-9_]+$/;

/** A user-written target name as a `Target`, or null when it is not letters, digits and `_`. */
export function parseTarget(name: string): Target | null {
  return TARGET_NAME.test(name) ? toTarget(name) : null;
}

function toTarget(validName: string): Target {
  return validName.toUpperCase() as Target;
}

/** A stored or user-written target name, validated and upper-cased. */
export const targetSchema = z
  .string()
  .regex(TARGET_NAME, "target names use letters, digits and _ only")
  .transform(toTarget);

const targetTable = z
  .record(z.string(), targetSchema)
  .default({})
  .transform((table) => new Map(Object.entries(table)));

const routesShape = z.object({ sections: targetTable, projects: targetTable }).strict();

type ParsedRoutes = { ok: true; routes: Routes } | { ok: false; error: string };

/** Parses the `routes` setting's JSON text, naming the first problem when it is malformed. */
export function parseRoutes(text: string): ParsedRoutes {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: "routes must be JSON, e.g. " + EMPTY_ROUTES_SETTING };
  }
  const result = routesShape.safeParse(json);
  if (result.success) return { ok: true, routes: result.data };
  const issue = result.error.issues[0];
  const where = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
  return { ok: false, error: where + issue.message };
}

/** The settings-field validator: the same parse, reported under the field. */
export const routesSettingSchema = z.string().superRefine((text, context) => {
  const parsed = parseRoutes(text);
  if (!parsed.ok) context.addIssue({ code: "custom", message: parsed.error });
});

/** The `routes` settings field: JSON text, validated under the field as it is typed. */
export const routesSetting = {
  routes: {
    type: "string",
    label: "Routes",
    description:
      'JSON mapping bb section and project ids to target names: {"sections": {"<section id>": "ops"}, "projects": {"<project id>": "dev"}}. A section match beats a project match. Each target gets its own URL and key secrets below once saved.',
    experimental_multiline: true,
    experimental_schema: routesSettingSchema,
    default: EMPTY_ROUTES_SETTING,
  },
} satisfies PluginSettingDescriptors;

/** The target a thread routes to: its section's, else its project's, else none. */
export function routeFor(
  routes: Routes,
  thread: { sectionId: string | null; projectId: string },
): Target | null {
  const bySection = thread.sectionId === null ? undefined : routes.sections.get(thread.sectionId);
  return bySection ?? routes.projects.get(thread.projectId) ?? null;
}

/** Every distinct target the routes name, sorted. */
export function targetsOf(routes: Routes): Target[] {
  const all = [...routes.sections.values(), ...routes.projects.values()];
  return [...new Set(all)].sort();
}
