import type { Freshness } from '#modules/shared/freshness.js';
import type { BreakWriteRequest } from './break.writer.js';

/**
 * Whether each thing a break can be written FROM survives the gap between the writing and the slot.
 *
 * ## Why this is a type and not a paragraph
 *
 * `break.claims.ts` is a guard, and a guard is a claim about the code that existed when it was
 * written. Weather is the proof: it shipped as a whole capability — a plugin, a source, a floor
 * writer, a model writer, a tool — months after that file, and inherited none of it. Every
 * individual piece of the weather path is careful. `WeatherService` refuses a reading with no
 * `observedAt`, `inventedFigure` refuses any figure the reading did not carry, `WeatherSource`
 * distinguishes three ways of having nothing. What nobody asked was whether the thing it says stops
 * being true before anybody hears it, and **nothing in the tree failed when nobody asked**: not a
 * type, not a test, not a lint. The omission was invisible for as long as nobody happened to look.
 *
 * So the question is asked here, by the compiler, of every substrate at once. {@link SUBSTRATE_FRESHNESS}
 * is a mapped type over `keyof Required<BreakWriteRequest>`, so **adding a field to that interface
 * fails `tsc` until somebody declares what happens to it between the write and the air** — which is
 * exactly the event that happened here and produced nothing. The same shape as
 * `packages/plugin-sdk/src/boundary.json.safe.ts`, for the same reason, and it lives in `src/` for
 * that file's reason too: the build tsconfig type-checks only `src/`, so an assertion in `tests/`
 * would never run.
 *
 * ## `perishable` is the honest answer and is meant to be used
 *
 * The value that matters most is the one admitting there is no guard. A vocabulary offering only
 * guards would push somebody toward the nearest plausible one, which is how a table like this
 * becomes a lie; naming the absence keeps it a record. Every `perishable` entry carries a comment
 * saying why that is tolerable today and what would stop making it so.
 *
 * Nothing reads this at runtime. It is a declaration, and the array of names is the whole cost.
 *
 * The vocabulary itself is in `modules/shared/freshness.ts`, because `StationTool.freshness` answers
 * the same question about a fact that reaches a script through the model's tool loop rather than
 * through a field, and the module edge runs director ← llm.
 */

/**
 * Every field of {@link BreakWriteRequest}, and what keeps it true until the break airs.
 *
 * A missing key is a `tsc` error, which is the whole mechanism. A key whose verdict is wrong is
 * still a bug, and the comments are where that is arguable.
 */
export const SUBSTRATE_FRESHNESS: { [TField in keyof Required<BreakWriteRequest>]: Freshness } = {
    // Which writer takes this. Never spoken.
    kind: 'not-spoken',

    // The record just finished. A record that played stays played: a station cannot un-play one, and
    // `neighboursOf` re-reads the order at write time so the walk skips anything already skipped.
    previous: 'timeless',
    // The record coming up, which is the original claim and the reason the whole mechanism exists.
    next: 'claims-item',

    // The station's own name. It changes when an operator changes it, which is not a gap this is
    // about, and a break saying the old one for one boundary is not a fact about the world.
    station: 'timeless',

    // Who the station is, and everything that hangs off the sheet. All of it is invented material
    // about a character; none of it is a statement about the world that the world can falsify.
    // A recast mid-window is handled by `recast`, which un-writes the break outright.
    persona: 'timeless',
    notebook: 'timeless',
    story: 'timeless',
    preoccupation: 'timeless',

    // What the engine can perform and what is on the rack. Both are read at write time and both are
    // re-resolved on the way to air — `RenderSegmentJob` drops a reaction the engine cannot do, and
    // `hits` drops a pad the board no longer holds — so a change between the two is already
    // absorbed rather than spoken.
    reactions: 'timeless',
    pads: 'timeless',

    // What the station has already said and played this broadcast. Both are history, and history
    // only grows: a phrase spent twenty minutes ago is still spent, and a record played is still
    // played. The list being SHORT by the time the break airs is not a way of being untrue.
    recent: 'timeless',
    played: 'timeless',

    // The bulletin, fetched against `airs_at` by `BulletinSource.storiesFor` and cut to the
    // operator's freshness window measured from that instant. A story inside the window when the
    // break was written is inside it when the break airs, because the window is hours wide and the
    // gap is minutes.
    stories: 'fetched-for-air',

    // The reading. `WeatherSource` declines one already too old to be true at air, which is the
    // `fetched-for-air` half, AND stamps `claims_reading_until` so drift past the projection is
    // caught as well. The stronger of the two is named here: the claim is what survives to the
    // hand-over. This row is the one this whole file exists because of.
    weather: 'claims-reading',
    // The expiry itself, which is the guard rather than anything a break says.
    weatherFreshUntil: 'not-spoken',

    // What the break is about, resolved by the caller out of the context below. A category or a
    // location: an operator's own word for a thing, and it does not stop being that word.
    subject: 'timeless',

    // The moment, in the three shapes a writer can use and the one a guard can. A phrasing that
    // names any of the first three stamps `claims_time_*`; `moment` is a number nothing is told,
    // carried for `namesWrongTimeOfDay` alone.
    clock: 'claims-time',
    greeting: 'claims-time',
    dayPart: 'claims-time',
    moment: 'not-spoken',

    // When it airs, what it is worth at the model slot, and what asked for it. The first two are
    // scheduling. `context` is read by the writer for its kind and by nothing else, and no writer
    // reads it today: what a writer would say out of it is resolved into `subject` above before it
    // gets here. A writer that starts reading it directly puts this row back in question.
    airsAt: 'not-spoken',
    priority: 'not-spoken',
    context: 'not-spoken',
};
