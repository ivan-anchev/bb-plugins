import type { BoatClient } from "./boat/client.ts";
import type { SandboxId } from "./boat/sandbox.ts";
import { shellQuote } from "./shell.ts";

const REMOVED = "removed ";

const resetScript = (instanceKey: string): string => `set -eu
marker="$HOME/.local/state/bb-boat/instance-key"
[ "$(cat "$marker" 2>/dev/null || true)" = ${shellQuote(instanceKey)} ] && exit 0
for unit in "$HOME"/.config/systemd/user/bb-host-daemon-*.service; do
  [ -e "$unit" ] || continue
  name=$(basename "$unit")
  systemctl --user disable --now "$name" || true
  state=$(systemctl --user show --property=ActiveState --value "$name")
  case "$state" in
    inactive|failed) ;;
    *) echo "$name did not stop (state: $state)" >&2; exit 1 ;;
  esac
  rm -f "$unit"
  echo "${REMOVED}~/.config/systemd/user/$name"
done
if [ -L "$HOME/.local/bin/bb" ]; then
  case "$(readlink "$HOME/.local/bin/bb")" in
    */.bb-machines/*) rm -f "$HOME/.local/bin/bb"; echo "${REMOVED}~/.local/bin/bb" ;;
  esac
fi
if [ -e "$HOME/.bb-machines" ]; then rm -rf "$HOME/.bb-machines"; echo "${REMOVED}~/.bb-machines"; fi
systemctl --user daemon-reload
mkdir -p "$(dirname "$marker")"
printf '%s\\n' ${shellQuote(instanceKey)} > "$marker"`;

/** The paths it removed, for one provisioning step; empty for a clean disk or a retried create. */
export async function resetInstance(client: Pick<BoatClient, "run">, sandboxId: SandboxId, instanceKey: string, signal: AbortSignal): Promise<string[]> {
  let output = "";
  const { exitCode } = await client.run(sandboxId, {
    command: resetScript(instanceKey),
    timeoutSeconds: 60,
    signal,
    onOutput: (chunk) => void (output += chunk),
  });
  if (exitCode !== 0)
    throw new Error(`Could not remove the old bb machine state on sandbox ${sandboxId} (exit ${exitCode}): ${output.trim()}`);
  return output
    .split("\n")
    .filter((line) => line.startsWith(REMOVED))
    .map((line) => line.slice(REMOVED.length));
}
