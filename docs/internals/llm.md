# Internals: the model

The station's words are a plugin and the loop around them is not. What stays host-side, why there is
one model slot, and the one rescue in the conversation loop.

Every paragraph here records a measured failure and the fix that was chosen over the obvious one.
Read the ones covering whatever you are about to change. The always-loaded index is
[`CLAUDE.md`](../../CLAUDE.md).

## Where the loop lives

**The station's words are a plugin, and the loop around them is not.** `llm` capability, `plugins/llm` on the
AI SDK, with three provider arms: an OpenAI-compatible one reaching Ollama, vLLM, OpenAI itself, Groq, Mistral
and OpenRouter behind whatever address is set, plus Anthropic and Gemini in their own protocols. A native arm
is never there for COVERAGE — the compatible one already reaches those two — but for what only their own
protocol carries, and each is a dependency and a branch rather than a second plugin, because everything above
the transport is the same work whoever answers. `llm.pluginId`
picks it, mirroring `render.speechPluginId` including its DEFAULT — see plugin selection in
`apps/api/CLAUDE.md`. The MODEL is a per-call parameter rather than config, because `plugin_configs.plugin_id`
is a primary key and a station wanting a big model for a show and a small one for an ident cannot express that
by installing twice. Three things stay host-side in `modules/llm/`, deliberately: `LlmGate`, which holds one
model slot **until the words stop arriving rather than until the call resolves**, with its budget starting at
admission and covering the drain; the tool loop, because a tool is a station function and running one inside a
plugin would be the wrong side of the fence; and `ToolRegistry`, whose sources are an explicit list rather
than whatever registered itself. A tool declaration goes out and a tool call comes back, both plain JSON, so
nothing executable crosses.

**Every configured provider is reachable at once, and the MODEL NAME says which.** Not a "which provider"
setting, because there is already a per-call parameter carrying exactly this decision and a second one beside
it would drift: the model travels with every request, the plugin is one station setting, so a station wanting
a hosted model for the words listeners hear and a local one for the volume nobody hears has one place to say
so. `anthropic:` and `google:` are the whole vocabulary and **a bare name is the OpenAI-compatible server,
permanently** rather than "the default" — fixed, so a name means the same thing on every station whatever else
is configured, and so an install from before any of this goes on working with its stored model, its ticked
tool-capable models and its writer settings untouched. The prefixes are matched exactly and nothing else is
parsed, which is what keeps Ollama's own `name:tag` and OpenRouter's `vendor/model` off the compatible arm's
own ids. `llm.names.ts` holds the rule; the arms are built per credential in `llm.arms.ts`, and an arm with no
credential refuses a generation naming it with a sentence saying which key is missing.

**A signed thinking block is part of the conversation, and the transcript carries it.** Anthropic refuses a
tool round trip whose earlier turns arrive without their thinking signatures, and Gemini wants its thought
signatures back on the function calls it made. So `LlmResult.providerState` comes off a generation and goes
back onto the `assistant` turn the loop builds, opaque the whole way: the host never reads it, and the rule in
the plugin is **carry what the provider SIGNED** rather than carry the reasoning. That is what keeps the
OpenAI-compatible arm exactly as it was — a local server signs nothing, so nothing is captured and nothing new
is sent — and it is why an unsigned reasoning block is dropped rather than replayed, for the same reason
`spokenAnswer` is careful about reasoning: a model's working-out is not something it said.

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

**A model budget and degradation tiers are still NOT built, and one of the three reasons has now expired**
(`docs/todo/station-intelligence.md` §2): every call goes through `LlmService`, so the retrofit is one file,
and "no tier makes music stop" is already structural — the chain tops up and the writer registry falls
through. But "the model is self-hosted so nothing is billed" stopped being true the day a provider arm reached
a paid API, which is exactly the trigger that section named. The retrofit surface is unchanged; what changed is
that a runaway refill now costs money rather than a warm GPU.

## The tool loop

**The source list is ordered, and the order is the only steer a model gets about which question to ask
first.** `LlmModule` names them one by one — music search, the station's taste, the show so far, similar
artists, the charts, the news, the web — and that is the order the declarations reach the model in. It reads
outwards: what the station HAS and can play, then what it is in the middle of, then what somebody else says
about records, then the world. `search_web` is last deliberately, and its description says the same thing in
words: everything above it answers out of a list somebody assembled and is cheaper, faster and easier to be
right from, so an open search is the fallback rather than the opening move. Order is otherwise only a
tie-break on duplicate names, which these do not have.

**Four of the seven sources are plugin-backed and three are not, and the line between them is not about
difficulty.** `docs/todo/tool-plugins.md`'s rule: a tool is a plugin when the thing it talks to is somebody
else's service (charts, similar artists, news, web search), and a host-side source when it talks to deadair
(the catalog, the taste, the running order). Routing the second kind through a plugin would be a boundary
crossing in a circle.

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
