import type { InboxPr, SectionKey, Visit } from "../../contract.ts";
import { repoKey } from "../../github/repo.ts";

export type Attention = "ci-failing" | "changes-requested" | "new-activity";

/** When the reader last opened each PR (epoch ms), by `visitKey`. */
export type Visits = ReadonlyMap<string, number>;

const visitKey = ({ repo, number }: Pick<InboxPr, "repo" | "number">) => `${repoKey(repo)}#${number}`;

export const visitsByPr = (visits: Visit[]): Visits => new Map(visits.map((visit) => [visitKey(visit), visit.openedAt]));

/**
 * The dot of `pr`'s row in `section`, or null. Only an open or draft PR carries one. A PR
 * GitHub updated after the reader last opened it has new activity; one never opened has it
 * only in Needs my review, so a first run does not light up every row.
 */
export function attentionOf(pr: InboxPr, section: SectionKey, visits: Visits): Attention | null {
  if (pr.state !== "OPEN" && pr.state !== "DRAFT") return null;
  if (pr.ciFailing) return "ci-failing";
  if (pr.changesRequested) return "changes-requested";
  const openedAt = visits.get(visitKey(pr));
  const isNew = openedAt === undefined ? section === "review" : Date.parse(pr.updatedAt) > openedAt;
  return isNew ? "new-activity" : null;
}
