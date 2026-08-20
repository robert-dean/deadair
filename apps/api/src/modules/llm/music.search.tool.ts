import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import { catalogKey, normalizeKey } from '#modules/catalog/catalog.keys.js';
import { TracksRepository } from '#modules/catalog/tracks.repository.js';
import { advisoryPolicy, demandsClean } from '#modules/director/advisory.policy.js';
import { songKey } from '#modules/director/rotation.keys.js';
import { QueuedRecords } from '#modules/shared/queued.records.js';
import { settingIsOn } from '#modules/shared/setting.flags.js';
import { ProviderSearch, type FoundTrack } from './provider.search.js';
import type { StationTool, ToolSource } from './llm.tools.js';

/**
 * "What can the station play?", as ONE thing a model can ask.
 *
 * ## Why this replaced a pair of tools
 *
 * `search_library` answered from `deadair.tracks` and `search_catalog` fanned out over the provider
 * plugins, and once `PickResolver` gained its lookup-and-ingest rung BOTH answered with records that
 * can air. So the split stopped being schedulable-versus-not and became a preference — which the
 * model then had to arbitrate on every call, using no information the host does not already have.
 *
 * That arbitration is where briefed refills died. Measured on `artists like mitch murder` against a
 * library of rock and metal: one refill found the artist at a provider, asked `similar_artists` for
 * its neighbours, then searched the LIBRARY for each neighbour in turn, got nothing every time, and
 * ran out of tool steps before it ever answered — twenty-four records came from the brief-blind
 * floor. A later one was told, by an empty-result note, to go to the providers, and did, and got
 * twenty-five real records. The note worked and it was a patch on a decision the model should never
 * have been handed.
 *
 * So the two questions are answered together and the ANSWER carries the fact: every row says whether
 * the station already owns it. A preference the host can state is not a choice the model has to make.
 *
 * ## Owned is the same claim the resolver will act on
 *
 * `TracksRepository.ownership` matches on `title_key` + `artist_key`, which is what
 * `PickResolver.identify` and `ProviderTrackLookup` key off. Match on anything looser and `owned`
 * would be advertising something the station will not in fact find.
 *
 * ## Bans narrow BOTH halves. Rotation rules still narrow neither.
 *
 * A disliked record is excluded wherever it came from, because a dislike is an instruction about
 * what the station may play and `PickResolver` drops one anyway — offering it can only waste a pick.
 * `searchPlayable` has always excluded them on the library side; the provider side never did, and
 * merging made that asymmetry visible inside a single answer rather than hidden between two tools.
 *
 * A record inside the repeat window is still offered, unchanged and deliberately: variety is enforced
 * at the point of choice, and pre-filtering returns a worse pool on a small library.
 *
 * A `clean-only` station falls on the BAN side of that line and the two `prefer-` states do not,
 * exactly as before: clean-only means a record with no clean copy cannot air at all, while a
 * preference is satisfied when the copy is chosen.
 */

/**
 * How many records come back at most, whatever was asked for.
 *
 * A floor on what a refill can do rather than a comfort: `ModelSetGenerator` asks for an oversampled
 * batch — two dozen records for a fifteen-item refill — and a model that can see ten cannot name two
 * dozen distinct ones. It pads with repeats instead, the chain discards them, and the brief-blind
 * floor quietly fills the rest of the hour.
 */
const MAX_RESULTS = 25;

/**
 * How few records a search may answer with, whatever was asked for.
 *
 * The floor {@link MAX_RESULTS} never had, and it is the same argument read from the other end. A
 * ceiling stops a model filling its context with a library listing; nothing stopped it starving
 * itself, and it does. Measured on a briefed refill: the model asked for `limit: 1` on three
 * consecutive searches, was handed exactly what it asked for, and answered with three records for a
 * batch of twenty-four. It was not wrong about anything — one row is what it requested — but a
 * search that returns one row cannot fill an oversampled batch, which is the whole reason the
 * ceiling is 25 rather than 10.
 *
 * So `limit` stays a CEILING and stops being a way to ask for too little. The description says so,
 * because a bound the model cannot see is one it will keep walking into.
 */
const MIN_RESULTS = 10;

/**
 * At most this many owned records, so a provider always has room in the answer.
 *
 * Without a reserve the merge is first-come: a brief the library HALF matches fills all
 * {@link MAX_RESULTS} slots with owned records and the model never sees what the station could get,
 * which is the failure the whole merge exists to remove — just moved from the model's choice into
 * the ordering. A judgement rather than a measurement; what would settle it is how often a real
 * refill hits the cap with both halves full.
 */
const OWNED_SHARE = 15;

/**
 * Library rows below which the providers are asked too.
 *
 * The host making the call the model used to be asked to make. Not zero, because a substring match
 * can return one incidental row for a query the library cannot really answer ("Laser" matching a
 * title while the station holds nothing by Lazerhawk), and a single junk hit must not be what
 * suppresses the reach. A judgement, not a measurement.
 */
const THIN = 3;

/** How the operator asks for every search to reach the providers, whatever the library returned. */
export const MUSIC_SEARCH_KEYS = { alwaysReach: 'llm.alwaysSearchProviders' } as const;

/** OFF: reach past the library only when it comes up short. See the setting's help for the argument. */
export const ALWAYS_REACH_DEFAULT = false;

/** One row of the answer. Thin on purpose: a model choosing a record needs names, not a schema. */
interface MusicTrack {
    title: string;
    artist: string;
    /**
     * Whether the station already has this record.
     *
     * The whole point of the merge. `true` means catalogued and bound — free to play, usually on
     * disk already, and measured, so it airs trimmed. `false` means the station will fetch it when
     * it is chosen, which is a download and an untrimmed first play, and is perfectly fine.
     */
    owned: boolean;
    /**
     * Whether this record is ALREADY in the running order being extended.
     *
     * Absent on the ordinary row rather than sent as `false`, because most rows are not queued and
     * twenty-five `"queued":false` are context spent saying nothing. Present, it is a fact the model
     * could not otherwise get: the prompt's avoid list is capped and the rest of it travels as a
     * COUNT, so the record in front of it may be one of the ones it was told about and cannot see.
     * Naming it costs a pick, since `PickResolver` discards a duplicate.
     *
     * Marked and not filtered out, deliberately. Dropping them would hide from the model that its own
     * previous picks landed, and would read as the library shrinking between two identical searches.
     */
    queued?: boolean;
    /** Everyone else on the record, shown and never copied. Provider rows only. */
    featuring?: string[];
    album?: string;
    year?: number;
    genre?: string;
    /** How well known a provider says it is, 0 to 100. Absent on owned rows and where nobody ranked it. */
    popularity?: number;
}

@Injectable()
export class MusicSearchTool implements ToolSource {
    constructor(
        private readonly tracks: TracksRepository,
        private readonly providers: ProviderSearch,
        private readonly queued: QueuedRecords,
        private readonly config: AppConfig,
        private readonly logger: Logger,
    ) {}

    async tools(): Promise<StationTool[]> {
        return [
            {
                declaration: {
                    name: 'search_music',
                    // Written for the model, not for a developer. It says what the answer MEANS
                    // rather than which store was read, because there is no longer a choice to
                    // steer — what is left to explain is the one field that carries the old split.
                    description:
                        'Search for records the station can play: its own library and everything its music providers offer, in one answer. Every result is safe to name. Each row says whether the station already owns it — an owned record is ready to play, and one it does not own yet is fetched when you choose it. A row marked queued is already in the running order: choosing it does nothing, so pick something else. It matches NAMES and styles in the library, but only NAMES at the providers: to fill a brief, work out for yourself which artists fit it and search for them one at a time.',
                    parameters: {
                        type: 'object',
                        properties: {
                            query: {
                                type: 'string',
                                description:
                                    'A title, an artist, or a style. In the station\'s own library a record is found under every style it or its artist is tagged with. At the providers a style like "rap" finds records with that word in the title, not records of that style.',
                            },
                            yearFrom: { type: 'number', description: 'Narrow to records released in or after this year.' },
                            yearTo: { type: 'number', description: 'Narrow to records released in or before this year.' },
                            limit: {
                                type: 'number',
                                description: `How many records, at most ${MAX_RESULTS}. Asking for fewer than ${MIN_RESULTS} still returns ${MIN_RESULTS}: you are choosing from what comes back, so a short list only narrows what you have to choose between.`,
                            },
                        },
                        // Nothing is required, because a period is a complete search on its own. What
                        // a call actually needs is one of the three, which `search` enforces and
                        // says: a model refused for sending no query worked around it by passing the
                        // query `a`, which is not a no-op but a text match that steers the answer.
                        required: [],
                        additionalProperties: false,
                    },
                },
                run: async args => await this.search(args),
            },
        ];
    }

    /**
     * One search of everything the station can play.
     *
     * Arguments arrive as the model produced them, so nothing here trusts a type. A call with
     * nothing to search on is the model's mistake and is reported as one, because that is something
     * it can correct and an exception is not.
     */
    private async search(args: Record<string, unknown>): Promise<{ tracks: MusicTrack[] }> {
        const query = readText(args.query) ?? '';
        const filters = {
            ...(readYear(args.yearFrom) === undefined ? {} : { yearFrom: readYear(args.yearFrom)! }),
            ...(readYear(args.yearTo) === undefined ? {} : { yearTo: readYear(args.yearTo)! }),
        };
        if (query.length === 0 && Object.keys(filters).length === 0) {
            throw new Error('a search needs a "query" string, or a year to narrow by');
        }

        const limit = clampLimit(args.limit);
        // Read per call, like every other setting: an operator switching the station to clean-only
        // is obeyed by the next thing the model asks rather than after a restart.
        const cleanOnly = demandsClean(advisoryPolicy(this.config));
        // A year narrows the providers and cannot narrow the library search, which matches text.
        // Asked for a period alone there is nothing for it to match, so it is not asked at all.
        const owned = query.length === 0 ? [] : await this.tracks.searchPlayable(query, limit, cleanOnly);

        const reaching = owned.length < THIN || settingIsOn(this.config, MUSIC_SEARCH_KEYS.alwaysReach, ALWAYS_REACH_DEFAULT);
        const reached = reaching ? (await this.providers.search(query, filters, MAX_RESULTS)).tracks : [];

        const fromProviders = await this.fromProviders(reached, owned);
        const fromLibrary = owned.map(row => this.mark(toOwnedRow(row))).slice(0, ownedAllowance(limit, fromProviders.length));
        const rows = [...fromLibrary, ...fromProviders].slice(0, limit);
        this.logger.debug('llm: searched for music', { query, ...filters, owned: owned.length, reached: reached.length, answered: rows.length });

        return { tracks: rows };
    }

    /**
     * Provider rows, minus everything the answer must not carry.
     *
     * Two reads rather than one because they answer for different records: {@link
     * TracksRepository.ownership} can only speak for a record the catalog HAS, and a row by a banned
     * artist the station never catalogued joins to no track at all. Both are batch and both are
     * skipped entirely when nothing was reached.
     */
    private async fromProviders(reached: readonly FoundTrack[], owned: readonly { title: string; artistName: string }[]): Promise<MusicTrack[]> {
        if (reached.length === 0) return [];

        const [ownership, bannedArtists] = await Promise.all([
            this.tracks.ownership(reached.map(track => ({ title: track.title, artist: track.artist }))),
            this.tracks.dislikedArtistKeys(reached.map(track => track.artist)),
        ]);

        // What the library half already answered with. A record in both is ONE record to a DJ, and
        // the owned row is the better of the two: it carries the year and the style, and it is the
        // copy the station will actually play.
        const shown = new Set(owned.map(row => keyOf(row.title, row.artistName)));

        const rows: MusicTrack[] = [];
        for (const track of reached) {
            const key = keyOf(track.title, track.artist);
            if (shown.has(key)) continue;
            if (ownership.banned.has(key)) continue;
            if (bannedArtists.has(normalizeKey(track.artist))) continue;

            rows.push(
                this.mark({
                    title: track.title,
                    artist: track.artist,
                    owned: ownership.owned.has(key),
                    ...(track.featuring === undefined ? {} : { featuring: track.featuring }),
                    ...(track.album === undefined ? {} : { album: track.album }),
                    ...(track.popularity === undefined ? {} : { popularity: track.popularity }),
                }),
            );
        }

        // Owned first here too, so a record the library search missed but the station holds does not
        // sit below one it would have to fetch.
        return [...rows.filter(row => row.owned), ...rows.filter(row => !row.owned)];
    }

    /**
     * Say so when the running order already holds this record.
     *
     * Applied to BOTH halves through one method, because a record can be queued whichever store it
     * came back from and a mark that only reached the provider rows would be worse than none: the
     * model would learn to read an unmarked row as free.
     *
     * The key is `songKey`, which is what the avoid set was built with and what `play_history` and
     * the repeat window are written with. Anything else here would be a third spelling of "the same
     * record" that nobody could see disagreeing with the other two.
     */
    private mark(row: MusicTrack): MusicTrack {
        return this.queued.has(songKey(row.title, [row.artist])) ? { ...row, queued: true } : row;
    }
}

/** A library row as the model reads it. Everything the catalog does not know is left out rather than sent as null. */
const toOwnedRow = (row: {
    title: string;
    artistName: string;
    albumName?: string | null;
    year?: number | null;
    genre?: string | null;
}): MusicTrack => ({
    title: row.title,
    artist: row.artistName,
    owned: true,
    ...(row.albumName == null ? {} : { album: row.albumName }),
    ...(row.year == null ? {} : { year: row.year }),
    ...(row.genre == null ? {} : { genre: row.genre }),
});

/**
 * How many owned records may take the answer, leaving room for the ones the station could get.
 *
 * The reserve is a SHARE of what was asked for rather than a fixed count, and that is a correction
 * rather than a nicety. Written as `Math.max(OWNED_SHARE, …)` it was inert for every small request:
 * a model asking for five records from a library that matched ten got five owned rows and never saw
 * the provider half at all, because the allowance was fifteen and the slice took the first five. The
 * reserve exists so a brief the library HALF matches still shows what the station could reach, and
 * that argument does not get weaker because the caller asked for fewer rows.
 *
 * Two bounds around it. With nothing reached the library takes the lot, since holding it to a share
 * would answer with fifteen records to a caller that asked for twenty-five and could have had them.
 * And where the providers found less than the room left over, the library takes the slack instead of
 * leaving the answer short.
 */
const ownedAllowance = (limit: number, reached: number): number => {
    if (reached === 0) return limit;
    return Math.max(limit - reached, Math.round((limit * OWNED_SHARE) / MAX_RESULTS));
};

/** The identity two halves of the answer are compared on, which is the resolver's own key. */
const keyOf = (title: string, artist: string): string => catalogKey(normalizeKey(title), normalizeKey(artist));

/** Text the model actually set, or nothing. A model that fills every parameter sends `query: ""`, which is not a search. */
const readText = (value: unknown): string | undefined => (typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined);

/** A year the model set, ignoring anything that is not one. */
const readYear = (value: unknown): number | undefined =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.trunc(value) : undefined;

/** Whatever the model asked for, held between {@link MIN_RESULTS} and {@link MAX_RESULTS}. */
function clampLimit(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) return MAX_RESULTS;
    return Math.min(Math.max(Math.floor(value), MIN_RESULTS), MAX_RESULTS);
}
