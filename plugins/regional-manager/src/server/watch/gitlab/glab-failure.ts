// Why a read of GitLab through glab failed, in words that name the host, and whether it lasts:
// glab's words for each failure host-command.ts cliFailure tells apart, and the one failure only a
// GitLab read has, a GraphQL schema that lacks a field the query reads. Shapes from glab's source
// (context.md §1.5) and its live answers on gitlab.itcapital.io (review.md).
import type { PrUnavailable } from "../../../model/verdict/pr.ts";
import { cliFailure, type CliWords, type HostCommandFailure } from "../host-command.ts";

/** glab's words for each failure, naming the host it reads. */
export const glabWords = (host: string): CliWords => ({
  cli: "glab",
  forge: "gitlab",
  // glab ends an HTTP failure whose answer has a message with "(HTTP 401)", and one without with "glab: HTTP 401".
  httpStatus: /(?:\(HTTP |^glab: HTTP )(\d{3})/m,
  notInstalled: `glab, the GitLab CLI, isn't installed on the machine running bb, so it can't read GitLab at ${host}`,
  signedOut: `glab isn't signed in to ${host} on the machine running bb: run glab auth login --hostname ${host} there`,
  rejected: `GitLab at ${host} rejected glab's credentials (HTTP 401): run glab auth login --hostname ${host} on the machine running bb`,
  unreachable: `couldn't reach GitLab at ${host}`,
  rateLimited: `GitLab at ${host} is limiting requests right now`,
  unexplained: (said) => `glab couldn't read GitLab at ${host}: ${said}`,
});

// GitLab's GraphQL error for a field its schema doesn't have: "Field 'x' doesn't exist on type 'MergeRequest'".
const SCHEMA_GAP = /doesn't exist on type/;

/**
 * Why a glab read of GitLab at `host` failed. why a schema gap lasts: a GitLab that lacks a field
 * the query reads lacks it on every read, and a verdict waiting on it would wait forever. why it
 * names no version: which GitLab first had each field is known only from its docs.
 */
export function glabFailure(host: string, failure: HostCommandFailure): PrUnavailable {
  if (SCHEMA_GAP.test(failure.stderr)) return { kind: "persistent", forge: "gitlab", reason: `GitLab at ${host} lacks a field the plugin's query reads, so it is older than the plugin reads` };
  return cliFailure(glabWords(host), failure);
}
