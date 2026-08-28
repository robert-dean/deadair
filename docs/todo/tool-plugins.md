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

## And so did search, 2026-08-28

Built, and as a capability for the reason above rather than as a `tool` plugin: `search` in the SDK,
`SearchService` in `modules/search`, `WebSearchTool` in front of it, `plugins/websearch` behind it
over SearXNG, Brave or Tavily. **Nothing about the `ToolRegistry` changed to accommodate it**, which
is the thing the 2026-08-25 note below predicted and is worth having confirmed: a new source is one
`registry.register` and one entry in the explicit list.

Two things it settled that this file had left open.

**"Is it a plugin?" is the wrong first question. "Is it a menu?" is the better one.** Every source
here except this one answers out of a list somebody assembled — the library, the providers, a
published chart, the operator's own feeds. Search takes words the model made up and goes and asks,
and that is what makes it the last declaration offered and the one the prompt describes as a
fallback. The plugin/host split is a second question and is answered by the rule above.

**A synthesized ANSWER is where the capability boundary actually bit.** Tavily's `include_answer`
and SearXNG's infobox are the headline feature of both services, and neither has anywhere to land:
the capability has no field for one, the plugin turns the parameter off, and both parsers have a
test asserting the paragraph does not survive. A paragraph somebody else's model wrote about pages
this station never sees is a claim nothing here can check against a source — the same argument
`SourceDocument` is built on, arriving from the opposite direction.

The remaining rows of the table below are weather, which is still the case for a real `tool`
capability.

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

## The tool loop has a second caller now, 2026-08-25

Everything above was written when the only thing that drove tools was a break writer. The persona
STORY pass (`persona.story.pass.service.ts`) is the second, and it changes what a `search` capability
would be worth here: it is the one pass on the station that runs with tools ON deliberately, because
a character's invented past is worth having only where it is grounded in records this station
actually holds. A `search` source registered in `ToolRegistry` reaches it with no change to that
file.

Both of the following were re-read on 2026-08-28, when one was built. What happened to each:

- **The fence in `persona.story.model.ts` was written for a pass that could only look at this
  station's own library.** A pass that can search the open web can also state what it found, and the
  rule it is holding — a record may be in a story, an event involving a real artist may not — gets
  much harder to keep when the model has a source to cite. Everything that pass writes arrives
  `suggested`, so the operator is still the check; that is what makes the risk survivable rather than
  what makes it go away.

  **Answered with one more line in the fence.** The existing rule already forbade what needed
  forbidding, and read as a rule about INVENTION rather than about claiming: on a pass that could
  only see this station's library, "may not claim" and "may not invent" were the same sentence,
  because there was no way to state a true thing about an artist. The added line says the rule holds
  for anything the model looked up, and says what a tool result is FOR here — choosing what a
  presenter might have been listening to, never saying what an artist did.
- **Every tool the registry holds is offered to every caller.** `LlmService.toolsFor` is all or
  nothing, so a search tool added for the story pass is also in front of the break writers, which
  today deliberately run with `tools: false`. That is fine as it stands and would stop being fine the
  moment something wanted tools for one caller and not another.

  **Still true, and still fine, and it is now the interesting constraint rather than a footnote.**
  The two passes that run with tools on are the story pass and the set generator, and neither is the
  one that would most obviously benefit: a talk break is where a fact off the web would actually be
  heard, and it runs without tools because a break must be fast and both records are already in its
  prompt. So a per-caller tool list is the thing to build the day somebody wants a break writer that
  can look something up, and building it is a smaller job than making the break writers fast enough
  to take the whole registry.

## Related

- [dj-voice.md](dj-voice.md) for the writers that would use tools, and for the bulletin kind that news
  and weather feed.
- [station-moment.md](station-moment.md) for weather's other consumer.
- `docs/decisions/plugin-trust.md` for why a plugin is trusted code, which is what makes `execute`
  running in the host realm unremarkable.
