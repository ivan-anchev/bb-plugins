boat Sandbox gives bb threads their own cloud computer on boat.dev. A sandbox starts when a thread needs one, stops after it has been idle, and resumes later on the same disk, so the work on it is still there.

## What you get

- **boat Sandbox in the new-thread environment picker.** A thread started there gets a new boat sandbox with the project cloned and `.bb-env-setup.sh` run, and the sandbox is deleted when bb removes the machine. From the CLI: `bb thread spawn --environment-provider boat-sandbox --machine-inputs '{"preset":"large"}' --prompt "…"`.
- **A boat Sandbox section in Settings** for your boat API key, how long a sandbox may sit idle before it stops (15 minutes by default), and the default sandbox size.
- **`bb boat status`**, which checks the key and shows the boat account, the wallet it bills, whether zero data retention is on, and how many sandbox starts are left in each window. Anything missing comes with the one step that fixes it.
- **`bb boat sandboxes`**, which lists this server's sandboxes with their bb machines and notes anything out of step, such as a sandbox boat stopped by itself or one no machine uses.

## How it works

The plugin talks to boat's REST API with a key you make with `boat api-key create bb --preset ci`. bb stores the key as a secret file and never shows it again. The plugin refuses accounts with zero data retention, because a stop there deletes the sandbox, and keys that bill an organization wallet.

bb's enrollment secret travels to the sandbox as a file in a private directory, never as command text, so it never appears in boat's 90-day command history. Each sandbox carries labels that tie it to this bb server and thread, so an interrupted create picks up its sandbox instead of starting a second one.

Once a minute the plugin stops a sandbox whose threads have been idle for the set time; a thread running a long command is never idle. A follow-up to the thread resumes the same sandbox in seconds, with its files where they were. While bb runs, the plugin keeps pushing boat's auto-stop deadline back, so boat never stops a sandbox bb is using. The same check puts bb right when boat and bb disagree: a sandbox boat stopped is recorded as suspended so a follow-up resumes it, a suspended sandbox someone resumed by hand is stopped again, and a sandbox no machine uses is stopped after 15 minutes but never deleted.
