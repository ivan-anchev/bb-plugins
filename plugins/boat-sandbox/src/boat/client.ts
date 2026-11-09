// The only module that speaks HTTP to boat.dev.
import { setTimeout as sleep } from "node:timers/promises";
import type { Preset } from "../launch.ts";
import { toSandbox, type Sandbox, type SandboxId } from "./sandbox.ts";
import {
  wireCommandFrame,
  wireError,
  wireLimits,
  wireMe,
  wireSandboxEnvelope,
  wireSandboxList,
  wireSavedSnapshotList,
  type Account,
  type Limits,
  type SavedSnapshot,
} from "./wire.ts";

const BASE_URL = "https://boat.dev/api/v1";
/** boat holds a command for up to 60 s while the sandbox starts, then answers `409 sandbox_starting`. */
const NOT_RUN_PATIENCE_MS = 60_000;
const NOT_RUN_RETRY_MS = 2_000;
/** What core sees for a command a signal ended: boat reports no exit code for it. */
const SIGNALLED_EXIT_CODE = 128;

/** Every boat refusal, in one shape: a non-2xx response, or an `error` frame of a command stream. */
export class BoatApiError extends Error {
  override readonly name = "BoatApiError";
  readonly status: number;
  readonly code: string;
  /** From `Retry-After`, which boat sends on every 429. */
  readonly retryAfterMs: number | null;
  /** boat says the command provably never ran, so sending it again is safe. */
  readonly retryable: boolean;

  constructor(status: number, code: string, message: string, retryAfterMs: number | null, retryable: boolean) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryAfterMs = retryAfterMs;
    this.retryable = retryable;
  }
}

export type Labels = Readonly<Record<string, string>>;

export interface CreateSandboxBody {
  name: string;
  type: Preset;
  labels: Labels;
  ttlSeconds: number;
  /** The saved snapshot whose disk the sandbox starts from; boat's stock image when absent. */
  from?: string;
}

export interface CommandRequest {
  command: string;
  timeoutSeconds: number;
  signal: AbortSignal;
  onOutput(chunk: string): void;
}

export interface BoatClient {
  me(signal?: AbortSignal): Promise<Account>;
  /** Start budget and wallet of the wallet a create would bill. */
  limits(signal?: AbortSignal): Promise<Limits>;
  /** Every saved snapshot on the account, in any status (`snapshot.read`). */
  savedSnapshots(signal?: AbortSignal): Promise<SavedSnapshot[]>;
  /** null when boat no longer has the sandbox (404 or cancelled). */
  get(id: SandboxId, signal: AbortSignal): Promise<Sandbox | null>;
  /** Every sandbox carrying all of `labels`, in any state, across all pages. */
  list(labels: Labels, signal: AbortSignal): Promise<Sandbox[]>;
  /** A repeat with the same key and body returns the same sandbox. */
  create(body: CreateSandboxBody, idempotencyKey: string, signal: AbortSignal): Promise<Sandbox>;
  /** Asynchronous on boat's side, but the sandbox is 404 at once. Throws a 404 BoatApiError when it is gone. */
  remove(id: SandboxId, signal: AbortSignal): Promise<void>;
  /** Saves the disk, then powers off; returns while boat is still stopping. A repeat joins the pending stop. */
  stop(id: SandboxId, signal: AbortSignal): Promise<void>;
  /**
   * Starts a stopped sandbox on the same disk with auto-stop `ttlSeconds` from now, kept for later
   * resumes; returns while it is still starting.
   */
  resume(id: SandboxId, ttlSeconds: number, signal: AbortSignal): Promise<void>;
  /** Moves the auto-stop deadline to now + `ttlSeconds`, and keeps that TTL for later resumes. */
  setTtl(id: SandboxId, ttlSeconds: number, signal: AbortSignal): Promise<void>;
  /** Runs `command` in a login shell as `user`, streaming its output, and returns its exit code. */
  run(id: SandboxId, request: CommandRequest): Promise<{ exitCode: number }>;
  /** Writes `content` to `path`, mode 0644 whatever the directory's umask. */
  writeFile(id: SandboxId, path: string, content: string, signal: AbortSignal): Promise<void>;
}

export function createBoatClient(apiKey: string): BoatClient {
  const call = (path: string, options: RequestOptions = {}) => send(apiKey, path, options);
  const json = async (path: string, options?: RequestOptions) => (await call(path, options)).json();

  return {
    me: async (signal) => wireMe.parse(await json("/me", { signal })),
    limits: async (signal) => wireLimits.parse(await json("/limits", { signal })),
    // No query parameters: boat refuses unknown ones, and this list has no paging.
    savedSnapshots: async (signal) => wireSavedSnapshotList.parse(await json("/saved-snapshots", { signal })),
    async get(id, signal) {
      try {
        return toSandbox(wireSandboxEnvelope.parse(await json(`/sandboxes/${id}`, { signal })).sandbox);
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },
    async list(labels, signal) {
      const found: Sandbox[] = [];
      let cursor: string | null = null;
      do {
        const page = wireSandboxList.parse(await json(`/sandboxes?${listQuery(labels, cursor)}`, { signal }));
        found.push(...page.sandboxes.map(toSandbox).filter((sandbox) => sandbox !== null));
        cursor = page.pageInfo.nextCursor;
      } while (cursor !== null);
      return found;
    },
    async create(body, idempotencyKey, signal) {
      const created = await json("/sandboxes", {
        method: "POST",
        body,
        headers: { "idempotency-key": idempotencyKey },
        signal,
      });
      const sandbox = toSandbox(wireSandboxEnvelope.parse(created).sandbox);
      if (sandbox === null) throw new Error("boat cancelled the new sandbox as it was created.");
      return sandbox;
    },
    async remove(id, signal) {
      await call(`/sandboxes/${id}`, { method: "DELETE", headers: { "x-ascii-confirm-delete": id }, signal });
    },
    async stop(id, signal) {
      await call(`/sandboxes/${id}/stop`, { method: "POST", body: {}, signal });
    },
    async resume(id, ttlSeconds, signal) {
      await call(`/sandboxes/${id}/resume`, { method: "POST", body: { ttlSeconds }, signal });
    },
    async setTtl(id, ttlSeconds, signal) {
      await call(`/sandboxes/${id}`, { method: "PATCH", body: { ttlSeconds }, signal });
    },
    run: (id, { command, timeoutSeconds, signal, onOutput }) =>
      retryWhileNotRun(signal, async () => {
        const response = await call(`/sandboxes/${id}/commands`, {
          method: "POST",
          body: { command, timeoutSeconds, stream: true },
          signal,
        });
        return { exitCode: await readExitCode(response, onOutput) };
      }),
    async writeFile(id, path, content, signal) {
      const body = { path, content: Buffer.from(content).toString("base64"), encoding: "base64" };
      await call(`/sandboxes/${id}/files`, { method: "PUT", body, signal });
    },
  };
}

export const isNotFound = (error: unknown): boolean => error instanceof BoatApiError && error.status === 404;

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

/** The one fetch wrapper: bearer auth, JSON in, and every non-2xx thrown as a BoatApiError. */
async function send(apiKey: string, path: string, { method = "GET", body, headers, signal }: RequestOptions): Promise<Response> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${apiKey}`,
      accept: "application/json",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  if (!response.ok) throw toApiError(response, await response.text());
  return response;
}

// A gateway in front of boat can answer with HTML, so the body may not be boat's envelope.
function toApiError(response: Response, text: string): BoatApiError {
  const envelope = wireError.safeParse(parseJson(text));
  const retryAfter = response.headers.get("retry-after");
  return new BoatApiError(
    response.status,
    envelope.success ? envelope.data.code : `http_${response.status}`,
    envelope.success ? envelope.data.message : `HTTP ${response.status} ${response.statusText}`,
    retryAfter === null ? null : Number(retryAfter) * 1000,
    envelope.success && envelope.data.error?.details?.retryable === true,
  );
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// No state filter: boat then lists every state, stopped and failed included.
const listQuery = (labels: Labels, cursor: string | null): string => {
  const query = new URLSearchParams({ limit: "200" });
  for (const [key, value] of Object.entries(labels)) query.append("label", `${key}=${value}`);
  if (cursor !== null) query.set("cursor", cursor);
  return query.toString();
};

/** Sends again while boat says the command never ran: the sandbox is still starting or restoring its disk. */
async function retryWhileNotRun<T>(signal: AbortSignal, attempt: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + NOT_RUN_PATIENCE_MS;
  for (;;) {
    try {
      return await attempt();
    } catch (error) {
      if (!commandNeverRan(error) || Date.now() > deadline) throw error;
      await sleep(NOT_RUN_RETRY_MS, undefined, { signal });
    }
  }
}

const commandNeverRan = (error: unknown): boolean =>
  error instanceof BoatApiError && (error.retryable || (error.status === 409 && error.code === "sandbox_starting"));

/** Forwards every output chunk and returns the exit frame's code. */
async function readExitCode(response: Response, onOutput: (chunk: string) => void): Promise<number> {
  for await (const line of ndjsonLines(response)) {
    const frame = wireCommandFrame.parse(JSON.parse(line));
    switch (frame.type) {
      case "started":
        break;
      case "stdout":
      case "stderr":
        onOutput(frame.data);
        break;
      case "exit":
        return frame.exitCode ?? SIGNALLED_EXIT_CODE;
      case "error":
        throw new BoatApiError(
          response.status,
          frame.error ?? "command_failed",
          frame.message ?? "boat could not run the command.",
          null,
          frame.retryable === true,
        );
      default:
        frame satisfies never; // why: parsed once in wire.ts, so a new frame type is a compile error here
    }
  }
  throw new Error("boat's command stream ended without an exit frame.");
}

async function* ndjsonLines(response: Response): AsyncGenerator<string> {
  if (response.body === null) throw new Error("boat answered a streamed command with no body.");
  let pending = "";
  for await (const text of response.body.pipeThrough(new TextDecoderStream())) {
    pending += text;
    const end = pending.lastIndexOf("\n");
    if (end === -1) continue;
    yield* pending.slice(0, end).split("\n").filter(isNotBlank);
    pending = pending.slice(end + 1);
  }
  if (isNotBlank(pending)) yield pending;
}

const isNotBlank = (line: string): boolean => line.trim() !== "";
