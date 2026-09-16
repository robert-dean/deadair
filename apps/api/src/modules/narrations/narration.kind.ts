/**
 * The kind a narration is, on the clock, on a segment and on a production.
 *
 * One word across all three, `syndicated.kind.ts`'s arrangement exactly, and chosen for the same
 * reason: a band's kind is what the station DOES at that time, and one predicate every reader shares
 * is what keeps the planner, the scheduler and the clock from disagreeing about what a band is for.
 *
 * **It must never be added to `render.productionKinds`.** That setting names the kinds the production
 * scheduler COMMISSIONS: it reads an anchored band ahead by three hours and opens a production for a
 * model to write. A narration production is opened by this module instead, already written, because
 * the words are the author's. A band whose kind is in that set is also dropped from `BreakPlanner`'s
 * fill (`isProductionKind`), so putting `narration` there would leave the band silently never
 * planted while two schedulers both thought they owned it.
 */
export const NARRATION_KIND = 'narration';

/** Whether a band, a segment or a production is a narration. Case-insensitive, as the clock's kinds are. */
export const isNarrationKind = (kind: string): boolean => kind.trim().toLowerCase() === NARRATION_KIND;
