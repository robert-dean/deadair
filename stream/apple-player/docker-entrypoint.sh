#!/bin/sh
# Start the three things the player needs, then supervise the player itself.
#
# Shaped after `stream/spotify-shim-run.sh`: one throttled restart loop, because a player that cannot
# start (no bridge secret seeded yet, the app still booting) must not become a restart storm, and one
# that dies at 3am must come back without anyone watching.
#
# Order matters and is not arbitrary:
#   1. XDG_RUNTIME_DIR must exist before PulseAudio, which puts its socket there.
#   2. PulseAudio must hold the null sink before Chrome starts, or Chrome picks a null default of its
#      own and every capture is silence that looks like a working file.
#   3. Xvfb must be up before Chrome, which will not start headful without a display and must not be
#      started headless, because the Widevine CDM does not work there.
set -u

THROTTLE="${APPLE_PLAYER_RESTART_THROTTLE:-5}"
DISPLAY_NUM="${DISPLAY:-:99}"

log() { echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') apple-player-run: $*"; }

# ── The config, from the same file every other stream container reads ─────────
# `PLAYOUT_BRIDGE_SECRET` is rendered into radio.env by the app (`stream.config.ts`), on the
# streamconfig volume, and sourcing it here is how this container comes to hold the same secret the app
# signs its URLs with. It is exactly what the Liquidsoap entrypoint does before backgrounding the
# Spotify shim, and it has to be done the same way for the same reason: the secret is the app's to
# rotate, so reading it from the file the app writes means a rotation is a restart rather than an edit
# in two places.
#
# Without this the service would depend on `${PLAYOUT_BRIDGE_SECRET}` being exported into `docker
# compose` from somebody's shell, which is empty on a clean checkout — and the player would refuse to
# start, correctly but confusingly, on a station whose secret was seeded perfectly well.
#
# `set -a` so the sourced values are exported to the player. The committed static default is the
# fallback, as it is there, so a container that comes up before the app has ever rendered anything
# starts and reports its state instead of looping.
cfg=/streamconfig/radio.env
[ -f "$cfg" ] || cfg=/defaults/radio.env
if [ -f "$cfg" ]; then
    log "sourcing $cfg"
    set -a
    # shellcheck disable=SC1090
    . "$cfg"
    set +a
else
    log "no radio.env at /streamconfig or /defaults; running on the process environment alone"
fi

mkdir -p "${XDG_RUNTIME_DIR:-/tmp/xdg}" 2>/dev/null || true
chmod 700 "${XDG_RUNTIME_DIR:-/tmp/xdg}" 2>/dev/null || true

# ── Stale state from the last run, which a restart does not clear ──────────────
# MEASURED, and the reason this block exists rather than an assumption about tidiness. `docker restart`
# reruns this script in the SAME container filesystem, so the lock Xvfb left behind is still there and
# it refuses the display ("already active for display 99"); PulseAudio finds its own runtime directory
# and refuses too. Chrome then has no display, `could not attach to chrome` four times, and the
# supervisor loops forever on a container Docker reports as Up.
#
# It matters more here than it looks: `restart: unless-stopped` is how this container is meant to come
# back, so without these two lines the only way to recover it is to delete and recreate it.
rm -f "/tmp/.X${DISPLAY_NUM#:}-lock" "/tmp/.X11-unix/X${DISPLAY_NUM#:}" 2>/dev/null || true
rm -rf "${XDG_RUNTIME_DIR:-/tmp/xdg}/pulse" 2>/dev/null || true

log "starting Xvfb on $DISPLAY_NUM"
Xvfb "$DISPLAY_NUM" -screen 0 1280x900x24 -nolisten tcp >/dev/null 2>&1 &
xvfb=$!

log "starting pulseaudio"
# Not daemonized: this script is the supervisor, and a backgrounded child it can see die is worth more
# than one that forks away. `--exit-idle-time=-1` stops it quitting between records.
pulseaudio --exit-idle-time=-1 --disallow-exit --disallow-module-loading=false >/dev/null 2>&1 &
pulse=$!

# The sink is loaded by /etc/pulse/default.pa, but the daemon takes a moment to get there and Chrome
# asking first is the failure this wait exists to prevent. Ten seconds, then carry on and let
# /health report it: a container that is up and honest beats one that never starts.
i=0
while [ "$i" -lt 50 ]; do
    if pactl list short sources 2>/dev/null | grep -q "${APPLE_PLAYER_SINK:-deadair}.monitor"; then
        log "capture sink is ready"
        break
    fi
    i=$((i + 1))
    sleep 0.2
done
[ "$i" -lt 50 ] || log "warning: the capture sink did not appear; /health will say so"

# ── The sign-in door, which is shut unless it is asked for ────────────────────
# The operator has to sign in to Apple Music once, in this container's Chrome, and then the profile on
# /state keeps the session for good. That is one browser visit per install — the same shape as the
# Spotify shim's one-time `POST /authorize` — and this is how the browser is reached, since it is inside
# a container with no display.
#
# Three decisions worth stating, because each one is a way to get this wrong:
#
#   * It is OFF unless `APPLE_PLAYER_VNC=1`. A permanent remote-desktop service for a once-per-install
#     step is a standing surface in exchange for nothing, and the station needs it on exactly never.
#   * It REFUSES to start without a password. x11vnc has to bind 0.0.0.0 inside the container for a
#     published port to reach it (`-localhost` binds the container's own loopback, which Docker's port
#     forwarding does not arrive on), so anything else on the container network could otherwise drive
#     the browser that holds the operator's Apple Music session. Refusing is the safe half of that
#     trade, and the log line says which variable is missing.
#   * The port is not published by default either. Turning this on is two deliberate steps, and
#     stream/apple-player/README.md spells out both.
vnc=''
if [ "${APPLE_PLAYER_VNC:-0}" = "1" ]; then
    if [ -z "${APPLE_PLAYER_VNC_PASSWORD:-}" ]; then
        log "refusing to start VNC: APPLE_PLAYER_VNC=1 but APPLE_PLAYER_VNC_PASSWORD is empty"
    else
        x11vnc -storepasswd "$APPLE_PLAYER_VNC_PASSWORD" "${XDG_RUNTIME_DIR:-/tmp/xdg}/vncpasswd" >/dev/null 2>&1
        log "starting x11vnc on 5900 (sign in, then turn APPLE_PLAYER_VNC back off)"
        x11vnc -display "$DISPLAY_NUM" -rfbport 5900 -rfbauth "${XDG_RUNTIME_DIR:-/tmp/xdg}/vncpasswd" \
            -forever -shared -noxdamage -quiet >/dev/null 2>&1 &
        vnc=$!
    fi
fi

child=''
trap 'if [ -n "$child" ]; then kill "$child" 2>/dev/null || true; fi; if [ -n "$vnc" ]; then kill "$vnc" 2>/dev/null || true; fi; kill "$pulse" "$xvfb" 2>/dev/null || true; exit 0' TERM INT

while :; do
    # Node runs the TypeScript directly: type stripping is native since Node 23 and every import here
    # names a `.ts` file, so there is no build step, no bundler and no dependency in this container
    # beyond the runtime itself.
    node /app/src/main.ts &
    child=$!
    wait "$child"
    rc=$?
    child=''
    log "player exited ($rc); restarting in ${THROTTLE}s"
    sleep "$THROTTLE"
done
