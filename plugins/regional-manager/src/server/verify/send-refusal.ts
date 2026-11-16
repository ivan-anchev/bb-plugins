// Whether an error from bb's threads.send proves that bb refused the message before taking it. An
// error alone proves nothing: a call can fail after bb took the message, as when it times out, the
// connection drops or the server fails while it answers. Only the answers below are proof.
//
// bb's SDK turns an error answer into a BbHttpError with its status and the `code` of the body bb's
// ApiError writes; a timeout, a dropped connection or any other failure carries neither. bb takes a
// message by appending it to the thread in one transaction, or by putting it in the thread's queue.
// Each answer below is thrown on the send route before either, or inside that transaction, which
// it rolls back. Lines are in bb-app 0.49.0's server/dist/start-server.js.
import { z } from "zod";

const REFUSALS = [
  /**
   * The thread is missing or deleted: requirePublicThread (:54339) as the route's first step
   * (:213515), and the re-reads before a dispatch queues or reattempts (:105148, :105352).
   */
  { status: 404, code: "thread_not_found" },
  /**
   * The thread can't take a message now (archived, deleted, stopping, still starting, or already
   * active for this mode): throwThreadNotWritable (:54141), from ensureThreadIsWritable (:104404)
   * as a dispatch starts (:105038, :104636) and reattempts (:105355), resolveSendMode (:104418),
   * the check before a dispatch queues (:105159), and ensureThreadCanStartRequest (:110020)
   * before the append (:104643) and inside its transaction (:104794).
   */
  { status: 409, code: "thread_not_writable" },
  /**
   * The sender thread is missing or deleted: throwSenderThreadInvalid (:54187), from
   * resolveMessageSenderThreadId (:104474) as a dispatch starts (:105058, :104645).
   */
  { status: 400, code: "parent_thread_invalid" },
] as const;

/** BbHttpError (:202245), as resolveResponse throws it (:202299). */
const bbHttpErrorSchema = z.object({ status: z.number(), code: z.string(), message: z.string() });

/** bb's answer when `error` proves it refused the message; null when bb may have taken it. */
export function refusalOf(error: unknown): string | null {
  const answer = bbHttpErrorSchema.safeParse(error);
  if (!answer.success) return null;
  const { status, code, message } = answer.data;
  return REFUSALS.some((refusal) => refusal.status === status && refusal.code === code) ? message : null;
}
