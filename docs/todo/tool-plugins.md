# Deferred: letting a plugin be something the model can call

**Written:** 2026-08-09, while scoping the `llm` seam.
**State of the tree:** the tool loop itself is being built with the `llm` capability, host-side, over
a registry that takes **sources**. This file is about adding a second kind of source. Today there is
one: catalog search, over
[`MusicProviderCatalog.searchTracks`](../../packages/plugin-sdk/src/capabilities/music.provider.ts).

---

## News and RSS took a different route, 2026-08-15

Two of the three rows in the table below are built, and NOT as `tool` plugins. News arrived as a
`news` capability with a host-side adapter (`modules/llm/news.tool.ts`) in front of it, which is the
same arrangement `charts` has. That is worth knowing before building the capability below, because
it says something this file did not anticipate: a plugin that answers a QUESTION the station has is
better modelled as a capability, and `tool` is for a plugin that wants to offer the model something
the host has no concept of. Weather is still the case that argues for it. See
[news-and-bulletins.md](news-and-bulletins.md).

## The shape

A `tool` capability in the plugin SDK:

- `describe()` returns declarations: a name, a description the model reads to decide whether it wants
  this, and JSON Schema parameters.
- `execute(name, args)` runs one and returns a result.

**Both ends are plain JSON, so this needs no exemption from the JSON-safe rule.** That is worth
saying plainly, because the two capabilities beside it are exceptions: `speak()` returns a real
`ReadableStream` and `host.fetch` a real `Response`. Here nothing crosses but data. A tool
declaration is a description of a function, never a function, and the host is what actually calls
anything.

It also means the boundary test costs nothing to satisfy: classify it with the payload types in
`boundary.json.safe.ts` and it stays there.

## What wants it

Things the DJ would ask about mid-sentence, that live behind somebody else's API:

| Tool | Why a plugin |
| --- | --- |
| Weather | Geocoding, condition codes and cache windows are per-service quirks. See [station-moment.md](station-moment.md) |
| News | Every feed has its own shape, its own rate limit and its own idea of what a category is |
| RSS | The generic version of the above, and the one an operator points at their own sources |

All three are the inputs a bulletin is written from, which is the segment kind after a talk break.

## What does NOT want it

**Not everything worth calling is a plugin.** The registry takes sources, and a plugin is one kind:

- **Searching for a track** is the host exposing a capability it already has. `searchTracks` is on
  `music.provider` and every provider plugin already implements it, so a "find me a song like this"
  tool is a host-side adapter over the installed provider, not a new plugin and not a new boundary.
- **Reading the running order, the lineup or the play history** is the host's own data. A tool over it
  is a function in the module, and routing that through a plugin would be a boundary crossing in a
  circle.

The rule of thumb: a tool is a plugin when the thing it talks to is somebody else's service. When the
thing it talks to is deadair, it is a source the module registers directly.

## Things to get right when it lands

- **A tool call is inside a gate admission.** The `llm` loop holds the single model slot from the
  first call to the last, so a slow tool holds the model. Bound each execution separately from the
  loop's step count, and make a tool that times out an answer the model can see rather than a failure
  that kills the generation.
- **A tool's failure is data, not an exception.** The model asked a question and the honest answer is
  "that did not work"; handing it back as text lets the model carry on and say something true. A
  `PluginError` on a tool call should be caught by the loop and returned as a tool result.
- **Declarations are per-invocation, not cached forever.** A plugin reconfigured by an operator can
  describe itself differently, and `PluginLifecycleManager.reinitPlugin` already runs on every config
  write. Read declarations through the registry rather than snapshotting them at boot.
- **Permissions.** A tool the model can call is a thing the model can make happen. Reads are safe by
  construction; anything that writes needs a deliberate decision about whether a model gets to do it
  unattended, and this file is not making that decision.

## Related

- [dj-voice.md](dj-voice.md) for the writers that would use tools, and for the bulletin kind that news
  and weather feed.
- [station-moment.md](station-moment.md) for weather's other consumer.
- `docs/decisions/plugin-trust.md` for why a plugin is trusted code, which is what makes `execute`
  running in the host realm unremarkable.
