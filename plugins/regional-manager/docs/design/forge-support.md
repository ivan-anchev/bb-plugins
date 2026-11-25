# Design: forge support for GitLab, glab and self-hosted hosts

Accepted in round 1: **package A as the base, with five grafts.** Code is `plugins/regional-manager` in ivan-anchev/bb-plugins, designed against `main` = `29470c4f` (0.10.0+). Paths are under that plugin.

## Decision

- The PR watch learns a second forge. Each forge gets its own folder under `src/server/watch/` (`github/`, `gitlab/`), and `pr-watch.ts` switches on the forge.
- **The forge travels with the number.** Every value that carries a change request's number also carries `forge`, so `#41` or `!41` is never a guess at render time.
- **The CLI signed in to a host owns it.** `github.com`, `*.ghe.com` and `gitlab.com` are known by name. Any other host is GitLab if `glab` knows it, GitHub Enterprise if `gh` does. There is no plugin setting and no probe.
- Code keeps the word "PR" (`PrSnapshot`, `prUrl`, `pr_snapshots`, event kind `pr`). Only words a person or agent reads change by forge.

## Usage

The user on a self-hosted GitLab runs `glab auth login --hostname git.corp` once on the machine running bb. Then the board shows the merge request badge, the feed says `!41 merged`, the status reads `Merged !41`, and the doorbell reads `BBP-7 MR !41: merged`. If nothing is signed in there, the board says which command to run.

The watch, per regional manager and per due group (copied from A):

```ts
const at = await locator.locate(gitRemoteUrl);          // which forge, host and project
if (at.kind === "off-forge") inbox.prUnavailable(coordinatorId, branch, at.unavailable, now);
else {
  const result = await read(at.repo, branches);         // switch (repo.forge) → readGitHub | readGitLab
  // saved exactly as today: inbox.prRead(...) or inbox.prUnavailable(...)
}
```

Every text that names a change request goes through one helper (copied from A):

```ts
headline: `Merged ${prNumberText(pr)}`                             // "#41" | "!41"
`${on} ${prWord(event.pr.forge)} ${prNumberText(event.pr)}: …`     // "PR #41" | "MR !41"
`CI failed on ${prNumberText(ci)}`                                 // ci: { kind: "fail", forge, number, failedChecks }
```

## Shape

**Model** (`src/model/verdict/forge.ts`, new; copied from A):

```ts
export const forgeSchema = z.enum(["github", "gitlab"]);
export type Forge = z.infer<typeof forgeSchema>;
export type PrNumber = { forge: Forge; number: number };
const WORDS: Record<Forge, Words> = {
  github: { sigil: "#", word: "PR", noun: "pull request", name: "GitHub", checks: "checks" },
  gitlab: { sigil: "!", word: "MR", noun: "merge request", name: "GitLab", checks: "jobs" },
};
export const prNumberText = ({ forge, number }: PrNumber): string => `${WORDS[forge].sigil}${number}`;
```

| Type | Change | Stored |
|---|---|---|
| `PrSnapshot` | + `forge` | `pr_snapshots.snapshot`, `events.event` (kind `pr`) |
| `PrUnavailable` | + `forge: Forge \| null` (null: on no recognised forge) | `pr_snapshots.unavailable` |
| `CiVerdict` `no-checks`, `pass`, `fail` | + `forge` | `checks.verdict` at `$.settlement.ci` |
| `Closure` merge, `FailureReason` ci, feed `pr` entry | `& PrNumber` | derived; closure key stays `merged #N` on GitHub |
| `Board.prUnavailable` | `string` → `{ forge, reason }` | wire |

`ciOf` stays forge-blind: it compares `headSha`, `ci`, `state` and `handoffAtRead`, and only copies `forge` into its verdict. Stored rows are stamped by four appended, re-runnable migrations (copied from A):

```ts
`UPDATE pr_snapshots SET snapshot = json_set(snapshot, '$.forge', 'github') WHERE snapshot IS NOT NULL`,
`UPDATE pr_snapshots SET unavailable = json_set(unavailable, '$.forge',
     CASE WHEN json_extract(unavailable, '$.reason') = 'its project''s git remote isn''t on github.com' THEN NULL ELSE 'github' END)
   WHERE unavailable IS NOT NULL`,
`UPDATE events SET event = json_set(event, '$.pr.forge', 'github') WHERE json_extract(event, '$.kind') = 'pr'`,
`UPDATE checks SET verdict = json_set(verdict, '$.settlement.ci.forge', 'github') WHERE json_extract(verdict, '$.settlement.ci.number') IS NOT NULL`,
```

**Watch** (`src/server/watch/`):

- `locate.ts`: parses the remote (scp, `ssh://` with the ssh port dropped, `http(s)://` with userinfo dropped, `git://`), names the forge, and returns `Located = { kind: "on-forge"; repo: ForgeRepo } | { kind: "off-forge"; unavailable }`. `ForgeRepo = { forge; host; path }`. A recognised host is cached for the plugin's life; a refusal for 5 minutes.
- `host-command.ts`: `runHostCli(cli, args)` replaces `runGh`; `connectionFailed` is the transport pattern list both classifiers share.
- `github/`: `read.ts` and `failure.ts` moved from `pr-query.ts` and `gh-failure.ts`; `auth.ts` asks `gh auth status --hostname H --json hosts`.
- `gitlab/`: `read.ts`, `failure.ts`, `auth.ts` (`glab auth status --hostname H --output json`: whether glab knows the host, whether it is signed in, and the instance's path prefix from `graphql_endpoint`).

The GitLab read, one `glab api graphql --hostname H` call per 5 branches, every value a `-f` variable (copied from A; grafts 1 and 2 remove `sha` and `MANUAL`):

```graphql
query($path: ID!, $b0: String!, …) { project(fullPath: $path) {
  b0: mergeRequests(sourceBranches: [$b0], sort: CREATED_DESC, first: 1) { nodes {
    iid webUrl state draft approved diffHeadSha approvedBy(first: 1) { nodes { id } }
    headPipeline { sha status jobs(statuses: [FAILED, CANCELED, MANUAL], retried: false, first: 10) { nodes { name allowFailure } } } } }
  … } }
```

Mapping: `number` = `Number(iid)`; `opened` and `locked` → open; `review` is `approved` only when `approved` is true and `approvedBy` is non-empty; no `headPipeline` → `ci: none`, so the 5-minute grace applies; SUCCESS → pass; FAILED, CANCELED → fail; SKIPPED → none; every other status, known or not → pending; `failedChecks` are the listed jobs with `allowFailure: false`.

glab's failures are classified in `gitlab/failure.ts` beside gh's in `github/failure.ts`: missing CLI, sign-in asked, HTTP 401 and a too-old schema are persistent; transport, timeout, rate limit and anything unexplained are transient. `project: null` asks `glab auth status` once, to tell "signed out" from "can't see it, or it isn't there".

## Why

| Criterion | A | B |
|---|---|---|
| Fidelity | **4**: all requirements met; its own sha filter dropped merged-results pipelines; https port refused | **3**: always passes `--hostname` and strips env on github.com; picks the newest pipeline for a sha from any source, and can't see merged-results pipelines |
| Simplicity | **4**: one field, one helper file, two folders, four UPDATEs | **2**: a settings mechanism, source keys, read budgets, a worker pool, REST paging and a repo-wide rename |
| Data model | **4**: forge beside every number; branded path; `Located` union | **4**: `CiResult` union is stricter, but three repository shapes and a nullable legacy `sourceKey` |
| Fit | **5**: the repo's own migration, classifier and harness patterns; folders stay at nine | **3**: replaces the exec seam and the row decoder, renames every store method |
| Testability | **4**: one `run(cli, args)` seam, an injected clock | **3**: a real 60 s timer and concurrency inside the reader |
| Change tolerance | **4**: a third forge is one word row, one switch arm, one folder | **4**: the host map takes any forge, but each forge threads through more layers |

A wins on every criterion but data model, where they tie. What settled it was checked in the code and in GitLab's and glab's source:

- GitLab resolves `MergeRequest.headPipeline` as `diff_head_pipeline`: the head pipeline only if it matches the head commit by `sha` **or** `source_sha` (`app/models/merge_request.rb:954`, `ci/pipeline.rb:1858`). B's reason for leaving GraphQL, that `headPipeline` can't be trusted, doesn't hold, and its REST read is the one that misses merged-results pipelines.
- B asks `glab auth status` on every pass anyway, so its host map is a second home for what glab's config already says.
- A's facts hold on main: the `json_set` migration precedent, `MIGRATIONS.slice(0, n)` tests, `Ci` waiting's number read by nothing, and `gh auth status --hostname H --json hosts` answering `{"hosts":{}}` with exit 0 for an unknown host (run live, gh 2.97.0).

## Grafts

1. **Trust `headPipeline`** (judge's finding; replaces A's filter in `gitlab/read.ts`). Drop `sha` from the query and the `headPipeline.sha === diffHeadSha` test. GitLab already returns null unless the pipeline is the head's, and A's test would have settled a merged-results project as "no CI checks".
2. **A blocked pipeline waits** (from B's `gitlab/pipeline.ts` `ciKind`). Status `MANUAL` maps to pending, and `MANUAL` leaves the jobs filter. Nothing failed, so nothing is sent back to the agent.
3. **A recognition ask that got no answer is not a refusal that lasts** (from B's failure policy: an auth error is classified by its evidence). In `locate.ts`, a `glab` or `gh` auth-status run that was killed or unreadable makes the off-forge reason transient, so a waiting verdict keeps waiting. A missing CLI is named as missing, not as "not signed in".
4. **An https remote's port is glab's to know** (from B's logical host and glab's `api_host`). `locate.ts` asks about the bare host and no longer refuses a port outright. The remote's port must equal the port in glab's `graphql_endpoint`; otherwise the reason says to set glab's `api_host`. A port on a host gh claims is still refused. The path prefix is stripped only from an http(s) remote's path, since an ssh path never carries it.
5. **The agent's first message names its forge** (from B's `brief.ts` `forgePart`). When the locator knows the project's forge, the brief says the forge, the host and the CLI (`glab` or `gh`). A host whose name doesn't say GitLab gives the agent no other way to know.

## Tradeoffs

- One network call per unknown host at plugin start, and one per 5 minutes while refused, in exchange for no setting to keep in step with glab.
- A host both CLIs know is refused until one signs out.
- Up to 10 failed job names per pipeline (GitHub: 100), so 5 branches fit GitLab's complexity budget.
- A pipeline blocked on a manual job is polled every minute until someone plays it or the merge request merges.
- Tests gain `forge: "github"` mechanically; one test (a gitlab.com remote names no repository) is reversed on purpose.
- Nothing about glab was run live: its shapes are read from source at v1.132.0. Issue 01 records real fixtures when glab and gitlab.com are reachable.

## Dependencies

No npm packages. On the machine running bb: `gh` as today; `glab` 1.122 or later (`auth status --output json`); GitLab 13.12 or later. An older one is reported with a reason.

## Build order

1. `issues/01-gitlab-com-merge-requests.md`: read gitlab.com merge requests; badge, CI gate, merge closes the issue.
2. `issues/02-merge-request-wording.md`: `MR !N` in catch-up, doorbell, findings, briefs and the feed. Depends on 01.
3. `issues/03-self-hosted-hosts.md`: self-hosted GitLab and GitHub Enterprise by CLI sign-in. Depends on 01.
4. `issues/04-forge-neutral-guidance.md`: rules, tool descriptions, skills and docs. Depends on 03.

## Open questions

1. GitHub Enterprise Server in scope? Default: **yes**, in issue 03; it rides on the same recognition.
2. A pipeline blocked on a manual job: wait, or fail the verdict? Default: **wait** (graft 2).
3. Does a merged-results pipeline count as CI on the handed-off commit? Default: **yes**; it is GitLab's own head pipeline (graft 1).
4. "Approved" on GitLab: only when someone approved and the rules are met? Default: **yes**; "changes requested" is not read.
5. An ssh remote whose host differs from the web host (glab's `ssh_host`): Default: **not now**; the reason names the host. glab's status JSON carries `ssh_host`, so a follow-up is cheap.
6. Pass `--hostname github.com` on github.com, which fixes a `GH_HOST` misroute? Default: **no**; requirement 6 asks for today's exact poll.
