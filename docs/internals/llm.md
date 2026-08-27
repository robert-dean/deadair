# Internals: the model

The station's words are a plugin and the loop around them is not. What stays host-side, why there is
one model slot, and the one rescue in the conversation loop.

Every paragraph here records a measured failure and the fix that was chosen over the obvious one.
Read the ones covering whatever you are about to change. The always-loaded index is
[`CLAUDE.md`](../../CLAUDE.md).

## Where the loop lives

**The station's words are a plugin, and the loop around them is not.** `llm` capability, `plugins/llm` on the
AI SDK's OpenAI-compatible provider so one plugin covers a local server and a hosted one alike. `llm.pluginId`
picks it, mirroring `render.speechPluginId` including its DEFAULT — see plugin selection in
`apps/api/CLAUDE.md`. The MODEL is a per-call parameter rather than config, because `plugin_configs.plugin_id`
is a primary key and a station wanting a big model for a show and a small one for an ident cannot express that
by installing twice. Three things stay host-side in `modules/llm/`, deliberately: `LlmGate`, which holds one
model slot **until the words stop arriving rather than until the call resolves**, with its budget starting at
admission and covering the drain; the tool loop, because a tool is a station function and running one inside a
plugin would be the wrong side of the fence; and `ToolRegistry`, whose sources are an explicit list (catalog
search today). A tool declaration goes out and a tool call comes back, both plain JSON, so nothing executable
crosses.

**A station with no model plugin is an ordinary state, not a fault** — `canGenerate()` answers it without
throwing, so a writer picks its deterministic binding.

**One model slot, and it stays one.** `LlmGate` serializes because there is one process with one set of
weights on one GPU. Two callers now want it at once — a refill holds it for minutes, a break wants it for
seconds — and that is still not an argument for a pool: a second app-side slot relocates the queue to the
model host, where there is no `maxWaitMs`, and that timeout is the entire mechanism by which a break writer
gives up and lets the floor write. Widening the gate would remove the thing that keeps a slow model from
costing a silent station while looking like it was helping. The asymmetry is PRIORITY, not throughput, and it
is expressed by bounding the background job (`ModelSetGenerator.BUDGET_MS`), which needs nothing from the
gate.

**A model budget and degradation tiers are deliberately NOT built** (`docs/todo/station-intelligence.md` §2,
deferred against its own ordering claim): every call goes through `LlmService`, so the retrofit is one file,
the model is self-hosted so nothing is billed, and "no tier makes music stop" is already structural — the
chain tops up and the writer registry falls through.

## The tool loop

**A tool call the model wrote as TEXT is still a tool call, and the loop re-issues it.** A
conversation ends when a generation comes back with no tool calls, because that is what an answer
looks like — and a local model does not always agree: one refill's entire final message was
`{"artist":"Mitch Murder","limit":12}`, the arguments of a `similar_artists` call with no call around
them. The loop read it as an answer, `readPicks` found no record in it, and the hour went to the
floor one step before the model would have answered. So `LlmService.runConversation` asks
`strayToolCall` whether the words ARE a call before accepting them as an answer. The rescue lives in
the loop rather than in the parser because `readPicks` is RIGHT to read that object as no records:
what the moment wants is the call to be made, which only the thing holding the tools can do. The bar
is deliberately high, since a false positive turns a real answer into a search and loses it — the
whole message must be one JSON object and nothing else, a named form must name a tool actually on
offer, and a bare argument bag must fit EXACTLY ONE tool (every key declared, every required
parameter present), which is why `{"limit":20}` is left alone and why `{"title":…,"artist":…}` can
never be mistaken for a call. Two bounds: there is no rescue on the LAST step, where withdrawing the
tools to force words is the point, and the replayed assistant turn carries empty content rather than
the stray text, because the transcript is also the model's own record of what it did and it should be
shown the shape to repeat, not the mistake. The raw text survives in the log line.
