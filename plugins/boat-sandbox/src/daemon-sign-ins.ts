// boat writes the account's sign-ins (CLAUDE_CODE_OAUTH_TOKEN, GITHUB_TOKEN, the ChatGPT tokens) to
// /run/ascii-secrets/env.sh at every start and resume, and only ~/.bashrc reads that file. bb's host
// daemon is a systemd user service that never runs ~/.bashrc, so without this its agent turns start
// signed out (checked live on 2026-11-09: "Not logged in · Please run /login").
import type { BoatClient } from "./boat/client.ts";
import type { SandboxId } from "./boat/sandbox.ts";

/**
 * A drop-in systemd applies to every `bb-host-daemon-*.service`, written before core installs the unit.
 * At each daemon start it copies boat's file without `export` (systemd reads only NAME=value) into the
 * runtime directory, a fresh file only the user can read, in memory as boat's own copy is, and loads it.
 * The `-`s keep a sandbox in an environment that passes nothing starting as before. The command holds no
 * secret: boat keeps command text for 90 days.
 */
const WRITE_DROP_IN = `set -e
dir="$HOME/.config/systemd/user/bb-host-daemon-.service.d"
mkdir -p "$dir"
cat > "$dir/boat-sign-ins.conf" <<'CONF'
[Service]
ExecStartPre=-/bin/sh -c 'umask 077; rm -f %t/boat-sign-ins.env; sed -n "s/^export //p" /run/ascii-secrets/env.sh > %t/boat-sign-ins.env'
EnvironmentFile=-%t/boat-sign-ins.env
CONF`;

/** Before every bootstrap: core starts the daemon there, and the start is when it reads boat's sign-ins. */
export async function passSignInsToDaemon(client: Pick<BoatClient, "run">, sandboxId: SandboxId, signal: AbortSignal): Promise<void> {
  const { exitCode } = await client.run(sandboxId, { command: WRITE_DROP_IN, timeoutSeconds: 30, signal, onOutput: () => {} });
  if (exitCode !== 0) throw new Error(`Could not pass boat's sign-ins to bb's daemon on sandbox ${sandboxId} (exit ${exitCode}).`);
}
