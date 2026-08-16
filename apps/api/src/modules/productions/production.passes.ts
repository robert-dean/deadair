/**
 * Which passes each writing mode runs, as a table rather than as branches.
 *
 * The operator chooses how much of the model's time a production is worth, and this is the whole of
 * what that choice means. Adding a pass to a mode is editing one row here; adding a NEW pass is that
 * plus the function that runs it, and nothing else — no chain logic changes, because the chain reads
 * this list rather than knowing the modes.
 *
 * ## One job per pass, never one per production
 *
 * The chain is: a job runs one pass, writes what it produced to the row, and sends the job for the
 * next pass. Three things fall out of that and none had to be designed.
 *
 * - **pg-boss runs stay short**, so `expiresIn` stays a number that means something. One job for a
 *   whole production would need an enormous one, and a wedged run would then be unreclaimable for
 *   hours.
 * - **A restart resumes**, because the row says which pass finished. There is no checkpoint table:
 *   the thing being checkpointed is the checkpoint.
 * - **The model is genuinely free between passes**, which is what makes the gate's tiers work at
 *   all. A tier that only applies between admissions needs there to BE admissions, and a production
 *   wrapped in one `gate.hold` would hold the station's only model for the whole show — every break
 *   in that window falling to its floor, which is the failure the tiers were split to stop.
 *
 * ## Why the modes are these three
 *
 * `quick` is one draft per beat and no plan of content, for a production whose shape is already
 * decided by what it was given — a bulletin with four stories in an order. `outlined` adds the pass
 * that decides the shape, which is what makes something a programme rather than a sequence.
 * `polished` adds a deterministic check and at most one re-draft, which costs a second call only for
 * the beats that actually failed something.
 *
 * Note what `polished` does NOT add: a model judging the draft. The check is arithmetic
 * (`production.checks.ts`), because a model asked whether its own work is good says yes, and because
 * everything worth catching here — a beat that repeats an earlier one, one that came back half the
 * length it was asked for, one that re-introduces a show already in progress — is measurable.
 */

import type { ProductionPass, WritingMode } from './production.js';

/**
 * The pass chain for each mode, in order.
 *
 * `outline` is absent from `quick` rather than being a no-op in it: a pass that runs and does
 * nothing still costs a job, a row write and a look at the gate.
 */
export const PASSES: Record<WritingMode, readonly ProductionPass[]> = {
    quick: ['draft'],
    outlined: ['outline', 'draft'],
    polished: ['outline', 'draft', 'check'],
};

/** Every mode an operator may choose, for a settings field and for validating one. */
export const WRITING_MODES: readonly WritingMode[] = ['quick', 'outlined', 'polished'];

/** Whether this is a mode the station knows how to run. */
export const isWritingMode = (value: string): value is WritingMode => (WRITING_MODES as readonly string[]).includes(value);

/**
 * What runs after this pass, or `undefined` when the production is written.
 *
 * The chain's one piece of arithmetic, kept here beside the table it reads so a mode and its
 * successor logic cannot drift.
 *
 * A pass that is not in this mode's chain answers `undefined`, which is deliberately the same answer
 * as "that was the last one". It happens when a mode is changed under a production that is already
 * being made, and stopping there is the honest outcome: the passes that have run have run, and the
 * alternative is guessing where a production is in a chain it was never started on.
 */
export function nextPass(mode: WritingMode, completed: ProductionPass): ProductionPass | undefined {
    const chain = PASSES[mode];
    const at = chain.indexOf(completed);
    if (at < 0) return undefined;

    return chain[at + 1];
}

/** The pass a production of this mode starts with. Every mode has at least one, so this never fails. */
export const firstPass = (mode: WritingMode): ProductionPass => PASSES[mode][0]!;

/** Whether this mode ever runs this pass, for a job asked to do something the mode does not want. */
export const runsPass = (mode: WritingMode, pass: ProductionPass): boolean => PASSES[mode].includes(pass);
