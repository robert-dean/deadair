---
paths:
    - '**/tests/**/*.ts'
    - '**/tests/**/*.tsx'
---

# Tests

Vitest everywhere. Tests live in each package's top-level `tests/`, mirroring `src/` and importing `../src/...`; never beside the code.

- Run one package with `pnpm --filter <pkg> test`, or one file with `npx vitest run --root <package dir> <path>`. CI runs the root `vitest.config.ts`, which names every package's config as a project and shards them; a new package with tests needs only its own `vitest.config.ts`.
- `apps/api` tests are type-checked by `pnpm typecheck` (`tsconfig.tests.json`), which CI runs. Plain `tsc --noEmit` skips `tests/`, so run `pnpm typecheck` before pushing.
- A switch's off-case is tested with the string `'false'`, never a boolean (`.claude/rules/settings.md`).
- Guard tests in `apps/api/tests/architecture/` name each list by its direction: `KNOWN_*` and `BASELINE_*` may only shrink; `EXEMPT_*`, `NOT_*` and `NO_*` excuse a case and carry a reason. Fix the code; never add an entry to make a guard pass. `.claude/hooks/ratchet.guard.sh` asks before an edit grows one of those lists, changes a guard's detector, or skips or focuses a test anywhere.
- When a test proves a property vitest cannot see (module resolution, the real `node` loader), spawn the real thing, as `plugin.peers.test.ts` does.
- A changing set of 20-second timeouts in the web tests is machine load, not a break: check `uptime` and re-run with `--maxWorkers=2`.
