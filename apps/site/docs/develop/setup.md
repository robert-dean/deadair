---
title: Setting up a checkout
sidebar_position: 1
description: From clone to a station running on your machine, with every step that a fresh clone actually needs.
---

# Setting up a checkout

This is the whole of it, in order, for somebody who has just cloned the repository. It ends with the
console asking you to create an administrator.

You need **Node 26 or newer**, **pnpm 11** and **Docker**. Nothing else is installed globally: the
database, the cache, the mail catcher, the speech server, the measurement sidecar, Icecast and
Liquidsoap all run in containers, and the API and console run on your machine.

## 1. Install the workspace

```bash
pnpm install
```

## 2. Write the API's environment file

```bash
cp apps/api/.env.example apps/api/.env
```

The values in it already match the containers the next step starts. Two are deliberately empty,
because the station refuses to start without them and a default would be a published secret:

```bash
openssl rand -hex 32
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 | base64 -w0
```

The first is `KMS_LOCAL_ROOT_KEY`, which encrypts every credential the station stores. The second is
`AUTHENTICATION_SESSION_JWT_PRIVATE_KEY`, which signs sessions. Paste each into the file. On macOS
the second command is `base64` with no `-w0`.

The file says the database twice on purpose. `DATABASE_URL` is what dbmate and kysely-codegen read;
the discrete `DATABASE_*` values are what the station connects with. Keep them agreeing.

## 3. Start the services

```bash
docker compose up -d
```

| Service | Where | What it is |
| --- | --- | --- |
| `db` | `localhost:55432` | PostgreSQL. Not 5432, so it cannot collide with one you already run |
| `redis` | `localhost:6379` | Sessions and the job queue |
| `mailpit` | SMTP `1025`, inbox `http://localhost:8025` | Accepts every message and delivers none, so sign-in mail and email factors can be walked end to end |
| `kokoro` | `localhost:8880` | A speech server, so the station has a voice |
| `analysis` | `127.0.0.1:9321` | The measurement sidecar: cue points and loudness |
| `icecast` | `127.0.0.1:8000` | The stream server |
| `liquidsoap` | `127.0.0.1:3679`, harbor `8005` | The mixing chain |

## 4. Apply the schema

```bash
pnpm --filter @deadair/api migrate:up
```

Migrations are dbmate SQL under `apps/api/data/migrations`, in the `deadair` schema. `pnpm db:reset`
throws the database away and does this again from zero, which is usually quicker than unpicking a
migration you are still writing.

## 5. Build once

```bash
pnpm build
```

**This is not optional before the first `pnpm dev`.** The console imports `@deadair/sdk`, and the
SDK, the plugin SDK and the shared error codes are all built to a `dist/` that a fresh clone does not
have. The API's watcher builds what it depends on, but nothing in the `dev` graph builds the SDK for
the console, so Vite starts and then cannot resolve it. Once built, you only need this again when you
change one of those packages.

## 6. Run it

```bash
pnpm dev
```

That starts the API on `http://localhost:3333` and the console on `http://localhost:3002`, which is
the one to open. The console proxies `/api` to the API, so there is nothing else to point anywhere.

**The first page is the onboarding wizard**: a station with no accounts asks for an administrator's
email address and password before anything else, and that call is the one unauthenticated write in
the station. After it, you are signed in and on the Desk.

There is no music yet. Connect a provider under Settings, Plugins, exactly as
[Quick start](../quick-start.md) describes, and remember that Spotify needs its second, playback
authorization as well as the connection.

## One origin, and HLS

`pnpm dev` leaves the console and the API on different ports, which is fine for everything except
HLS and anything that cares about cookie origins. The dev overlay puts one nginx in front of both:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d nginx
```

The station is then at `http://localhost:8080`, console, API and stream together, exactly as the
image serves it in production.

## Running the checks

```bash
pnpm lint
pnpm test
pnpm build
```

Those three are what a pull request is measured against, alongside the rules in
[Contributing](./contributing.md). Per package while you work:

```bash
pnpm --filter @deadair/api test
pnpm --filter @deadair/web test
```

Tests live in each package's top-level `tests/`, mirroring `src/`.

## Generated code

Three things in this repository are generated and never hand-edited: the ContractKit routers, types
and SDKs from `apps/api/data/contracts`, the permission types from `apps/api/data/permissions`, and
the Kysely database types from the schema itself.

```bash
pnpm build:contracts      # routers, types, the four SDKs, the API reference, openapi.yaml
pnpm build:permissions    # permission types
pnpm build:datatypes      # database types, from a live migrated database
pnpm codegen              # all three
```

`build:datatypes` and therefore `codegen` walk a real database, so the containers have to be up and
the migrations applied. CI regenerates all of it and fails on anything that moved, so a changed
contract, permission or migration is committed together with its output.

## Developing a plugin against this checkout

The station reads operator-installed plugins from `apps/api/data/plugins`, which is gitignored and
does not exist until you make it. Link yours in rather than copying:

```bash
mkdir -p apps/api/data/plugins
ln -s /path/to/my-plugin apps/api/data/plugins/my-plugin
```

Then press **Rescan** on the Plugins page. Changed code needs a restart rather than a Rescan, because
Node keeps every module it has already imported. [Packaging and installing](../plugin-development/packaging.md)
has the rest, including why a linked folder must not bring its own `node_modules`.

## The listener apps

They are not in the pnpm workspace and are not built by any of the above. Each has its own toolchain
and its own README: `apps/android` (Gradle), `apps/ios` (Xcode), `apps/desktop` (.NET) and
`apps/streamdeck`, which is a workspace member and builds with everything else.

## When something is wrong

- **The API exits at boot naming a variable.** That variable is missing from `apps/api/.env`. The two
  keys are the usual ones.
- **The console starts but shows import errors for `@deadair/sdk`.** Step 5 has not been run, or a
  package changed since it was.
- **The database refuses the connection.** Check the port is 55432 rather than 5432, and that
  `docker compose ps` shows `db` healthy.
- **Liquidsoap refuses the bridge secret, or Icecast refuses the admin password.** The audio chain
  keeps credentials the station generated for whichever database it was first started against, so a
  second checkout sharing those containers will say this. It is harmless unless you are working on
  playout, and `pnpm db:reset` followed by restarting the two containers clears it.
- **Something else.** [Q&A discussions](https://github.com/robert-dean/deadair/discussions/categories/q-a)
  is the place to ask.
