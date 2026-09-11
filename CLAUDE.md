# deadair

An AI radio station: it picks the records, writes what the presenter says between them, speaks it,
and streams the result. A Koa API (`apps/api`), a React console (`apps/web`), a plugin system for
music providers, enrichment sources, speech and models (`packages/plugin-sdk`, `plugins/*`), and the
identity/permissions/settings chassis underneath them. **No decoding, mixing or encoding happens in
Node**: Liquidsoap and Icecast run beside the station and the measurement sidecar is a separate
process for that reason. That is the true version of "audio never touches Node", which this file
used to state as an absolute the code visibly contradicted — `speak()` returns a real
`ReadableStream`, the render pipeline writes segment audio through Node, and Liquidsoap fetches it
back over HTTP.

## Where the detail lives

**This file is loaded into every session, so it holds only what you need before touching anything.**
The reasoning behind each rule — the measured failure, the fix that was chosen over the obvious one
— lives in a scoped file you read when you get there. Those files are **not optional reading when
you are changing the thing they describe**: most of their paragraphs exist because the obvious fix
was shipped first and was wrong.

| Working on | Read |
| --- | --- |
| `apps/api/src/**` (lifecycle, config, settings, DI, connections) | [`apps/api/CLAUDE.md`](apps/api/CLAUDE.md) |
| `apps/web/**` | [`apps/web/CLAUDE.md`](apps/web/CLAUDE.md) |
| `apps/site/**` | [`apps/site/CLAUDE.md`](apps/site/CLAUDE.md) |
| `plugins/**`, `packages/plugin-sdk/**` | [`packages/plugin-sdk/CLAUDE.md`](packages/plugin-sdk/CLAUDE.md), then its [`README.md`](packages/plugin-sdk/README.md) |
| `apps/android/**`, `packages/sdk-kotlin/**` | [`apps/android/CLAUDE.md`](apps/android/CLAUDE.md) |
| `apps/desktop/**`, `packages/sdk-csharp/**` | [`apps/desktop/CLAUDE.md`](apps/desktop/CLAUDE.md) |
| `apps/ios/**`, `packages/sdk-swift/**` | [`apps/ios/CLAUDE.md`](apps/ios/CLAUDE.md) |
| the running order, briefs, periods, committing, track audio | [`docs/internals/director.md`](docs/internals/director.md) |
| which records get chosen, ratings, advisory, the search tool | [`docs/internals/programming.md`](docs/internals/programming.md) |
| what a break says, facts, phrasings, bulletins, the format clock | [`docs/internals/breaks.md`](docs/internals/breaks.md) |
| personas, their notebooks, their stories, latitude, auditions | [`docs/internals/personas.md`](docs/internals/personas.md) |
| phone-ins, beats, casting, stitching | [`docs/internals/productions.md`](docs/internals/productions.md) |
| speech engines, voices, cues, pads, segment stages, pronunciations | [`docs/internals/render.md`](docs/internals/render.md) |
| the mount, the audience gate, why it is quiet, the activity feed | [`docs/internals/playout.md`](docs/internals/playout.md) |
| the model, the gate, the tool loop | [`docs/internals/llm.md`](docs/internals/llm.md) |
| the Dockerfile, the image variants, CI | [`docs/internals/deployment.md`](docs/internals/deployment.md) |

Each of those is sectioned, so the answer to one question is a heading rather than a file. Several
tasks cross more than one of them, and for those the order matters:

| Changing | Read, in this order |
| --- | --- |
| what a break says | `breaks.md`, then `personas.md` for whoever is saying it, `llm.md` for the loop that writes it, `render.md` for what becomes of the words |
| what plays next | `programming.md`, then `director.md` for the order the pick lands in |
| anything that airs, or fails to | `playout.md`, then `director.md` — the two answer different halves of "why is nothing playing" |
| a setting, anywhere | `apps/api/CLAUDE.md`, both the string rule and the registry, before writing the first `config.get` |
| a plugin, or a capability on the host | `packages/plugin-sdk/CLAUDE.md`, then its `README.md` |
| the schema | the generated-output rule below first, because the types are not yours to edit |

Work designed against the real tree and then deliberately deferred lives in the
[Ideas](https://github.com/robert-dean/deadair/discussions/categories/ideas) category of GitHub
Discussions, labelled by subsystem (`area: director`, `area: render`, and so on). **Read it before
designing a station feature from scratch: the call may already have been made.** The roadmap is
#4. It moved there from `docs/todo/` on 2026-09-11, so a comment citing a discussion URL is citing
what used to be a file. From a session (it needs the network):

```bash
gh api graphql -f query='{repository(owner:"robert-dean",name:"deadair"){discussions(first:100,categoryId:"DIC_kwDOT1dAaM4DFUWO"){nodes{number title labels(first:5){nodes{name}}}}}}'
gh api graphql -f query='{repository(owner:"robert-dean",name:"deadair"){discussion(number:37){title body comments(first:10){nodes{body}}}}}'
```

Read the comments too: the two ideas longer than GitHub's body limit continue in their first one.

The long-form arguments the rest of the tree cites by name live in the scoped files above, each under
its own heading. There is no separate directory of them, and a comment or a doc that points at one is
pointing at something that has never existed:

- **Plugin trust** — why plugins run in-process permanently, what the closed subprocess option bought
  back, which half of the JSON-safe rule survives, and the four-row threat table that says which
  three threats the egress layer actually answers: `packages/plugin-sdk/CLAUDE.md` § "Trust and
  egress".
- **Analysis licensing** — every dependency in the analysis path is permissive, weights included, and
  the sidecar is NOT a licence workaround. Read it before pinning anything in
  `analysis/requirements.txt`, and note that the licence to check is the model WEIGHTS' licence,
  which is not in the package metadata: `analysis/README.md` § "The rule, stated once".
- **Who owns the running order** — why the director is the sole writer, the four bugs that were all
  the same bug, and why the schedule is a document and a resolver rather than an actor:
  `docs/internals/director.md` § "Who owns the running order".
- **Bytes before air** — why a record is not committed until its audio is local, why the gate cuts
  rather than filters, and why it fails open: `docs/internals/director.md` § "Nothing airs until its
  bytes are here".
- **Pad licensing** — what this repository may ship as audio, and why the manifest records a checksum
  and an uploader: `docs/internals/render.md` § "Pads".
- **How work is dispatched** — the four mechanisms, which properties choose between them, and why
  there is no event bus: `apps/api/CLAUDE.md` § "How work is dispatched".
- `apps/api/README.md` for the boot sequence, DI scoping convention and middleware. Its module and
  route tables were checked against `src/modules/modules.ts` and `src/routes/routes.setup.ts` on
  2026-09-09 and list all 37 modules and all 29 routers in registration order. Those two files stay
  the source of truth: verify against them before relying on an entry.
- `README.md` and `docs/licensing.md` are written for whoever RUNS this rather than for whoever
  works on it. Keep them true.

## Workspace

```
apps/api          Koa server, ContractKit routers, dbmate migrations
apps/web          React console (Vite, TanStack Router, Mantine)
apps/site         the public website at deadair.radio (Docusaurus). Never in the image
apps/android      Kotlin/Compose listener app (Media3). Its own Gradle build and CI job. Its
                  package.json is a name and a version for changesets, and nothing else
packages/plugin-sdk   the plugin contract and host capabilities
packages/sdk          typed client for the API, generated from the contracts
packages/sdk-kotlin   the same contracts as a Kotlin/Ktor client, for the Android app. Generated;
                      no package.json, so pnpm and turbo never see it
apps/desktop      Avalonia listener and operator desk (.NET 10, C#). Its own solution and CI job,
                  and a package.json that is a version for changesets, as apps/android's is
packages/sdk-csharp   the same contracts as a C#/System.Text.Json client, for the desktop app.
                      Generated, save for the one project file; no package.json
apps/ios          SwiftUI listener app (AVFoundation). Its own Xcode project and CI job, a local
                  Swift package holding every tested decision, and a package.json that is a
                  version for changesets, as the other two apps' are
packages/sdk-swift    the same contracts as a Swift/Codable client, for the iOS app. Generated,
                      save for Package.swift; no package.json
packages/error-codes  shared error code constants
packages/config-*     shared eslint / tsconfig
plugins/*             bundled plugins: spotify, navidrome, musicbrainz, lastfm, wikipedia (the
                      prose the station's facts are extracted from), rss, websearch (SearXNG, Brave
                      or Tavily, whichever the operator points it at), weather (Open-Meteo, the US
                      National Weather Service or OpenWeatherMap), kokoro and chatterbox
                      (the station's voice), llm, analyzer (the adapter over the measurement sidecar)
analysis/             the measurement sidecar: a Python service that decodes a record and answers
                      with its cue points and its loudness. No decoding happens in Node
stream/, nginx/, docker-compose*.yml   Icecast, Liquidsoap and friends (DEV)
Dockerfile, docker/               the production image: the whole station in one container
deploy/, unraid/                  how somebody else installs it
```

`apps/api` modules, in registration order: `logging`, `dataConnections`, `health`, `data`, `crypto`,
`authentication`, `permissions`, `policy`, `art`, `catalog`, `onboarding`, `settings`, `stream`,
`plugins`, `jobs`, `playlists`, `charts`, `similarity`, `news`, `search`, `weather`, `topics`,
`scrobble`, `llm`,
`personas`, `schedule`, `render`, `playout`, `nowplaying`, `analysis`, `director`, `storage`,
`activity`, `history`, `enrichment`, `productions`, `station`. **`src/modules/modules.ts` is the source of
truth and the order is load-bearing** — see [`apps/api/CLAUDE.md`](apps/api/CLAUDE.md). Check it
before assuming a subsystem exists.

## The rules that apply everywhere

Everything else is scoped. These five are not, and each one is cheap to break from anywhere.

**Generated output.** ContractKit routers and types are generated from `.ck` files in
`apps/api/data/contracts` (`pnpm build:contracts`), and so are the Kotlin SDK in
`packages/sdk-kotlin` that the Android listener compiles, the C# SDK in `packages/sdk-csharp` that
the desktop app compiles and the Swift SDK in `packages/sdk-swift` that the iOS app compiles, and so
is the website's API reference under `apps/site/docs/api-reference` (its `index.md` aside).
Permission types in `apps/api/src/modules/permissions/generated` come from
`apps/api/data/permissions/*.perm` via pdsl (`pnpm build:permissions`). Kysely types come from
`pnpm build:datatypes` (enum override sync, then kysely-codegen). `pnpm rebuild:data` rolls the
schema all the way down and back up. Never hand-edit any of it. Migrations are dbmate SQL under
`apps/api/data/migrations`, schema `deadair`.
**CI regenerates all three and fails on anything that moved** (the `generated` job, which is the only
one allowed to run codegen because the database it walks from zero is its own service container), so
an edited `.ck`, `.perm` or migration merged without its output beside it is now a red check rather
than a route answering a shape the SDK does not have. That job is also why
`contractkit.config.json` names its root RELATIVELY: it was an absolute path under one home
directory, which resolved on exactly one machine and matched there only because macOS ignores case.

**The JSON-safe rule covers what is stored or sent, and nothing else.** Manifests, permissions,
config fields and every `capabilities/` payload: no `Date`, no class instances, no functions,
durations as integer milliseconds, dates as ISO-8601 strings. Host methods are exempt and
deliberately so. `boundary.json.safe.ts` fails `tsc` over a registered payload, so it cannot drift by
accident. The full rule and its exemptions are in
[`packages/plugin-sdk/CLAUDE.md`](packages/plugin-sdk/CLAUDE.md).

**In plugin code, `undefined` means "not set". Never `null`.**

**A setting is a STRING.** Every layer of `AppConfig` holds text, so an on/off setting is read
through `settingIsOn` and never as a boolean, and a number through the resolvers in
`setting.numbers.ts`. `config.get(key, false)` answers the string `'false'`, which is truthy. This
was live in six places at once; see [`apps/api/CLAUDE.md`](apps/api/CLAUDE.md).

**Formatting and toolchain:** 4-space indent, single quotes, semicolons, print width 150,
`arrowParens: avoid`. Node 26+, TypeScript 6, pnpm + Turborepo. `pnpm test` / `pnpm lint` /
`pnpm build` run through turbo; per package, `pnpm --filter @deadair/api test`. Tests live in each
package's top-level `tests/`, mirroring `src/`. **CI does not run them through turbo**:
`vitest.config.ts` at the root names every package's own config as a PROJECT, so one
`vitest run --shard=k/4` sees all 310 files and four jobs split them. The reason is that turbo pays
one vitest STARTUP per package and the startups are the cost, not the assertions — `apps/api` alone
is 3736 tests in 18 seconds against the other fourteen packages' half as many in 55. Nothing about
running tests BY HAND changed: the root config replaces no package's config, so `pnpm test` through
turbo and `pnpm --filter <pkg> test` both behave exactly as before, and a new package with tests is
picked up by adding its own `vitest.config.ts` as usual.

## Adding to these files

A new rule goes in the scoped file that covers the thing it is about, not here. This file grows only
when a rule genuinely applies everywhere — there are five, and that number should be hard to move.
The reason is measurable: this file was 153KB and was loaded into every session whatever the task
was, which is a standing cost paid by every question anybody asks about any part of the tree.
