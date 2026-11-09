// How this bb server marks and recognises what it owns on boat: the owner id, labels, names and
// the resource core persists for each machine.
import { randomUUID } from "node:crypto";
import type { JsonValue, PluginKvStorage } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { Labels } from "./boat/client.ts";
import { accountId, sandboxId } from "./boat/wire.ts";

// Label keys match boat's [A-Za-z0-9][A-Za-z0-9._/-]{0,62}.
const OWNER = "bb.boat/owner";
const ROLE = "bb.boat/role";
const KEY = "bb.boat/key";
const OWNER_ID_KV_KEY = "owner-id";

/** A random id per bb server, kept in plugin KV. It scopes every boat list, so two bb servers on one account never touch each other's sandboxes. */
export async function loadOwnerId(kv: PluginKvStorage): Promise<string> {
  const existing = await kv.get<string>(OWNER_ID_KV_KEY);
  if (existing !== undefined) return existing;
  const created = randomUUID();
  await kv.set(OWNER_ID_KV_KEY, created);
  return created;
}

/** The labels of the machine sandbox core asked for with `key`. */
export const machineLabels = (ownerId: string, key: string): Labels => ({ [OWNER]: ownerId, [ROLE]: "machine", [KEY]: key });

/** Readable in `boat list`. For a composed create the key is the thread id. */
export const sandboxName = (key: string): string => `bb ${key}`;

const resourceSchema = z.object({ sandboxId, key: z.string().min(1), accountId }).strict();

/** Core persists this per host and any plugin can read it, so it holds no credential. */
export type BoatResource = z.output<typeof resourceSchema>;

export const parseResource = (value: JsonValue): BoatResource => resourceSchema.parse(value);
