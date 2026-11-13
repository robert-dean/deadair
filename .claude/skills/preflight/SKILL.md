---
name: preflight
description: 'Use when a change to deadair is finished and about to be committed, pushed or handed to review: "commit this", "open a PR", "get this ready", "is this ready for review", "wrap it up", before git commit or gh pr create. Not after each step of a plan. Regenerates what the diff needs (build:contracts, build:permissions, build:data), runs the gates CI runs in its order (format, release:version --check, build, typecheck, the affected tests and the architecture guards, then the native app builds a contract change reaches), runs the running-order, plugin and docs reviewers on the diff, writes the changeset, then the commit and the pull request in house style with no AI trailer, and lists every gate that could not run.'
---

# Preflight

You think the change is finished. This page makes you prove it before you say so, then writes the commit and the pull request the way this repository writes them. Evidence before claims: every "passes" in what you report is a command you ran in this session, with the numbers it printed.

## 0. Where you are

- `git status`, `git branch --show-current`, `git log --oneline origin/main..HEAD`.
- Never commit to `main`: a push to it deploys the live station. A branch whose name came from a review of another project is renamed before the first commit (`git branch -m <what it changes>`); nothing that lands may name another project.
- The base is `git merge-base origin/main HEAD`, or the branch below for a stacked branch. On a stacked branch whose base was squash-merged, delete any `.changeset/*.md` the base already consumed, or the version PR bumps twice.
- A fresh worktree needs `pnpm install` and `pnpm turbo build --filter='@deadair/api^...'` before any typecheck, or you will read hundreds of errors that are not there. Both need the sandbox override.

## 1. Generators the diff needs

From `git diff --name-only <base>`:

| Changed | Run | Then |
| --- | --- | --- |
| `apps/api/data/contracts/**/*.ck` | `pnpm build:contracts` | `pnpm --filter @deadair/sdk build`. If nothing was written after a revert: `rm -rf apps/api/.contractkit/cache` and run it again |
| `apps/api/data/permissions/*.perm` | `pnpm build:permissions` | |
| `apps/api/data/migrations/*.sql` | `pnpm build:data` against a database migrated from this branch (a scratch one in a worktree) | check a new enum column's key in `.kysely-codegenrc.json` keeps its `Generated<>` wrapper |
| a new file in `apps/web/src/routes/` | `pnpm --filter @deadair/web build` | commit `routeTree.gen.ts` |

After them, `git status` must show the generated output beside its source. The `generated` CI job regenerates all of it from a database walked from zero and fails on anything that moved.

## 2. Gates, in CI's order

Stop at the first failure, fix it, and start this step again. Bypass caches where turbo would replay a stale result.

1. `pnpm format:check`. CI only warns, but fix what your change touched.
2. `pnpm release:version --check` when a listener app's `package.json` or version file changed.
3. `pnpm build`.
4. `pnpm typecheck`. Not plain `tsc --noEmit`, which skips `tests/` and `scripts/`.
5. Tests: the files covering what changed, `npx vitest run --root <package> <paths>`, then `npx vitest run --root apps/api tests/architecture` for the guards. When the change is broad, the whole suite as CI runs it: `pnpm exec vitest run`.
6. Native apps, when a `.ck` changed or their own folder did. A renamed field breaks them while every TypeScript check passes:
    - `cd apps/desktop && dotnet build -c Release -warnaserror` (needs the sandbox override)
    - `cd apps/android && ./gradlew --no-watch-fs :sdk:build :app:assembleDebug :app:testDebugUnitTest` (JAVA_HOME and ANDROID_HOME set by hand)
    - `cd packages/sdk-swift && swift build` (needs the sandbox override)
7. `stream/*.liq` changed: `liquidsoap --check` in the pinned image (`stream/README.md`).
8. `bash .claude/hooks/hooks.test.sh` when `.claude/hooks` or `.claude/settings.json` changed.

## 3. Review

Write the diff to a file so the reviewers read it whole (a diff pasted into a prompt comes through shortened):

```bash
base=$(git merge-base origin/main HEAD)
out="$TMPDIR/$(git rev-parse --short HEAD).review.diff"
{ git diff --name-status "$base"; echo; git diff -U10 "$base" -- . ':!apps/api/src/modules/data/db.ts' ':!**/generated/**' ':!packages/sdk/src' ':!packages/sdk-kotlin' ':!packages/sdk-csharp' ':!packages/sdk-swift' ':!apps/site/docs/api-reference' ':!apps/site/static/openapi.yaml'; } > "$out"
wc -l "$out"
```

Then start the reviewers whose row matches, in parallel, each with the base, HEAD, the file's path and its line count:

| Changed | Agent |
| --- | --- |
| `apps/api/src/modules/{director,schedule,playout,stream,render,productions}/**`, `stream/**` | `running-order-reviewer` |
| `plugins/**`, `packages/plugin-sdk/**`, `apps/api/src/modules/plugins/**` | `plugin-reviewer` |
| anything outside `tests/` | `docs-reviewer` |

Fix every blocker and should-fix, or say in the pull request why not. Re-run step 2 for what the fixes touched.

## 4. Changeset

A change somebody running or listening to the station would notice gets one (`.changeset/README.md`): name the package you changed, `patch` unless it adds something an operator chooses to use, and one paragraph written for the operator or listener, not the reviewer. A change only to tooling, tests or docs gets none.

## 5. Commit

- Subject: a plain sentence saying what the code does now, in the imperative, no `feat:`/`fix:` prefix, no full stop, under about 80 characters. "Drop a long stall in the audio clock instead of bursting it to listeners".
- Body: what was wrong or missing and why this is the fix, in paragraphs, wrapped at about 100 columns. Measured numbers beat adjectives.
- No `Co-Authored-By` for an assistant, no "Generated with" line, no session trailer. No em dashes as separators.
- One coherent change per commit; a plan's phases are separate commits.

## 6. Pull request

Fill `.github/pull_request_template.md`. The house shape for anything non-trivial is three sections under the template's heading:

- **What was happening**: the symptom, with the evidence (log lines, numbers, the issue it fixes as `Fixes #N`).
- **The change**: one bullet per file or area, saying what it does and how it was verified.
- **For the reviewer**: trade-offs, what is still unknown, and a **Verified** line naming every gate that ran, and every one that did not and why.

Never push to `main`. Open the pull request from the branch with `gh pr create` (needs the sandbox override), and only when asked.

## 7. Report

To the user: each gate with its result and numbers, each reviewer's verdict, the commit and PR, and a plain list of what was not run.
