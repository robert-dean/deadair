---
title: Before you install
description: What the station needs from the machine and from you before the first command. Docker, a music source, a model if you want one, and how much memory and disk.
---

# Before you install

The station brings almost everything with it, but it plays your music rather than its own, and it
runs in Docker. This page is what to have ready, so neither install page stops halfway to send you
off for something.

## What you need

- **Docker on a `linux/amd64` machine.** Either [Unraid](./install-unraid.md) with Community
  Applications, or any Linux host with Docker and the Compose plugin ([with Docker
  Compose](./install-compose.md)). Docker Desktop on a Mac or a PC works for trying it out.
- **Somewhere the music comes from.** Either a Spotify account, which has to be Premium because the
  station fetches the audio, or a Subsonic server such as Navidrome. Have the server's address and an
  account on it to hand. The station holds no music of its own.
- **Internet access on the first boot**, for the image itself and for the speech model's weights.
  The weights are downloaded the first time the station speaks, not when the image is pulled.

## What you can add later

- **A language model.** Without one the presenter talks from the station's own phrasings, so a
  station with none still talks. With one, the model writes what the presenter says. It can be
  Anthropic, Gemini, or anything that speaks the OpenAI API, Ollama on your own network included.
  [Give the station a model](./connect-a-model.md) covers it.
- **A mail server**, for sign-in links and emailed codes. Without one, you sign in with the
  password you set.

## How big a machine

These figures are from a fresh `full` container, idle, before any library was synced:

| | `full` |
| --- | --- |
| Memory | about 2 GB, of which the speech server is about 1.4 GB |
| The image on disk | about 9.5 GB |
| The data directory | about 400 MB, most of it the speech model's weights |

**Give it 4 GB of memory**, so the station has room to work when it renders speech and measures
records. The data directory then grows with what the station does: records are cached before they
air, and the cache grows to the size of the library you play. [Install § Two kinds of
thing](../install.md#two-kinds-of-thing-and-two-disks) explains how to put that cache on a different
disk.

`latest` is the same size without the database's share. `slim` brings no speech server, so it saves
its memory and most of its disk. The voice then runs on another machine, which is where a graphics
card helps. The station itself needs none.

## On a Mac with Apple Silicon

The image is built for `amd64` only. Docker Desktop runs it under emulation, which works and is
slower, most noticeably the first boot and rendering speech. It is fine for trying the station out.
For a station that stays on the air, use an `amd64` machine.

## Next

[Install on Unraid](./install-unraid.md), or [install with Docker Compose](./install-compose.md),
where the short way is one command.
