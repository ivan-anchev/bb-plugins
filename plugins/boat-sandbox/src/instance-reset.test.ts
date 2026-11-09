import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { BoatClient } from "./boat/client.ts";
import { sandboxId } from "./boat/wire.ts";
import { resetInstance } from "./instance-reset.ts";

const SANDBOX = sandboxId.parse("bx_abcdefgh");
const UNIT = "bb-host-daemon-ivananchev-getbb-app-host_66jpgt267u.service";
const signal = () => AbortSignal.timeout(10_000);

/** A sandbox whose commands print `output` and exit with `exitCode`. */
const answering = (output: string, exitCode = 0): Pick<BoatClient, "run"> => ({
  run: async (_id, { onOutput }) => (onOutput(output), { exitCode }),
});

test("the removed paths are read from the command's output, whatever else it prints", async () => {
  const output = `Removed "/home/user/.config/systemd/user/default.target.wants/${UNIT}".\nremoved ~/.config/systemd/user/${UNIT}\nremoved ~/.bb-machines\n`;

  assert.deepEqual(await resetInstance(answering(output), SANDBOX, "thr_1", signal()), [`~/.config/systemd/user/${UNIT}`, "~/.bb-machines"]);
  assert.deepEqual(await resetInstance(answering(""), SANDBOX, "thr_1", signal()), []);
});

test("a reset that fails stops the create with the command's output", async () => {
  await assert.rejects(resetInstance(answering("Failed to connect to bus\n", 1), SANDBOX, "thr_1", signal()), {
    message: `Could not remove the old bb machine state on sandbox ${SANDBOX} (exit 1): Failed to connect to bus`,
  });
});

/**
 * How the sandbox's systemd answers the reset, as the body of a stub `systemctl`. Its calls are
 * `--user disable --now <unit>`, `--user show --property=ActiveState --value <unit>`, `--user daemon-reload`.
 */
const systemd = {
  stopsTheDaemon: `[ "$2" = show ] && echo inactive`,
  refusesTheStop: `case "$2" in disable) echo "Failed to stop $4: Operation refused." >&2; exit 1 ;; show) echo active ;; esac`,
  unreachable: `echo "Failed to connect to bus: No medium found" >&2; exit 1`,
  doesNotKnowTheUnit: `case "$2" in disable) echo "Failed to disable unit: Unit file $4 does not exist." >&2; exit 1 ;; show) echo inactive ;; esac`,
};

/** A disk saved from a bb machine, in a scratch HOME, with a `systemctl` that logs its arguments and answers as `answer`. */
function savedBbMachine(answer = systemd.stopsTheDaemon) {
  const home = mkdtempSync(join(tmpdir(), "bb-boat-reset-"));
  const bin = join(home, "stub-bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "systemctl"), `#!/bin/sh\necho "$*" >> "${home}/systemctl.log"\n${answer}\nexit 0\n`, { mode: 0o755 });
  mkdirSync(join(home, ".config/systemd/user/bb-host-daemon-.service.d"), { recursive: true });
  writeFileSync(join(home, ".config/systemd/user", UNIT), "[Service]\n");
  mkdirSync(join(home, ".bb-machines/ivananchev.getbb.app/checkouts"), { recursive: true });
  mkdirSync(join(home, ".local/bin"), { recursive: true });
  symlinkSync(join(home, ".bb-machines/ivananchev.getbb.app/bin/bb"), join(home, ".local/bin/bb"));
  writeFileSync(join(home, ".claude.json"), "{}");
  // Runs the command as boat would, in a shell on the sandbox.
  const sandbox: Pick<BoatClient, "run"> = {
    async run(_id, { command, onOutput }) {
      const ran = spawnSync("sh", ["-c", command], { env: { HOME: home, PATH: `${bin}:/usr/bin:/bin` }, encoding: "utf8" });
      onOutput(ran.stdout + ran.stderr);
      return { exitCode: ran.status ?? 128 };
    },
  };
  return {
    home,
    sandbox,
    systemctl: () => readFileSync(join(home, "systemctl.log"), "utf8"),
    /** The old machine's identity, unit and `bb` link are all still on the disk, and no create key is recorded. */
    assertUntouched() {
      assert.equal(existsSync(join(home, ".bb-machines/ivananchev.getbb.app/checkouts")), true);
      assert.equal(existsSync(join(home, ".config/systemd/user", UNIT)), true);
      assert.equal(lstatSync(join(home, ".local/bin/bb")).isSymbolicLink(), true);
      assert.equal(existsSync(join(home, ".local/state/bb-boat/instance-key")), false);
    },
  };
}

test("on a disk saved from a bb machine, the reset removes its bb state once per create key and nothing else", async () => {
  const { home, sandbox, systemctl } = savedBbMachine();

  const removed = await resetInstance(sandbox, SANDBOX, "thr_1", signal());

  assert.deepEqual(removed, [`~/.config/systemd/user/${UNIT}`, "~/.local/bin/bb", "~/.bb-machines"]);
  assert.equal(systemctl(), `--user disable --now ${UNIT}\n--user show --property=ActiveState --value ${UNIT}\n--user daemon-reload\n`);
  assert.equal(existsSync(join(home, ".bb-machines")), false);
  assert.equal(existsSync(join(home, ".config/systemd/user/bb-host-daemon-.service.d")), true);
  assert.equal(existsSync(join(home, ".claude.json")), true);
  assert.equal(readFileSync(join(home, ".local/state/bb-boat/instance-key"), "utf8"), "thr_1\n");

  // A retried create of the same launch has enrolled by now: it must not lose that identity.
  mkdirSync(join(home, ".bb-machines/ivananchev.getbb.app"), { recursive: true });
  assert.deepEqual(await resetInstance(sandbox, SANDBOX, "thr_1", signal()), []);
  assert.equal(existsSync(join(home, ".bb-machines/ivananchev.getbb.app")), true);

  // A sandbox made from this disk later is another instance.
  assert.deepEqual(await resetInstance(sandbox, SANDBOX, "thr_2", signal()), ["~/.bb-machines"]);
});

test("when the old daemon does not stop, the reset fails and keeps its identity, so a retry tries again", async () => {
  const disk = savedBbMachine(systemd.refusesTheStop);

  await assert.rejects(resetInstance(disk.sandbox, SANDBOX, "thr_1", signal()), {
    message: `Could not remove the old bb machine state on sandbox ${SANDBOX} (exit 1): Failed to stop ${UNIT}: Operation refused.\n${UNIT} did not stop (state: active)`,
  });
  disk.assertUntouched();
});

test("when systemd cannot be asked, the reset fails before removing anything", async () => {
  const disk = savedBbMachine(systemd.unreachable);

  await assert.rejects(resetInstance(disk.sandbox, SANDBOX, "thr_1", signal()), {
    message: `Could not remove the old bb machine state on sandbox ${SANDBOX} (exit 1): Failed to connect to bus: No medium found\nFailed to connect to bus: No medium found`,
  });
  disk.assertUntouched();
});

test("a unit systemd does not know is not running, so the reset goes ahead", async () => {
  const { home, sandbox } = savedBbMachine(systemd.doesNotKnowTheUnit);

  assert.deepEqual(await resetInstance(sandbox, SANDBOX, "thr_1", signal()), [`~/.config/systemd/user/${UNIT}`, "~/.local/bin/bb", "~/.bb-machines"]);
  assert.equal(readFileSync(join(home, ".local/state/bb-boat/instance-key"), "utf8"), "thr_1\n");
});
