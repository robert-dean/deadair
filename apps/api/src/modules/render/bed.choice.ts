import type { ShelvedSegment } from './segment.repository.js';

/**
 * Which bed a break airs over, from the beds that may air on its show, or `undefined` for none.
 *
 * The show's own first, which is `BreakPlanner.ownFirst`'s rule for a recording: a show that has
 * beds of its own never airs the station's, and a show with none airs whatever is scoped to nobody.
 * Another show's beds are never in `beds` at all (see `SegmentRepository.listBeds`).
 *
 * Random among what is left, avoiding the bed the last break had where there is another: the same
 * bed every break is what a show with ONE bed sounds like, which is a choice its operator made, but a
 * show with three that played the first every time would be a tape loop.
 */
export function chooseBed(beds: readonly ShelvedSegment[], previousId: string | undefined, random: () => number = Math.random): string | undefined {
    const own = beds.filter(bed => bed.forShow);
    const pool = own.length > 0 ? own : beds;
    if (pool.length === 0) return undefined;

    const others = pool.filter(bed => bed.id !== previousId);
    const from = others.length > 0 ? others : pool;
    return from[Math.floor(random() * from.length)]!.id;
}

/** What a {@link BedPicker} reads the beds from. `SegmentRepository.listBeds`, narrowed for a test. */
export interface BedShelf {
    listBeds(onAir?: { slotId?: string; personaId?: string }): Promise<ShelvedSegment[]>;
}

/**
 * The beds for one planting pass: read once, the first time a break wants one, and dealt out with
 * {@link chooseBed} so two breaks planted together do not share a bed where the show has another.
 *
 * Lazy because most passes plant nothing that is written, and a station with no beds should pay one
 * query per pass at most, not one per break. A read that fails is a pass with no beds: the breaks
 * still plant, and air as words, which is what a bed is never allowed to cost.
 */
export class BedPicker {
    private beds?: Promise<readonly ShelvedSegment[]>;
    private previous?: string;

    constructor(
        private readonly shelf: BedShelf,
        private readonly onAir: { slotId?: string; personaId?: string },
        private readonly onError: (error: unknown) => void = () => {},
    ) {}

    /** The bed for the next break planted this pass, or `undefined` for a break with none. */
    async next(): Promise<string | undefined> {
        // Inside an async function, so a read that throws before it returns a promise is caught too.
        this.beds ??= (async () => await this.shelf.listBeds(this.onAir))().catch(error => {
            this.onError(error);
            return [];
        });

        const chosen = chooseBed(await this.beds, this.previous);
        if (chosen !== undefined) this.previous = chosen;
        return chosen;
    }
}

/** A picker that never has a bed, for a pass where beds are off. */
export const NO_BEDS: Pick<BedPicker, 'next'> = { next: async () => undefined };
