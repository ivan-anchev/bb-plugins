boat Sandbox gives bb threads their own cloud computer on boat.dev. A sandbox starts when a thread needs one, stops after it has been idle, and resumes later on the same disk, so the work on it is still there.

## What you get

- **A boat Sandbox section in Settings** for your boat API key, how long a sandbox may sit idle before it stops (15 minutes by default), and the default sandbox size.
- **`bb boat status`**, which checks the key and shows the boat account, the wallet it bills, whether zero data retention is on, and how many sandbox starts are left in each window. Anything missing comes with the one step that fixes it.

## How it works

The plugin talks to boat's REST API with a key you make with `boat api-key create bb --preset ci`. bb stores the key as a secret file and never shows it again. The plugin refuses accounts with zero data retention, because a stop there deletes the sandbox, and keys that bill an organization wallet.

This release sets up and checks the account; creating sandboxes for threads comes next.
