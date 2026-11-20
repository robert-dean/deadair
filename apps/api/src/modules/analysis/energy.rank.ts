/**
 * A record's ENERGY: how loud it plays and how bright it sounds, each ranked against this station's
 * own library, and the two ranks averaged.
 *
 * Pure: the ranks, the average and the thirds. The reads are `AnalysisRepository.energyDistributions`
 * and `energyPartsFor`.
 *
 * ## Why ranks, and why against this library
 *
 * The analyzer measures two absolute figures, `integratedLufs` and `brightnessHz`, and cannot say
 * whether either is high: that depends on what else the station holds. A cut on an absolute scale is
 * the trap a text-and-audio embedding fell into on another library, where ranking raw scores put
 * "energetic" on 62% of it. So each figure becomes a percentile rank against the library's own
 * distribution, and a third of whatever the station holds is the energetic third.
 *
 * Measured on 40 records drawn from the live library against felt-energy scores written down before
 * any figure was computed (`analysis/README.md`, "How brightness is measured"): loudness alone agreed
 * at 0.63, brightness at 0.70, the two ranks averaged at 0.77.
 *
 * ## Two biases, and where they are answered
 *
 * Brightness reads dark club music as calm, and loudness carries the mastering era. Both are biases of
 * a LIBRARY-wide ranking, which is what a record's page shows. A show leaning toward a stage does not
 * use the library-wide thirds: it takes {@link thirdsOf} the records it is choosing between, so a
 * techno show's build runs from its own darker, quieter records to its own louder, brighter ones.
 *
 * ## No opinion
 *
 * `undefined`, never a middle value, for every case this cannot judge: a record with no loudness (a
 * silent one, or one never measured), a library with fewer than {@link ENERGY_MIN_LIBRARY} measured
 * records, a pool of fewer than {@link ENERGY_MIN_POOL}. A brightness measured on fewer records than the
 * minimum is left out of every record's energy rather than ranked against a handful, so until a
 * re-measure brings it to the library, energy is loudness alone and says so.
 */

/**
 * The fewest measured records a figure's distribution needs before anything is ranked against it.
 *
 * Unfitted, and said so: enough that one percentile step is several records rather than one, and far
 * below the 7,234 rows the live library had loudness for on 2026-11-20.
 */
export const ENERGY_MIN_LIBRARY = 500;

/** The fewest records with an energy a pool needs before it is split into thirds. Two a third. */
export const ENERGY_MIN_POOL = 6;

/** How many cut points a distribution is read as: the minimum, every percentile, the maximum. */
export const ENERGY_CUT_POINTS = 101;

/** What one record contributes: the analyzer's two absolute figures, either of which may be absent. */
export interface EnergyParts {
    /** `integratedLufs`, gated programme loudness. */
    loudnessLufs?: number;
    /** `brightnessHz`, the median spectral centroid. */
    brightnessHz?: number;
}

/**
 * The library's distribution of each figure, as {@link ENERGY_CUT_POINTS} ascending cut points (the
 * 0th to the 100th percentile). `undefined` for a figure measured on fewer than {@link ENERGY_MIN_LIBRARY}
 * records, which ranks nothing.
 */
export interface EnergyDistributions {
    loudness?: readonly number[];
    brightness?: readonly number[];
}

/** Which figures a record's energy was ranked from. */
export type EnergyFrom = 'loudness' | 'loudnessAndBrightness';

/** A record's energy in this library. */
export interface Energy {
    /** 0 to 100: how far up this library the record sits. */
    percentile: number;
    /** Which figures went into it. `loudness` until the record's brightness is measured and ranked. */
    from: EnergyFrom;
}

/** A third of a pool. */
export type EnergyThird = 'low' | 'medium' | 'high';

/**
 * Where `value` falls in a distribution, from 0 to 100, interpolated between the cut points so two
 * records inside one percentile step still rank apart. Clamped at the ends: a record quieter than the
 * quietest record measured is at 0, not below it.
 */
export function percentileRank(value: number, cuts: readonly number[]): number {
    const last = cuts.length - 1;
    if (last < 1) return 50;
    if (value <= cuts[0]!) return 0;
    if (value >= cuts[last]!) return 100;

    // The last cut at or below the value. Cut points can repeat where many records share a figure, so
    // the search lands on the highest of a run of equals, which is where a value equal to them ranks.
    let low = 0;
    let high = last;
    while (high - low > 1) {
        const middle = (low + high) >> 1;
        if (cuts[middle]! <= value) low = middle;
        else high = middle;
    }
    const from = cuts[low]!;
    const to = cuts[high]!;
    const within = to > from ? (value - from) / (to - from) : 0;
    return (100 * (low + within)) / last;
}

/** A distribution as read, or `undefined` when it cannot rank anything. */
export function usableCuts(cuts: readonly number[] | undefined, count: number): readonly number[] | undefined {
    if (cuts === undefined || count < ENERGY_MIN_LIBRARY || cuts.length !== ENERGY_CUT_POINTS) return undefined;
    return cuts.every(Number.isFinite) ? cuts : undefined;
}

/**
 * A record's energy in this library: the mean of the percentile ranks it has, or `undefined`.
 *
 * Loudness is required, because a record without it is silent or unmeasured and has no energy to
 * speak of. Brightness joins when the record has one AND the library's brightness is measured widely
 * enough to rank against.
 */
export function energyOf(parts: EnergyParts | undefined, distributions: EnergyDistributions): Energy | undefined {
    const loudness = parts?.loudnessLufs;
    if (loudness === undefined || !Number.isFinite(loudness) || distributions.loudness === undefined) return undefined;

    const loud = percentileRank(loudness, distributions.loudness);
    const brightness = parts?.brightnessHz;
    if (brightness === undefined || !Number.isFinite(brightness) || distributions.brightness === undefined) {
        return { percentile: loud, from: 'loudness' };
    }
    return { percentile: (loud + percentileRank(brightness, distributions.brightness)) / 2, from: 'loudnessAndBrightness' };
}

/**
 * The low, middle and high thirds of a pool of records by energy, or `undefined` for a pool too small
 * to split. A record with no energy is in no third and is left out of the map.
 *
 * Ranked within the pool rather than cut on the library's thirds, which is the whole point of it (see
 * the module's comment). Records with the same energy share their mean position, so a tie never puts
 * two identical records in different thirds.
 */
export function thirdsOf<K>(energies: ReadonlyMap<K, number>): Map<K, EnergyThird> | undefined {
    const entries = [...energies].filter(([, energy]) => Number.isFinite(energy));
    if (entries.length < ENERGY_MIN_POOL) return undefined;

    entries.sort((a, b) => a[1] - b[1]);
    const thirds = new Map<K, EnergyThird>();
    let start = 0;
    while (start < entries.length) {
        let end = start;
        while (end + 1 < entries.length && entries[end + 1]![1] === entries[start]![1]) end += 1;
        // The tied run's mean position, as a fraction of the pool, decides its third.
        const position = (start + end) / 2 / entries.length;
        const third: EnergyThird = position < 1 / 3 ? 'low' : position < 2 / 3 ? 'medium' : 'high';
        for (let index = start; index <= end; index += 1) thirds.set(entries[index]![0], third);
        start = end + 1;
    }
    return thirds;
}
