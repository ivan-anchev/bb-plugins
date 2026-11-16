import assert from "node:assert/strict";
import { test } from "node:test";
import { bbHttpError } from "../test-harness.ts";
import { refusalOf } from "./send-refusal.ts";

test("only bb's answers from before it takes a message prove a refusal, each by its status and code", () => {
  const refusals = [bbHttpError(404, "thread_not_found", "Thread not found"), bbHttpError(409, "thread_not_writable", "Thread is archived"), bbHttpError(400, "parent_thread_invalid", "Sender thread is invalid")];
  assert.deepEqual(refusals.map(refusalOf), ["HTTP 404: Thread not found", "HTTP 409: Thread is archived", "HTTP 400: Sender thread is invalid"]);

  const unproven = [
    bbHttpError(500, "internal_error", "Internal Server Error"),
    bbHttpError(502, "host_unavailable", "Host daemon is not connected"),
    bbHttpError(409, "invalid_request", "Thread not found"),
    bbHttpError(400, "thread_not_found", "Thread not found"),
    Object.assign(new Error("HTTP 502: Bad Gateway"), { status: 502, code: null }),
    Object.assign(new Error("BB request timed out after 75 seconds."), { name: "BbRequestTimeoutError" }),
    new TypeError("fetch failed"),
    new Error("Cannot connect to BB server. Ensure it is running and BB_SERVER_URL is correct."),
    "socket hang up",
  ];
  assert.deepEqual(unproven.map(refusalOf), unproven.map(() => null));
});
