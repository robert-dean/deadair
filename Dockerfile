# syntax=docker/dockerfile:1
# deadair, as one container.
#
# A radio station is not one process and never was: something decodes, something encodes,
# something serves the stream, something writes the words. What this image gives up is the
# CONTAINER boundary between them, not the process boundary — every piece below is still its own
# process under its own supervisor, and nothing was folded into Node to make it fit. The reason to
# give it up is that an operator installing a station should install a station, not assemble six
# services and a network, and the places this runs (a home server's app catalogue) are built around
# one image with one volume.
#
# Three variants, from two build arguments:
#
#   slim    WITH_TTS=0 WITH_DB=0   the station. Bring a database, a cache and a voice.
#   latest  WITH_TTS=1 WITH_DB=0   the default. A voice is included; the database is yours.
#   full    WITH_TTS=1 WITH_DB=1   everything, for a host with nothing on it.
#
# The base is the Liquidsoap image rather than a bare Debian one, because Liquidsoap is the one
# component here that is genuinely hard to install and easy to install WRONGLY — its codec set is
# what the station's audio chain is. It is Debian trixie, which is what makes everything else
# below cheap: Icecast 2.5 can be copied out of an image built on the same release (2.5 is not in
# Debian, and building it needs a libigloo newer than trixie's own), and nginx and Node both
# publish for it.

ARG WITH_TTS=1
ARG WITH_DB=0
# The commit this image was built from. Empty by default, and deliberately: a hand-built image was
# built from a working tree, not from a commit, and an empty answer is the honest one. CI passes the
# sha (see `.github/workflows/images.yml`), which is what makes "is the station running what I
# committed" a question the console can answer.
ARG REVISION=
# The release this image is. Empty by default on the same argument as `REVISION` above: a build that
# is not a release should not claim to be one, and "no version" is the honest answer for every image
# built from a working tree or from an ordinary push. CI passes it only on a tag run.
ARG VERSION=
ARG NODE_VERSION=26.7.0
ARG S6_OVERLAY_VERSION=3.2.3.2
ARG GO_LIBRESPOT_VERSION=v0.7.4
ARG DBMATE_VERSION=v2.35.0

# ─────────────────────────────────────────────────────────────────────────────────────────────
# The manifests, and nothing else.
# ─────────────────────────────────────────────────────────────────────────────────────────────
# An install is a function of the lockfile and the manifests. Handing it the whole tree made it a
# function of every file in the repository instead, so a one-line change to a route reinstalled
# the world — the layer under the install had a new digest, so the install beneath it did too.
# This stage exists to answer that: it takes the whole context and throws away everything that is
# not a manifest, and its OUTPUT is unchanged by an ordinary commit, so the install downstream of
# it stays cached. The copy is cheap; it is the install that is not.
FROM node:26-trixie-slim AS manifests
WORKDIR /src
COPY . .
# The member list is the WORKSPACE'S OWN GLOBS rather than a list of paths, on `link-peers.mjs`'s
# rule: a package added later is covered without anybody remembering this stage. One level deep,
# which is what `pnpm-workspace.yaml` says and is also what keeps the fixture plugins under
# `apps/api/tests` out of it — they are not members, and editing one should not cost an install.
# A fourth glob added there and not here fails at the install below, loudly, rather than shipping.
#
# `-p` so an unchanged manifest keeps its timestamp: BuildKit hashes content rather than mtime, so
# this is belt-and-braces rather than the mechanism, but the whole point of this stage is an output
# that does not move and there is no reason to leave that resting on one implementation detail.
RUN set -eux; \
    mkdir -p /manifests; \
    cp -p package.json pnpm-lock.yaml pnpm-workspace.yaml /manifests/; \
    for member in apps/* packages/* plugins/*; do \
        [ -f "$member/package.json" ] || continue; \
        mkdir -p "/manifests/$member"; \
        cp -p "$member/package.json" "/manifests/$member/"; \
    done

# ─────────────────────────────────────────────────────────────────────────────────────────────
# The workspace: the API, the console, the plugins.
# ─────────────────────────────────────────────────────────────────────────────────────────────
# Trixie to match the runtime, because a prod dependency with a native binding is compiled here
# and loaded there.
FROM node:26-trixie-slim AS workspace

# pnpm comes from npm rather than from corepack: Node 25 and later do not ship a corepack binary
# at all, so `corepack enable` is a command that is not there. Installed this way it still reads
# the repo's own `packageManager` pin, so the version is the lockfile's rather than this line's.
RUN npm install -g corepack@latest && corepack enable

WORKDIR /app

COPY --from=manifests /manifests/ ./
RUN --mount=type=cache,target=/root/.local/share/pnpm/store,sharing=locked \
    pnpm install --frozen-lockfile

# The source, over the top of the install — and ONLY the source the build actually reads. This was
# `COPY . .`, which made a JavaScript rebuild a function of every file in the repository: editing
# `docker/rootfs`, an nginx snippet or this Dockerfile invalidated the copy, and turbo then rebuilt
# all fifteen packages from nothing. Measured on the release that prompted this — `0 cached, 15
# total`, ninety-three seconds — for a commit that touched no TypeScript whatsoever.
#
# What the build reads is the members, `turbo.json`, and `link-peers.mjs` for the step further
# down. Every tsconfig extends a workspace package rather than a file at the root, and every build
# script is `tsc`, `tsup` or `vite` reading its own directory, so there is nothing else to bring.
# `tests/` is excluded at the ignore file, because the build tsconfigs include `src` alone and an
# image that never runs a test should not be rebuilt by one.
#
# Nothing here disturbs the install above: `node_modules` is in `.dockerignore` at every level, so
# the context carries none and these copies overwrite none — neither the store at the root nor the
# symlink farm pnpm left inside each member.
#
# No workspace package declares an `install`, `prepare` or `prepack` script, which is what makes
# installing before the source is present safe at all. One that grows a `prepare` needing its own
# source would have to be installed after these copies instead.
COPY turbo.json ./
COPY docker/link-peers.mjs ./docker/
COPY packages ./packages
COPY plugins ./plugins
COPY apps ./apps

# Never `codegen` here. The contract routers, the permission types and the Kysely types are
# committed, and regenerating them needs a live database — an image build that reached for one
# would be a build that cannot run without the thing it is being built to bring up.
RUN pnpm exec turbo run build --filter=@deadair/api --filter=@deadair/web --filter='./plugins/*'

# Strip the dev half in place. `pnpm deploy` would be the tidier-looking answer and is the wrong
# one: it rewrites the tree into a self-contained directory, and bundled plugins are discovered by
# WALKING UP to the directory holding pnpm-workspace.yaml and then reading `plugins/<name>/dist`,
# so a layout that is no longer a workspace is a layout with no plugins in it.
# The console is finished the moment it is built — it is static files, and nothing downstream of
# here is going to compile it again. So it is moved out of the workspace BEFORE the prune below,
# which deletes the tree it was sitting in.
RUN mkdir -p /web && cp -a apps/web/dist/. /web/

RUN --mount=type=cache,target=/root/.local/share/pnpm/store,sharing=locked \
    pnpm install --prod --frozen-lockfile --ignore-scripts \
 && rm -rf apps/web node_modules/.cache .turbo

# The prune above removes the dev half, and with it the only thing putting each plugin's PEER
# dependencies on disk. They are peers on purpose — a plugin must reach the host's copy of the SDK
# and of the schema library rather than carry its own — so they are linked into the workspace root
# here, where a shared dependency belongs and where Node looks last on its way up from a plugin.
RUN node docker/link-peers.mjs

# ─────────────────────────────────────────────────────────────────────────────────────────────
# The track shim.
# ─────────────────────────────────────────────────────────────────────────────────────────────
FROM golang:1-trixie AS shim
RUN apt-get update \
 && apt-get install -y --no-install-recommends git \
 && rm -rf /var/lib/apt/lists/*
ARG GO_LIBRESPOT_VERSION
RUN git clone --depth 1 --branch "${GO_LIBRESPOT_VERSION}" https://github.com/devgianlu/go-librespot /src
COPY stream/spotify-shim/*.go /src/cmd/deadair-shim/
RUN cd /src && CGO_ENABLED=0 go build -v -o /out/deadair-shim ./cmd/deadair-shim

# ─────────────────────────────────────────────────────────────────────────────────────────────
# Icecast 2.5, taken from an image that already built it.
# ─────────────────────────────────────────────────────────────────────────────────────────────
# 2.5 rather than Debian's 2.4 because `/admin/eventfeed` is where the audience count comes from:
# on 2.4 the station falls back to a once-a-minute poll, and both edges of "somebody is listening"
# arrive up to a minute late — which for a station that only airs while somebody is there is the
# difference between tuning in and waiting.
FROM libretime/icecast:2.5.0 AS icecast

# ─────────────────────────────────────────────────────────────────────────────────────────────
# The station's voice, when this variant has one.
# ─────────────────────────────────────────────────────────────────────────────────────────────
# A speech server is a Python environment plus a few hundred megabytes of weights, which is why
# it is a variant rather than a fixture: a station pointed at a voice on a machine with a graphics
# card should not also carry one it will never run. The empty case is a real stage because a
# Dockerfile has no conditional COPY — but the copy below is a mount rather than a COPY, and an
# empty stage mounts as an empty directory instead of failing on a path that is not there.
# Pinned by DIGEST, with the tag left beside it to say what the digest is. A floating tag here is
# not the ordinary staleness trade: this is the layer the fence below exists to hold still, so the
# day upstream pushes a new `latest` the voice is rebuilt, re-pushed, and re-pulled by every
# operator — for a change nobody in this repository made and nothing in this repository records.
# Measured at 63 seconds just to resolve and fetch on each release. Bump it deliberately.
FROM ghcr.io/remsky/kokoro-fastapi-cpu:latest@sha256:28d6f0b6e4df369559012578299d201b855a08fac466f616653edd1f08c5370a AS tts-1
FROM scratch AS tts-0
ARG WITH_TTS
FROM tts-${WITH_TTS} AS tts

# ─────────────────────────────────────────────────────────────────────────────────────────────
# The station.
# ─────────────────────────────────────────────────────────────────────────────────────────────
FROM savonet/liquidsoap:v2.4.5

USER root
ENV DEBIAN_FRONTEND=noninteractive

ARG WITH_TTS
ARG WITH_DB
ARG NODE_VERSION
ARG S6_OVERLAY_VERSION
ARG DBMATE_VERSION

# Everything apt provides, in one layer.
#
#   xz-utils         unpacking the supervisor and Node, neither of which apt has
#   ffmpeg           the measurement sidecar shells out to it; nothing here decodes in Node
#   python3          the sidecar itself
#   libigloo0t64     Icecast 2.5 links it and trixie's own is older than 2.5 requires, so this
#                    one comes from backports; without it the binary copied in below will not run
#   nginx            from upstream, which is the same version dev's edge runs
RUN set -eux; \
    echo 'deb http://deb.debian.org/debian trixie-backports main' > /etc/apt/sources.list.d/trixie-backports.list; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl gnupg xz-utils; \
    curl -fsSL https://nginx.org/keys/nginx_signing.key | gpg --dearmor -o /usr/share/keyrings/nginx-archive-keyring.gpg; \
    . /etc/os-release; \
    echo "deb [signed-by=/usr/share/keyrings/nginx-archive-keyring.gpg] https://nginx.org/packages/debian ${VERSION_CODENAME} nginx" \
        > /etc/apt/sources.list.d/nginx.list; \
    printf 'Package: *\nPin: origin nginx.org\nPin: release o=nginx\nPin-Priority: 900\n' > /etc/apt/preferences.d/99nginx; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        ffmpeg \
        nginx \
        python3 python3-venv \
        media-types \
        tzdata \
        libcurl4 libogg0 libspeex1 libssl3t64 libtheora0 libvorbis0a libxml2 libxslt1.1 librhash1; \
    apt-get install -y --no-install-recommends -t trixie-backports libigloo0t64; \
    rm -rf /var/lib/apt/lists/*

# Node, verified the way the official image verifies it rather than trusted from a repository.
RUN set -eux; \
    arch="$(dpkg --print-architecture)"; \
    case "$arch" in amd64) narch='x64';; arm64) narch='arm64';; *) echo "unsupported architecture: $arch" >&2; exit 1;; esac; \
    export GNUPGHOME="$(mktemp -d)"; \
    for key in \
        5BE8A3F6C8A5C01D106C0AD820B1A390B168D356 \
        DD792F5973C6DE52C432CBDAC77ABFA00DDBF2B7 \
        CC68F5A3106FF448322E48ED27F5E38D5B0A215F \
        8FCCA13FEF1D0C2E91008E09770F7A9A5AE15600 \
        890C08DB8579162FEE0DF9DB8BEAB4DFCF555EF4 \
        C82FA3AE1CBEDC6BE46B9360C43CEC45C17AB93C \
        108F52B48DB57BB0CC439B2997B01419BD92F80A \
        A363A499291CBBC940DD62E41F10027AF002F8B0 \
        655F3B5C1FB3FA8D1A0CA6BDE4A7D232B936D2FD \
    ; do \
        gpg --batch --keyserver hkps://keys.openpgp.org --recv-keys "$key" \
        || gpg --batch --keyserver keyserver.ubuntu.com --recv-keys "$key"; \
    done; \
    cd /tmp; \
    curl -fsSLO --compressed "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${narch}.tar.xz"; \
    curl -fsSLO --compressed "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt.asc"; \
    gpg --batch --decrypt --output SHASUMS256.txt SHASUMS256.txt.asc; \
    gpgconf --kill all; \
    grep " node-v${NODE_VERSION}-linux-${narch}.tar.xz\$" SHASUMS256.txt | sha256sum -c -; \
    tar -xJf "node-v${NODE_VERSION}-linux-${narch}.tar.xz" -C /usr/local --strip-components=1 --no-same-owner; \
    rm -rf "$GNUPGHOME" /tmp/node-v* /tmp/SHASUMS256.txt*; \
    node --version

# The supervisor. Two tarballs: the scripts, then the binaries for this architecture.
RUN set -eux; \
    arch="$(dpkg --print-architecture)"; \
    case "$arch" in amd64) sarch='x86_64';; arm64) sarch='aarch64';; *) echo "unsupported architecture: $arch" >&2; exit 1;; esac; \
    cd /tmp; \
    curl -fsSLO "https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-noarch.tar.xz"; \
    curl -fsSLO "https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-${sarch}.tar.xz"; \
    tar -C / -Jxpf "s6-overlay-noarch.tar.xz"; \
    tar -C / -Jxpf "s6-overlay-${sarch}.tar.xz"; \
    rm -f /tmp/s6-overlay-*.tar.xz

# Migrations run at boot, and the tool that applies them is a dev dependency that the production
# install above has just removed. The released binary is the substitute, and it depends on nothing.
RUN set -eux; \
    arch="$(dpkg --print-architecture)"; \
    curl -fsSL -o /usr/local/bin/dbmate \
        "https://github.com/amacneil/dbmate/releases/download/${DBMATE_VERSION}/dbmate-linux-${arch}"; \
    chmod 0755 /usr/local/bin/dbmate; \
    dbmate --version

COPY --from=icecast /usr/bin/icecast /usr/bin/icecast
COPY --from=icecast /usr/share/icecast/ /usr/share/icecast/

# One user for everything the station runs, numbered to match the ownership a home server gives
# the share this container's volume comes from — so `/data` is writable with no chown ceremony
# and no PUID indirection. It is created HERE, above the two heavy stages below, so each of them
# can set ownership on the tree it lays down instead of a later pass re-owning it: an overlay
# chown rewrites every file it touches into a new layer, so `chown -R` over a tree this size is
# a second copy of it in the published image.
RUN set -eux; \
    groupadd --gid 100 --non-unique deadair 2>/dev/null || true; \
    useradd --uid 99 --gid 100 --non-unique --no-create-home --home-dir /data --shell /usr/sbin/nologin deadair 2>/dev/null || true; \
    mkdir -p /data /var/log/icecast /var/cache/nginx /var/log/nginx /etc/nginx/realip.d; \
    chown 99:100 /data /var/log/icecast /var/cache/nginx /var/log/nginx

# What the speech server needs from apt, kept OUT of the copy below rather than fused into it.
# `cp -a` preserves every timestamp and mode, so the copy is byte-identical from one build to the
# next and the registry skips it on push; an `apt-get` in the same command writes dpkg state and
# logs whose contents differ every time, which would give that whole gigabyte a new digest on
# every release. Same layer, two very different kinds of bytes.
RUN set -eux; \
    if [ "${WITH_TTS}" = "1" ]; then \
        apt-get update; \
        apt-get install -y --no-install-recommends espeak-ng espeak-ng-data libsndfile1; \
        rm -rf /var/lib/apt/lists/*; \
    fi

# The speech server, if this variant has one: its tree, and the interpreter its environment was
# built against, which lives under /usr/local and does not collide with anything already there.
# The environment is left where the tree puts it rather than being rebuilt, because the weights
# beside it are the expensive part and rebuilding would only move the same files around.
RUN --mount=from=tts,target=/mnt/tts set -eux; \
    if [ "${WITH_TTS}" = "1" ]; then \
        cp -a /mnt/tts/usr/local/. /usr/local/; \
        cp -a /mnt/tts/app /opt/tts; \
        chown -R 99:100 /opt/tts; \
    fi

# A database and a cache, for the variant meant to land on a host with nothing on it. Postgres
# comes from its own archive rather than Debian's, so the version here is the version the station
# is developed against instead of whichever one this base happens to carry.
RUN set -eux; \
    if [ "${WITH_DB}" = "1" ]; then \
        . /etc/os-release; \
        curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /usr/share/keyrings/pgdg.gpg; \
        echo "deb [signed-by=/usr/share/keyrings/pgdg.gpg] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" \
            > /etc/apt/sources.list.d/pgdg.list; \
        apt-get update; \
        apt-get install -y --no-install-recommends postgresql-17 redis-server; \
        rm -rf /var/lib/apt/lists/*; \
    fi

# ─────────────────────────────────────────────────────────────────────────────────────────────
# Everything below here comes out of this repository, and so changes on an ordinary commit.
# ─────────────────────────────────────────────────────────────────────────────────────────────
# A layer's digest covers the layers beneath it, so anything sitting under a changed layer is
# rebuilt whether or not its own content moved — and a rebuilt layer is one the registry has to
# accept and every operator has to fetch again. The speech server and the database were under the
# station's own tree for as long as this file existed, which is why an API-only release re-pushed
# a gigabyte of weights and pulled it back down on the other side. Nothing that the station's
# source can invalidate may sit above them: keep this line where it is, and add below it.

# Below the fence with the rest of the repository, small though it is: it is built out of
# `stream/spotify-shim`, so it is the station's own source however little of it there is.
COPY --from=shim /out/deadair-shim /usr/local/bin/deadair-shim

# The measurement sidecar: its own interpreter environment, its own pinned requirements. Only the
# modules the service actually imports, which is a rule its own image learned the hard way — a
# missing one is a crash loop, not a build failure. The environment is keyed to the pins alone
# and the service's own code lands after it, so editing `measure.py` reinstalls nothing.
#
# **This list is the SECOND copy of it and is the one that gets forgotten.** `analysis/Dockerfile`
# carries the same names, and a module added there and not here builds clean and crash-loops in
# production while the dev container is perfectly happy. Adding one means editing both.
#
# The beat tracker used to be exactly that miss, and worse: this file installed
# `requirements.txt` and nothing else, so `beat_this` was never installed here at all — a track
# that reached `beats.py` would crash-loop the production sidecar the console shows as "engine
# off". `analysis/requirements.nodeps.txt` is the fix: one pin file both Dockerfiles read, so
# there is nothing left to forget for that package, only the module list above.
COPY analysis/requirements.txt /opt/analysis/requirements.txt
RUN python3 -m venv /opt/analysis/venv \
 && /opt/analysis/venv/bin/pip install --no-cache-dir -r /opt/analysis/requirements.txt

# The beat tracker: `--no-deps`, for the reason `requirements.nodeps.txt` carries inline rather
# than repeating here.
COPY analysis/requirements.nodeps.txt /opt/analysis/requirements.nodeps.txt
RUN /opt/analysis/venv/bin/pip install --no-cache-dir --no-deps -r /opt/analysis/requirements.nodeps.txt
COPY analysis/measure.py analysis/loudness.py analysis/tags.py analysis/join.py analysis/app.py /opt/analysis/

# The station's own soundboard, copied into the pad library once on a station that has never held a
# pad. Below the fence with everything else the repository produces, and it is genuinely empty today:
# `docs/internals/render.md` § "Pads" refuses attribution-requiring audio, because a radio station has
# nowhere to put a credit and the obligation would travel to the operator in silence. The directory
# exists so the seam does, and so the day somebody sources verified CC0 audio it is a file drop.
COPY assets/pads /app/assets/pads

# What the app renders its stream config FROM. Only the template: `station-id.mp3` and the script
# are the audio chain's, not the app's, and the app reads nothing else here.
COPY stream/icecast.xml.tmpl /app/stream/
# `/radio` and not somewhere tidier because `radio.liq` names `/radio/station-id.mp3` outright —
# the one path in the audio chain that is not configurable, since the ident is the thing it falls
# back to when everything else has failed and a missing fallback is silence.
COPY stream/radio.liq stream/station-id.mp3 /radio/
# What the stream runs on until the app has rendered the operator's own settings.
COPY stream/radio.default.env /defaults/radio.env
COPY stream/icecast.default.xml /defaults/icecast.xml

COPY docker/nginx.conf /etc/nginx/nginx.conf
# The mount proxy, shared verbatim with the compose edge rather than copied into a second file
# that could drift from it.
COPY nginx/snippets /etc/nginx/snippets
COPY docker/rootfs /

# The supervisor's own tree, made runnable and cut down to the services this variant has. Both
# halves need `docker/rootfs` to be on disk, which is what keeps this below the copy rather than
# up with the user it belongs to; it is a handful of small files either way.
RUN set -eux; \
    chmod +x /etc/s6-overlay/scripts/* /etc/s6-overlay/s6-rc.d/*/run; \
    if [ "${WITH_TTS}" != "1" ]; then rm -f /etc/s6-overlay/user-bundles.d/user/contents.d/tts /etc/s6-overlay/user-bundles.d/user/contents.d/init-tts; fi; \
    if [ "${WITH_DB}" != "1" ]; then rm -f /etc/s6-overlay/user-bundles.d/user/contents.d/postgres /etc/s6-overlay/user-bundles.d/user/contents.d/redis /etc/s6-overlay/user-bundles.d/user/contents.d/init-database; fi

# The station's own tree, in the shape the plugin loader expects to find: pnpm-workspace.yaml at
# the root is the marker it walks up to, and `plugins/<name>/dist` is where it looks next. Last of
# all, and split by how often each part moves: `node_modules` is the biggest and turns over only
# with the lockfile, `apps/api` is the smallest and turns over with every commit.
COPY --from=workspace /app/pnpm-workspace.yaml /app/package.json /app/
COPY --from=workspace /app/node_modules /app/node_modules
COPY --from=workspace /app/packages /app/packages
COPY --from=workspace /app/plugins /app/plugins
COPY --from=workspace /app/apps/api /app/apps/api
# The console, served by nginx rather than by the API. The API has no static middleware and is not
# growing one: the edge in front of it already has to exist for the stream.
COPY --from=workspace /web /srv/web
# Deliberately no chown over /app: the station reads its own code and writes none of it, and
# re-owning a tree that size would copy every file in it into another layer.

# Everything the station keeps is under one directory, because a backup an operator will actually
# take is one directory. The paths below are absolute rather than the code's cwd-relative
# defaults, which resolve against `/app/apps/api` and would scatter state through the image.
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data \
    LOGS_DIR=/data/logs \
    # The derived half — the record cache, art, rendered speech, voice previews — is deliberately
    # absent from this list. It is what an operator may want on another disk, so it is resolved at
    # start from whether `/media` was mounted (see `scripts/storage-env`); naming those paths here
    # would take the choice away by making it look as though somebody had already made it. The
    # inbox is not part of it: what an operator recorded themselves is authored, and belongs with
    # the half that gets backed up.
    SEGMENT_LIBRARY_DIR=/data/inbox \
    PLUGINS_DIR=/data/plugins \
    STREAM_ASSETS_DIR=/app/stream \
    # Where the shipped soundboard is read from, once. Not under `/data` or `/media`: it is part of
    # the image rather than something the operator gave the station, and it is copied INTO the pad
    # library rather than served from here.
    PAD_ASSETS_DIR=/app/assets/pads \
    STREAM_CONFIG_DIR=/data/streamconfig \
    # Everything that reads the rendered config here is the station's own user, so the passwords
    # in it are not world-readable. The default is looser because it has to serve a deployment
    # where the parts are separate containers under uids this project does not choose. Icecast
    # says it may refuse a world-readable config in a future version, so this is also what stops
    # that being a station that will not start one day.
    STREAM_CONFIG_MODE=0640 \
    STREAM_MUSIC_DIR=/data/music \
    # The HLS segments and playlists. Two variables for one directory because two
    # processes reach it by different names in the compose deployment, where liquidsoap
    # and the app are separate containers with their own mount points. Here they are the
    # same process tree and the same path, and it is nginx's `alias` target as well.
    #
    # The directory itself is made by `init-station`, with every other thing the station
    # keeps, and NOT by a `mkdir` in this file: `/data` is a volume an operator mounts, so
    # anything the image puts under it is hidden the moment they do.
    STREAM_HLS_DIR=/data/streamhls \
    STREAM_HLS_LIQUIDSOAP_DIR=/data/streamhls \
    ANALYSIS_PORT=9321 \
    TTS_PORT=8880 \
    USE_GPU=false \
    DEVICE=cpu \
    PHONEMIZER_ESPEAK_PATH=/usr/bin \
    PHONEMIZER_ESPEAK_DATA=/usr/share/espeak-ng-data \
    ESPEAK_DATA_PATH=/usr/share/espeak-ng-data \
    LOG_FILE=/data/streamlogs/liquidsoap.log \
    TRUST_PROXY=true \
    # What sits in FRONT of this container, which is a different question from the line above:
    # that one says the app may believe the edge inside the image, this one says the edge may
    # believe whatever the operator put in front of it. Empty means nobody, and then a caller is
    # whoever nginx can see for itself — which behind a tunnel is the tunnel, identically for
    # everyone, and is what makes one rate limit bucket out of the whole internet. Set it to the
    # proxy's address or CIDR (`172.16.0.0/12` covers a sibling container reached through Docker's
    # published port) and, where the proxy sends one, name its header:
    # `REAL_IP_HEADER=CF-Connecting-IP`. `scripts/init-station` renders and tests it at boot.
    REAL_IP_FROM= \
    REAL_IP_HEADER=X-Forwarded-For \
    MIGRATE_ON_BOOT=true \
    WITH_DB=${WITH_DB} \
    S6_KEEP_ENV=1 \
    S6_BEHAVIOUR_IF_STAGE2_FAILS=2 \
    S6_CMD_WAIT_FOR_SERVICES_MAXTIME=0

# What the audio chain calls back on when a record has aired or its queue has run dry. Its own
# default names a host that exists only when the app runs outside the containers, so it has to be
# said here: nothing in the station fails as quietly as a callback nobody receives.
ENV PLAYOUT_BASE_URL=http://app:3000/playout

# What this image was built from and which release it is, each said twice on purpose, because the two
# readers cannot reach each other's copy.
#
# The LABEL is for whoever has the daemon: `docker inspect` answers it without starting anything,
# and the name is the OCI standard one so every registry UI and scanner already knows what it means.
# The ENV is for the station itself — the API reads it at boot and reports it from `/health` and on
# the check-up page, which is the reading an operator can actually get to. Without the second one
# the answer to "is this running what I committed" needs a shell on the host, which is the whole
# thing this is here to stop.
#
# Both are metadata over the layer beneath them, so this is also the cheapest possible place to put
# the one argument that changes every build: nothing below rebuilds when the sha moves.
#
# The labels that never change go FIRST, above the two that do, for the same reason the argument
# below is declared as late as it is: a constant layer that sits after a volatile one is rebuilt
# every time the volatile one moves. These are what a registry page and a vulnerability scanner
# read, and without them the published image is anonymous on Docker Hub — `.source` in particular
# is what wires it back to the repository it was built from.
LABEL org.opencontainers.image.title="deadair" \
    org.opencontainers.image.description="An AI radio station you run yourself: it picks the records, writes what the presenter says between them, speaks it, and streams the result." \
    org.opencontainers.image.source="https://github.com/robert-dean/deadair" \
    org.opencontainers.image.url="https://github.com/robert-dean/deadair" \
    org.opencontainers.image.licenses="MIT" \
    org.opencontainers.image.vendor="Marooned Software"

# DECLARED here rather than with the other arguments at the top of the stage. The reasoning for
# putting it up there was that an argument busts the cache at its first USE, not at its
# declaration — which is not what the builds do. The first release after this argument was added
# reused 10 of its layers where the release before it reused 36, and every step of the final stage
# rebuilt, apt included, on a commit that touched nothing the stage reads. Declaring it one line
# above the only two lines that read it leaves nothing behind it to invalidate.
ARG REVISION
ARG VERSION
LABEL org.opencontainers.image.revision="${REVISION}"
LABEL org.opencontainers.image.version="${VERSION}"
ENV BUILD_REVISION=${REVISION}
ENV BUILD_VERSION=${VERSION}

# The one address the station is reached at: the console, the API under /api, and the stream
# itself. Everything else here talks to everything else over loopback.
EXPOSE 80

VOLUME ["/data"]

# Liveness only, and deliberately: it answers from memory with no database behind it, so a station
# whose provider is down or whose library is empty is still a station that is up.
HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=5 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

ENTRYPOINT ["/init"]
