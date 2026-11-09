// Shared by the tests only; server.ts never imports it, so the build leaves it out.
import Database from "better-sqlite3";
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { PendingInteraction, ThreadResponse } from "./bb-types.ts";
import { openFailureLog } from "./failure-log.ts";

interface ReceivedRequest {
  method: string;
  path: string;
  headers: IncomingHttpHeaders;
  body: string;
}

/**
 * A local webhook receiver: records every request and answers with `status`
 * (sending `location` along when set), or never when `hang`.
 */
export async function startReceiver() {
  const requests: ReceivedRequest[] = [];
  const state: { status: number; hang: boolean; location: string | null } = { status: 200, hang: false, location: null };
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      requests.push({ method: request.method ?? "", path: request.url ?? "", headers: request.headers, body });
      if (state.hang) return;
      response.writeHead(state.status, state.location === null ? {} : { Location: state.location }).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("the receiver is not listening on TCP");
  return {
    url: `http://127.0.0.1:${address.port}/hook`,
    requests,
    state,
    close() {
      server.closeAllConnections();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/** Waits until `check` holds: for a POST that a handler started and returned without awaiting. */
export async function until(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("the condition did not hold in time");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

export function memoryFailureLog() {
  const db = new Database(":memory:");
  const failures = openFailureLog(db, (target, statements) => statements.forEach((sql) => target.exec(sql)));
  return { db, failures, rawRows: () => JSON.stringify(db.prepare("SELECT * FROM failures").all()) };
}

export function thread(overrides: Partial<ThreadResponse> = {}): ThreadResponse {
  return {
    activeBackgroundAgentCount: 0,
    archivedAt: null,
    canEditMessages: true,
    canRestoreEnvironment: false,
    canSpawnChild: true,
    createdAt: 1,
    deletedAt: null,
    environmentId: null,
    id: "thr_abcdefgh123",
    lastReadAt: null,
    latestAttentionAt: 1,
    lifecycleOwnerThreadId: null,
    originKind: null,
    originPluginId: null,
    parentNotifications: "auto",
    parentThreadId: null,
    pinnedAt: null,
    projectId: "proj_1",
    providerId: "claude-code",
    queuedMessageCount: 0,
    runtime: { displayStatus: "idle" },
    sectionId: null,
    sourceThreadId: null,
    status: "idle",
    title: "Fix the build",
    titleFallback: null,
    updatedAt: 100,
    visibility: "visible",
    ...overrides,
  };
}

export function question(id: string, prompt: string): PendingInteraction {
  return {
    createdAt: 1,
    id,
    origin: { kind: "provider", providerId: "claude-code", providerRequestId: "req", providerThreadId: "pt" },
    payload: { kind: "user_question", questions: [{ id: "q1", prompt, allowFreeText: true, multiSelect: false, required: true }] },
    providerId: "claude-code",
    providerRequestId: "req",
    providerThreadId: "pt",
    resolution: null,
    resolvedAt: null,
    status: "pending",
    statusReason: null,
    threadId: "thr_abcdefgh123",
    turnId: "turn_1",
  };
}

/** A row of a thread's event log; the SDK does not export the name. */
export type ThreadEventRow = Awaited<ReturnType<BbPluginApi["sdk"]["threads"]["events"]["list"]>>[number];

/** The `turn/completed` row bb records when a turn ends, as `bb thread log` shows it. */
export function turnCompleted(seq: number, status: "completed" | "interrupted"): ThreadEventRow {
  return {
    id: `evt_${seq}`,
    scope: { kind: "turn", turnId: `turn_${seq}` },
    threadId: "thr_abcdefgh123",
    seq,
    createdAt: seq,
    type: "turn/completed",
    data: { providerThreadId: "pt", status },
  };
}
