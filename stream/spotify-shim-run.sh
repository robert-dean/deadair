#!/bin/sh
# Supervisor for deadair-shim, backgrounded by the container entrypoint before it execs Liquidsoap.
#
# The entrypoint invokes this as `sh <path>` rather than relying on the exec bit: this file is
# bind-mounted over the image's copy, so the HOST's permissions are what the container sees and the
# Dockerfile's chmod does not apply.
#
# The shim serves one Spotify track per HTTP request (see stream/spotify-shim), so Liquidsoap's
# request.queue can download a Spotify track ahead of air the way it downloads a pre-signed
# Subsonic URL. It is not an audio source and Liquidsoap does not spawn it: nothing in radio.liq
# knows about it, and the app talks to it directly.
#
# Its config comes from the process env, which the entrypoint sources from radio.env (`set -a`):
#   PLAYOUT_BRIDGE_SECRET   signs the track URLs; the same secret gating /control/*
#   SPOTIFY_SHIM_SECRET     gates POST /session and POST /authorize, which both decide whose
#                           Spotify account this shim fetches as
#   SHIM_ADDR               listen address (default :3679)
#   SHIM_CREDENTIALS        where the shim keeps its own authorization (default
#                           /streamstate/spotify-credentials.json, a writable compose volume)
#   SHIM_CALLBACK_URL       override the redirect Spotify returns the operator's browser to;
#                           defaults to http://127.0.0.1:<SHIM_ADDR port>/login, which is the
#                           address compose publishes on the host
#
# Diagnostics go to a log on the mounted volume: nothing here is attached to a terminal, and the
# entrypoint's stdout belongs to Liquidsoap.
#
# The restart loop is throttled: a shim that cannot start (no secret yet, app still booting) must
# not become a restart storm, and one that dies at 3am must come back without anyone watching.
set -u

LOG_DIR="${SHIM_LOG_DIR:-/streamlogs}"
LOG="$LOG_DIR/spotify-shim.log"
THROTTLE="${SHIM_RESTART_THROTTLE:-5}"

mkdir -p "$LOG_DIR" 2>/dev/null || true
log() { echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') spotify-shim-run: $*" >>"$LOG" 2>/dev/null || true; }

# Forward termination to the child so a `docker stop` does not leave it running out its 15s
# graceful shutdown while the supervisor is already gone.
child=''
trap 'if [ -n "$child" ]; then kill "$child" 2>/dev/null || true; fi; exit 0' TERM INT

log "starting (addr ${SHIM_ADDR:-:3679})"
while :; do
    deadair-shim >>"$LOG" 2>&1 &
    child=$!
    wait "$child"
    rc=$?
    child=''
    log "deadair-shim exited ($rc); restarting in ${THROTTLE}s"
    sleep "$THROTTLE"
done
