---
paths:
    - 'plugins/**/*.ts'
    - 'packages/plugin-sdk/src/**/*.ts'
    - 'apps/api/src/modules/plugins/**/*.ts'
---

# Plugins

The contract is `packages/plugin-sdk/README.md`; the parts that are easy to break are `packages/plugin-sdk/CLAUDE.md`. Read the section covering what you change.

- In plugin code, `undefined` means "not set". Never `null`.
- What is stored or sent is JSON-safe: manifests, permissions, config fields and every `capabilities/` payload. No `Date`, no class instances, no functions; durations as integer milliseconds, dates as ISO-8601 strings. Host methods are exempt. `boundary.json.safe.ts` fails `tsc` over a registered payload.
- Plugins are trusted, in-process code, permanently. `host.fetch`, `host.socket` and `host.tls` protect an honest plugin from a hostile upstream and the operator from a careless plugin; they do not contain a hostile one. Never describe them as a sandbox.
- `host.fetch` is the only HTTP egress. A host a plugin reaches must be in `permissions.network` or come from the operator through `fromConfig`.
- Never read `this.host` after an `await`: capture it once, before the first one. A config save reinitializes the plugin and the getter then throws.
- Register teardown with `this.register(disposer)` beside the setup it undoes.
- An image URL a plugin returns never reaches a response as-is; it can carry the operator's credentials.
- A list an operator adds to is a `list` config field with declared columns, never a text box with a separator.
- `apps/api` and every plugin import the SDK from its `dist`: `pnpm --filter @deadair/plugin-sdk build` before type-checking them.
