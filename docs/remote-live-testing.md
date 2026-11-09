# Live-testing a plugin on a remote machine

`bb plugin install|dev` run on the bb server, which reads plugin paths from its
own disk. On a remote machine (a sandbox, or any checkout under
`~/.bb-machines/`), a path from your checkout fails with
`no readable package.json`. Test against a throwaway bb server on the machine
instead.

## Start a throwaway server

```sh
npm i -g --prefix /tmp/bbapp bb-app@"$(bb --version)"
mkdir -p /tmp/bb-test
setsid nohup env BB_DATA_DIR=/tmp/bb-test BB_SERVER_PORT=48886 \
  BB_HOST_DAEMON_PORT=48887 BB_TELEMETRY=0 /tmp/bbapp/bin/bb-server \
  > /tmp/bb-test/server.log 2>&1 < /dev/null & disown
```

`setsid … & disown` keeps the server alive after your command returns.

## Point bb at it

Shell state does not carry between commands, so define this in each one:

```sh
local_bb() { env -u BB_SERVER_HEADERS -u BB_CLI BB_DATA_DIR=/tmp/bb-test \
  BB_SERVER_URL=http://127.0.0.1:48886 /tmp/bbapp/bin/bb "$@"; }
local_bb status   # must print "Data dir: /tmp/bb-test"
```

Then `local_bb plugin install ./plugins/<id> --yes`,
`local_bb plugin dev plugins/<id>`, and the plugin's own commands.

## Check the UI

The server serves the bb web app at `http://127.0.0.1:48886` with no login.
Skip the onboarding screen. Drive it with headless Chrome on this machine:

```sh
bb browser-automation open --backend local --headless --machine <this host id> --json
```

Run this without `local_bb`, then open the URL above in that session.

## Limits

The server starts empty: built-in plugins only, with no settings, secrets or
projects. Set what the plugin needs on it. Machine-provider flows, like a
sandbox enrolling, need a server that remote machines can reach. Test those
from the bb server's machine.

## Clean up

```sh
local_bb plugin remove <id> --yes
pkill -f '[/]tmp/bbapp/'   # the brackets stop it matching this shell
rm -rf /tmp/bb-test /tmp/bbapp
```
