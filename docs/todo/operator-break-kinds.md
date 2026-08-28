# Deferred: an operator can author a kind of break, and today only a developer can

**Written:** 2026-08-28, promoted out of [comparable-stations.md](comparable-stations.md)'s second
pass, where it was the largest finding and the only one that adds a SURFACE rather than a field. It
was ranked 6th there and had no file, which is the state this directory exists to correct.

**The argument is their catalogue rather than their design.** A comparable station's operators had
authored a two-line unrhymed poem about the moment, a note on what taping music off the radio was
like, and a first-time-I-heard-this memory tied to the host's own backstory. Not one of those needs
code. Not one of them would ever have been specified by whoever wrote the break machinery, which is
the whole point: the value is not in any kind somebody might add, it is in not having to be the
person who thought of it.

## Every piece already exists and an operator can reach none of them

Adding a kind of break here is a code change in five places, none of them hard and all of them
required together:

| Piece | Where | What it holds |
| --- | --- | --- |
| The row's kind | `segments.kind`, `0008_segments.sql:33` | **Already unconstrained text**, with a comment saying a station that invents a kind is not a schema problem |
| The words | `BreakWriterRegistry` | `canWrite(kind)` and `kinds()`; registration is one line in `director.module.ts` |
| The prompt | `BreakPromptShape`, `break.prompt.ts:75` | `job`, `showsPrevious`, `showsPlayed`, `rules`, `mustNameRecord`, `showsFacts`, `showsNotebook`, `opening` |
| When it fires | `deadair.clock_bands` | Anchored occurrences and operator intervals, both already operator-authored |
| What it is about | `TopicKindRegistry` | Which kinds take subjects, and the subjects themselves |

So the schema is ready, the clock is ready, and the subject list is ready. **What is missing is that
`BreakPromptShape` is a TypeScript literal and `BreakWriterRegistry` takes a class.** A kind an
operator writes has to reach both without a deploy.

## The shape, which is theirs and worth copying rather than improving

A kind is a directory: a short brief in prose saying what to cover and when to stay quiet;
frontmatter carrying a cooldown, an optional cron, and a declaration of which "right now" facts the
writer may reference; and optionally a small module that fetches live data and may decline before
any words are written. **The words are still written at air time, around whatever is playing**, which
is the same split this tree already makes between a phrasing and a script.

Two rules to copy exactly, both of which are decisions rather than details:

- **The frontmatter's context list should BE `BreakPromptShape`, not a vocabulary beside it.** An
  operator declaring "this kind may see the previous record and the station's facts" is writing that
  type in prose. A second list plus a mapping is two things to keep straight where one would do,
  which is `topics`' own argument against exactly this.
- **An authored kind arrives DISABLED and is enabled by hand.** That is what makes an authored kind
  and an imported one the same object with the same guard, and it is the only reason the community
  exchange below can ever be safe.

## What has to be decided before it is built

Three, and the first is the one that decides whether this is a weekend or a month.

**Does an authored kind run code?** Their optional module fetches live data and may decline. Here
that is a plugin, and this tree has an entire trust decision about plugins already
(`docs/decisions/plugin-trust.md`): they run in-process, permanently, and the rate limiting,
redirect chasing and breaker exist because of it. **A kind that is prose only is a file an operator
edits; a kind that fetches is a plugin wearing a different name.** The honest first version is
prose-only, with "and it may name an existing topic kind for its subjects" as the escape hatch —
which covers the poem, the taping note and the memory, and covers none of the live-data ones.

**Where does a kind live?** A directory beside the plugins is the obvious answer and drags in
loading, watching and reload. A row in a table is duller and reuses `deadair.settings`'s deferred
reload and the whole existing console. **The exchange in the section below wants a directory and
authoring does not**, and those are separable — which is the note comparable-stations already makes
and the reason this file does not decide it.

**What stops a kind from being drivel?** Nothing, and that is correct: the same thing that stops a
persona from being drivel, which is an operator reading it back. But the station's own refusals still
hold — a break that names neither record or drops the character is declined whatever a kind's brief
says — and an authored kind must not be able to switch one off. That is `latitude`'s rule reached
from a third direction, and it is the sentence to write into the frontmatter's documentation on the
first day rather than the tenth.

## What this is not

**Not the community exchange.** Distribution is a separate question with separate risks, and it is
in [comparable-stations.md](comparable-stations.md)'s "deliberately not wanted" section for reasons
that do not apply to authoring at all.

**Not a replacement for a phrasing.** `break.templates.ts` is what the station says when the model
declines, and it is already operator-authored per persona. A kind is what the station is TRYING to
say; a phrasing is what it says when it cannot. Anyone who reads this file as "the operator can write
break text now" has read it backwards.
