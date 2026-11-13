// The binding that plays a festival show's bill. What is asserted: it takes the acts off air longest
// first, headliners no more than anybody else, takes only its share, skips an act the cooldown holds, and
// steps aside for a show with no festival, a festival that is gone, or a station that cannot name records.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@maroonedsoftware/appconfig';
import type { Logger } from '@maroonedsoftware/logger';
import type { ArtistTrack } from '@deadair/plugin-sdk';
import { DateTime } from 'luxon';

import {
    DEFAULT_FESTIVAL_MIX,
    FESTIVAL_KEYS,
    FestivalSetGenerator,
    orderBillByNeglect,
} from '../../../src/modules/director/festival.set.generator.js';
import type { FestivalBill } from '../../../src/modules/director/festival.bill.js';
import { SimilarPicker } from '../../../src/modules/director/similar.picker.js';
import type { SimilarityService } from '../../../src/modules/similarity/similarity.service.js';
import type { PlayHistoryRepository } from '../../../src/modules/director/play.history.repository.js';
import { DEFAULT_RULES } from '../../../src/modules/director/rotation.rules.js';
import { artistKey } from '../../../src/modules/director/rotation.keys.js';
import type { SetInputs } from '../../../src/modules/director/set.generator.js';
import type { Festival } from '../../../src/modules/schedule/festival.rules.js';
import { StationIdentity } from '../../../src/modules/shared/station.identity.js';

const FESTIVAL: Festival = {
    id: 'f1',
    name: 'Shaky Knees',
    startsOn: '2027-05-07',
    endsOn: '2027-05-09',
    acts: [
        { artist: 'Foo Fighters', headliner: true },
        { artist: 'The Struts', headliner: false },
        { artist: 'Wet Leg', headliner: false },
        { artist: 'Fontaines D.C.', headliner: false },
    ],
};

interface Options {
    settings?: Record<string, string>;
    canNameTracks?: boolean;
    festival?: Festival;
    lastAiredByArtist?: Map<string, DateTime>;
}

function build(options: Options = {}) {
    const settings: Record<string, string> = { ...options.settings };
    const config = { get: vi.fn((key: string, fallback?: unknown) => (key in settings ? settings[key] : fallback)) } as unknown as AppConfig;

    const topTracks = vi.fn(async (ref: { name: string }, _limit: number): Promise<ArtistTrack[]> => [
        { title: `${ref.name} Song`, artist: ref.name },
    ]);
    const similarity = { canNameTracks: () => options.canNameTracks ?? true, topTracks, similarTo: vi.fn() } as unknown as SimilarityService;
    const of = vi.fn(async (id: string | undefined) => (id === 'f1' ? (options.festival ?? FESTIVAL) : undefined));
    const history = {
        lastAiredSince: vi.fn(async () => new Map<string, DateTime>()),
        lastAiredByArtist: vi.fn(async () => options.lastAiredByArtist ?? new Map<string, DateTime>()),
    };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

    return {
        generator: new FestivalSetGenerator(
            { of } as unknown as FestivalBill,
            similarity,
            new SimilarPicker(similarity),
            history as unknown as PlayHistoryRepository,
            new StationIdentity(),
            config,
            logger as unknown as Logger,
        ),
        of,
        topTracks,
        logger,
    };
}

const inputs = (overrides: Partial<SetInputs> = {}): SetInputs => ({ count: 10, rules: DEFAULT_RULES, festivalId: 'f1', ...overrides });

beforeEach(() => {
    vi.clearAllMocks();
});

describe('FestivalSetGenerator', () => {
    it('is on by default, and takes more of a show than a brief does', () => {
        expect(DEFAULT_FESTIVAL_MIX).toBeGreaterThan(0.4);
    });

    it('takes the acts off air longest first, one record each, for its share', async () => {
        const { generator } = build({
            lastAiredByArtist: new Map([
                [artistKey(['Foo Fighters']), DateTime.utc().minus({ days: 1 })],
                [artistKey(['The Struts']), DateTime.utc().minus({ days: 9 })],
            ]),
        });

        // A share of 0.6 of four is two: never aired first (Wet Leg, Fontaines D.C., in the bill's order).
        const picks = await generator.generate(inputs({ count: 4 }));

        expect(picks.map(pick => pick.artist)).toEqual(['Wet Leg', 'Fontaines D.C.']);
    });

    it('reaches the whole bill when its share is large enough', async () => {
        const { generator } = build({ settings: { [FESTIVAL_KEYS.mix]: '1' } });

        const picks = await generator.generate(inputs({ count: 10 }));

        expect(picks.map(pick => pick.artist)).toEqual(['Foo Fighters', 'The Struts', 'Wet Leg', 'Fontaines D.C.']);
    });

    it('skips an act the cooldown holds', async () => {
        const { generator } = build({
            settings: { [FESTIVAL_KEYS.mix]: '1' },
            lastAiredByArtist: new Map([[artistKey(['Wet Leg']), DateTime.utc().minus({ minutes: 5 })]]),
        });

        const picks = await generator.generate(inputs({ rules: { ...DEFAULT_RULES, artistCooldownMinutes: 60 } }));

        expect(picks.map(pick => pick.artist)).not.toContain('Wet Leg');
    });

    it('steps aside for a show with no festival, or one that is gone', async () => {
        const { generator, of } = build();

        expect(await generator.generate(inputs({ festivalId: undefined }))).toEqual([]);
        expect(of).not.toHaveBeenCalled();
        expect(await generator.generate(inputs({ festivalId: 'gone' }))).toEqual([]);
    });

    it('steps aside when its share is off, read as the string a setting is', async () => {
        const { generator, of } = build({ settings: { [FESTIVAL_KEYS.mix]: '0' } });

        expect(await generator.generate(inputs())).toEqual([]);
        expect(of).not.toHaveBeenCalled();
    });

    it("steps aside, and says so once, when nothing can name an artist's records", async () => {
        const { generator, logger } = build({ canNameTracks: false });

        expect(await generator.generate(inputs())).toEqual([]);
        await generator.generate(inputs());

        expect(logger.info).toHaveBeenCalledTimes(1);
    });
});

describe('orderBillByNeglect', () => {
    it("puts the never aired first and keeps the bill's order between them, headliners included", () => {
        const ordered = orderBillByNeglect([
            { name: 'Headliner', artistKey: 'headliner', lastAiredAt: DateTime.utc().minus({ hours: 1 }) },
            { name: 'Opener', artistKey: 'opener' },
            { name: 'Second', artistKey: 'second' },
            { name: 'Old', artistKey: 'old', lastAiredAt: DateTime.utc().minus({ days: 30 }) },
        ]);

        expect(ordered.map(act => act.name)).toEqual(['Opener', 'Second', 'Old', 'Headliner']);
    });
});
