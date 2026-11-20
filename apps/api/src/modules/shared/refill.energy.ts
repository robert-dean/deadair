import { Injectable } from 'injectkit';

/** A third of the library or of a pool, low to high. The same three names `analysis/energy.rank.ts` uses. */
export type EnergyBand = 'low' | 'medium' | 'high';

/**
 * The energy stage of the refill a model is choosing records for, and how to read a record's band.
 *
 * `AiredRecords`' sibling, and out of band for its reason: `ModelSetGenerator` knows a refill is running
 * and which stage it airs in, and `MusicSearchTool` writes the rows, built by the tool registry and
 * knowing nothing about any refill. Scoped, so one refill's stage is never read by another.
 *
 * The lookup travels with the stage rather than the search tool reaching the measurements itself, so
 * the `llm` module, which registers before `analysis`, never has to know where an energy comes from.
 *
 * Unset is the ordinary state: a break writer shares the search tool and sets nothing, and a show with
 * no energy stages asks for nothing. Either way no row is marked, which is the answer before this.
 */
@Injectable()
export class RefillEnergy {
    private stageNow?: EnergyBand;
    private lookup?: (trackIds: readonly string[]) => Promise<ReadonlyMap<string, EnergyBand>>;

    /** Take this refill's stage, and how to read each record's band against the library. */
    set(stage: EnergyBand, lookup: (trackIds: readonly string[]) => Promise<ReadonlyMap<string, EnergyBand>>): void {
        this.stageNow = stage;
        this.lookup = lookup;
    }

    /** The stage this refill leans to, or undefined when it names none. */
    get stage(): EnergyBand | undefined {
        return this.stageNow;
    }

    /** Each record's band against the library, for those that have one. Empty with no stage, or when nothing could be read. */
    async bandsFor(trackIds: readonly string[]): Promise<ReadonlyMap<string, EnergyBand>> {
        if (this.lookup === undefined || trackIds.length === 0) return new Map();
        return await this.lookup(trackIds).catch(() => new Map<string, EnergyBand>());
    }
}
