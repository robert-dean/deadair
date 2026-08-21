#!/bin/sh
# Restart this container when the app re-renders the config it booted with.
#
# Backgrounded by the entrypoint of both stream containers, before each execs its real process.
#
# ── Why ────────────────────────────────────────────────────────────────────────────────────────
# Icecast reads icecast.xml once and Liquidsoap sources radio.env once, in the entrypoint. Nothing
# re-reads either. So a re-render — an operator changing a stream setting, or a schema rebuild that
# reseeds all five stream secrets in one query — leaves a live process holding credentials that
# match nothing, and the symptoms name something else entirely: Icecast holds an admin password the
# app has replaced, so the audience cannot be read and an audience-gated station goes quiet with a
# full running order, and Liquidsoap's source connection is refused so there is no mount at all.
# The app detects both and says so (stream.staleness.ts), but it cannot fix them: it
# has no Docker socket and should not have one, since that is root on the host in exchange for a
# process being able to restart the thing broadcasting it.
#
# This puts the authority where it costs nothing: inside the container that needs restarting. No
# socket anywhere, and each container only ever restarts itself.
#
# ── Why a POLL, and not inotify ────────────────────────────────────────────────────────────────
# Because inotify events do not cross Docker Desktop for Mac's host bind mount, and /streamconfig
# is exactly that. This is settled in this repo the hard way, twice: a watched playlist only ever
# saw what was in the directory at container start (see radio.liq, which reloads on a timer for the
# same reason), and an earlier file-drop path for DJ segments never aired a single one. A watcher
# built on inotify here would look correct and do nothing.
#
# ── Why no coordination with the app ───────────────────────────────────────────────────────────
# A restart is cheap in the one way that matters: the running order lives in the APP's memory, and
# PlayoutPusher re-pushes and re-asserts the mount lease on its next two-second reconcile. What it
# costs is the audio on air at that moment — but a restart cuts that whenever it happens, and
# waiting for a track boundary would mean running replaced credentials for minutes. In the reseed
# case the station is already off the air, so any delay is pure. The one thing genuinely lost is an
# armed talk-over cue, which is one break.
#
# ── Why the file is not read here ──────────────────────────────────────────────────────────────
# Only its mtime. The app writes these files by rename, so a reader sees a whole file or the old
# one — but this process has no business parsing secrets it does not use, and the mtime is the
# entire question.
#
# Watches the RENDERED path whatever the entrypoint actually booted from, so a container that came
# up on the committed default (/defaults/...) restarts onto the app's config the first time one is
# rendered, which used to be a manual step the README had to warn about.
#
# usage: config-watch.sh <rendered-config-path> [interval-seconds]
#        interval 0 disables the watch entirely, for an operator who would rather choose the
#        moment their station cuts.
set -u

TARGET="${1:?config-watch: no path to watch}"
INTERVAL="${2:-5}"

log() { echo "config-watch: $*" >&2; }

case "$INTERVAL" in
    '' | 0)
        log "disabled; $TARGET will not be watched and this container adopts a new config only when restarted by hand"
        exit 0
        ;;
esac

# Empty for a file that is not there, which is a legitimate starting state and not an error: the
# app may not have rendered yet. Its later appearance is a change like any other.
#
# GNU form first, since both stream images are Debian, then the BSD form so this is exercisable on
# a developer's Mac and survives a base image swap. A `stat` that answers neither is handled at
# startup rather than here: see below.
mtime() { stat -c %Y "$TARGET" 2>/dev/null || stat -f %m "$TARGET" 2>/dev/null || true; }

booted=$(mtime)

# A file that exists but will not report an mtime means neither form worked, and everything below
# would then read "unchanged" forever. That is precisely the silent nothing this whole mechanism
# exists to remove, so it is refused out loud instead: the app's own drift warning still stands,
# and an operator restarts by hand.
if [ -e "$TARGET" ] && [ -z "$booted" ]; then
    log "cannot read the mtime of $TARGET on this image; not watching. Restart this container by hand to adopt a re-rendered config"
    exit 1
fi

previous="$booted"
log "watching $TARGET every ${INTERVAL}s (booted generation ${booted:-none})"

while sleep "$INTERVAL"; do
    now=$(mtime)

    # Two conditions, and the second is the debounce. Acting on the first differing reading would
    # mean restarting into a write that is still happening if the app ever loses the atomic rename,
    # and it would restart twice when a reseed changes both files at once and this one is touched
    # in two passes. Requiring the new mtime to survive a poll costs one interval and removes both.
    if [ "$now" != "$booted" ] && [ "$now" = "$previous" ]; then
        log "$TARGET changed (${booted:-none} -> ${now:-none}); stopping so the restart policy brings this container back on the new config"
        # PID 1 is the real process: every entrypoint here `exec`s it, so this signals the thing
        # that has to go, not a shell wrapping it. Terminating it exits the container, and compose's
        # `restart: unless-stopped` starts it again with an entrypoint that re-reads the file. An
        # in-place re-exec would not do: the Liquidsoap entrypoint also backgrounds the track shim,
        # which has to be restarted with it because it inherits the same sourced environment.
        kill -TERM 1
        exit 0
    fi

    previous="$now"
done
