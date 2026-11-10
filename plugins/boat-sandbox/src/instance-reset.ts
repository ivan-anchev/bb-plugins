// Create only, never resume: a sandbox started from a saved snapshot may carry the bb identity of the
// machine it was saved from. That machine's daemon unit is enabled with lingering on, so it
// starts at boot as the old host, and bb's daemon CLI refuses another host's identity in its data
// directory, which also holds that machine's checkouts.
//
// cloud-init's per-instance model: a marker holds the instance id, and the per-instance work runs only
// when the marker differs. The instance id is core's create key, so a retried create that already
// enrolled this launch never wipes its own identity (core requires create to be idempotent by key).
// Everything else on the disk, the user's own logins included, is left alone.
import type { BoatClient } from "./boat/client.ts";
import type { SandboxId } from "./boat/sandbox.ts";
import { shellQuote } from "./shell.ts";

const REMOVED = "removed ";

/**
 * Stops and removes every bb daemon unit, the `bb` symlink into the old data directory, and the data
 * directory, then records the key. The command holds no secret (boat keeps command text for 90 days):
 * the key is the thread id, already in the sandbox's name and labels. The plugin's drop-in directory
 * `bb-host-daemon-.service.d` does not match `*.service`.
 *
 * Nothing is removed until systemd confirms the unit is not running: removing the identity under a live
 * old daemon would enroll this sandbox beside it. `disable` fails for a unit systemd does not know, which
 * is not running either, so the unit's state decides; a `systemctl` that cannot answer exits the script.
 */
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
