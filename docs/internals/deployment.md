# Internals: the production image

Production is one container. What that gives up, what it must never give up, and the layer rules an
ordinary edit undoes without noticing.

Every paragraph here records a measured failure and the fix that was chosen over the obvious one.
Read the ones covering whatever you are about to change. The always-loaded index is
[`CLAUDE.md`](../../CLAUDE.md).

**Production is ONE container, and what it gives up is the container boundary rather than the
process one.** `Dockerfile` builds the whole station — API, console, audio chain, stream server,
track shim, measurement sidecar, and on two of three variants a speech server, on one of them a
database — supervised by s6, service definitions in `docker/rootfs`. Nothing was folded into Node
to make it fit; the sidecar is still a separate process because decoding still does not happen in
Node. Development is unchanged and still the compose stack, which is why the two must not drift:
an image both worlds share (nginx, the speech server) is pinned to ONE version written in both
places. Seven things are load-bearing. **The base is the audio chain's own image**, because that is
the component that is hard to install correctly and it is Debian trixie, which is what lets the
stream server be copied out of an image built on the same release — Icecast 2.5 is not in Debian
and building it wants a library newer than trixie ships, and 2.4 costs `/admin/eventfeed`, which
is how the station knows anybody is listening. **The parts still address each other by their
compose names**, resolved to this container in `/etc/hosts` by the boot script, so every code
default, every rendered config and the edge's own proxy lines are the same strings in both worlds
— the alternative was a second set saying loopback that has to be kept in step with the first.
`PLAYOUT_BASE_URL` is the one exception and must be set, since its default names both the wrong
host and the wrong port. **The API runs its compiled `dist`**, which is what the conditional
imports map bought. **The config watch restarts the two services whose config changed** rather
than stopping the container, which is the same mechanism doing less damage. **Migrations run at
boot** and wait for the database rather than depending on it, so one rule covers a bundled
database and an operator's slower one. And **everything the station keeps is under `/data`**, so a
backup is one directory; the runtime user is 99:100 to match what a home server's app share is
owned by, so there is no ownership step. And **nothing derived from this repository may sit above
the fence comment in the final stage**, which is the newest of the seven and the one an ordinary
edit undoes without noticing: a layer's digest covers everything beneath it, so a `COPY` of the
station's own tree placed above the speech server gives that gigabyte of weights a new digest on
every commit, and an API-only release re-pushes it and every operator re-pulls it. That is what
the file did for as long as it existed. Two smaller rules hold the same line — an `apt-get` is
never fused into the same `RUN` as a large `cp -a`, because the copy is byte-identical from one
build to the next and the dpkg state beside it is not, so fusing them costs the whole layer its
determinism; and a heavy tree is owned by the `RUN` that lays it down rather than by a later
`chown -R`, since an overlay chown rewrites every file it touches into a second copy of the tree
(the file said this about `/app` while doing it to `/opt/tts`). The same argument one stage up is
why the `manifests` stage exists: an install is a function of the lockfile, so the builder copies
the manifests alone, installs, and copies the source over the top — its member list is
`pnpm-workspace.yaml`'s own globs rather than a list of paths, so a package added later is covered
and a fixture manifest under `apps/api/tests` is not. **No workspace package may declare an
`install`, `prepare` or `prepack` script**, which is the one thing that makes installing before
the source is there safe; one that needs its own source at install time has to be installed after
the source copy instead. The copy over the top is the MEMBERS, `turbo.json` and `link-peers.mjs`
and nothing else, for the fence's own reason one stage out: it was `COPY . .`, which made a
JavaScript rebuild a function of every file in the tree, so editing an nginx snippet rebuilt all
fifteen packages from nothing. Images are built and published by
`.github/workflows/`, three variants from two build args, and `codegen` is never run there for the
reason it is never run anywhere automated: its outputs are committed and regenerating them needs a
live database. **The variants publish under the COMMIT SHA and the mutable tags are moved onto
them afterwards** (`promote`, a registry-side `imagetools` retag), which is what lets the image
jobs run beside the tests rather than behind them: what the old `needs: [build]` protected was
never the images but `latest`, `slim` and `full`, and those still wait. The speech base is pinned
by digest for the fence's reason again — a moving tag there rebuilds and re-pushes the voice for a
change nobody here made.
