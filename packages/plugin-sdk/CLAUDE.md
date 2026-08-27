# The plugin contract

What a plugin may do, what the host promises it, and the rules that make an in-process plugin safe to
run. [`README.md`](README.md) beside this is the contract itself — capabilities, config fields,
manifests, versioning — and is required reading before touching `plugins/` or this package. This
file is the part that is easy to break by accident.

Every paragraph here records a measured failure and the fix that was chosen over the obvious one.
Read the ones covering whatever you are about to change. The always-loaded index is
[`CLAUDE.md`](../../CLAUDE.md).

**The JSON-safe rule now covers what is stored or sent, and nothing else.** Manifests, permissions, config fields and every `capabilities/` payload: no `Date`, no class instances, no functions, durations as integer milliseconds, dates as ISO-8601 strings. The reason is Postgres and the console's JSON, not a wire format, and it survives on that basis alone. Host methods are exempt and deliberately so: `host.fetch` returns a real `Response`, `host.signal` a real `AbortSignal`, `speak()` a real `ReadableStream`. `boundary.json.safe.ts` fails `tsc` over a registered payload and its registry-coverage test fails over a boundary interface classified in none of its three arrays, so neither can drift by accident.

**Plugins are trusted code, permanently.** They load through a plain dynamic `import()` into the host realm and can reach `process.env`, `fs`, and the pg pool. `host.fetch` protects an honest plugin from a hostile upstream and protects the operator from a careless plugin. It does not contain a hostile one, and no future version will: the subprocess option is closed, not deferred. Do not write docs, UI copy, or comments claiming otherwise, and do not reintroduce a constraint whose only justification is a move that is not happening.

**`host.fetch` returns a real `Response`, and it is the only egress.** `response.body` is how bytes stream; there is no second path and the old `host.streams` protocol is gone. `timeoutMs` bounds getting the response (connect, headers, the whole redirect chain) and stops there, because a large body legitimately outlives the call that fetched it: reading it is bounded separately by `PLUGIN_BODY_IDLE_TIMEOUT_MS`, `PLUGIN_BODY_LIFETIME_MS` and `PLUGIN_RESPONSE_MAX_BYTES`, enforced by one guard wrapping every body. `url` and `redirected` are set by the host, because redirects are followed by hand to re-check the allowlist per hop and a constructed `Response` has neither. `jsonBody` / `tryJsonBody` are `async` free functions that keep the response the platform's own. A body nobody will read should be `cancel()`ed; `PluginHostFactory.cancelOpenBodies` is the backstop on dispose, not the plan.

**`host.fetch` policy is per upstream, and its budget is the live one.** `permissions.network` entries are bare hostnames, or objects carrying `ratePerSecond` and a shared `bucket` (a published limit usually covers a service, not a hostname), or `{ fromConfig: 'baseUrl' }` for an address the operator supplies. The fetch budget is capped by whatever the _current invocation_ has left, published by `PluginInvoker` through `plugin.invocation.deadline.ts` and readable by plugins as `host.remainingMs()` (sync) or watched as `host.signal`, not by the `PLUGIN_INVOKE_TIMEOUT_MS` constant. `host.signal` is the invoker's own `AbortController` signal rather than a copy, so honouring it and being abandoned are the same moment. Everything the host throws at plugin code is a `PluginError`, never a `ServerkitError`: the invoker's `toPluginError` flattens anything else to `internal`, and the status the host chose never reaches the client.

**A plugin extends `Plugin` and registers its own teardown.** `packages/plugin-sdk/src/plugin.base.ts`: `this.host` is a getter that throws a sentence naming the plugin rather than a `TypeError`, and `register(disposer)` puts an undo beside its setup, run last-registered-first on unload even when one throws. This matters more in-process, not less, because a timer a plugin forgets lives in the API server until a restart and an operator reloads plugins on every config change. Extending it is optional; the host only ever asks for `PluginLifecycle`. Note `host` being a getter costs TypeScript's narrowing of other properties across a read of it.

**A list an operator adds to is a `list` config field, not a box with a separator in it.**
`ConfigFieldType` covers `list` with declared `columns` (`packages/plugin-sdk/src/plugin.config.fields.ts`),
stored as a JSON array of row objects in a string exactly as a `multiselect` stores its values, read
back with `parseRows`, and drawn by the console's one settings form as a table with an Add button.
It exists because `id|Name|address` lines are what a list becomes the moment its entries have parts,
and a mistyped line is a feed the station silently does not have — the same argument that moved the
format clock out of a settings box. Three things are load-bearing. A cell is named POSITIONALLY
inside the form (`f3.0.c1`, `cellNameOf`) and the column's own key is put back on the way out, which
is `nameOf`'s rule one level down: a cell is addressed by path, a dot in a path is a step into a
nested object, and translating dots to dashes would quietly merge a plugin's `a.b` and `a-b` into
one cell. So a column key is shaped however the plugin likes, dots included, and nothing about this
reaches a plugin author. The HOST's allowlist reads a `fromConfig` list through the columns declared
`url` and no others (`addressCells` in `plugin.host.factory.ts`), because `hostnameFromSetting`
accepts a bare hostname and would otherwise put a category called `sport` on the allowlist. And a
column may declare `optionsFrom`, a closed host vocabulary (`station.newsCategories` today) resolved
by the CONSOLE against the station's own tables — the third way a form learns what to offer, and the
only one a plugin cannot answer for itself, since a news plugin has no way to learn which categories
this station holds.

**A CELL's choices can also come from the plugin, which is the second of those three ways reaching
one column rather than one field.** `suggestConfigOptions()` publishes under
`columnSuggestionKey(fieldKey, columnKey)` — `voices.engine`, a dot-joined pair that cannot collide
with a field key because a column key may not contain one — and the form merges it exactly where it
merges a resolved `optionsFrom`. Both speech plugins fill their engine-voice column this way, which
is the difference between a table an operator can complete and one that requires knowing `af_heart`
by heart. **A cell with choices renders as an AUTOCOMPLETE and not a select**, deliberately: the
server's list is what it currently holds rather than the whole vocabulary, so a Kokoro blend
expression and a Chatterbox clip added since the last refresh both have to stay typeable. Being
unable to name a voice the server HAS is a worse failure than naming one it does not.

**In plugin code, `undefined` means "not set". Never `null`.**
