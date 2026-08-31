// The merged search. What is worth pinning is not search quality but the three claims the merge is
// FOR: every row says whether the station owns it, the host decides when to reach the providers
// rather than the model, and a ban narrows both halves rather than only the one that always did.

import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@maroonedsoftware/appconfig';
import type { Logger } from '@maroonedsoftware/logger';

import type { TracksRepository } from '../../../src/modules/catalog/tracks.repository.js';
import { catalogKey, normalizeKey } from '../../../src/modules/catalog/catalog.keys.js';
import { ADVISORY_KEY } from '../../../src/modules/director/advisory.policy.js';
import { MUSIC_SEARCH_KEYS, MusicSearchTool } from '../../../src/modules/llm/music.search.tool.js';
import type { ProviderSearch, FoundTrack } from '../../../src/modules/llm/provider.search.js';
import { QueuedRecords } from '../../../src/modules/shared/queued.records.js';
import { SearchedRecords } from '../../../src/modules/shared/searched.records.js';
import { StationIdentity } from '../../../src/modules/shared/station.identity.js';
import { songKey } from '../../../src/modules/director/rotation.keys.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

type LibraryRow = { title: string; artistName: string; albumName?: string | null; year?: number | null; genre?: string | null };

const key = (title: string, artist: string) => catalogKey(normalizeKey(title), normalizeKey(artist));

const found = (title: string, artist: string, extra: Partial<FoundTrack> = {}): FoundTrack => ({
    title,
    artist,
    source: 'deadair.provider',
    ...extra,
});

interface Build {
    library?: LibraryRow[];
    reached?: FoundTrack[];
    /** Keys the catalog holds, for provider rows the library search did not return. */
    ownedKeys?: string[];
    bannedKeys?: string[];
    bannedArtists?: string[];
    /** Records the running order already holds, as `[title, artist]`. */
    alreadyQueued?: [string, string][];
    settings?: Record<string, unknown>;
    /** The broadcast on air, which is what seeds the library's row ordering. */
    broadcastId?: string;
}

function build({
    library = [],
    reached = [],
    ownedKeys = [],
    bannedKeys = [],
    bannedArtists = [],
    alreadyQueued = [],
    settings = {},
    broadcastId,
}: Build = {}) {
    const searchPlayable = vi.fn(async () => library);
    const ownership = vi.fn(async () => ({ owned: new Set(ownedKeys), banned: new Set(bannedKeys) }));
    const dislikedArtistKeys = vi.fn(async () => new Set(bannedArtists.map(normalizeKey)));
    const tracks = { searchPlayable, ownership, dislikedArtistKeys } as unknown as TracksRepository;

    const search = vi.fn(async () => ({ tracks: reached, searched: 1 }));
    const providers = { search, canSearch: () => true } as unknown as ProviderSearch;

    // A real string, never a boolean: every layer of AppConfig holds strings, so a double that
    // hands back a boolean passes whichever way the code under test reads it.
    const config = { get: (name: string, fallback?: unknown) => (name in settings ? settings[name] : fallback) } as unknown as AppConfig;

    const queued = new QueuedRecords();
    queued.remember(alreadyQueued.map(([title, artist]) => songKey(title, [artist])));

    const identity = new StationIdentity();
    if (broadcastId !== undefined) identity.began(broadcastId);

    const searched = new SearchedRecords();

    return {
        tool: new MusicSearchTool(tracks, providers, queued, searched, identity, config, logger),
        searchPlayable,
        search,
        ownership,
        dislikedArtistKeys,
        searched,
    };
}

const only = async (tool: MusicSearchTool) => (await tool.tools())[0]!;
const run = async (tool: MusicSearchTool, args: Record<string, unknown>) =>
    (await (await only(tool)).run(args)) as { tracks: Record<string, unknown>[] };

describe('MusicSearchTool', () => {
    it('offers one tool that explains the field carrying the old split', async () => {
        const { tool } = build();
        const declaration = (await only(tool)).declaration;

        expect(declaration.name).toBe('search_music');
        expect(declaration.description).toMatch(/owns/i);
        expect(declaration.description).toMatch(/safe to name/i);
    });

    it('marks a record the station has and one it would have to fetch', async () => {
        const { tool } = build({
            library: [{ title: 'Laid to Rest', artistName: 'Lamb of God', year: 2004, genre: 'metal' }],
            reached: [found('Prime Operator', 'Mitch Murder', { album: 'The Real Deal' })],
        });

        const result = await run(tool, { query: 'anything' });

        expect(result.tracks).toEqual([
            { title: 'Laid to Rest', artist: 'Lamb of God', owned: true, year: 2004, genre: 'metal' },
            { title: 'Prime Operator', artist: 'Mitch Murder', owned: false, album: 'The Real Deal' },
        ]);
    });

    it('reaches the providers when the library comes up short', async () => {
        // The decision the model used to be asked to make, and got wrong by searching the library
        // for one artist after another that it had already been told the station does not hold.
        const { tool, search } = build({ library: [], reached: [found('Hurricane', 'Mitch Murder')] });

        await run(tool, { query: 'Mitch Murder' });

        expect(search).toHaveBeenCalled();
    });

    it('does not reach them when the library answered well', async () => {
        const library = Array.from({ length: 6 }, (_, index) => ({ title: `Track ${index}`, artistName: 'Metallica' }));
        const { tool, search } = build({ library });

        await run(tool, { query: 'Metallica' });

        expect(search).not.toHaveBeenCalled();
    });

    it('reaches them anyway when the operator asked for it, with the setting as the STRING it really is', async () => {
        // `config.get(key, false)` answers the string 'true' here. A test that handed over a real
        // boolean would pass whether or not the code went through `settingIsOn`.
        const library = Array.from({ length: 6 }, (_, index) => ({ title: `Track ${index}`, artistName: 'Metallica' }));
        const { tool, search } = build({ library, settings: { [MUSIC_SEARCH_KEYS.alwaysReach]: 'true' } });

        await run(tool, { query: 'Metallica' });

        expect(search).toHaveBeenCalled();
    });

    it('stays off for the string "false", which is truthy and is the bug this guards', async () => {
        const library = Array.from({ length: 6 }, (_, index) => ({ title: `Track ${index}`, artistName: 'Metallica' }));
        const { tool, search } = build({ library, settings: { [MUSIC_SEARCH_KEYS.alwaysReach]: 'false' } });

        await run(tool, { query: 'Metallica' });

        expect(search).not.toHaveBeenCalled();
    });

    it('shows one record once when both halves carry it', async () => {
        // The owned row wins: it carries the year and the style, and it is the copy that will play.
        const { tool } = build({
            library: [{ title: 'Laid to Rest', artistName: 'Lamb of God', year: 2004 }],
            reached: [found('laid to rest', 'lamb of god'), found('Omerta', 'Lamb of God')],
        });

        const result = await run(tool, { query: 'Lamb of God' });

        expect(result.tracks).toHaveLength(2);
        expect(result.tracks[0]).toMatchObject({ title: 'Laid to Rest', owned: true });
        expect(result.tracks[1]).toMatchObject({ title: 'Omerta', owned: false });
    });

    it('marks a reached record the catalog holds as owned even when the library search missed it', async () => {
        const { tool } = build({
            reached: [found('Omerta', 'Lamb of God')],
            ownedKeys: [key('Omerta', 'Lamb of God')],
        });

        const result = await run(tool, { query: 'omerta' });

        expect(result.tracks[0]).toMatchObject({ owned: true });
    });

    it('drops a provider row for a record the operator disliked', async () => {
        const { tool } = build({ reached: [found('Numb', 'Linkin Park')], bannedKeys: [key('Numb', 'Linkin Park')] });

        expect((await run(tool, { query: 'Numb' })).tracks).toEqual([]);
    });

    it('drops a provider row by a disliked artist the station does not own at all', async () => {
        // The reason there are two reads: this record joins to no catalog row, so the ownership
        // query cannot see it, and `PickResolver` would drop it after the model spent a pick.
        const { tool } = build({ reached: [found('Seminole Wind', 'John Anderson')], bannedArtists: ['John Anderson'] });

        expect((await run(tool, { query: 'Seminole Wind' })).tracks).toEqual([]);
    });

    it('keeps room for the providers when the library could have filled the answer', async () => {
        // Without a reserve the merge is first-come, and a brief the library HALF matches never
        // shows the model what the station could get — the failure the merge exists to remove,
        // moved from the model's choice into the ordering.
        const library = Array.from({ length: 25 }, (_, index) => ({ title: `Track ${index}`, artistName: 'Metallica' }));
        const { tool } = build({ library, reached: [], settings: {} });
        const withProviders = build({
            library,
            reached: Array.from({ length: 25 }, (_, index) => found(`Reached ${index}`, 'Mitch Murder')),
            settings: { [MUSIC_SEARCH_KEYS.alwaysReach]: 'true' },
        });

        const alone = await run(tool, { query: 'Metallica' });
        const shared = await run(withProviders.tool, { query: 'Metallica' });

        // Nothing competing, so the library takes the whole answer.
        expect(alone.tracks).toHaveLength(25);
        expect(alone.tracks.every(row => row.owned === true)).toBe(true);
        // Something competing, so it is held to its share.
        expect(shared.tracks.filter(row => row.owned === true)).toHaveLength(15);
        expect(shared.tracks.filter(row => row.owned === false)).toHaveLength(10);
    });

    it('keeps that room in proportion when the model asks for fewer records', async () => {
        // The reserve was a fixed fifteen and so was inert for every small request: asked for five
        // records from a library that matched ten, the answer was five owned rows and the provider
        // half was never seen. The argument for the reserve does not get weaker because the caller
        // asked for fewer rows. Caught by watching a live refill call this with a small limit.
        const library = Array.from({ length: 10 }, (_, index) => ({ title: `Track ${index}`, artistName: 'Metallica' }));
        const { tool } = build({
            library,
            reached: Array.from({ length: 19 }, (_, index) => found(`Reached ${index}`, 'Mitch Murder')),
            settings: { [MUSIC_SEARCH_KEYS.alwaysReach]: 'true' },
        });

        const result = await run(tool, { query: 'anything', limit: 10 });

        expect(result.tracks).toHaveLength(10);
        expect(result.tracks.filter(row => row.owned === false).length).toBeGreaterThan(0);
    });

    it('answers with a usable number of records however few the model asked for', async () => {
        // The floor the ceiling never had. Measured: a briefed refill asked for `limit: 1` on three
        // consecutive searches, got exactly that, and answered with three records for a batch of
        // twenty-four. Nothing was wrong except that one row cannot fill an oversampled batch, which
        // is the whole reason the ceiling is 25 rather than 10.
        const { tool, searchPlayable } = build({ library: Array.from({ length: 20 }, (_, index) => ({ title: `T${index}`, artistName: 'A' })) });

        const result = await run(tool, { query: 'Miami Nights 1984', limit: 1 });

        expect(searchPlayable).toHaveBeenCalledWith('Miami Nights 1984', 10, false, {});
        expect(result.tracks).toHaveLength(10);
    });

    it('says so in the declaration, because a bound the model cannot see is one it walks into', async () => {
        const { tool } = build();
        const parameters = (await only(tool)).declaration.parameters as { properties: { limit: { description: string } } };

        expect(parameters.properties.limit.description).toMatch(/fewer than 10 still returns 10/i);
    });

    it('gives the library the slack when the providers found less than the room left over', async () => {
        const library = Array.from({ length: 25 }, (_, index) => ({ title: `Track ${index}`, artistName: 'Metallica' }));
        const { tool } = build({
            library,
            reached: [found('Prime Operator', 'Mitch Murder')],
            settings: { [MUSIC_SEARCH_KEYS.alwaysReach]: 'true' },
        });

        const result = await run(tool, { query: 'anything' });

        // Not fifteen: one provider row is competing, so the other twenty-four slots are the
        // library's rather than being held empty against a reserve nothing is claiming.
        expect(result.tracks).toHaveLength(25);
        expect(result.tracks.filter(row => row.owned === true)).toHaveLength(24);
    });

    it('marks a record the running order already holds, whichever half it came back from', async () => {
        // The fact the model could not otherwise get: the prompt's avoid list is capped at twelve
        // and the rest of it reaches the model as a COUNT, so a record in front of it may be one it
        // was told about and cannot see. Naming one costs a pick, since the resolver discards a
        // duplicate. Measured: two of the three Miami Nights 1984 rows handed to one refill were
        // already in the order.
        const { tool } = build({
            library: [{ title: 'Ocean Drive', artistName: 'Miami Nights 1984' }],
            reached: [found('Hurricane', 'Mitch Murder'), found('Prime Operator', 'Mitch Murder')],
            alreadyQueued: [
                ['Ocean Drive', 'Miami Nights 1984'],
                ['Hurricane', 'Mitch Murder'],
            ],
        });

        const result = await run(tool, { query: 'anything' });

        expect(result.tracks).toEqual([
            { title: 'Ocean Drive', artist: 'Miami Nights 1984', owned: true, queued: true },
            { title: 'Hurricane', artist: 'Mitch Murder', owned: false, queued: true },
            { title: 'Prime Operator', artist: 'Mitch Murder', owned: false },
        ]);
    });

    it('leaves the field off a record that is not queued rather than sending false', async () => {
        // Twenty-five `"queued":false` are context spent saying nothing.
        const { tool } = build({ library: [{ title: 'Ocean Drive', artistName: 'Miami Nights 1984' }] });

        const result = await run(tool, { query: 'anything' });

        expect(result.tracks[0]).not.toHaveProperty('queued');
    });

    it('marks rather than filters, so the model can see its own picks landed', async () => {
        // Dropping them would read as the library shrinking between two identical searches.
        const { tool } = build({
            library: [{ title: 'Ocean Drive', artistName: 'Miami Nights 1984' }],
            alreadyQueued: [['Ocean Drive', 'Miami Nights 1984']],
        });

        expect((await run(tool, { query: 'anything' })).tracks).toHaveLength(1);
    });

    it('marks nothing for a caller that is extending no running order', async () => {
        // A break writer shares this tool and is filling nothing. An empty holder is the ordinary
        // state rather than a gap.
        const { tool } = build({ library: [{ title: 'Ocean Drive', artistName: 'Miami Nights 1984' }] });

        expect((await run(tool, { query: 'anything' })).tracks[0]).not.toHaveProperty('queued');
    });

    it('says what queued means in the declaration, since the row alone is a bare flag', async () => {
        const { tool } = build();

        expect((await only(tool)).declaration.description).toMatch(/already in the running order/i);
    });

    it('narrows BOTH halves by a period, rather than only the providers', async () => {
        // The half this used to miss is the half the answer prefers. `ownedAllowance` reserves room
        // for library rows and they sort first, so an in-period provider half merged with an
        // any-period owned half puts the wrong decade at the top of the answer under the right name.
        const { tool, searchPlayable, search } = build({ reached: [found('Africa', 'TOTO')] });

        await run(tool, { query: 'synth', yearFrom: 1980, yearTo: 1989 });

        expect(searchPlayable).toHaveBeenCalledWith('synth', 25, false, { yearFrom: 1980, yearTo: 1989 });
        expect(search).toHaveBeenCalledWith('synth', { yearFrom: 1980, yearTo: 1989 }, 25);
    });

    it('searches the library for a period alone, which is a complete search', async () => {
        // It used to skip the library entirely here, on the reasoning that a number cannot narrow a
        // text match -- true of the text and false of the search, since a period is the whole
        // question. A station asked for "anything from the seventies" got only what a provider had.
        const { tool, searchPlayable } = build({ reached: [found('Africa', 'TOTO')] });

        await run(tool, { yearFrom: 1970, yearTo: 1979 });

        expect(searchPlayable).toHaveBeenCalledWith('', 25, false, { yearFrom: 1970, yearTo: 1979 });
    });

    it('seeds the library ordering with the broadcast on air', async () => {
        // Stable within a programme so a model searching twice does not read the library as having
        // changed; different between programmes so the same broad query is not answered with one
        // frozen slice of the library for good. Under `ModelSetGenerator` this search IS the draw.
        const { tool, searchPlayable } = build({ broadcastId: 'broadcast-7' });

        await run(tool, { query: 'rock' });

        expect(searchPlayable).toHaveBeenCalledWith('rock', 25, false, { seed: 'broadcast-7' });
    });

    it('sends no seed at all off air, rather than the word undefined', async () => {
        // A break writer's own search, a library scan, anything outside a broadcast. The repository's
        // parameter is optional and an absent seed is what it takes.
        const { tool, searchPlayable } = build();

        await run(tool, { query: 'rock' });

        expect(searchPlayable).toHaveBeenCalledWith('rock', 25, false, {});
    });

    it('reports a call with nothing to search on as something the model can correct', async () => {
        const { tool } = build();

        await expect((await only(tool)).run({})).rejects.toThrow(/query/);
    });

    it('narrows the library to clean copies when the station may play nothing else', async () => {
        const { tool, searchPlayable } = build({ settings: { [ADVISORY_KEY]: 'clean-only' } });

        await run(tool, { query: 'a' });

        expect(searchPlayable).toHaveBeenCalledWith('a', 25, true, {});
    });

    it('does not narrow for a mere preference, which is settled when the copy is chosen', async () => {
        const { tool, searchPlayable } = build({ settings: { [ADVISORY_KEY]: 'prefer-clean' } });

        await run(tool, { query: 'a' });

        expect(searchPlayable).toHaveBeenCalledWith('a', 25, false, {});
    });

    it('asks nothing of the catalog when nothing was reached', async () => {
        const library = Array.from({ length: 6 }, (_, index) => ({ title: `Track ${index}`, artistName: 'Metallica' }));
        const { tool, ownership, dislikedArtistKeys } = build({ library });

        await run(tool, { query: 'Metallica' });

        expect(ownership).not.toHaveBeenCalled();
        expect(dislikedArtistKeys).not.toHaveBeenCalled();
    });

    it('caps the limit rather than honouring a request for the whole library', async () => {
        const { tool, searchPlayable } = build();

        await run(tool, { query: 'a', limit: 400 });

        expect(searchPlayable).toHaveBeenCalledWith('a', 25, false, {});
    });

    // The other half of the wiring `SearchedRecords` exists for: a refill can only fall back to what
    // it was shown if the tool wrote it down as it answered. Nothing here reads it back — that is
    // `ModelSetGenerator`'s job — so what is asserted is only that the rows arrive.
    it('keeps what it answered with, so a refill whose model goes quiet has something to play', async () => {
        const library = [
            { title: 'Miami Nights', artistName: 'Mitch Murder' },
            { title: 'Accelerated', artistName: 'Lost Years' },
        ];
        const { tool, searched } = build({ library });

        await run(tool, { query: 'Mitch Murder' });

        expect(searched.all()).toEqual([
            { title: 'Miami Nights', artist: 'Mitch Murder' },
            { title: 'Accelerated', artist: 'Lost Years' },
        ]);
    });

    it('counts a record answered by two searches once', async () => {
        const library = [{ title: 'Miami Nights', artistName: 'Mitch Murder' }];
        const { tool, searched } = build({ library });

        await run(tool, { query: 'Mitch Murder' });
        await run(tool, { query: 'Miami Nights' });

        expect(searched.size).toBe(1);
    });
});
