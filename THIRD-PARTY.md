# Third-party software in the deadair image

The [MIT licence](LICENSE) covers the source in this repository. It does not cover the programs the
published container image bundles alongside it, which this repository does not write and does not
relicense. The image is an aggregate: each component below keeps its own terms, and several of them
are copyleft.

Nothing here is modified. The [Dockerfile](Dockerfile) fetches every one of them from its own
upstream at the version named below, so the corresponding source is whatever that upstream
publishes — which is how the source-availability obligation under the GPL and AGPL entries is met.

This file is about the SOFTWARE. What the station plays is a separate question with a separate
answer: see [docs/licensing.md](docs/licensing.md), and note that deadair grants you no right to
broadcast any music.

## In the container image

| Component                                                            | Version                 | Licence                     | Present in         |
| -------------------------------------------------------------------- | ----------------------- | --------------------------- | ------------------ |
| [Liquidsoap](https://github.com/savonet/liquidsoap)                   | 2.4.5                   | GPL-2.0-or-later            | all variants       |
| [Icecast](https://gitlab.xiph.org/xiph/icecast-server) (LibreTime image) | 2.5.0                 | GPL-2.0                     | all variants       |
| [go-librespot](https://github.com/devgianlu/go-librespot)             | v0.7.4                  | **GPL-3.0**                 | all variants       |
| [nginx](https://nginx.org)                                            | nginx.org stable, Debian trixie | BSD-2-Clause        | all variants       |
| [Node.js](https://nodejs.org)                                         | 26.7.0                  | MIT                         | all variants       |
| [s6-overlay](https://github.com/just-containers/s6-overlay)           | 3.2.3.2                 | ISC                         | all variants       |
| [dbmate](https://github.com/amacneil/dbmate)                          | v2.35.0                 | MIT                         | all variants       |
| [Kokoro-FastAPI](https://github.com/remsky/Kokoro-FastAPI)            | CPU image, pinned by digest | Apache-2.0              | `latest`, `full`   |
| [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) (model weights) | as shipped in that image | Apache-2.0                 | `latest`, `full`   |
| [PostgreSQL](https://www.postgresql.org)                              | 17, from the PGDG apt repository | PostgreSQL Licence | `full`             |
| [Redis](https://redis.io)                                             | 8.0.2, from Debian trixie | **AGPL-3.0** (see below)  | `full`             |

Everything else in the final image is Debian trixie, under the terms Debian ships it.

**Two entries are worth reading twice**, because they carry obligations the others do not.

**go-librespot is GPL-3.0.** It is the shim that fetches audio for the Spotify plugin. It runs as
its own process and is fetched unmodified at a pinned tag; anyone redistributing the image is
passing that binary on under the GPL and owes its recipients the corresponding source, which is the
upstream repository at that tag.

**Redis 8 is tri-licensed** — AGPLv3, RSALv2 or SSPLv1 — and only the first of those is
DFSG-free, so the copy Debian main ships, which is the copy this image installs, is under
**AGPL-3.0**. The AGPL's network clause is about offering source to users who interact with the
program over a network; Redis here is unmodified and its source is published by both Redis and
Debian, so pointing at those satisfies it. It is only in the `full` variant. An operator who would
rather not distribute it at all should run `latest` or `slim` and bring their own cache, which is
what those variants are for.

## Fonts

The console bundles seven families through [Fontsource](https://fontsource.org), which repackages
and does not relicense them: Archivo, Chakra Petch, IBM Plex Mono, IBM Plex Sans, Newsreader, Public
Sans and Space Mono. All are under the [SIL Open Font License
1.1](https://openfontlicense.org/), which permits bundling and redistribution and asks that the
licence travel with the font.

The desktop app embeds the IBM Plex TTFs directly, and ships `OFL.txt` beside them in
`apps/desktop/src/MaroonedSoftware.Deadair.Desktop/Assets/Fonts/`.

## The measurement sidecar

`analysis/` is a Python service, and its dependencies are pinned with their licences checked by
hand — including the licence of any model WEIGHTS, which package metadata does not carry. The rule,
the evidence per line, and why one dependency is installed `--no-deps`, are in
[analysis/requirements.txt](analysis/requirements.txt) and in `analysis/README.md` under "The rule,
stated once". Nothing copyleft or non-commercial is in that path.

## Audio this repository ships

| File                    | sha256                                                             | Origin                                                        |
| ----------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------- |
| `stream/station-id.mp3` | `18837bb301549d2648cfb438220995fa8e90c4483b3ccb6e5a505e68bc15e2ac` | Made by the author of this project and dedicated to the public domain (CC0-1.0). It is the fallback ident the mount falls through to when there is nothing else to play. |

That is the whole list. `assets/pads/` ships nothing — it is empty deliberately rather than
pending, and the rule for adding to it (CC0 or an equivalent dedication, never
attribution-requiring) is in `docs/internals/render.md` under "Pads", with the provenance schema in
`assets/pads/MANIFEST.json`. `stream/music/` holds only a `.gitkeep`: the music is the operator's.
