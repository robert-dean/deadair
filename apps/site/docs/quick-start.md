---
title: Quick start
sidebar_position: 0
description: One station, on one machine, in about ten minutes. Every choice is made for you.
---

# Quick start

This is the shortest path from nothing to a station that is talking between records. It makes every
choice for you: one container that brings its own database, one port, one music provider. Nothing
here is hard to change later, and [Install](./install.md) is the page that covers each choice this
one skips.

You need Docker, a machine to run it on, and either a Spotify account (Premium, because the station
fetches audio) or a Subsonic server such as Navidrome.

## 1. Generate the two secrets

Both are generated once and kept. Nothing else has to be decided before the first start.

```bash
openssl rand -hex 32
```

That one encrypts every credential the station stores, and it has to be hex.

```bash
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 | base64 -w0
```

That one signs sessions, and it has to be RSA. On macOS the last command is `base64` with no `-w0`.
Losing the first means typing your provider's credentials in again; losing the second signs everybody
out and costs nothing else.

## 2. Start it

Make a directory, put this in `docker-compose.yml`, and fill in the two keys and the address:

```yaml
services:
    deadair:
        image: deadair/deadair:full
        container_name: deadair
        restart: unless-stopped
        ports:
            - '8080:80'
        volumes:
            - ./data:/data
        environment:
            KMS_LOCAL_ROOT_KEY: 'paste the hex key here'
            AUTHENTICATION_SESSION_JWT_PRIVATE_KEY: 'paste the base64 key here'
            APP_BASE_URL: 'http://localhost:8080'
            SPA_BASE_URL: 'http://localhost:8080'
            TZ: 'America/New_York'
```

`full` is the tag that brings PostgreSQL and Redis with it, so there is nothing else to install. Set
`TZ` to where the station is, because it is what the presenter reads the clock in.

The two addresses are what you type into a browser to reach the station. `http://localhost:8080` is
right if you are opening it on the same machine; use `http://192.168.1.10:8080` or
`https://radio.example.com` if you are not, with the scheme, the host and the port and nothing
after it.

```bash
docker compose up -d
```

The schema is applied before the station starts, so there is no migration step. On a host whose
`./data` is not already owned by 99:100, hand it over once with `sudo chown -R 99:100 ./data`.

## 3. Make yourself the operator

Open `http://localhost:8080`. The first thing a station with no accounts asks for is an
administrator: an email address and a password. That account is yours and there is no other way in,
so the password is worth keeping somewhere.

## 4. Give it music

Open **Settings → Plugins**.

**On Spotify, there are two authorizations and you need both.** The connection lets the plugin read
your library. The playback authorization, on the card below it, lets the station fetch audio. With
only the first, your playlists list perfectly and every record is dropped for want of audio.

The page Spotify sends your browser to will not load, and that is expected rather than a failure: it
is an address on the station itself. Copy it out of the address bar and paste it back into the
console, which finishes the job. The card walks you through it.

**On Navidrome or another Subsonic server**, enable the Navidrome plugin instead and give it the
server's address and an account on it. There is one authorization and no browser visit.

Either way, let the library sync before going on. Nothing can be programmed until there are records
to program.

## 5. Say where it is, and who is on air

- **Settings → Stream**: a station name and the public address listeners reach it at. Saving this is
  what takes the audio chain off its built-in defaults.
- **Voice → Characters**: pick a presenter. Several come with the station, and a station with no
  model configured still talks, out of its own phrasings.

## 6. Put something on

On the **Desk**, press **Plan** to have the station fill a running order, or put a record on
yourself. Then open the stream:

```
http://localhost:8080/live.mp3
```

Any player opens that address, and so do the [listener apps](./features/listening.md).

**If it is silent, that is probably on purpose.** By default the station airs only while somebody is
connected: a loaded station with a full running order and no listeners is quiet, and the Desk says so
rather than reporting a fault. Open the stream and it starts. If it stays quiet, **Check-up** answers
why in one sentence, and [Help](./help.md) covers the usual causes.

## Where to go next

- [Install](./install.md) for the choices this page made for you: which tag, bringing your own
  database, putting it on the internet, and the two-disk layout for a big library.
- [On Unraid](./unraid.md) if that is where it is going, which is a form rather than a compose file.
- [Music licensing](./licensing.md) before you publish an address. The station grants you no rights
  to broadcast anything in your library.
- [What it does](./features/index.md) for the rest of the station: the schedule, facts, phone-ins,
  podcasts and readings.
