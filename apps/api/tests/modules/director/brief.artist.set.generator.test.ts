// The binding that reads the whole of a brief that names its acts. Measured on the live station,
// 2026-10-11: The Boneyard's brief names twenty-four acts and the model only ever reached the top of
// it. So what is asserted is that this takes the neglected acts first, takes only its share, skips an
// act the cooldown holds, and steps aside wherever it has nothing to offer.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@maroonedsoftware/appconfig';
import type { Logger } from '@maroonedsoftware/logger';
import type { ArtistTrack } from '@deadair/plugin-sdk';
import { DateTime } from 'luxon';

import { BRIEF_ARTIST_KEYS, BriefArtistSetGenerator, DEFAULT_BRIEF_ARTIST_MIX } from '../../../src/modules/director/brief.artist.set.generator.js';
import type { BriefArtist, BriefArtists } from '../../../src/modules/director/brief.artists.js';
import { SimilarPicker } from '../../../src/modules/director/similar.picker.js';
import type { SimilarityService } from '../../../src/modules/similarity/similarity.service.js';
import type { PlayHistoryRepository } from '../../../src/modules/director/play.history.repository.js';
import { DEFAULT_RULES } from '../../../src/modules/director/rotation.rules.js';
import { artistKey, songKey } from '../../../src/modules/director/rotation.keys.js';
import type { SetInputs } from '../../../src/modules/director/set.generator.js';
import { StationIdentity } from '../../../src/modules/shared/station.identity.js';

const BRIEF = 'Thrash: Metallica, Kreator, Sodom. Death: Obituary, Behemoth.';

/** The acts in the brief, longest off air first, as `BriefArtists` would answer. */
const NAMED: BriefArtist[] = [
    { name: 'Behemoth', artistKey: 'behemoth' },
    { name: 'Obituary', artistKey: 'obituary', lastAiredAt: DateTime.utc().minus({ days: 9 }) },
    { name: 'Sodom', artistKey: 'sodom', lastAiredAt: DateTime.utc().minus({ days: 3 }) },
    { name: 'Kreator', artistKey: 'kreator', lastAiredAt: DateTime.utc().minus({ hours: 5 }) },
    { name: 'Metallica', artistKey: 'metallica', lastAiredAt: DateTime.utc().minus({ minutes: 10 }) },
];

interface Options {
    settings?: Record<string, unknown>;
    canNameTracks?: boolean;
    named?: BriefArtist[];
    tracks?: Record<string, ArtistTrack[]>;
    lastAired?: Map<string, DateTime>;
}

function build(options: Options = {}) {
    const settings: Record<string, unknown> = { ...options.settings };
    const config = { get: vi.fn((key: string, fallback?: unknown) => (key in settings ? settings[key] : fallback)) } as unknown as AppConfig;

    const topTracks = vi.fn(
        async (ref: { name: string }, _limit: number): Promise<ArtistTrack[]> =>
            options.tracks?.[ref.name] ?? [{ title: `${ref.name} Song`, artist: ref.name }],
    );
    const similarity = { canNameTracks: () => options.canNameTracks ?? true, topTracks, similarTo: vi.fn() } as unknown as SimilarityService;
    const named = vi.fn(async () => options.named ?? NAMED);
    const lastAiredSince = vi.fn(async () => options.lastAired ?? new Map<string, DateTime>());
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

    return {
        generator: new BriefArtistSetGenerator(
            { named } as unknown as BriefArtists,
            similarity,
            new SimilarPicker(similarity),
            { lastAiredSince } as unknown as PlayHistoryRepository,
            new StationIdentity(),
            config,
            logger as unknown as Logger,
        ),
        named,
        topTracks,
        logger,
    };
}

const inputs = (overrides: Partial<SetInputs> = {}): SetInputs => ({ count: 10, rules: DEFAULT_RULES, brief: BRIEF, ...overrides });

beforeEach(() => {
    vi.clearAllMocks();
});

describe('BriefArtistSetGenerator', () => {
    it('is on by default', () => {
        expect(DEFAULT_BRIEF_ARTIST_MIX).toBeGreaterThan(0);
    });

    it('takes one record from each neglected act, longest off air first, and only its share of the batch', async () => {
        const { generator } = build();

        const picks = await generator.generate(inputs({ count: 10 }));

        // 0.4 of ten is four, and Metallica aired inside the cooldown, so it is never reached.
        expect(picks).toEqual([
            { title: 'Behemoth Song', artist: 'Behemoth' },
            { title: 'Obituary Song', artist: 'Obituary' },
            { title: 'Sodom Song', artist: 'Sodom' },
            { title: 'Kreator Song', artist: 'Kreator' },
        ]);
    });

    it('reads the share as the string a setting is', async () => {
        const { generator } = build({ settings: { [BRIEF_ARTIST_KEYS.mix]: '0.2' } });

        expect(await generator.generate(inputs({ count: 10 }))).toHaveLength(2);
    });

    it('skips an act the cooldown holds, aired or queued, rather than spend a slot on a record that will be dropped', async () => {
        const { generator, topTracks } = build();

        const picks = await generator.generate(inputs({ count: 25, queuedArtistKeys: new Set([artistKey(['Sodom'])]) }));

        expect(picks.map(pick => pick.artist)).toEqual(['Behemoth', 'Obituary', 'Kreator']);
        expect(topTracks).not.toHaveBeenCalledWith(expect.objectContaining({ name: 'Metallica' }), expect.anything());
    });

    it('never names a record the running order already holds', async () => {
        const { generator } = build({
            tracks: {
                Behemoth: [
                    { title: 'Ov Fire and the Void', artist: 'Behemoth' },
                    { title: 'Conquer All', artist: 'Behemoth' },
                ],
            },
        });

        const picks = await generator.generate(inputs({ count: 2, avoidSongKeys: new Set([songKey('Ov Fire and the Void', ['Behemoth'])]) }));

        expect(picks[0]).toEqual({ title: 'Conquer All', artist: 'Behemoth' });
    });

    it('steps aside with no brief, with the share at 0, and when the brief names nobody', async () => {
        expect(await build().generator.generate(inputs({ brief: undefined }))).toEqual([]);
        expect(await build({ settings: { [BRIEF_ARTIST_KEYS.mix]: '0' } }).generator.generate(inputs())).toEqual([]);
        expect(await build({ named: [] }).generator.generate(inputs())).toEqual([]);
    });

    it('says once that nothing can name an artist’s records, and leaves the brief to the model', async () => {
        const { generator, logger, named } = build({ canNameTracks: false });

        expect(await generator.generate(inputs())).toEqual([]);
        expect(await generator.generate(inputs())).toEqual([]);

        expect(logger.info).toHaveBeenCalledTimes(1);
        expect(named).not.toHaveBeenCalled();
    });

    it('keeps what it found when a lookup throws part way', async () => {
        const { generator, topTracks, logger } = build();
        topTracks
            .mockImplementationOnce(async ref => [{ title: `${ref.name} Song`, artist: ref.name }])
            .mockRejectedValueOnce(new Error('rate limited'));

        const picks = await generator.generate(inputs());

        expect(picks).toEqual([{ title: 'Behemoth Song', artist: 'Behemoth' }]);
        expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/stopped early/));
    });
});
