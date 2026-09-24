import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { PgBossJobBroker } from '@maroonedsoftware/jobbroker/pgboss';
import { Logger } from '@maroonedsoftware/logger';
import { DEDICATION_CONTEXT, DEDICATION_KIND, DEDICATION_LABEL } from '#modules/director/dedication.writer.js';
import { DirectorService } from '#modules/director/director.service.js';
import { PickResolver } from '#modules/director/pick.resolver.js';
import { resolveRules, stationRules } from '#modules/director/rotation.rules.js';
import { StationLineupRepository } from '#modules/director/station.lineup.repository.js';
import { NowPlayingService } from '#modules/nowplaying/nowplaying.service.js';
import { TrackAudioRepository } from '#modules/playout/audio/track.audio.repository.js';
import { TrackAudioService } from '#modules/playout/audio/track.audio.service.js';
import { SegmentRepository } from '#modules/render/segment.repository.js';
import { errorText } from '#modules/shared/error.text.js';
import { StationIdentity } from '#modules/shared/station.identity.js';
import { arbitrate } from './request.arbiter.js';
import { RequestsRepository, type ChatReplyTarget, type Dedication, type RequestRow, type RequestStatus } from './requests.repository.js';
import { requestSettings } from './requests.settings.js';

/** Who is asking, however they reached the station. */
export interface Requester {
    /** `user:<actor id>` or `chat:<plugin id>:<platform user id>`. What the arbitration compares on. */
    key: string;
    /** What to call them. Never an email address. */
    name: string;
    actorId?: string;
    /** Where to tell them what became of it, when they asked from a chat. */
    chat?: ChatReplyTarget;
}

/** The job the messaging module sends a chat message with. Named rather than imported, since messaging registers after this module. */
const MESSAGING_ANNOUNCE_JOB = 'messaging.announce';

/** How long a chat is told anything about a request: an answer an hour late is noise. */
const NOTICE_WINDOW_MS = 60 * 60_000;

/** How long a request may wait to be placed before it lapses. */
export const REQUEST_PLACE_WINDOW_MS = 60 * 60_000;

/** How long a request may sit in the order unheard before it is written off. */
export const REQUEST_AIR_WINDOW_MS = 3 * 60 * 60_000;

/** What became of an attempt to put a request into the running order. */
export type PlaceOutcome = 'queued' | 'waiting' | 'declined';

/**
 * The request desk: taking a request, deciding on it, and putting it into the running order.
 *
 * ## One desk, whoever is asking
 *
 * A listener app and a chat platform reach the same `submit`, so one person cannot get round the
 * cooldown by asking from the other side, and the arbitration is written once (Ideas #76 says it
 * would serve both, and it does).
 *
 * ## The director still places it
 *
 * A request is placed by posting `insertRequested`, never by writing the order: the director is the
 * only writer of what airs. It is posted only with the record's audio already on this machine, so it
 * never holds the commit pass behind a download. A record that is not here yet is fetched and the
 * request waits as `pending`; `RequestsTickJob` offers it again, as it does one that found no quiet
 * place near the head of the order.
 *
 * ## The station's rules still hold
 *
 * The record goes through `PickResolver` with the broadcast's own rules, exactly as a mixed-in record
 * does, so a dislike, the repeat window, the period and the advisory policy apply to a request too.
 *
 * ## Telling a chat
 *
 * Somebody who asked from a chat is told what became of it through the messaging module's announce
 * job, by name, since that module sits after this one in the list. What they are told is the
 * station's own sentence and never repeats anything they wrote.
 */
@Injectable()
export class RequestDesk {
    constructor(
        private readonly repository: RequestsRepository,
        private readonly identity: StationIdentity,
        private readonly config: AppConfig,
        private readonly nowPlaying: NowPlayingService,
        private readonly lineups: StationLineupRepository,
        private readonly resolver: PickResolver,
        private readonly audio: TrackAudioRepository,
        private readonly trackAudio: TrackAudioService,
        private readonly director: DirectorService,
        private readonly segments: SegmentRepository,
        private readonly jobs: PgBossJobBroker,
        private readonly logger: Logger,
    ) {}

    /**
     * Take a request. Always answers with a row, a refusal included, so whoever asked can be told why
     * in the same breath: a refusal is a `declined` row whose `reason` says it.
     */
    async submit(requester: Requester, record: { trackId: string; title: string; artist: string }, dedication?: Dedication): Promise<RequestRow> {
        const stationKey = this.identity.stationKey;
        const settings = requestSettings(this.config);
        const open = await this.repository.open(stationKey);
        const mine = open.find(request => request.requesterKey === requester.key);
        const lastGranted = await this.repository.lastGrantedAt(stationKey, requester.key);

        const decision = arbitrate({
            enabled: settings.enabled,
            onAir: this.nowPlaying.getNowPlaying().onAir,
            ...(mine === undefined ? {} : { openForRequester: `${mine.title} by ${mine.artist}` }),
            ...(lastGranted === undefined ? {} : { lastGrantedAt: lastGranted.toMillis() }),
            cooldownMs: settings.cooldownMs,
            trackAlreadyOpen: open.some(request => request.trackId === record.trackId),
            openCount: open.length,
            maxOpen: settings.maxOpen,
            now: Date.now(),
        });

        const created = await this.repository.create({
            stationKey,
            requesterKey: requester.key,
            requesterName: requester.name,
            ...(requester.actorId === undefined ? {} : { actorId: requester.actorId }),
            ...(requester.chat === undefined ? {} : { chat: requester.chat }),
            trackId: record.trackId,
            title: record.title,
            artist: record.artist,
            status: decision.ok ? (settings.approval === 'operator' ? 'waiting' : 'pending') : 'declined',
            ...(decision.ok ? {} : { reason: decision.reason }),
            ...(dedication === undefined ? {} : { dedication }),
        });
        if (created.status !== 'pending') return created;

        // Quietly: whoever asked is answered with the row this returns, so a notice as well would say
        // everything twice.
        await this.place(created, { quiet: true });
        return (await this.repository.find(stationKey, created.id)) ?? created;
    }

    /** An operator letting a waiting request through. Answers the row as it now stands, or nothing when it was not waiting. */
    async grant(id: string): Promise<RequestRow | undefined> {
        const stationKey = this.identity.stationKey;
        const granted = await this.repository.moveTo(stationKey, id, ['waiting'], 'pending');
        if (granted === undefined) return undefined;

        if ((await this.place(granted)) === 'waiting')
            this.tell(granted, `Good news: ${granted.title} by ${granted.artist} will be on in a little while.`);
        return (await this.repository.find(stationKey, id)) ?? granted;
    }

    /** An operator turning a request down. Only one not yet in the order: a queued one is taken out of the order instead. */
    async decline(id: string, reason: string | undefined): Promise<RequestRow | undefined> {
        const said = reason?.trim() || 'The station decided not to play it this time.';
        const declined = await this.repository.moveTo(this.identity.stationKey, id, ['waiting', 'pending'], 'declined', said);
        if (declined !== undefined) this.tell(declined, `Sorry, not this time: ${declined.title} by ${declined.artist}. ${said}`);
        return declined;
    }

    /**
     * Try every pending request again, and let go of the ones that have waited too long. Answers how
     * many were placed. Run by `RequestsTickJob`.
     */
    async tick(now = Date.now()): Promise<number> {
        const stationKey = this.identity.stationKey;
        let placed = 0;

        for (const request of await this.repository.open(stationKey)) {
            const age = now - request.createdAt.toMillis();

            if (request.status === 'queued') {
                if (age > REQUEST_AIR_WINDOW_MS) {
                    await this.lapse(request, ['queued'], 'It left the running order before it could air.');
                }
                continue;
            }

            if (age > REQUEST_PLACE_WINDOW_MS) {
                await this.lapse(request, ['waiting', 'pending'], 'It could not be fitted in within the hour.');
                continue;
            }

            if (request.status === 'pending' && (await this.place(request)) === 'queued') placed += 1;
        }
        return placed;
    }

    /** A request's record has just gone to air. Marks every queued request for it heard, and tells whoever asked. */
    async aired(trackId: string): Promise<number> {
        const stationKey = this.identity.stationKey;
        let marked = 0;
        for (const request of await this.repository.open(stationKey)) {
            if (request.status !== 'queued' || request.trackId !== trackId) continue;
            const aired = await this.repository.moveTo(stationKey, request.id, ['queued'], 'aired');
            if (aired === undefined) continue;
            marked += 1;
            this.tell(aired, `Playing your request now: ${aired.title} by ${aired.artist}.`);
        }
        return marked;
    }

    /**
     * Put one pending request into the running order if it can go now.
     *
     * `waiting` covers everything that may come right by itself: nothing on air, the audio still on
     * its way, no quiet place near the head of the order. Only a record the station's rules or its
     * sources rule out is `declined`, since that will not change in the next minute.
     *
     * `quiet` for a caller answering the person itself, so a chat is not told the same thing twice.
     */
    async place(request: RequestRow, options: { quiet?: boolean } = {}): Promise<PlaceOutcome> {
        const say = (row: RequestRow, text: string) => {
            if (options.quiet !== true) this.tell(row, text);
        };
        const stationKey = this.identity.stationKey;
        try {
            const lineup = await this.lineups.load();
            if (lineup === undefined) return 'waiting';

            const rules = resolveRules(lineup.mode, lineup.rules, stationRules(this.config));
            const [track] = await this.resolver.resolve([{ title: request.title, artist: request.artist, trackId: request.trackId }], rules, {
                ...(lineup.era === undefined ? {} : { era: lineup.era }),
                keepOrder: true,
                discoveries: 1,
            });
            if (track === undefined) {
                await this.refuse(request, 'The station cannot play that one just now: it has aired lately, or this hour’s rules rule it out.', say);
                return 'declined';
            }

            const [state] = await this.audio.findForBindings([{ pluginId: track.pluginId, externalId: track.externalId }]);
            if (state === undefined) {
                await this.refuse(request, 'None of the station’s sources can play that one at the moment.', say);
                return 'declined';
            }
            if (state.checksum === undefined) {
                if (!this.trackAudio.isFetching(state.sourceId)) await this.jobs.send('playout.cache_track', { sourceId: state.sourceId });
                return 'waiting';
            }

            const dedication = await this.planDedication(request);
            const result = await this.director.applyEdit({
                kind: 'insertRequested',
                track,
                requestId: request.id,
                ...(dedication === undefined ? {} : { dedication: { segmentId: dedication, segmentKind: DEDICATION_KIND } }),
            });
            if (!result.ok) {
                // Nothing went in, so the words planned for it have nowhere to be said. Written off
                // rather than left `planned`, where they would sit in the library looking like a break
                // still to come. A new one is planned with the next attempt.
                if (dedication !== undefined)
                    await this.segments.markFailed(dedication, 'the request it went with could not be placed yet', 'planned');
                return 'waiting';
            }

            const queued = await this.repository.moveTo(stationKey, request.id, ['pending'], 'queued');
            if (queued !== undefined) say(queued, `Your request is in: ${queued.title} by ${queued.artist}, a few records from now.`);
            return 'queued';
        } catch (error) {
            // A fault here leaves the request pending for the tick to offer again, rather than
            // telling somebody no for a reason that had nothing to do with their record.
            this.logger.warn(`requests: could not place a request, and will try again (${errorText(error)})`);
            return 'waiting';
        }
    }

    /**
     * Plan the words to go in front of a dedicated request, and answer the segment's id, or nothing
     * when there is no dedication or the station is not saying them. The listener's words ride the
     * segment's context to the writer, which is the only thing that reads them.
     */
    private async planDedication(request: RequestRow): Promise<string | undefined> {
        if (request.dedication === undefined || !requestSettings(this.config).dedications) return undefined;

        const context: Record<string, string> = { [DEDICATION_CONTEXT.from]: request.requesterName };
        if (request.dedication.to !== undefined) context[DEDICATION_CONTEXT.to] = request.dedication.to;
        if (request.dedication.message !== undefined) context[DEDICATION_CONTEXT.message] = request.dedication.message;

        const segment = await this.segments.plan({ kind: DEDICATION_KIND, label: DEDICATION_LABEL, context });
        return segment.id;
    }

    private async refuse(request: RequestRow, reason: string, say: (row: RequestRow, text: string) => void): Promise<void> {
        const declined = await this.repository.moveTo(this.identity.stationKey, request.id, ['pending'], 'declined', reason);
        if (declined !== undefined) say(declined, `Sorry, not this time: ${declined.title} by ${declined.artist}. ${reason}`);
    }

    private async lapse(request: RequestRow, from: readonly RequestStatus[], reason: string): Promise<void> {
        const lapsed = await this.repository.moveTo(this.identity.stationKey, request.id, from, 'expired', reason);
        if (lapsed !== undefined) this.tell(lapsed, `Your request for ${lapsed.title} by ${lapsed.artist} has lapsed. ${reason}`);
    }

    /** Tell somebody who asked from a chat. Fire and forget: a request is not held up by a message. */
    private tell(request: RequestRow, text: string): void {
        const chat = request.chat;
        if (chat === undefined) return;
        void this.jobs
            .send(MESSAGING_ANNOUNCE_JOB, { pluginId: chat.pluginId, chatId: chat.chatId, text, notAfter: Date.now() + NOTICE_WINDOW_MS })
            .catch(error => this.logger.warn(`requests: could not tell a chat about a request (${errorText(error)})`));
    }
}
