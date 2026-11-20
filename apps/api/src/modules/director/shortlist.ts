import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import { ANALYSIS_READABLE_SINCE_VERSION } from '@deadair/plugin-sdk';
import { AnalysisRepository } from '#modules/analysis/analysis.repository.js';
import { thirdsOf, type Energy, type EnergyThird } from '#modules/analysis/energy.rank.js';
import { AiredRecords } from '#modules/shared/aired.records.js';
import { errorText } from '#modules/shared/error.text.js';
import { SimilarityStoreRepository } from '#modules/similarity/similarity.store.repository.js';
import { advisoryPolicy } from './advisory.policy.js';
import type { BriefReach } from './brief.acts.js';
import { CandidatesRepository, namedRecordKey, type NamedMatch } from './candidates.repository.js';
import { PickResolver, type ScreenCandidate } from './pick.resolver.js';
import { artistKey, songKey } from './rotation.keys.js';
import { ENERGY_BOOST } from './energy.lean.js';
import { FRESH_FLOOR } from './rotation.rules.js';
import type { TrackPick } from './set.generator.js';
import type { SetInputs } from './set.generator.js';
import { trackLengthBounds } from './track.length.js';

/**
 * The records a model is handed to choose from, every one of which may air now.
 *
 * ## The failure this exists for
 *
 * Measured on the live station, 2026-10-25, The Church (a 24-hour slot whose brief names eighteen
 * acts), refill trace `51fea6af`: the model searched five times, then generated its answer for two
 * minutes with no tools and ran out of its 180-second budget having named nothing. 29,564 tokens,
 * about 5,600 characters of reasoning. The rescue filled the batch from the searches and
 * `PickResolver` kept one of twenty, because the candidates were repeats and acts inside the
 * cooldown. Searching was not the cost; WRITING the answer was, and most of what it would have
 * written could never have aired.
 *
 * So the station does the part a host can do. It gathers the records the brief reaches (the
 * library's, and what the similarity store holds for the brief's acts and their neighbours: see
 * `BriefActs`), screens them through the resolver's own rules (`PickResolver.screen`), and hands the
 * model a numbered list. The model answers with numbers, which is a few dozen tokens, and every
 * number is a record that can air.
 *
 * ## Spread, freshest first
 *
 * Up to {@link SHORTLIST_MAX} lines, one record per artist per turn, the acts in the order the
 * station has neglected them and their neighbours after them, each artist's records never-aired
 * first and then longest off air (`AiredRecords`, the smart shuffle's read). An act gives up to
 * {@link PER_ACT} records and a neighbour {@link PER_NEIGHBOUR}: enough choice that the model, not
 * this, decides which of an act's records make the batch, and few enough that the list stays short.
 *
 * ## Nothing when it would be too short
 *
 * A list with fewer lines than the batch wants is not offered at all, and the model is asked the way
 * it always was, with its searches. That keeps a brief the store cannot yet serve (a style rather than
 * a list of acts, or a store still filling) exactly where it was.
 */

/** The most lines a model is shown. Enough to choose a batch from twice over, few enough to read. */
export const SHORTLIST_MAX = 60;

/** How many records an act the brief names may give the list. */
export const PER_ACT = 4;

/** How many records a neighbour may give: a lead toward the brief, not the brief. */
export const PER_NEIGHBOUR = 2;

/** A ceiling on the library read, which a brief's acts never come near. */
const LIBRARY_READ = 2_000;

/** One line of the list. */
export interface ShortlistEntry extends ScreenCandidate {
    /** For a neighbour, the brief act that led to them, for the line's `like` note. */
    like?: string;
    album?: string;
    /** Whole days since it last aired, inside the smart shuffle's horizon. Absent for never. */
    airedDaysAgo?: number;
    /**
     * Which third of THIS LIST the record's measured energy falls in, while the refill leans to an energy
     * stage. Absent with no stage, for a record the library does not hold or has not measured, and for a
     * list too short of measured records to split. See `energy.lean.ts`.
     */
    energy?: EnergyThird;
}

@Injectable()
export class Shortlist {
    constructor(
        private readonly candidates: CandidatesRepository,
        private readonly store: SimilarityStoreRepository,
        private readonly resolver: PickResolver,
        // Filled by `ModelSetGenerator.rememberAired` before this is asked, with the smart shuffle on.
        private readonly aired: AiredRecords,
        private readonly config: AppConfig,
        private readonly logger: Logger,
        /** Each listed record's measured energy, for a refill that leans to an energy stage. */
        private readonly analysis: AnalysisRepository,
    ) {}

    /**
     * The list for this refill, or `undefined` when there is not enough to choose a batch from.
     *
     * A read that fails answers `undefined`, which is the refill as it was before this existed.
     */
    async build(inputs: SetInputs, reach: BriefReach): Promise<ShortlistEntry[] | undefined> {
        if (reach.acts.length === 0) return undefined;

        try {
            const artists: { key: string; turns: number; like?: string | undefined }[] = [
                ...reach.acts.map(act => ({ key: act.artistKey, turns: PER_ACT })),
                ...reach.neighbours.map(neighbour => ({
                    key: neighbour.artistKey,
                    turns: PER_NEIGHBOUR,
                    like: reach.acts.find(act => act.artistKey === neighbour.of)?.name,
                })),
            ];
            const keys = artists.map(artist => artist.key);
            const [library, stored] = await Promise.all([
                this.candidates.byArtists(keys, LIBRARY_READ, advisoryPolicy(this.config), inputs.era, trackLengthBounds(this.config)),
                this.store.recordsFor(keys),
            ]);

            // Each artist's records: the library's first, then what a source named that the library does
            // not hold, freshest first within the artist.
            const byArtist = new Map<string, ShortlistEntry[]>();
            const songs = new Set<string>();
            const add = (key: string, entry: ShortlistEntry): void => {
                const song = songKey(entry.title, [entry.artist]);
                if (songs.has(song)) return;
                songs.add(song);
                const days = this.aired.daysAgo(song);
                const own = byArtist.get(key);
                const placed = days === undefined ? entry : { ...entry, airedDaysAgo: days };
                if (own === undefined) byArtist.set(key, [placed]);
                else own.push(placed);
            };
            for (const row of library) {
                add(artistKey([row.artist]), {
                    title: row.title,
                    artist: row.artist,
                    trackId: row.trackId,
                    ...(row.album === undefined ? {} : { album: row.album }),
                    ...(row.year === undefined ? {} : { year: row.year }),
                });
            }
            // A record a source named that the catalog DOES hold, under a row the library read above
            // left out (outside the period, or past the length bounds), is listed as that row, so
            // the screen judges it as the resolver will. Listed by name it passed as undated, the
            // model chose it, and the resolver matched it to the very row the library read had
            // refused: on 2026-11-11 that was most of an '80s refill. See `findManyByName`.
            // A failed read lists them by name, as before this existed, rather than costing the list.
            const held = await this.candidates.findManyByName([...stored.values()].flat()).catch((error: unknown) => {
                this.logger.debug(
                    `director: the shortlist lists a source's records by name, because the catalog could not be read (${errorText(error)})`,
                );
                return new Map<string, NamedMatch>();
            });
            for (const [key, records] of stored) {
                for (const record of records) {
                    const row = held.get(namedRecordKey(record.title, record.artist));
                    add(
                        key,
                        row === undefined
                            ? {
                                  title: record.title,
                                  artist: record.artist,
                                  ...(record.album === undefined ? {} : { album: record.album }),
                                  ...(record.year === undefined ? {} : { year: record.year }),
                              }
                            : {
                                  // The row's own strings, because a pick carrying an id is taken on
                                  // trust as that row's: see `PickResolver.identify`.
                                  title: row.title,
                                  artist: row.artist,
                                  trackId: row.trackId,
                                  ...(record.album === undefined ? {} : { album: record.album }),
                                  ...(row.year === undefined ? {} : { year: row.year }),
                              },
                    );
                }
            }
            for (const [key, own] of byArtist) byArtist.set(key, freshestFirst(own));

            const offered = artists.flatMap(artist => byArtist.get(artist.key) ?? []);
            const screened = new Set(
                await this.resolver.screen(offered, inputs.rules, {
                    want: inputs.count,
                    ...(inputs.era === undefined ? {} : { era: inputs.era }),
                    ...(inputs.avoidSongKeys === undefined ? {} : { avoidSongKeys: inputs.avoidSongKeys }),
                    ...(inputs.avoidArtistKeys === undefined ? {} : { avoidArtistKeys: inputs.avoidArtistKeys }),
                    ...(inputs.queuedArtistKeys === undefined ? {} : { queuedArtistKeys: inputs.queuedArtistKeys }),
                    ...(inputs.broadcast === undefined ? {} : { broadcast: inputs.broadcast }),
                    ...(inputs.mix === undefined ? {} : { mix: inputs.mix }),
                }),
            );

            const lists = artists.map(artist => ({
                turns: artist.turns,
                like: artist.like,
                records: (byArtist.get(artist.key) ?? []).filter(entry => screened.has(entry)),
            }));
            const chosen = spread(lists);

            this.logger.debug('director: a shortlist for the model', {
                artists: artists.length,
                offered: offered.length,
                airable: screened.size,
                listed: chosen.length,
                asked: inputs.count,
            });
            if (chosen.length < inputs.count) return undefined;
            return inputs.energy === undefined ? chosen : await this.withEnergy(chosen);
        } catch (error) {
            this.logger.warn(`director: could not build a shortlist for the model; it will search as before (${errorText(error)})`);
            return undefined;
        }
    }

    /**
     * The list with each record's third of it marked, by measured energy. Thirds of the LIST, which is
     * what the model chooses between, for the floor's reason: a show's records may all sit low in the
     * library and still have a low, a middle and a high of their own. A failed read lists them unmarked.
     */
    private async withEnergy(list: ShortlistEntry[]): Promise<ShortlistEntry[]> {
        const ids = list.flatMap(entry => (entry.trackId === undefined ? [] : [entry.trackId]));
        const energies = await this.analysis.energiesFor(ids, ANALYSIS_READABLE_SINCE_VERSION).catch(() => new Map<string, Energy>());
        const thirds = thirdsOf(new Map([...energies].map(([trackId, energy]) => [trackId, energy.percentile])));
        if (thirds === undefined) return list;
        return list.map(entry => {
            const third = entry.trackId === undefined ? undefined : thirds.get(entry.trackId);
            return third === undefined ? entry : { ...entry, energy: third };
        });
    }
}

/** Never aired first, then longest off air; ties keep their order (the library's before a source's). */
function freshestFirst(entries: readonly ShortlistEntry[]): ShortlistEntry[] {
    const age = (entry: ShortlistEntry): number => entry.airedDaysAgo ?? Number.POSITIVE_INFINITY;
    return [...entries].sort((left, right) => age(right) - age(left));
}

/** One record per artist per turn, in artist order, each up to its own turns, to {@link SHORTLIST_MAX}. */
function spread(lists: readonly { turns: number; like: string | undefined; records: ShortlistEntry[] }[]): ShortlistEntry[] {
    const chosen: ShortlistEntry[] = [];
    const most = Math.max(0, ...lists.map(list => list.turns));
    for (let turn = 0; turn < most; turn++) {
        for (const list of lists) {
            if (chosen.length >= SHORTLIST_MAX) return chosen;
            if (turn >= list.turns) continue;
            const record = list.records[turn];
            if (record === undefined) continue;
            chosen.push(list.like === undefined ? record : { ...record, like: list.like });
        }
    }
    return chosen;
}

/**
 * How long off air a record has to be before it draws at full weight, in days: the smart shuffle's
 * own default horizon, so the two leans read alike.
 */
const FULL_WEIGHT_DAYS = 14;

/** What a neighbour draws at against an act the brief names. */
const NEIGHBOUR_WEIGHT = 0.5;

/**
 * Up to `count` records drawn from the list, for a refill whose model named nothing.
 *
 * The list is already a set of records that may air, so the rescue needs no searches and decides
 * nothing the resolver will not judge again. A weighted draw rather than the list's own top, so a run
 * of failed refills does not air the same opening every time: a record never aired, or off air a
 * fortnight, draws at full weight, one aired lately at no less than `FRESH_FLOOR` of it (the smart
 * shuffle's floor, never zero), and a neighbour at half an act's. No more than `maxPerArtist` by one
 * artist, the cap the resolver applies, so the slots go to records it will keep; `0` is no cap. A record
 * in the refill's energy stage, by its mark, draws at `ENERGY_BOOST` times, as it would from the floor.
 *
 * @param random - For tests. Anything answering in `[0, 1)`.
 */
export function drawFromShortlist(
    list: readonly ShortlistEntry[],
    count: number,
    maxPerArtist: number,
    random: () => number = Math.random,
    energy?: EnergyThird,
): TrackPick[] {
    const pool = list.map(entry => ({ entry, weight: weightOf(entry) * (energy !== undefined && entry.energy === energy ? ENERGY_BOOST : 1) }));
    const perArtist = new Map<string, number>();
    const drawn: TrackPick[] = [];

    while (drawn.length < count) {
        const open = pool.filter(item => maxPerArtist <= 0 || (perArtist.get(artistKey([item.entry.artist])) ?? 0) < maxPerArtist);
        if (open.length === 0) break;

        let target = random() * open.reduce((sum, item) => sum + item.weight, 0);
        const chosen = open.find(item => (target -= item.weight) < 0) ?? open[open.length - 1]!;
        pool.splice(pool.indexOf(chosen), 1);

        const key = artistKey([chosen.entry.artist]);
        perArtist.set(key, (perArtist.get(key) ?? 0) + 1);
        drawn.push({
            title: chosen.entry.title,
            artist: chosen.entry.artist,
            ...(chosen.entry.trackId === undefined ? {} : { trackId: chosen.entry.trackId }),
        });
    }
    return drawn;
}

function weightOf(entry: ShortlistEntry): number {
    const fresh = entry.airedDaysAgo === undefined ? 1 : Math.min(1, Math.max(FRESH_FLOOR, entry.airedDaysAgo / FULL_WEIGHT_DAYS));
    return fresh * (entry.like === undefined ? 1 : NEIGHBOUR_WEIGHT);
}
