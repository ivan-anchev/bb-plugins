import type { BoatClient } from "./boat/client.ts";
import type { SandboxId } from "./boat/sandbox.ts";

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
