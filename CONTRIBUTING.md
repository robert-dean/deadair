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
.NET solution; neither has a `package.json`, and neither is in the pnpm workspace.

## Before you open a pull request

```bash
pnpm lint
pnpm test
pnpm build
```

`pnpm test` runs every package through turbo. CI runs the same 446 test files as one sharded vitest
invocation instead, which is faster for a reason explained in `CLAUDE.md`; running them by hand is
unchanged.

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

`docs/todo/` holds work that was designed against the real tree and then deliberately deferred.
**Read it before designing a feature from scratch**: the call may already have been made, and the
file will say what it cost.

## Commit messages

A subject of the form `area: what changed`, in prose, lower case, no trailing full stop. The body
says why, and is the part worth writing. There is no conventional-commit tooling and no changelog
generation reading these, so write them for a person.
