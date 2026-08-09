# The mixer knobs that are still constants

**Written:** 2026-08-09, when `VOICE_GAIN_DB` became the fourth of them.
**State of the tree:** four values that decide how a break sounds are hardcoded in
`apps/api/src/modules/stream/stream.service.ts`, materialized into `radio.env`, and changed only by
editing code and deploying.

---

## What they are

| Constant | `radio.env` key | What it decides |
| --- | --- | --- |
| `TALK_OVER_TRACKS` | `TALK_OVER_TRACKS` | whether the DJ talks over the record or between records in silence |
| `DUCK_GAIN_DB` | `DUCK_GAIN_DB` | how far the bed drops under the voice |
| `DUCK_FADE_MS` | `DUCK_FADE_MS` | how long that ramp takes |
| `VOICE_GAIN_DB` | `VOICE_GAIN_DB` | trim on the voice after the mic chain |

Every one of them is something an operator tunes by ear, over several listens, on their own library
and their own speech engine. That is exactly the profile of a setting and exactly not the profile of
a constant.

## The seam

`STREAM_KEYS` in [apps/api/src/modules/stream/stream.settings.ts](../../apps/api/src/modules/stream/stream.settings.ts)
and `resolveStreamSettings` beside it. Every other value the materializer writes already comes
through there — the mount, the bitrate, the station name, all five secrets — so these four are the
only stream values that bypass a mechanism already built for them. Adding them is a `STREAM_KEYS`
entry, a field on `StreamSettings`, a default, and passing them through `playoutConfig` instead of
reading a module constant.

## Why it is not just that

`radio.liq` reads all four at **startup**. So a settings row that changed while Liquidsoap was
running would re-render `radio.env` (the app already does that on a settings write) and change
nothing anyone can hear until the container restarts. A console knob that silently does nothing is
worse than no knob.

Which makes the real work the restart trigger, and that has a genuine design question in it: the
station holds the mount on a lease it renews, so restarting Liquidsoap takes it off air for as long
as the container takes to come back. On a station with listeners that is audible. Options, none of
them decided:

- Restart on the operator's say-so, with the console stating plainly that it will interrupt the
  broadcast. Honest, and puts the cost where the person choosing it can see it.
- Defer the restart to the next time the audience gate closes, so it is spent on an empty mount.
  Free, and means a change can sit unapplied for hours with no obvious reason why.
- Make the values live in `radio.liq` — read them per use from a ref, refreshed by a `/control/*`
  call — so no restart is needed at all. The most work, and the only option with no downside for
  the listener. Worth checking against how `duck_gain_db` is used before assuming it is possible:
  `lin_of_dB` is evaluated once when the ramp closure is built.

## What must NOT move

`CONTROL_TTL_S` and `PLAYOUT_PREFETCH` look like they belong on the same list and do not. Both come
from constants in
[apps/api/src/modules/playout/liquidsoap.control.ts](../../apps/api/src/modules/playout/liquidsoap.control.ts)
that the app uses for its own behaviour as well: the TTL is what the pusher renews against, and the
prefetch is the same number as its push lead. They are shared deliberately, so the two ends of the
bridge cannot disagree. Splitting either into a setting gives it two owners and one place for them
to drift, and the failure — a lease that expires between renewals, a skip that lands on an unfetched
item — is intermittent and hard to attribute.
