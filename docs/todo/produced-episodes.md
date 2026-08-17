# Produced episodes, and what a long generation does to the gates

**Written:** 2026-08-16, from asking what a podcast would do to `LlmGate` and `SpeechGate` a few
hours after both grew priority tiers.
**Built:** 2026-08-16, the same day, as `apps/api/src/modules/productions/` and migration
`0016_productions.sql`. All five decisions landed as written.

This file opened with "nothing here is built and nothing should be built from it yet", which stopped
being true within hours of it being written. It is kept because four of its decisions are "do not do
the obvious thing", and the obvious thing is what the shape of `LlmService.converse` actively
invites: the code can say what it does and cannot say which alternative was refused or why. Getting
these wrong is not a slow episode, it is an hour of the station falling through to its deterministic
floor with nothing saying why.

Where each decision lives now:

| § | The rule | Where it is |
| --- | --- | --- |
| 1 | An admission is a pass, never an episode | `produce.production.job.ts`, one `gate.hold` per pass and one render job per beat |
| 2 | The tiers split, and a slot is a real deadline | `gate.priority.ts` (four tiers), `priorityForSlot` in `production.ts`, `DEADLINE_MS` |
| 3 | A production enters the order whole or not at all | `DirectorService.injectProductions`, `StationLineup.insertGroup` |
| 4 | A job per pass, with the row as the checkpoint | `production.passes.ts`, `PASSES`, `nextPass`, `retryLimit: 0` |
| 5 | Timing never comes from the model | `production.plan.ts`, judged by `production.checks.ts` |

[from-v1.md](from-v1.md) §"Shows and episodes" is the prior art and is not repeated here: multi-pass
screenwriting, `writingMode`, show styles, callers cast per episode, `[SFX: …]` cues, and the two
resumability gotchas that were paid for live.

## 1. An admission is a PASS, never an episode

The rule, and everything else follows from it.

`LlmGate.hold` takes one admission for a whole tool loop, and its reasoning is written down: release
between steps and another generation evicts the KV cache the next step wants, and the budget clock
restarts mid-answer. That is right for a tool loop, which is four steps seconds apart inside one
conversation.

**It does not transfer to multi-pass writing, and the reason is the cache.** Outline, draft, check
and polish are different conversations with different prompts. There is no shared KV cache between
them, so the thing that justifies holding across steps does not exist. What survives is only the
cost: one admission for an episode holds the station's only model for minutes to hours, and
`ModelTalkBreakWriter`'s ten-second `maxWaitMs` means every break for that entire duration falls to
the floor.

That is not hypothetical. Of 24 recorded `failed` rows in `script_history` on 2026-08-16, **17 were
`waited 10000ms for the model and it is still busy`** — the model gate's queue under ordinary
contention, before any episode existed. An episode-length admission is that failure sustained
rather than occasional.

The same rule applies verbatim to speech, where the arithmetic is worse. An episode is 15–25 beats
at v1's 150–260 word band, and multi-voice REQUIRES one synthesis per beat because `segments.voice`
is one id per segment. At one admission per beat a break waits at most a few seconds; at one
admission per episode it waits for the whole show.

Note what this makes of `SpeechGate` not preempting: a feature rather than a gap. Aborting a beat
half way is never wanted. Slotting the station in BETWEEN beats is, and one-admission-per-beat gives
that for free.

## 2. Two tiers stop being enough, and this is where the aging question comes due

`gate.priority.ts` argues that two tiers need no starvation rule, and that ranking a break above a
refill is the change that would. An episode is what makes that change necessary, and the reason is
worth stating precisely: **`station` currently conflates work with an air deadline with work that
has none.**

That was safe while the only deadline-free caller was `ModelSetGenerator`, because a refill is ONE
admission bounded by `BUDGET_MS`. An episode is N admissions, and bounding each one says nothing
about the aggregate. A show producing all afternoon at `station` tier interleaves with break writers
by arrival, and a break arriving mid-pass waits out a pass rather than a tool step.

So the tier list becomes three when this lands:

```
air         breaks, welcomes, bulletins — something is about to need this
background  refills, episode production — nobody is waiting
preview     rehearsals, voice samples  — an operator is watching
```

And the starvation question has to be answered, because a talkative station can starve production
indefinitely. **The answer to reach for first is that a show has a deadline of its own** (its
scheduled slot), so its priority RISES as that slot approaches. Producing tomorrow's episode yields
to everything; producing the one that airs in twenty minutes does not. That is earliest-deadline
scheduling, and it beats aging here because the number is real rather than invented.

Do not build the three tiers before there is a third kind of caller. Do not build two and a half.

**What was built, and the one place this section was wrong.** The tier list came out FOUR rather
than three, and the extra one is at the top rather than the bottom: `breaking` sits above `air`, for
a break that exists because something happened. The three named here are `air`, `background` and
`preview`. Two things this section did not say, both in `gate.priority.ts`:

- **Ranking and preempting are separate questions, and they disagree once.** `LlmGate` orders its
  queue by rank and also asks a lower-ranked holder to stop, because queue order alone still leaves a
  ten-second break writer to time out behind a refill holding the model for minutes. The exception is
  at the top: `breaking` outranks `air` and does NOT preempt it, since aborting a half-written break
  destroys that work and frees the slot no sooner (a holder stops when its own work returns, not when
  its signal aborts).
- **A production is the awkward case for its whole life**, which is what makes earliest-deadline the
  right answer rather than a clever one. It has no deadline for hours and then has a real one, so it
  moves between two tiers it already qualifies for instead of needing an aging rule of its own.
  `priorityForSlot` is that move, `DEADLINE_MS` is half an hour, and an unscheduled production is
  `background` for its whole life. It never answers `breaking` at any distance, because that tier is
  reachable only through a `BreakUrgency` and a production scheduled for 9pm has been known about for
  hours.

## 3. An episode is several segments, and the concatenation route is closed

One segment is one script, one audio file, one lineup item. An episode is many of each.

**Concatenating beats into a single segment is not available**, and the reason is a project rule
rather than a preference: no decoding, mixing or encoding happens in Node. Joining beats would have
to move to Liquidsoap or the `analysis/` sidecar, which is a far larger change than it looks and
buys nothing the alternative does not.

So an episode is **N contiguous segments in the running order**. No new audio path, and the commit
pass, the cache planner and the player all work unchanged.

That collides with one rule, and the collision is the interesting part. **A segment that is not
`ready` is skipped, never waited for** — correct for a break, ruinous for a show, where beat 7
failing leaves a hole in the middle of a programme rather than a missing sentence. An episode is
more like a RECORD than a break, which is the same asymmetry
[bytes-before-air.md](../decisions/bytes-before-air.md) already argues when it holds a cold record
and skips a cold segment.

The mechanism for that exists and should be reused rather than reinvented. An `interrupt` break
request is already rendered BEFORE it is injected: `BreakPlanner.prepareRequested` gives its segment
no position on purpose, and `DirectorService.injectReady` finds one once the audio exists. An
episode is that generalized to a group: **nothing enters the running order until every beat is
`ready`, and then the whole block goes in at once.** A partially produced episode is not a shorter
episode, it is not an episode.

**Built as written, and the payoff is what did not have to change.** Because a block only ever enters
the order with every beat already spoken, the ordinary "a segment that is not `ready` is skipped,
never waited for" rule needs no exception and nothing downstream of the director learned what a
production is. The transport is untouched. Three details that were decided in the building rather
than here:

- **`insertGroup` is not `insertSegments` in a loop.** That one applies highest-index-first so
  independent placements do not drift, which is exactly wrong for a block: these are contiguous and
  ordered, and beat 2 must land after beat 1.
- **Removing one beat removes the production**, because cutting a beat out of a programme cannot
  sensibly mean "play the rest". Every member is MARKED rather than spliced, as a lone break already
  is, since `BreakPlanner` counts records since the last segment in the order and a spliced-out block
  is indistinguishable from one never planted into.
- **A beat that could not be spoken fails the production**, rather than the block waiting in
  `rendering` for audio that is never coming.

## 4. A job per pass, which is where resumability comes from

Not one job for an episode. One job per pass, chained, with the episode row as the state machine:
the `WriteBreakJob → RenderSegmentJob` shape extended, which this tree already runs.

Three things fall out of it and none of them has to be designed:

- **pg-boss runs stay short**, so `expiresIn` stays a number that means something. One job for a
  whole episode needs an enormous one, and a wedged run is then unreclaimable for hours.
- **A restart resumes**, because the row says which pass finished. v1 needed a
  `generation-checkpoints` repository for this; here the row is the checkpoint.
- **The model is genuinely free between passes**, which is what makes §2 work at all. A tier that
  only applies between admissions needs there to BE admissions.

v1's cancel gotcha still has to be answered explicitly and is not free: cancel must be terminal, or
the broker resurrects a cancelled run minutes later. In this tree that is the epoch's shape rather
than a queue's. **A queue cannot cancel**, so a cancelled episode is marked terminally on its row and
every pass checks that row before it spends anything. The second v1 gotcha (no control entry must
count as still current) is a symptom of holding cancellation somewhere other than the thing being
cancelled, and does not arise if the row is the authority.

**Cancellation came out asked-about in three places rather than one**, which is what "everything
already sent will arrive" actually costs: the claim refuses a settled production, the long passes
check the row again between beats, and the gate's withdrawal signal is the third, so a beat still
queued for the model when somebody stops the production leaves that queue rather than being admitted,
generated and thrown away. `isSettled` is one predicate rather than the set spelled out at each call
site, because a pass that forgot `cancelled` would be the exact failure the terminal state exists to
prevent.

**`retryLimit: 0` is the one job policy here that differs from its neighbours**, and the row is why.
A pass that threw has already recorded the reason and moved the production to `failed`, so a retry
finds a settled row and does nothing; worse, a pass that got half way through drafting and then threw
would re-claim and write its beats a second time. Resuming is a decision an operator makes against a
row they can see, not something a broker does silently.

## 5. Timing never comes from the model

Carried over from v1 unchanged, because it was learned the expensive way: beat count and word
budgets are computed deterministically and the outline only supplies content. One story in a
ten-minute show meant a single beat asked to carry ~1300 spoken words, which is unwritable.

This is the podcast form of a measurement this station has already made once. `DEFAULT_MAX_WORDS`
was never what bounded a break — 2 of 137 answers reached it, median 28 words — so what shapes an
answer is what it is asked for, not the ceiling it is given. A beat is the same: size the ask.

## What is not built

The five decisions are. What sits on top of them, as of 2026-08-16:

- **The operator surface**, which is landing as this is written: `data/contracts/productions/` and
  `production.settings.ts` (two keys, `render.productionWritingMode` and `render.productionMinutes`).
  Check the tree rather than this line.
- **Nothing commissions one on a schedule.** A production is made by a chain of jobs that has to be
  started, and today `apps/api/scripts/production.smoke.ts` is what starts it. The daypart schedule
  that would is [director-and-lineups.md](director-and-lineups.md), and it is the same column
  [personas.md](personas.md) §3 wants for choosing a host.
- **The cast is one.** `OutlineBeat.lead` and `Production.voices` exist and nothing reads them, so
  multi-voice is a shape with no behaviour behind it. Callers cast per episode are personas, per
  [personas.md](personas.md).
- **No `[SFX: …]` cues**, which v1 had. There is no foley layer in this tree at all.

## What not to do, in one place

- Do not wrap an episode in one `converse`, or one `gate.hold`.
- Do not concatenate beats in Node.
- Do not let a half-produced episode into the running order.
- Do not add a third priority tier until there is a third kind of caller, and do not add one without
  answering starvation.
- Do not let the model decide how long anything is.

## Related

- [from-v1.md](from-v1.md) — what v1 actually shipped, and the two resumability gotchas.
- [dj-voice.md](dj-voice.md) — the writer registry, the floor rule, and the plumbing a new kind of
  break inherits for nothing.
- [personas.md](personas.md) — callers cast per episode are personas, and §4's rehearsal is the
  preview tier's first real caller.
- [../decisions/how-work-is-dispatched.md](../decisions/how-work-is-dispatched.md) — the four
  dispatch mechanisms, and why admission control is not one of them.
- [../decisions/bytes-before-air.md](../decisions/bytes-before-air.md) — held versus skipped, which
  §3 is a third instance of.
