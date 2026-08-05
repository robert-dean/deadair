# Liquidsoap plus the Spotify track shim, in a single image.
#
# The shim (stream/spotify-shim) serves one Spotify track per HTTP request, so Liquidsoap's
# request.queue fetches a Spotify track exactly the way it fetches a pre-signed Subsonic URL —
# downloaded ahead of air, into a queue the app controls. What used to live here as well was the
# go-librespot daemon, streaming raw PCM into the mount through input.external; the station could
# only steer that, so it never owned a track before it aired.
#
# The shim is built INSIDE a clone of go-librespot at a pinned tag, which is what lets it import
# that project's own packages (session assembly, audio keys, the CDN reader, the decryptor) with
# no fork and no vendoring. It never decodes — Spotify's file is already Ogg Vorbis once
# decrypted — so unlike the daemon it needs no CGO and no codec libraries at all.
#
# Build just this image:  docker compose build liquidsoap
# (The compose service points at this Dockerfile; see docker-compose.yml.)
FROM golang:1-trixie AS shim
RUN apt-get update \
 && apt-get install -y --no-install-recommends git \
 && rm -rf /var/lib/apt/lists/*
# Pin to a release tag (not a moving branch) for reproducible builds. Bump deliberately: the shim
# is built against this tag's internals, so a bump is a real compatibility event.
ARG GO_LIBRESPOT_VERSION=v0.7.4
RUN git clone --depth 1 --branch "${GO_LIBRESPOT_VERSION}" \
      https://github.com/devgianlu/go-librespot /src
COPY stream/spotify-shim/*.go /src/cmd/deadair-shim/
RUN cd /src && CGO_ENABLED=0 go build -v -o /out/deadair-shim ./cmd/deadair-shim

# 2.4.x for the stream script: async source callbacks (the playout `on_track` notify runs off
# the streaming loop), `normalize_track_gain`, and `request.queue.remove`. Bumped from v2.2.5,
# which is BREAKING in two places radio.liq touches — callbacks moved to source methods, and the
# `annotate` protocol now checks nested static uris. See stream/README.md for the checks to run
# after a bump.
FROM savonet/liquidsoap:v2.4.5
# Root so we can drop the binary in and prepare the log dir. Liquidsoap runs fine as root for a
# local/personal station; the process only reads config and pushes to Icecast.
USER root
# curl + ca-certificates are how Liquidsoap resolves http(s) requests, which is every item in the
# running order: a shim URL for a Spotify track, a pre-signed Subsonic URL for a Navidrome one, a
# token-gated app URL for a rendered segment. The shim itself is a static binary and links nothing.
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
# The track shim, and the supervisor the entrypoint backgrounds it with. It is NOT spawned by
# Liquidsoap: it is not an audio source, it answers HTTP.
COPY --from=shim /out/deadair-shim /usr/local/bin/deadair-shim
COPY stream/spotify-shim-run.sh /usr/local/bin/spotify-shim-run.sh
RUN chmod +x /usr/local/bin/spotify-shim-run.sh
# Where the shim writes its log; mount a volume here to keep it across restarts.
RUN mkdir -p /streamlogs && chmod 0777 /streamlogs
