---
paths:
    - 'apps/api/data/contracts/**/*.ck'
    - 'apps/api/contractkit.config.json'
    - 'apps/api/src/routes/routes.setup.ts'
---

# Contracts (.ck)

One `.ck` file generates the Koa router, the zod types, the MCP tools, the TypeScript, Kotlin, C# and Swift SDKs, and the site's API reference and `openapi.yaml`. The `contractkit` skill has the loop, the output table and the syntax.

- Edit the `.ck`, then `pnpm build:contracts` from the repo root, and commit every output with it. Never edit the outputs; a hook asks before you do.
- If the generator reports nothing written after a revert, `rm -rf apps/api/.contractkit/cache` and run it again. The cache keys on the source, not on what is on disk.
- A new router is not live until it is added in `apps/api/src/routes/routes.setup.ts`, which is hand-written.
- `apps/web` type-checks against `packages/sdk/dist`: `pnpm --filter @deadair/sdk build` before a web typecheck.
- Renaming or removing a field, an enum value or an operation breaks the native apps, which compile their own generated SDKs: search `apps/desktop`, `apps/android` and `apps/ios` for the generated name (quote any `--include` glob in zsh, or it silently matches nothing), and build the desktop solution before pushing. Older app builds stay in listeners' hands, so a removal needs a release of the apps first.
