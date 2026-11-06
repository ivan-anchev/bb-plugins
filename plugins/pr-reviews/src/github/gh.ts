// The only module that runs `gh`. It parses gh's JSON once into the canonical PR types and
// maps every process failure to a refusal the app can show beside its data.
import { experimental_PluginRpcRefusal as Refusal } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { PrDetail, PrSummary } from "../contract.ts";
import { firstLine, parseHostCommandFailure, runHostCommand } from "./host-command.ts";
import type { Repo } from "./repo.ts";

const LIST_LIMIT = 200;
const SUMMARY_FIELDS = ["number", "title", "author", "updatedAt", "headRefOid"];
const DETAIL_FIELDS = [...SUMMARY_FIELDS, "body", "url", "headRefName", "baseRefName", "state", "commits"];

const ghSummarySchema = z.object({
  number: z.number(),
  title: z.string(),
  author: z.object({ login: z.string() }),
  updatedAt: z.string(),
  headRefOid: z.string(),
});

const toSummary = (pr: z.infer<typeof ghSummarySchema>): PrSummary => ({
  number: pr.number,
  title: pr.title,
  author: pr.author.login,
  updatedAt: pr.updatedAt,
  headSha: pr.headRefOid,
});

const ghDetailSchema = ghSummarySchema.extend({
  body: z.string(),
  url: z.string(),
  headRefName: z.string(),
  baseRefName: z.string(),
  state: z.enum(["OPEN", "CLOSED", "MERGED"]),
  commits: z.array(z.object({ oid: z.string() })),
});

const toDetail = (pr: z.infer<typeof ghDetailSchema>): PrDetail => ({
  ...toSummary(pr),
  body: pr.body,
  url: pr.url,
  headRefName: pr.headRefName,
  baseRefName: pr.baseRefName,
  state: pr.state,
  commits: pr.commits.map((commit) => commit.oid),
});

export async function listOpenPrs(repo: Repo): Promise<PrSummary[]> {
  const json = await runGh(["pr", "list", "-R", repo, "--state", "open", "--limit", String(LIST_LIMIT), "--json", SUMMARY_FIELDS.join(",")]);
  return z.array(ghSummarySchema).parse(JSON.parse(json)).map(toSummary);
}

export async function viewPr(repo: Repo, number: number): Promise<PrDetail> {
  const json = await runGh(["pr", "view", String(number), "-R", repo, "--json", DETAIL_FIELDS.join(",")]);
  return toDetail(ghDetailSchema.parse(JSON.parse(json)));
}

async function runGh(args: string[]): Promise<string> {
  try {
    return await runHostCommand("gh", args);
  } catch (error) {
    throw refusalFor(error);
  }
}

function refusalFor(error: unknown): Refusal {
  const { code, stderr } = parseHostCommandFailure(error);
  if (code === "ENOENT") {
    return new Refusal({ code: "invalid", message: "PR Reviews needs the GitHub CLI. Install gh and make sure it is on your PATH, then Refresh." });
  }
  if (stderr.includes("gh auth login")) {
    return new Refusal({ code: "forbidden", message: "The GitHub CLI isn't signed in. Run `gh auth login`, then Refresh." });
  }
  if (stderr.includes("Could not resolve to a PullRequest")) {
    return new Refusal({ code: "not_found", message: "GitHub has no such pull request." });
  }
  return new Refusal({ code: "invalid", message: firstLine(stderr) ?? "The GitHub CLI failed." });
}
