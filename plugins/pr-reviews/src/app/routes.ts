// The panel's subPath is its only route state: "", "<projectId>", "<projectId>/<number>".
// bb hands the page, the sidebar and the header the same percent-encoded subPath.
export type Route =
  | { kind: "root" }
  | { kind: "project"; projectId: string }
  | { kind: "pr"; projectId: string; number: number };

export const PANEL_ID = "pr-reviews";

export const PANEL_PATH = "prs";

export function parseRoute(subPath: string): Route {
  const [projectId, number] = subPath.split("/").filter(Boolean).map(decodeURIComponent);
  if (projectId === undefined) return { kind: "root" };
  const prNumber = Number(number);
  return Number.isInteger(prNumber) && prNumber > 0 ? { kind: "pr", projectId, number: prNumber } : { kind: "project", projectId };
}

/** Unencoded segments, as useBbNavigate().toPluginPanel expects them. */
export function routeSubPath(route: Exclude<Route, { kind: "root" }>): string {
  return route.kind === "pr" ? `${route.projectId}/${route.number}` : route.projectId;
}
