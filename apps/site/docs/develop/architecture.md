---
title: How it fits together
sidebar_position: 2
description: The parts of the station, what owns what, and where the long-form reasoning lives.
---

# How it fits together

Enough of the shape to find your way around, and pointers to the file that argues each decision. The
arguments live in the repository rather than here, because they change with the code.

## The parts

```
                  your provider                    a model             a voice
              (Spotify / Navidrome)             (local or hosted)   (Kokoro / Rhapsode)
                       │                               │                    │
                       └───────────── plugins ─────────┴────────────────────┘
                                         │
    ┌────────────────────────────────────┴─────────────────────────────────┐
    │  the station (Node)                                                  │
    │    director ── one running order, and the only thing that writes it  │
    │    render   ── words, then audio, one state per stage                │
    │    playout  ── hands records over, one at a time, and holds a lease  │
    └────────────────────────────────────┬─────────────────────────────────┘
                                         │  HTTP
                  ┌──────────────────────┼──────────────────────┐
             Liquidsoap              PostgreSQL              analysis
          (mixing, on air)        (everything kept)      (cue points, loudness)
                  │
               Icecast ──────────────►  /live.mp3
```

**Nothing in Node decodes, mixes or encodes audio.** Liquidsoap and Icecast run beside the station
and the measurement sidecar is a separate Python service for exactly that reason. The station drives
all three over HTTP.

## The workspace

| Path | What it is |
| --- | --- |
| `apps/api` | the Koa server: modules, ContractKit routers, dbmate migrations |
| `apps/web` | the console: React, Vite, TanStack Router, Mantine |
| `apps/site` | this website. Never in the image |
| `packages/plugin-sdk` | the plugin contract and the capabilities a host offers |
| `packages/sdk` | the typed API client, generated from the contracts |
| `packages/sdk-kotlin`, `sdk-csharp`, `sdk-swift` | the same contracts for the listener apps. Generated |
| `plugins/*` | the bundled plugins: providers, enrichment, speech, models, news, weather |
| `analysis/` | the measurement sidecar. Python |
| `apps/android`, `apps/ios`, `apps/desktop`, `apps/streamdeck` | the listener and operator apps |
| `stream/`, `nginx/`, `Dockerfile`, `docker/` | the audio chain, and the production image |

## Three things own the air

**The director owns the running order, and nothing else writes it.** It is one document of items,
each carrying its own state, several hours deep. The console, the schedule and the model all post
commands to the director rather than editing the order themselves, which is why an edit made at 3pm
is still true at 3.05. A record is not committed to air until its audio is on the machine.

**Render turns words into audio, one state per stage.** A break is written by whoever is presenting,
by a model when one is configured and by the station's own phrasings when none is, when the model is
slow, or when what it wrote failed a check. That floor cannot fail: a station whose presenter went
quiet because a GPU was busy is not a station.

**Playout hands records over one at a time and holds a lease.** Liquidsoap airs nothing unless the
station is actively renewing a short claim, so a crashed or redeployed station takes itself off the
air within seconds. Eleven ordered gates over one snapshot answer "why is nothing playing" with a
single causal verdict.

## The API's modules

`apps/api/src/modules/modules.ts` registers every module, **and the order is load-bearing**. It is the
source of truth for what exists: check it rather than assuming a subsystem is there.

## What is generated, and from what

Nothing in these is hand-edited, and CI regenerates all of it and fails on anything that moved.

| Generated | From | Command |
| --- | --- | --- |
| routers, request and response types, the four SDKs, this site's API reference, `openapi.yaml` | `apps/api/data/contracts/*.ck` | `pnpm build:contracts` |
| permission types | `apps/api/data/permissions/*.perm` | `pnpm build:permissions` |
| database types | the migrated schema | `pnpm build:datatypes` |

Migrations themselves are dbmate SQL under `apps/api/data/migrations`, in the `deadair` schema. To
change an endpoint, edit its `.ck` and commit the regenerated output beside it.

## Where the reasoning lives

`CLAUDE.md` at the root of the repository is the index, kept deliberately small, and each file below
is sectioned so a question is a heading. Read the one covering what you are changing.

| Working on | Read |
| --- | --- |
| the running order, briefs, committing, track audio | [`docs/internals/director.md`](https://github.com/robert-dean/deadair/blob/main/docs/internals/director.md) |
| which records get chosen, ratings, the search tool | [`programming.md`](https://github.com/robert-dean/deadair/blob/main/docs/internals/programming.md) |
| what a break says, facts, bulletins, the format clock | [`breaks.md`](https://github.com/robert-dean/deadair/blob/main/docs/internals/breaks.md) |
| personas, notebooks, stories, auditions | [`personas.md`](https://github.com/robert-dean/deadair/blob/main/docs/internals/personas.md) |
| phone-ins, beats, casting, stitching | [`productions.md`](https://github.com/robert-dean/deadair/blob/main/docs/internals/productions.md) |
| podcasts the station carries | [`podcasts.md`](https://github.com/robert-dean/deadair/blob/main/docs/internals/podcasts.md) |
| books and columns it reads out | [`narrations.md`](https://github.com/robert-dean/deadair/blob/main/docs/internals/narrations.md) |
| speech engines, voices, cues, pads, segments | [`render.md`](https://github.com/robert-dean/deadair/blob/main/docs/internals/render.md) |
| the mount, the audience gate, why it is quiet | [`playout.md`](https://github.com/robert-dean/deadair/blob/main/docs/internals/playout.md) |
| the model, the gate, the tool loop | [`llm.md`](https://github.com/robert-dean/deadair/blob/main/docs/internals/llm.md) |
| the Dockerfile, the image variants, CI | [`deployment.md`](https://github.com/robert-dean/deadair/blob/main/docs/internals/deployment.md) |
| lifecycle, config, settings, DI, connections | [`apps/api/CLAUDE.md`](https://github.com/robert-dean/deadair/blob/main/apps/api/CLAUDE.md) |
| plugins and host capabilities | [`packages/plugin-sdk/CLAUDE.md`](https://github.com/robert-dean/deadair/blob/main/packages/plugin-sdk/CLAUDE.md) |

## Four rules that apply everywhere

- **Generated output is never hand-edited**, per the table above.
- **A setting is a string.** Every layer of `AppConfig` holds text, so an on/off setting is read
  through `settingIsOn` and a number through the resolvers in `setting.numbers.ts`.
  `config.get(key, false)` answers the string `'false'`, which is truthy.
- **In plugin code, `undefined` means "not set", never `null`.**
- **What is stored or sent is JSON-safe**: no `Date`, no class instances, no functions, durations as
  integer milliseconds, dates as ISO-8601 strings. Host methods are exempt.
