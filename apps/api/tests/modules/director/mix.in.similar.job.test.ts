// A playlist mixing in its neighbours, found after it goes on air and posted as one command. What
// matters: each record is found from one of the playlist's own records and names it as its anchor;
// nothing is paid for on behalf of a broadcast that has ended; every pick goes through the resolver
// with the broadcast's rules; and an operator who asked and got nothing is told why.

import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';
import type { Container } from 'injectkit';
import type { JobContext } from '@maroonedsoftware/jobbroker';
import type { ArtistTrack, SimilarArtist } from '@deadair/plugin-sdk';
import { DateTime } from 'luxon';

import { anchorsOf, MAX_MIX_INS, MixInSimilarJob } from '../../../src/modules/director/mix.in.similar.job.js';
import { SimilarPicker } from '../../../src/modules/director/similar.picker.js';
import { StationLineup, isTrackItem, type StationLineupMode, type StationLineupTrackItem } from '../../../src/modules/director/station.lineup.js';
import type { StationLineupRepository } from '../../../src/modules/director/station.lineup.repository.js';
import type { DirectorService } from '../../../src/modules/director/director.service.js';
import type { DirectorCommand } from '../../../src/modules/director/director.mailbox.js';
import type { PickResolver } from '../../../src/modules/director/pick.resolver.js';
import type { PlayHistoryRepository } from '../../../src/modules/director/play.history.repository.js';
import { ROTATION_KEYS, type ResolvedRules } from '../../../src/modules/director/rotation.rules.js';
import { songKey } from '../../../src/modules/director/rotation.keys.js';
import type { TrackPick } from '../../../src/modules/director/set.generator.js';
import type { SimilarityService } from '../../../src/modules/similarity/similarity.service.js';
import { StationIdentity } from '../../../src/modules/shared/station.identity.js';
import type { RundownTrack } from '../../../src/modules/playout/rundown.js';
import type { ActivityRecorder } from '../../../src/modules/activity/activity.recorder.js';
import type { StationEvent } from '../../../src/modules/activity/station.events.repository.js';
import { settingsConfig } from '../../utils/settings.config.js';

vi.mock('../../../src/modules/jobs/job.authorization.js', () => ({ overrideJobActor: vi.fn() }));

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;
const context = { id: 'job-1' } as unknown as JobContext;
const container = {} as unknown as Container;

const track = (title: string, artist: string): RundownTrack => ({
    pluginId: 'deadair.spotify',
    externalId: `ext-${title}`,
    title,
    artists: [artist],
    artist,
});

/** A playlist of `count` records, each by its own artist: `P0` by `Artist0`, and so on. */
const playlist = (count: number): RundownTrack[] => Array.from({ length: count }, (_, index) => track(`P${index}`, `Artist${index}`));

interface Options {
    mode?: StationLineupMode;
    /** The broadcast's own rules. Absent asks for a mix, which is what the director sent this for. */
    mixInSimilar?: boolean;
    settings?: Record<string, string>;
    records?: RundownTrack[];
    hasSimilarity?: boolean;
    canNameTracks?: boolean;
    /** Records like one record, by anchor title. Absent is a plugin that answers about artists only. */
    similarTracks?: (title: string) => ArtistTrack[];
    /** What the resolver keeps, by pick. Defaults to every pick, as a record by the name it was asked for. */
    resolvable?: (picks: readonly TrackPick[]) => RundownTrack[];
    /** A neighbour per seed artist. Defaults to `Near<seed>`, whose one record is `Like <seed>`. */
    similar?: (seed: string) => SimilarArtist[];
    /** A neighbour's records. Defaults to one, `Like <seed>`, named for the artist it was found from. */
    tracks?: (neighbour: string) => ArtistTrack[];
    lastAired?: Map<string, DateTime>;
}

function build(options: Options = {}) {
    const station = settingsConfig({ [ROTATION_KEYS.mixInEvery]: '2', ...options.settings });
    const lineup = new StationLineup({
        name: 'A Playlist',
        mode: options.mode ?? 'rotation',
        onEnd: 'extend',
        source: 'import',
        ...(options.mixInSimilar === false ? {} : { rules: { mixInSimilar: true } }),
    });
    lineup.replaceFrom(options.records ?? playlist(6));

    const lineups = { load: vi.fn(async () => lineup) } as unknown as StationLineupRepository;

    const similarTo = vi.fn(async (ref: { name: string }) => (options.similar ? options.similar(ref.name) : [{ name: `Near${ref.name}` }]));
    const topTracks = vi.fn(async (ref: { name: string }): Promise<ArtistTrack[]> =>
        options.tracks ? options.tracks(ref.name) : [{ title: `Like ${ref.name.replace(/^Near/, '')}`, artist: ref.name }],
    );
    const similarity = {
        hasSimilarity: () => options.hasSimilarity ?? true,
        canNameTracks: () => options.canNameTracks ?? true,
        canNameSimilarTracks: () => options.similarTracks !== undefined,
        similarTracks: vi.fn(async (ref: { title: string }) => options.similarTracks?.(ref.title) ?? []),
        similarTo,
        topTracks,
    } as unknown as SimilarityService;

    const lastAiredSince = vi.fn(async () => options.lastAired ?? new Map<string, DateTime>());
    const history = { lastAiredSince } as unknown as PlayHistoryRepository;

    const resolve = vi.fn(async (picks: readonly TrackPick[], _rules: ResolvedRules, _options: object) =>
        options.resolvable ? options.resolvable(picks) : picks.map(pick => track(pick.title, pick.artist)),
    );
    const resolver = { resolve } as unknown as PickResolver;

    // The one writer, applying the command the way the real director does, so the assertions below
    // are about the running order rather than about a mock call.
    const posted: DirectorCommand[] = [];
    const director = {
        post: vi.fn(async (command: DirectorCommand) => {
            posted.push(command);
            if (command.kind === 'interleaveTracks') lineup.interleave(command.inserts);
            return undefined;
        }),
    } as unknown as DirectorService;

    const recorded: StationEvent[] = [];
    const activity = { record: vi.fn(async (event: StationEvent) => void recorded.push(event)) } as unknown as ActivityRecorder;

    const job = new MixInSimilarJob(
        lineups,
        similarity,
        new SimilarPicker(similarity),
        history,
        new StationIdentity(),
        resolver,
        director,
        activity,
        station.config,
        context,
        container,
        logger,
    );

    return { job, lineup, similarTo, resolve, posted: () => posted, recorded: () => recorded };
}

const titles = (lineup: StationLineup) =>
    lineup
        .all()
        .filter(isTrackItem)
        .map(item => item.track.title);

describe('MixInSimilarJob', () => {
    it('mixes a neighbour in after every Nth record, found from the record it follows', async () => {
        const { job, lineup, similarTo } = build();

        await job.run({ broadcastId: lineup.broadcastId });

        expect(titles(lineup)).toEqual(['P0', 'P1', 'Like Artist1', 'P2', 'P3', 'Like Artist3', 'P4', 'P5', 'Like Artist5']);
        // Seeded from the playlist's own records, never from what aired: see the job's header.
        expect(similarTo.mock.calls.map(call => call[0].name)).toEqual(['Artist1', 'Artist3', 'Artist5']);
        expect(
            lineup
                .all()
                .filter(isTrackItem)
                .filter(item => item.mixedIn),
        ).toHaveLength(3);
    });

    it("posts one command naming each record's anchor", async () => {
        const { job, lineup, posted } = build();
        const anchorId = (title: string) =>
            lineup
                .all()
                .filter(isTrackItem)
                .find(item => item.track.title === title)!.id;
        const expected = ['P1', 'P3', 'P5'].map(anchorId);

        await job.run({ broadcastId: lineup.broadcastId });

        expect(posted()).toHaveLength(1);
        const command = posted()[0]!;
        expect(command.kind === 'interleaveTracks' ? command.inserts.map(insert => insert.afterItemId) : []).toEqual(expected);
        expect(command).toMatchObject({ broadcastId: lineup.broadcastId });
    });

    it("resolves every pick with the broadcast's own rules, in one pass", async () => {
        const { job, lineup, resolve } = build();

        await job.run({ broadcastId: lineup.broadcastId });

        expect(resolve).toHaveBeenCalledOnce();
        expect(resolve.mock.calls[0]![1]).toMatchObject({ mixInSimilar: true, mayGenerate: true });
        expect(resolve.mock.calls[0]![2]).toMatchObject({ keepOrder: true, discoveries: 3 });
    });

    it('drops what the resolver would not play, and anything that comes back under a different name', async () => {
        const { job, lineup } = build({
            resolvable: picks => [
                // Kept: the name it was asked for.
                track(picks[0]!.title, picks[0]!.artist),
                // Dropped: no pick went looking for this, so there is no anchor to put it after.
                track('Something Else', 'Somebody'),
            ],
        });

        await job.run({ broadcastId: lineup.broadcastId });

        expect(titles(lineup)).toEqual(['P0', 'P1', 'Like Artist1', 'P2', 'P3', 'P4', 'P5']);
    });

    it('passes over a neighbour who is already on the playlist', async () => {
        // Artist1's neighbour is Artist4, who plays later anyway: mixing them in is a wasted insert.
        const { job, lineup } = build({ similar: seed => (seed === 'Artist1' ? [{ name: 'Artist4' }, { name: 'Elsewhere' }] : []) });

        await job.run({ broadcastId: lineup.broadcastId });

        expect(titles(lineup)).toContain('Like Elsewhere');
        expect(titles(lineup).filter(title => title.startsWith('Like'))).toEqual(['Like Elsewhere']);
    });

    it('skips before calling anything upstream when the broadcast it was asked for has ended', async () => {
        const { job, similarTo, resolve, posted } = build();

        await job.run({ broadcastId: 'a-broadcast-that-ended' });
        await job.run({});

        expect(similarTo).not.toHaveBeenCalled();
        expect(resolve).not.toHaveBeenCalled();
        expect(posted()).toEqual([]);
    });

    it('mixes nothing into a setlist, whatever it asks', async () => {
        const { job, lineup, similarTo } = build({ mode: 'setlist' });

        await job.run({ broadcastId: lineup.broadcastId });

        expect(similarTo).not.toHaveBeenCalled();
        expect(titles(lineup)).toEqual(['P0', 'P1', 'P2', 'P3', 'P4', 'P5']);
    });

    it('does nothing for a rotation that never asked', async () => {
        const { job, lineup, similarTo } = build({ mixInSimilar: false });

        await job.run({ broadcastId: lineup.broadcastId });

        expect(similarTo).not.toHaveBeenCalled();
    });

    it('takes the station setting when the broadcast said nothing', async () => {
        const { job, lineup, posted } = build({ mixInSimilar: false, settings: { [ROTATION_KEYS.mixInSimilar]: 'true' } });

        await job.run({ broadcastId: lineup.broadcastId });

        expect(posted()).toHaveLength(1);
    });

    it('tells the operator when nothing installed can name records, rather than playing the list as if unasked', async () => {
        const { job, lineup, recorded, similarTo } = build({ canNameTracks: false });

        await job.run({ broadcastId: lineup.broadcastId });

        expect(similarTo).not.toHaveBeenCalled();
        expect(recorded()).toEqual([
            expect.objectContaining({ kind: 'order.mixInEmpty', severity: 'warn', data: expect.objectContaining({ reason: 'no-similarity' }) }),
        ]);
    });

    it('says how many it found, and warns when every one was refused', async () => {
        const found = build();
        await found.job.run({ broadcastId: found.lineup.broadcastId });
        expect(found.recorded()).toEqual([expect.objectContaining({ kind: 'order.mixedIn', data: expect.objectContaining({ sent: 3 }) })]);

        const refused = build({ resolvable: () => [] });
        await refused.job.run({ broadcastId: refused.lineup.broadcastId });
        expect(refused.posted()).toEqual([]);
        expect(refused.recorded()).toEqual([
            expect.objectContaining({ kind: 'order.mixInEmpty', severity: 'warn', data: expect.objectContaining({ named: 3, resolved: 0 }) }),
        ]);
    });

    it("leans each walk toward a neighbour's record that has not aired lately", async () => {
        const { job, lineup } = build({
            records: playlist(2),
            similar: () => [{ name: 'Tricky' }],
            // Two records by the neighbour, the first aired an hour ago.
            tracks: () => [
                { title: 'Karmacoma', artist: 'Tricky' },
                { title: 'Overcome', artist: 'Tricky' },
            ],
            lastAired: new Map([[songKey('Karmacoma', ['Tricky']), DateTime.utc().minus({ hours: 1 })]]),
        });

        await job.run({ broadcastId: lineup.broadcastId });

        expect(titles(lineup)).toEqual(['P0', 'P1', 'Overcome']);
    });
});

describe('MixInSimilarJob with a plugin that can answer about one record', () => {
    it('mixes in a record like the anchor itself, and walks the artist where that has nothing', async () => {
        const { job, lineup, similarTo } = build({
            similarTracks: title => (title === 'P1' ? [{ title: 'Like P1 Itself', artist: 'Elsewhere' }] : []),
        });

        await job.run({ broadcastId: lineup.broadcastId });

        expect(titles(lineup)).toEqual(['P0', 'P1', 'Like P1 Itself', 'P2', 'P3', 'Like Artist3', 'P4', 'P5', 'Like Artist5']);
        // The artist walk only for the two anchors the record-level answer left empty.
        expect(similarTo.mock.calls.map(call => call[0].name)).toEqual(['Artist3', 'Artist5']);
    });

    it('works with only the record-level answer, where nothing can name records by an artist', async () => {
        const { job, lineup, recorded } = build({
            canNameTracks: false,
            similarTracks: title => [{ title: `Like ${title}`, artist: `Near ${title}` }],
        });

        await job.run({ broadcastId: lineup.broadcastId });

        expect(titles(lineup).filter(title => title.startsWith('Like'))).toEqual(['Like P1', 'Like P3', 'Like P5']);
        expect(recorded()).toEqual([expect.objectContaining({ kind: 'order.mixedIn' })]);
    });
});

describe('anchorsOf', () => {
    const items = (count: number): StationLineupTrackItem[] => {
        const lineup = new StationLineup({ name: 'x', mode: 'rotation', onEnd: 'extend', source: 'import' });
        lineup.replaceFrom(playlist(count));
        return lineup.all().filter(isTrackItem);
    };

    it('takes every Nth planned record, the first after N of them', () => {
        expect(anchorsOf(items(7), 3).map(item => item.track.title)).toEqual(['P2', 'P5']);
    });

    it('passes over records already with the player, and records mixed in before', () => {
        const all = items(6);
        all[0]!.state = 'handed';
        all[2]!.mixedIn = true;

        expect(anchorsOf(all, 2).map(item => item.track.title)).toEqual(['P3', 'P5']);
    });

    it('stops at the cap however long the playlist', () => {
        expect(anchorsOf(items(200), 1)).toHaveLength(MAX_MIX_INS);
    });

    it('takes none at a spacing below one', () => {
        expect(anchorsOf(items(5), 0)).toEqual([]);
    });
});
