# The Apple Music player container: Chrome, a virtual screen, a sink nobody listens to, and ffmpeg.
#
# Its own image rather than another binary inside the Liquidsoap one, unlike `stream/spotify-shim`.
# The shim is a 20MB static Go binary with no runtime of its own, so putting it beside Liquidsoap
# costs nothing; a browser is a gigabyte and a process tree, and the audio chain must not be
# restarted because a browser needed to be. It is also why this is a separate compose service with
# its own lifecycle: `config-watch.sh` stops the Liquidsoap container on a config change, and taking
# the station's player down with it would be a self-inflicted outage.
#
# Google's Chrome and not Chromium: only Google's build ships the Widevine CDM, without which nothing
# Apple Music serves can be decoded. Since the arm64 Linux release it exists for both architectures
# the station runs on, so this image builds natively on an Apple Silicon workstation and on the
# x86_64 box it is deployed to.
FROM node:26-bookworm-slim

# `--no-install-recommends` throughout: the recommends of chrome and pulseaudio between them pull in
# a desktop session, and the point of this image is one browser and one encoder.
#
# - xvfb            Widevine does not work in headless Chrome (crbug 40551636), so the browser is
#                   headful on a framebuffer nothing displays.
# - pulseaudio      the null sink the browser plays into; its monitor is what gets captured.
# - ffmpeg          the capture itself.
# - x11vnc          the once-per-install sign-in door, started only when asked for. About a megabyte,
#                   and the alternative to shipping it is an operator who cannot sign in at all.
#
# Chrome's own shared libraries are deliberately NOT listed: the `.deb` declares them, so apt resolves
# them for whichever Debian this base image is on. Naming them by hand is how an image breaks on a base
# bump, because half of them were renamed for the 64-bit time_t transition (`libasound2t64` and
# friends) and a pinned list would have to be re-learned rather than re-resolved.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates curl gnupg \
        xvfb \
        pulseaudio pulseaudio-utils \
        ffmpeg \
        fonts-liberation \
        x11vnc \
    && install -d -m 0755 /etc/apt/keyrings \
    && curl -fsSL https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /etc/apt/keyrings/google-chrome.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/google-chrome.gpg] https://dl.google.com/linux/chrome/deb/ stable main" \
        > /etc/apt/sources.list.d/google-chrome.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends google-chrome-stable \
    && rm -rf /var/lib/apt/lists/*

# PulseAudio in this container is one sink and no hardware. `exit-idle-time=-1` because the daemon
# would otherwise quit between records and take the sink with it, which presents as every capture
# after the first being silent.
COPY stream/apple-player/pulse-default.pa /etc/pulse/default.pa
COPY stream/apple-player/docker-entrypoint.sh /usr/local/bin/apple-player-run.sh
COPY stream/apple-player/src /app/src
COPY stream/apple-player/package.json /app/package.json

# Not root: Chrome is started with `--no-sandbox` (the container has neither a user namespace nor
# CAP_SYS_ADMIN for its own), so the process boundary is the one that is left and it should not be
# root's. `/state` holds the signed-in profile and is a volume; `/tmp/captures` is a tmpfs.
RUN useradd --create-home --shell /bin/sh deadair \
    && mkdir -p /state/profile /tmp/captures \
    && chown -R deadair:deadair /state /tmp/captures /app \
    && chmod +x /usr/local/bin/apple-player-run.sh

USER deadair
WORKDIR /app
ENV APPLE_PLAYER_PORT=3680 \
    APPLE_PLAYER_PROFILE=/state/profile \
    APPLE_PLAYER_CAPTURE_DIR=/tmp/captures \
    DISPLAY=:99 \
    XDG_RUNTIME_DIR=/tmp/xdg

EXPOSE 3680
ENTRYPOINT ["/usr/local/bin/apple-player-run.sh"]
