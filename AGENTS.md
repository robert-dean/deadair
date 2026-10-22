# deadair

The instructions for working in this repository are in [`CLAUDE.md`](CLAUDE.md). Read it before
anything else. Claude loads it on its own; this file exists so that every other agent finds the same
rules. It names a scoped `CLAUDE.md` for each part of the tree (`apps/api/CLAUDE.md`,
`apps/web/CLAUDE.md`, `packages/plugin-sdk/CLAUDE.md` and the rest), and those are required reading
before you change the thing they describe.

Keep the rules there, not here. Two copies of one rule drift, and the agent that read the stale one
is the one that ships the bug.

The block below is not ours. `turbo` writes it, and puts it back if it is deleted.

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
