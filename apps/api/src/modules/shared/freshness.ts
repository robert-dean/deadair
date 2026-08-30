/**
 * What keeps one piece of substrate true from the moment a break is written to the moment it is
 * heard, or the admission that nothing does.
 *
 * The vocabulary lives here rather than in `director` because two modules declare against it and the
 * edge between them runs director ← llm: `SUBSTRATE_FRESHNESS` answers it for every field a writer
 * is handed, and `StationTool.freshness` answers it for every fact that reaches a script through the
 * model's own tool loop instead. One list of possible answers, so the two cannot drift into
 * describing the same exposure with different words. The argument for asking at all is in
 * `modules/director/break.freshness.ts`.
 *
 * The question each value answers is narrow and is worth stating exactly: **can what this makes a
 * break SAY stop being true inside the gap between the words being written and the words being
 * heard?** That gap is `WRITE_AHEAD` — up to eight records, twenty-odd minutes — plus whatever the
 * substrate's own upstream was already behind by.
 */
export type Freshness =
    /**
     * Nothing it makes a break say can stop being true inside that gap.
     *
     * Not "never changes". A chart moves weekly and the catalog moves when somebody ingests, and
     * both are timeless at the scale of one break.
     */
    | 'timeless'
    /**
     * Never reaches the words at all: routing, ordering, or material for a guard rather than for a
     * sentence.
     *
     * Kept apart from `timeless` deliberately. They mean the same thing to the station and different
     * things to whoever changes this next — a field that becomes speakable moves out of here, and a
     * field that was always speakable and merely slow-moving does not.
     */
    | 'not-spoken'
    /** Fetched against `segments.airs_at` rather than against now, so it cannot be stale when written. */
    | 'fetched-for-air'
    /** Guarded by `segments.claims_item_id`: the record it named is checked against the order. */
    | 'claims-item'
    /** Guarded by `segments.claims_time_from`/`until`: the phrasing is checked against the clock. */
    | 'claims-time'
    /** Guarded by `segments.claims_reading_until`: the observation is checked against its own age. */
    | 'claims-reading'
    /**
     * It can stop being true in the gap, and **nothing stamps a claim for it**.
     *
     * The value this vocabulary exists to make sayable. Use it, with a comment saying why the
     * exposure is tolerable and what would end that — do not reach for the nearest guard that almost
     * fits, because a table naming a guard which does not run is worse than no table.
     */
    | 'perishable';
