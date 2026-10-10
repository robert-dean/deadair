// A request show following a listener's request with records like it, found after the request is
// placed and posted as one command. What matters: the run is found from the request itself; it
// replaces what was planned behind the request and nothing in front of it; nothing is paid for on
// behalf of a broadcast that has ended, a show that is not a request show, or a request a newer one
// has overtaken; every pick goes through the resolver; and a run that came to nothing says why.

import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';
import type { Container } from 'injectkit';
import type { JobContext } from '@maroonedsoftware/jobbroker';
import type { ArtistTrack } from '@deadair/plugin-sdk';
import { DateTime } from 'luxon';

import { FollowRequestJob } from '../../../src/modules/director/follow.request.job.js';
import { SimilarPicker } from '../../../src/modules/director/similar.picker.js';
import { StationLineup, isTrackItem, type StationLineupRules } from '../../../src/modules/director/station.lineup.js';
import type { StationLineupRepository } from '../../../src/modules/director/station.lineup.repository.js';
import type { DirectorService } from '../../../src/modules/director/director.service.js';
import type { DirectorCommand } from '../../../src/modules/director/director.mailbox.js';
import type { PickResolver } from '../../../src/modules/director/pick.resolver.js';
import type { PlayHistoryRepository } from '../../../src/modules/director/play.history.repository.js';
import type { ResolvedRules } from '../../../src/modules/director/rotation.rules.js';
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

/** Records like the request, each by its own artist: `Like0` by `Near0`, and so on. */
const alike = (count: number): ArtistTrack[] => Array.from({ length: count }, (_, index) => ({ title: `Like${index}`, artist: `Near${index}` }));

interface Options {
    rules?: StationLineupRules;
    hasSimilarity?: boolean;
    /** Records like one record. Absent is a plugin that answers about artists only. */
    similarTracks?: ArtistTrack[];
    /** What the resolver keeps. Defaults to every pick. */
    resolvable?: (picks: readonly TrackPick[]) => RundownTrack[];
}

function build(options: Options = {}) {
    const station = settingsConfig({});
    const lineup = new StationLineup({
        name: 'Requests',
        mode: 'rotation',
        onEnd: 'extend',
        source: 'director',
        rules: options.rules ?? { requestShow: true },
    });
    lineup.replaceFrom(Array.from({ length: 6 }, (_, index) => track(`C${index}`, `Catalog${index}`)));
    lineup.insertRequested(track('Asked For', 'Somebody Loved'), 'req-1');

    const lineups = { load: vi.fn(async () => lineup) } as unknown as StationLineupRepository;

    const similarTracks = vi.fn(async () => options.similarTracks ?? []);
    const similarTo = vi.fn(async (ref: { name: string }) => [{ name: `Near${ref.name}` }]);
    const topTracks = vi.fn(async (ref: { name: string }): Promise<ArtistTrack[]> => [{ title: `Like ${ref.name}`, artist: ref.name }]);
    const similarity = {
        hasSimilarity: () => options.hasSimilarity ?? true,
        canNameTracks: () => true,
        canNameSimilarTracks: () => options.similarTracks !== undefined,
        similarTracks,
        similarTo,
        topTracks,
    } as unknown as SimilarityService;

    const history = { lastAiredSince: vi.fn(async () => new Map<string, DateTime>()) } as unknown as PlayHistoryRepository;

    const resolve = vi.fn(async (picks: readonly TrackPick[], _rules: ResolvedRules, _options: object) =>
        options.resolvable ? options.resolvable(picks) : picks.map(pick => track(pick.title, pick.artist)),
    );
    const resolver = { resolve } as unknown as PickResolver;

    // The one writer, applying the command the way the real director does.
    const posted: DirectorCommand[] = [];
    const director = {
        post: vi.fn(async (command: DirectorCommand) => {
            posted.push(command);
            if (command.kind === 'followRequest') lineup.followRequest(command.requestId, command.tracks);
            return undefined;
        }),
    } as unknown as DirectorService;

    const recorded: StationEvent[] = [];
    const activity = { record: vi.fn(async (event: StationEvent) => void recorded.push(event)) } as unknown as ActivityRecorder;

    const job = new FollowRequestJob(
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

    return { job, lineup, similarTracks, similarTo, resolve, posted: () => posted, recorded: () => recorded };
}

const titles = (lineup: StationLineup) =>
    lineup
        .all()
        .filter(isTrackItem)
        .map(item => item.track.title);

describe('FollowRequestJob', () => {
    it('replaces what was planned behind the request with records like it', async () => {
        const { job, lineup, similarTracks } = build({ similarTracks: alike(8) });

        await job.run({ broadcastId: lineup.broadcastId, requestId: 'req-1' });

        expect(titles(lineup)).toEqual(['C0', 'Asked For', 'Like0', 'Like1', 'Like2', 'Like3']);
        // Seeded from the request, and asked once for the whole run.
        expect(similarTracks).toHaveBeenCalledTimes(1);
        expect(similarTracks).toHaveBeenCalledWith({ artist: 'Somebody Loved', title: 'Asked For' }, expect.any(Number));
    });

    it('follows with as many records as the show asked for', async () => {
        const { job, lineup } = build({ rules: { requestShow: true, requestFollowOn: 2 }, similarTracks: alike(8) });

        await job.run({ broadcastId: lineup.broadcastId, requestId: 'req-1' });

        expect(titles(lineup)).toEqual(['C0', 'Asked For', 'Like0', 'Like1']);
    });

    it("walks from the request's artist when no plugin can answer about the record", async () => {
        const { job, lineup, similarTo } = build({ rules: { requestShow: true, requestFollowOn: 1 } });

        await job.run({ broadcastId: lineup.broadcastId, requestId: 'req-1' });

        expect(similarTo.mock.calls.map(call => call[0].name)).toEqual(['Somebody Loved']);
        expect(titles(lineup)).toEqual(['C0', 'Asked For', 'Like NearSomebody Loved']);
    });

    it("resolves the run with the broadcast's rules, in order", async () => {
        const { job, lineup, resolve } = build({ similarTracks: alike(8) });

        await job.run({ broadcastId: lineup.broadcastId, requestId: 'req-1' });

        expect(resolve).toHaveBeenCalledTimes(1);
        expect(resolve.mock.calls[0]![2]).toMatchObject({ keepOrder: true, broadcast: { mode: 'rotation' } });
    });

    it('posts nothing, and says so, when nothing survives the rules', async () => {
        const { job, lineup, posted, recorded } = build({ similarTracks: alike(8), resolvable: () => [] });
        const before = titles(lineup);

        await job.run({ broadcastId: lineup.broadcastId, requestId: 'req-1' });

        expect(posted()).toEqual([]);
        expect(titles(lineup)).toEqual(before);
        expect(recorded()).toEqual([expect.objectContaining({ kind: 'order.followRequestEmpty', severity: 'warn' })]);
    });

    it('says so when no similarity plugin can name records', async () => {
        const { job, lineup, posted, recorded } = build({ hasSimilarity: false });

        await job.run({ broadcastId: lineup.broadcastId, requestId: 'req-1' });

        expect(posted()).toEqual([]);
        expect(recorded()).toEqual([
            expect.objectContaining({ kind: 'order.followRequestEmpty', data: expect.objectContaining({ reason: 'no-similarity' }) }),
        ]);
    });

    it('pays for nothing on behalf of a broadcast that has ended', async () => {
        const { job, similarTracks, posted } = build({ similarTracks: alike(8) });

        await job.run({ broadcastId: 'another-broadcast', requestId: 'req-1' });

        expect(similarTracks).not.toHaveBeenCalled();
        expect(posted()).toEqual([]);
    });

    it('does nothing on a show that is not a request show', async () => {
        const { job, lineup, similarTracks, posted } = build({ rules: {}, similarTracks: alike(8) });

        await job.run({ broadcastId: lineup.broadcastId, requestId: 'req-1' });

        expect(similarTracks).not.toHaveBeenCalled();
        expect(posted()).toEqual([]);
    });

    it('leaves a request alone once a newer one sits behind it', async () => {
        const { job, lineup, similarTracks, posted } = build({ similarTracks: alike(8) });
        lineup.insertRequested(track('Asked Next', 'Somebody Else'), 'req-2');

        await job.run({ broadcastId: lineup.broadcastId, requestId: 'req-1' });

        expect(similarTracks).not.toHaveBeenCalled();
        expect(posted()).toEqual([]);
    });
});
