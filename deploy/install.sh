#!/bin/sh
# deadair, installed with Docker Compose in one command:
#
#     curl -fsSL https://deadair.radio/install.sh | sh
#
# It asks four things (where to put the station, which tag, which port, and the address you will
# type to reach it), writes `docker-compose.yml` and `.env` from deploy/ in the repository, hands the
# data directory to the station's user, starts it, waits for it to come up, and runs
# `deadair-doctor` inside it. There are no keys to generate: the station makes its own on the
# first boot.
#
# Safe to run again. An existing `.env` is kept exactly as it is, so a second run brings an
# existing station back up rather than reconfiguring it. To update, run `docker compose pull` and
# `docker compose up -d` in the station's directory.
#
# Every question has a default and an environment variable that answers it, so it also runs with
# no terminal at all: DEADAIR_DIR, DEADAIR_VARIANT, DEADAIR_PORT, DEADAIR_URL. DEADAIR_SOURCE is
# where the two files are fetched from, `main` by default; point it at a release tag's deploy/
# directory to install that release's files.
#
# The whole script is a function called on the last line, so a download cut short runs nothing.

set -eu

main() {
    source_url="${DEADAIR_SOURCE:-https://raw.githubusercontent.com/robert-dean/deadair/main/deploy}"

    say() { printf '%s\n' "$*"; }
    fail() {
        printf 'deadair: %s\n' "$*" >&2
        exit 1
    }

    # `curl | sh` gives the script the pipe as its stdin, so questions are read from the terminal
    # itself. Without one, every question takes its default or its variable.
    if [ -r /dev/tty ] && [ -w /dev/tty ] && (: < /dev/tty) 2> /dev/null; then
        tty=/dev/tty
    else
        tty=
    fi
    ask() {
        # ask <question> <default>: prints the answer, or the default for an empty one.
        if [ -n "$tty" ]; then
            printf '%s [%s]: ' "$1" "$2" > "$tty"
            IFS= read -r answer < "$tty" || answer=
        else
            answer=
        fi
        printf '%s' "${answer:-$2}"
    }

    command -v docker > /dev/null 2>&1 || fail "Docker is not installed. https://docs.docker.com/engine/install/"
    docker compose version > /dev/null 2>&1 || fail "the Docker Compose plugin is not installed (docker compose version did not answer)."
    command -v curl > /dev/null 2>&1 || fail "curl is not installed."

    # The image is amd64 only. Docker Desktop on Apple Silicon runs it under emulation, which works
    # and is slow; a Linux arm64 host without emulation set up cannot run it at all.
    case "$(uname -m)" in
        x86_64 | amd64) ;;
        *) say "Note: the image is built for amd64 only, and this machine is $(uname -m). It runs under emulation where Docker provides it (Docker Desktop does), and slowly." ;;
    esac

    say "deadair: an AI radio station."
    say ""

    dir=$(ask "Where should the station live" "${DEADAIR_DIR:-$HOME/deadair}")
    mkdir -p "$dir"
    cd "$dir"

    if [ -f .env ]; then
        say "Keeping the .env already in $dir. Delete it and run this again to start over."
        fresh=
    else
        fresh=1
        say ""
        say "Which tag: full brings its own database and cache (nothing else needed),"
        say "latest expects your own PostgreSQL and Redis, slim brings no voice either."
        variant=$(ask "Tag" "${DEADAIR_VARIANT:-full}")
        case "$variant" in full | latest | slim) ;; *) fail "the tag is full, latest or slim, not '$variant'." ;; esac
        port=$(ask "Port to publish it on" "${DEADAIR_PORT:-8080}")

        # The address a browser types, guessed from the machine's own: the first address `hostname
        # -I` reports on Linux, the primary interface's on a Mac, localhost when neither answers.
        host=$(hostname -I 2> /dev/null | awk '{print $1}') || host=
        [ -n "$host" ] || host=$(ipconfig getifaddr en0 2> /dev/null) || host=
        [ -n "$host" ] || host=localhost
        say ""
        say "The address you will type to reach the station, with nothing after the port."
        say "Sign-in links and a music provider's authorization come back to it, so it has to be right."
        url=$(ask "Address" "${DEADAIR_URL:-http://$host:$port}")
        url="${url%/}"
        case "$url" in http://* | https://*) ;; *) fail "the address needs its scheme: http://$url" ;; esac
    fi

    say ""
    say "Fetching the compose file from $source_url"
    curl -fsSL -o docker-compose.yml.new "$source_url/docker-compose.yml" || fail "could not download docker-compose.yml."
    mv docker-compose.yml.new docker-compose.yml

    if [ -n "$fresh" ]; then
        curl -fsSL -o .env.new "$source_url/.env.example" || fail "could not download .env.example."
        # The timezone the presenter reads the clock in, taken from this machine. It can be changed
        # in the console later; this only saves an operator in New York a presenter on UTC.
        tz=$(readlink /etc/localtime 2> /dev/null | sed 's|.*/zoneinfo/||') || tz=
        [ -n "$tz" ] || tz=$(cat /etc/timezone 2> /dev/null) || tz=
        set_env() {
            # set_env <key> <value>: replace the line, escaping what sed would read as its own.
            value=$(printf '%s' "$2" | sed 's/[&|\\]/\\&/g')
            sed "s|^$1=.*|$1=$value|" .env.new > .env.tmp && mv .env.tmp .env.new
        }
        set_env VARIANT "$variant"
        set_env HTTP_PORT "$port"
        set_env APP_BASE_URL "$url"
        set_env SPA_BASE_URL "$url"
        [ -z "$tz" ] || set_env TZ "$tz"
        chmod 600 .env.new
        mv .env.new .env
        say "Wrote $dir/.env"
    fi

    # The station runs as uid 99, gid 100, and has to be able to write its data directory. Docker
    # Desktop on a Mac maps ownership itself, so this is only asked of Linux, with sudo when this is
    # not already root.
    data_dir=$(sed -n 's/^DATA_DIR=//p' .env | tail -n 1)
    data_dir="${data_dir:-./data}"
    mkdir -p "$data_dir"
    if [ "$(uname -s)" = Linux ] && [ "$(stat -c %u "$data_dir")" != 99 ]; then
        say "Handing $data_dir to the station's user (99:100)."
        if [ "$(id -u)" = 0 ]; then
            chown -R 99:100 "$data_dir"
        else
            sudo chown -R 99:100 "$data_dir" || fail "could not chown $data_dir; run: sudo chown -R 99:100 $dir/$data_dir"
        fi
    fi

    say ""
    say "Starting it. The first time, this downloads the image (a few gigabytes)."
    docker compose up -d

    # The image's own health check, which turns healthy once the API answers. The first boot sets
    # the database up and can take a few minutes.
    say "Waiting for the first boot. This can take a few minutes."
    waited=0
    while :; do
        state=$(docker inspect -f '{{.State.Health.Status}}' deadair 2> /dev/null) || state=missing
        [ "$state" = healthy ] && break
        if [ "$state" = unhealthy ] || [ "$state" = missing ] || [ "$waited" -ge 900 ]; then
            say "It has not come up ($state). The log says why:"
            say "    cd $dir && docker compose logs deadair"
            docker exec deadair deadair-doctor || true
            exit 1
        fi
        sleep 5
        waited=$((waited + 5))
    done

    say ""
    docker exec deadair deadair-doctor || true
    url=$(sed -n 's/^APP_BASE_URL=//p' .env | tail -n 1)
    say ""
    say "deadair is running. Open ${url:-the address you gave} and create the administrator."
    say "It lives in $dir. Back up its data directory, which holds its keys."
}

main "$@"
