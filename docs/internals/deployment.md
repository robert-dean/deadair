# Internals: the production image

Production is one container. What that gives up, what it must never give up, and the layer rules an
ordinary edit undoes without noticing.

Every paragraph here records a measured failure and the fix that was chosen over the obvious one.
Read the ones covering whatever you are about to change. The always-loaded index is
[`CLAUDE.md`](../../CLAUDE.md).

## One container, and what it costs

**Production is ONE container, and what it gives up is the container boundary rather than the process one.**
`Dockerfile` builds the whole station — API, console, audio chain, stream server, track shim, measurement
sidecar, and on two of three variants a speech server, on one of them a database — supervised by s6, service
definitions in `docker/rootfs`. Nothing was folded into Node to make it fit; the sidecar is still a separate
process because decoding still does not happen in Node. Development is unchanged and still the compose stack,
which is why the two must not drift: an image both worlds share (nginx, the speech server) is pinned to ONE
version written in both places. Seven things are load-bearing.

**The base is the audio chain's own image**, because that is the component that is hard to install correctly
and it is Debian trixie, which is what lets the stream server be copied out of an image built on the same
release — Icecast 2.5 is not in Debian and building it wants a library newer than trixie ships, and 2.4 costs
`/admin/eventfeed`, which is how the station knows anybody is listening.

**The parts still address each other by their compose names**, resolved to this container in `/etc/hosts` by
the boot script, so every code default, every rendered config and the edge's own proxy lines are the same
strings in both worlds — the alternative was a second set saying loopback that has to be kept in step with the
first. `PLAYOUT_BASE_URL` is the one exception and must be set, since its default names both the wrong host
and the wrong port.

**The API runs its compiled `dist`**, which is what the conditional imports map bought.

**The config watch restarts the two services whose config changed** rather than stopping the container, which
is the same mechanism doing less damage.

**Migrations run at boot** and wait for the database rather than depending on it, so one rule covers a bundled
database and an operator's slower one.

And **everything the station keeps is under `/data`**, so a backup is one directory; the runtime user is
99:100 to match what a home server's app share is owned by, so there is no ownership step.

## What is in front of it

**Behind a tunnel or a reverse proxy, every listener is the same caller until the operator says otherwise.**
The edge inside the container sets `X-Real-IP` to `$remote_addr`, which is the last hop rather than the
client, and the app believes it: `clientAddress` prefers that header, the rate limiter consumes on it (100
points per 5s, so one bucket for the whole internet) and the HLS audience register keys on it plus the user
agent, which then counts listeners by player rather than by person. Measured on a live station behind a
tunnel: two "listeners" that were one client fetching the playlist under two user agents.

`REAL_IP_FROM` is the opt-in, naming the proxy's address or CIDR — `172.16.0.0/12` covers a sibling container
reached through Docker's published port, which rewrites the source address to the bridge gateway and makes
every container look alike. `REAL_IP_HEADER` names where that proxy puts the address, defaulting to
`X-Forwarded-For` (walked recursively, since it is a list) and set to `CF-Connecting-IP` for a Cloudflare
tunnel. `scripts/init-station` renders both into `/etc/nginx/realip.d/`, which the edge includes with a
wildcard so an empty directory is a no-op, and **runs `nginx -t` before letting it stand**: a CIDR nginx
cannot parse would otherwise be the station off the air over a knob that only makes an address more accurate,
so a bad value is logged and dropped instead.

It is empty by default for the reason `TRUST_PROXY` is opted into rather than assumed. A forwarded address is
a header, and trusting one from a peer that is not really a proxy lets anybody who reaches the port be a
different caller on every request — rate limiting nobody at all, which is worse than rate limiting everybody
together. The compose edge takes the same include and expects a mounted file rather than an environment
variable.

## What the layer rules forbid

And **nothing derived from this repository may sit above the fence comment in the final stage**, which is the
newest of the seven and the one an ordinary edit undoes without noticing: a layer's digest covers everything
beneath it, so a `COPY` of the station's own tree placed above the speech server gives that gigabyte of
weights a new digest on every commit, and an API-only release re-pushes it and every operator re-pulls it.
That is what the file did for as long as it existed. Two smaller rules hold the same line — an `apt-get` is
never fused into the same `RUN` as a large `cp -a`, because the copy is byte-identical from one build to the
next and the dpkg state beside it is not, so fusing them costs the whole layer its determinism; and a heavy
tree is owned by the `RUN` that lays it down rather than by a later `chown -R`, since an overlay chown
rewrites every file it touches into a second copy of the tree (the file said this about `/app` while doing it
to `/opt/tts`). The same argument one stage up is why the `manifests` stage exists: an install is a function
of the lockfile, so the builder copies the manifests alone, installs, and copies the source over the top — its
member list is `pnpm-workspace.yaml`'s own globs rather than a list of paths, so a package added later is
covered and a fixture manifest under `apps/api/tests` is not.

**No workspace package may declare an `install`, `prepare` or `prepack` script**, which is the one thing that
makes installing before the source is there safe; one that needs its own source at install time has to be
installed after the source copy instead. The copy over the top is the MEMBERS, `turbo.json` and
`link-peers.mjs` and nothing else, for the fence's own reason one stage out: it was `COPY . .`, which made a
JavaScript rebuild a function of every file in the tree, so editing an nginx snippet rebuilt all fifteen
packages from nothing. The same argument is why `.dockerignore` keeps out everything under `apps/` and
`packages/` that the station does not run: the website's source, and the two listener apps with their
generated Kotlin and C# SDKs, which `COPY apps` and `COPY packages` otherwise carried in whole. Images are built and published by `.github/workflows/`, three variants from two build
args plus a third that selects nothing, and `codegen` is never run there for the reason it is never run
anywhere automated: its outputs are committed and regenerating them needs a live database.

**That third argument is `REVISION`, and where it is USED is the whole of the care it needs.** A build argument
costs the cache at its first use rather than at its declaration, and this is the only one here whose value is
different on every single build — consumed at the top of the final stage it would rebuild apt, Node, the
supervisor and the install for a string none of them read. So it is declared with the others and spent at the
bottom, on two lines that are metadata over the layer beneath them and rebuild nothing.

## What CI runs, and for which push

**A job runs when the part of the tree it checks changed, and everything runs when that cannot be
told.** The tree is several apps in several languages, and until this rule each push paid for all of
them: over sixty commits the macOS desktop build ran sixty times with sixteen changes to check, and
the sidecar's tests ran sixty times for one. `.github/scripts/changes.sh` diffs the push (or the pull
request's merge commit) against its base and answers one flag per part: `tree` (anything but prose,
which gates the build and the formatting check, a warning rather than a failure), `node` (the TypeScript workspace, which gates the test
shards), `generated`, `sidecar`, `android`, `desktop` and `image`. `changes.yml` runs it first in
both `pr.yml` and `release.yml`, and `build.yml` takes the flags as inputs that default to true.

**`image` is the one that deploys.** It is what the Dockerfile copies in, less what `.dockerignore`
keeps out, and without it neither workflow builds the three variants and `release.yml` does not
`promote`: the mutable tags stay on the last commit that changed the image, so a push of docs, the
website or a listener app no longer redeploys every station following `latest`. That is also the
commit a station reports as its revision, which stays honest because it is the commit the running
image was built from. `release.yml`'s manual trigger rebuilds and republishes everything, for when
the image should move although the tree did not (a base image's security fix).

**It fails open, and that is the part not to weaken.** No usable base commit (a tag push, a manual run,
a new branch, a force push) turns every flag on, so a release always builds everything. A change to a
workflow turns on the jobs it defines, and a change to the script or to a workflow that calls it turns
on everything. The rules are paths in one file, and `BASE=<commit> HEAD_REF=<commit>
.github/scripts/changes.sh` answers for any commit by hand, which is how a new rule should be checked
against history before it is trusted.

## The sidecar's own CI

**The sidecar is Python, and CI proves it two ways that TypeScript's checks cannot reach.** A
`sidecar` job in `build.yml`, run for any push that touches `analysis/`, installs the four pins
`analysis/requirements.txt` carries (numpy, scipy, fastapi, pydantic) plus pytest, and runs
`python3 -m pytest analysis/` directly — no
`pnpm install`, no `dist`, the same command a laptop runs. It stands alone rather than joining the
turbo test path or the root `vitest.config.ts`, which both assume a Node workspace this job never
touches. And `images.yml` proves the built image itself rather than only the source: after the
build step loads the image into the runner's daemon, `docker run … -c "import app"` against the
sidecar's own venv is what would have caught the two Dockerfile definitions diverging on the beat
tracker before a release shipped it — one installed it, the other silently didn't, and both built
clean. The smoke step runs only when the build also loaded the image, which is only a run that is
not publishing; a push still builds and pushes without either.

## Publishing

**The variants publish under the COMMIT SHA and the mutable tags are moved onto them afterwards** (`promote`,
a registry-side `imagetools` retag), which is what lets the image jobs run beside the tests rather than behind
them: what the old `needs: [build]` protected was never the images but `latest`, `slim` and `full`, and those
still wait. The speech base is pinned by digest for the fence's reason again — a moving tag there rebuilds and
re-pushes the voice for a change nobody here made.

**The commit goes INSIDE the image as well as into its tag**, which is not redundant: the mutable tags are
moved onto a sha-tagged image afterwards, so a station pulled as `latest` is running a commit whose name is
nowhere on the thing that is running. `REVISION` is passed as the same sha the tag is built from and written
twice — as the standard `org.opencontainers.image.revision` label, which `docker inspect` answers without
starting anything, and as `BUILD_REVISION` in the environment, which the API reads at boot. The second is what
makes "is the station running what I committed" answerable from the console: `/health` reports it for a probe,
`/station/checkup` carries it for the check-up page, and both hand on one string read once by
`modules/shared/build.revision.ts`. The two differ in who can reach them, and deliberately: `/health` is
anonymous because a probe holds no session, so the EDGE refuses it (`/api/health` and `/api/healthcheck` answer
404 in every nginx config) and the probe reaches it in-container on loopback, the way the Dockerfile's own
`HEALTHCHECK` does. Otherwise the commit a station is built from is a build fingerprint readable by anybody who
can reach the station at all. `/station/checkup` is the one that answers this for a person, behind
`platform.view`, which is why the field is on that contract as well as on `Health`. An image built by hand has no argument to pass and reports nothing, which
is the honest answer for something built from a working tree rather than from a commit.
