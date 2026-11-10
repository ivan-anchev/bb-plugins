// What bb's host daemon needs from boat, set up before each enrollment (create and resume), because the
// daemon reads it when it starts:
//
// 1. boat's sign-ins. boat writes the account's sign-ins (CLAUDE_CODE_OAUTH_TOKEN, GITHUB_TOKEN, the
//    ChatGPT tokens) to /run/ascii-secrets/env.sh at every start and resume, and only ~/.bashrc reads
//    that file. bb's daemon is a systemd user service that never runs ~/.bashrc, so without this its
//    agent turns start signed out ("Not logged in · Please run /login").
// 2. GitHub over HTTPS with boat's GITHUB_TOKEN, SSH remotes included: the four git settings bb core sends
//    with its forwarded login (cleared github.com helpers, a token helper, the two insteadOf rewrites), as
//    GIT_CONFIG_* on the daemon under core's exact variable names. When bb forwards a login, core's
//    per-command GIT_CONFIG_COUNT, GIT_CONFIG_KEY_n and GIT_CONFIG_VALUE_n replace these, so bb's wins
//    with no ordering code.
//
// Env on the daemon, not ~/.gitconfig: it reaches only what bb's daemon runs (turns, terminals, the
// clone, .bb-env-setup.sh), never lands in a saved snapshot, and follows bb's own rule of no
// credentials in global git config. Its own helper rather than boat's `gh auth git-credential`, because
// the git config a template carries is unknown. Scoped to github.com, so a template's helpers for other
// hosts keep working.
import type { BoatClient } from "./boat/client.ts";
import type { SandboxId } from "./boat/sandbox.ts";

/**
 * A drop-in systemd applies to every `bb-host-daemon-*.service`, written before core installs the unit.
 * At each daemon start it copies boat's file without `export` (systemd reads only NAME=value) into the
 * runtime directory, a fresh file only the user can read, in memory as boat's own copy is, and loads it.
 * The `-`s keep a sandbox in an environment that passes nothing starting as before.
 *
 * systemd expands `%` specifiers in Environment= but no `$NAME`, so `$1` and `$GITHUB_TOKEN` reach the
 * `sh -c` git runs the helper in as written; the helper must hold no `%`. The command holds no secret:
 * boat keeps command text for 90 days.
 */
const WRITE_DROP_IN = `set -e
dir="$HOME/.config/systemd/user/bb-host-daemon-.service.d"
mkdir -p "$dir"
cat > "$dir/boat.conf" <<'CONF'
[Service]
ExecStartPre=-/bin/sh -c 'umask 077; rm -f %t/boat-sign-ins.env; sed -n "s/^export //p" /run/ascii-secrets/env.sh > %t/boat-sign-ins.env'
EnvironmentFile=-%t/boat-sign-ins.env
Environment=GIT_CONFIG_COUNT=4
Environment="GIT_CONFIG_KEY_0=credential.https://github.com.helper" "GIT_CONFIG_VALUE_0="
Environment="GIT_CONFIG_KEY_1=credential.https://github.com.helper"
Environment='GIT_CONFIG_VALUE_1=!f() { test "$1" = get || return 0; test -n "$GITHUB_TOKEN" || return 0; echo username=x-access-token; echo "password=$GITHUB_TOKEN"; }; f'
Environment="GIT_CONFIG_KEY_2=url.https://github.com/.insteadOf" "GIT_CONFIG_VALUE_2=git@github.com:"
Environment="GIT_CONFIG_KEY_3=url.https://github.com/.insteadOf" "GIT_CONFIG_VALUE_3=ssh://git@github.com/"
CONF`;

/** Before every bootstrap: core starts the daemon there, and the start is when it reads all of this. */
export async function prepareDaemon(client: Pick<BoatClient, "run">, sandboxId: SandboxId, signal: AbortSignal): Promise<void> {
  const { exitCode } = await client.run(sandboxId, { command: WRITE_DROP_IN, timeoutSeconds: 30, signal, onOutput: () => {} });
  if (exitCode !== 0) throw new Error(`Could not set up bb's daemon for boat's sign-ins and GitHub on sandbox ${sandboxId} (exit ${exitCode}).`);
}
