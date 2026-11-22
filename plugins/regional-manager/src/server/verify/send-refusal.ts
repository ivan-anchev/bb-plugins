import { z } from "zod";

const REFUSALS = [
  { status: 404, code: "thread_not_found" },
  { status: 409, code: "thread_not_writable" },
  { status: 400, code: "parent_thread_invalid" },
] as const;

const bbHttpErrorSchema = z.object({ status: z.number(), code: z.string(), message: z.string() });

/** bb's answer when `error` proves it refused the message; null when bb may have taken it. */
export function refusalOf(error: unknown): string | null {
  const answer = bbHttpErrorSchema.safeParse(error);
  if (!answer.success) return null;
  const { status, code, message } = answer.data;
  return REFUSALS.some((refusal) => refusal.status === status && refusal.code === code) ? message : null;
}
