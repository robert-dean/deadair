# Contributing

One maintainer, one install, and a project that has just cut its first release. Issues and pull
requests are welcome; an issue before a large pull request is welcome too, because the answer may be
that the call has already been made and written down.

## Getting it running

```bash
pnpm install
docker compose up -d              # Postgres, Redis, Icecast, Liquidsoap, a voice, the sidecar
pnpm --filter @deadair/api migrate:up
pnpm dev
```

Node 26+, pnpm and Turborepo. The Android app has its own Gradle build and the desktop app its own
.NET solution. Each has a `package.json` holding a name and a version and nothing else, which is how
changesets numbers their releases; pnpm and turbo find nothing in them to install or run.

## Before you open a pull request

```bash
pnpm lint
pnpm test
pnpm build
```

`pnpm test` runs every package through turbo. CI runs the same 446 test files as one sharded vitest
invocation instead, which is faster for a reason explained in `CLAUDE.md`; running them by hand is
unchanged.

CI on a pull request from a fork waits for the maintainer to approve each run, because the workflow a
pull request runs is the one in the pull request. Expect a short delay before the checks start. The
one that has to pass is `ci-ok`, which stands for everything else. Pull requests are squash-merged, so
the commit messages inside yours are yours to write however you like; the merge gets a subject in the
form described under "Commit messages".

Security problems go through a private advisory rather than an issue or a pull request, as
`SECURITY.md` explains.

## The rules that will bounce a change

**Generated output is never hand-edited.** ContractKit routers and types come from the `.ck` files
in `apps/api/data/contracts`, and so do the TypeScript, Kotlin and C# SDKs and the website's API
reference and OpenAPI spec (`apps/site/docs/api-reference`, `apps/site/static/openapi.yaml`).
Permission types come from `apps/api/data/permissions/*.perm`. Database types come from the
schema. If you want to change an endpoint or a shape, edit the `.ck` and run `pnpm build:contracts`,
then commit the regenerated files alongside it. **CI regenerates all three and fails on anything that moved**, so an edited
contract merged without its output is a red check rather than a runtime surprise.

**A setting is a string.** Every layer of `AppConfig` holds text, so read an on/off setting through
`settingIsOn` and a number through the resolvers in `setting.numbers.ts`. `config.get(key, false)`
answers the string `'false'`, which is truthy.

**In plugin code, `undefined` means "not set", never `null`.**

**Tests live in each package's top-level `tests/`**, mirroring `src/`, not beside the code.

**Formatting** is 4-space indent, single quotes, semicolons, print width 150, `arrowParens: avoid`.
`pnpm format` applies it. Markdown is deliberately excluded and wrapped by hand at about 100
columns.

## Documentation

`CLAUDE.md` at the root is the index, and it is kept small on purpose. The reasoning behind a rule
lives in the scoped file that covers the thing it is about — `apps/api/CLAUDE.md`,
`packages/plugin-sdk/CLAUDE.md`, `docs/internals/*.md` — and most of those paragraphs exist because
the obvious fix was shipped first and was wrong. Read the one covering whatever you are changing,
and add to it rather than to the root file.

The [Ideas](https://github.com/robert-dean/deadair/discussions/categories/ideas) discussions hold work
that was designed against the real tree and then deliberately deferred, labelled by subsystem.
**Read them before designing a feature from scratch**: the call may already have been made, and the
discussion will say what it cost. A new idea goes there too. One that has not been checked against
the code yet gets the `unscoped` label, and loses it once somebody designs it against the tree.

## Releasing

Three things are released from this tree, each with its own version and changelog: the station
(every `@deadair/*` package under `apps/api`, `apps/web`, `packages/` and `plugins/`, which ship as one
image and share one number), the Android listener (`@deadair/android`) and the desktop app
(`@deadair/desktop`).

A change somebody running the station or listening to it would notice gets a changeset, in the same
pull request:

```bash
pnpm changeset
```

It asks which packages the change touches and how far each bumps, and writes a file under
`.changeset/` holding a paragraph that becomes a changelog bullet word for word. Name the package you
changed; naming any station package bumps the whole station. Without the prompts:

```bash
pnpm changeset --minor @deadair/plugin-rss --patch @deadair/android -m 'RSS feeds keep their order.'
```

`.changeset/README.md` says the same in fewer words.

`pnpm release:version` consumes the pending changesets: changesets bumps the manifests, and the
script writes one entry per unit into `CHANGELOG.md`, `apps/android/CHANGELOG.md` and
`apps/desktop/CHANGELOG.md`, then copies each app's number into the file its build stamps
(`app/build.gradle.kts`, `Directory.Build.props`). Change an app's version in its `package.json` and
nowhere else; the build job fails when a copy disagrees.

Nobody runs that by hand to release. Every push to `main` carrying a changeset has CI run it on a
branch and open, or refresh, a pull request titled `chore: update versions` holding the bumps and the
entries. **Merging that pull request is the station's release.** The run on the merge sees a version
with no `v*` tag, builds and tests everything, publishes the images under the version and its
major.minor line, then tags the commit and publishes a GitHub release of the changelog entry. If the
tests fail nothing is tagged, and the next green push to `main` releases the same version.

The pull request runs no checks. CI opened it with the workflow token, and GitHub starts nothing for
an event that token caused; the merge runs every check before anything is tagged. It is rebuilt from
`main` on every push, so change what an entry says by editing its changeset on `main`, not by
committing to the branch.

The listener apps are numbered by the same pull request and published on their own. Pushing an
`android-v<version>` tag on main publishes that build to Play's internal track, and anything further
is the Android release workflow run by hand (`apps/android/README.md` walks it). The Desktop release
workflow, run by hand, cuts `desktop-v<version>` with the entry from `apps/desktop/CHANGELOG.md`.

## Commit messages

A subject of the form `area: what changed`, in prose, lower case, no trailing full stop. The body
says why, and is the part worth writing. There is no conventional-commit tooling, and the changelogs
are written from changesets rather than from these, so write them for a person.
