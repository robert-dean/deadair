import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { PgBossJobBroker } from '@maroonedsoftware/jobbroker/pgboss';
import { Logger } from '@maroonedsoftware/logger';
import { TEMPLATE_KEYS } from '#modules/director/break.templates.js';
import { DEDICATION_CONTEXT, DEDICATION_KIND, DEDICATION_LABEL } from '#modules/director/dedication.writer.js';
import { DirectorService } from '#modules/director/director.service.js';
import { PickResolver } from '#modules/director/pick.resolver.js';
import { followOnFor } from '#modules/director/request.show.js';
import { NO_RULES, resolveRules, stationRules } from '#modules/director/rotation.rules.js';
import { StationLineupRepository } from '#modules/director/station.lineup.repository.js';
import { NowPlayingService } from '#modules/nowplaying/nowplaying.service.js';
import { PersonaRepository } from '#modules/personas/persona.repository.js';
import { TrackAudioRepository } from '#modules/playout/audio/track.audio.repository.js';
import { TrackAudioService } from '#modules/playout/audio/track.audio.service.js';
import { SegmentRepository } from '#modules/render/segment.repository.js';
import { errorText } from '#modules/shared/error.text.js';
import { StationBus } from '#modules/shared/station.bus.js';
import { StationIdentity } from '#modules/shared/station.identity.js';
import { STREAM_DEFAULTS, STREAM_KEYS } from '#modules/stream/stream.settings.js';
import { UNNAMED_REQUESTER, screenName } from './listener.text.js';
import { RequestPlacements } from './request.placements.js';
import { TRACK_ALREADY_OPEN, arbitrate, arbitrateRequester, oneAtATime, type RequesterFacts } from './request.arbiter.js';
import {
    OpenRequestTaken,
    RequestsRepository,
    type ChatReplyTarget,
    type Dedication,
    type NewRequest,
    type RequestRow,
    type RequestStatus,
} from './requests.repository.js';
import { requestSettings, requestSettingsFor, type RequestSettings } from './requests.settings.js';

/** Who is asking, however they reached the station. */
export interface Requester {
    /** `user:<actor id>` or `chat:<plugin id>:<platform user id>`. What the arbitration compares on. */
    key: string;
    /** What to call them. Never an email address. */
    name: string;
    actorId?: string;
    /** Where to tell them what became of it, when they asked from a chat. */
    chat?: ChatReplyTarget;
    /** Holds `platform:manage`, so the arbitration's rules about the person asking do not apply. Decided by the caller, which knows who is signed in. */
    operator?: true;
}

/** The job the messaging module sends a chat message with. Named rather than imported, since messaging registers after this module. */
const MESSAGING_ANNOUNCE_JOB = 'messaging.announce';

/** How long a chat is told anything about a request: an answer an hour late is noise. */
const NOTICE_WINDOW_MS = 60 * 60_000;

/** How long a request may wait to be placed before it lapses. */
export const REQUEST_PLACE_WINDOW_MS = 60 * 60_000;

/** How long a request may sit in the order unheard before it is written off. */
export const REQUEST_AIR_WINDOW_MS = 3 * 60 * 60_000;

/** Why the station turned down a record a listener may still insist on. Says nothing about insisting, since a chat cannot. */
export const REFUSED_FOR_TASTE = 'It has aired lately, or it does not fit this hour.';

/** Why the station turned down a record nobody can insist on: a never-play rule, or a clean-only station with no clean copy. */
export const REFUSED_OUTRIGHT = 'The station does not play that one.';

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
 * request waits as `pending`; `RequestAudioWatch` offers it again the moment the fetch lands, and
 * `RequestsTickJob` every minute, as it does one that found no quiet place near the head of the order.
 *
 * ## Two at once
 *
 * The arbitration decides from the open rows it has just read, and nothing is locked between that
 * read and the insert, so two submits that overlap both pass it. The database holds the two rules
 * that matter most (one open request per person, one per record) as unique indexes, and the loser of
 * that race is written down as `declined` with the same words the arbitration would have used had the
 * two arrived one after the other. The cap on how many are open is a count, which no index can hold,
 * so a true race can take the line one over.
 *
 * ## The station's rules still hold
 *
 * The record goes through `PickResolver` with the broadcast's own rules, exactly as a mixed-in record
 * does, so a dislike, the repeat window, the period and the advisory policy apply to a request too.
 *
 * ## Unless the listener insists
 *
 * A refusal for the station's own taste (how often, a dislike, the period, the length) can be
 * overruled by the listener, once. Which kind of refusal it was is found by resolving the record a
 * second time the way an overruled request is resolved (`PickResolver.resolve`'s `overrule`), since
 * the first answer cannot say which rule dropped it; a record that passes the second time is declined
 * `overrulable`. Insisting writes a NEW request marked `insisted` rather than reopening the old one,
 * so everything about the person and the line is decided again as for any request, and that request
 * is resolved as overruled every time it is placed, by the tick and by a grant as much as by submit.
 * A never-play rule and a clean-only station hold whatever anybody insists.
 *
 * ## Telling a chat
 *
 * Somebody who asked from a chat is told what became of it through the messaging module's announce
 * job, by name, since that module sits after this one in the list. What they are told is the
 * station's own sentence and never repeats anything they wrote.
 *
 * ## Names said on air are screened
 *
 * A dedication's two names are the listener's, and the floor writer says them as given. So before
 * they reach a writer each goes through `screenName`, with the station's own names as the reserved
 * list: a name that is not a name, or that would have the presenter introduce a listener as the
 * station or one of its presenters, becomes "a listener" (who it is from) or is left out (who it is
 * for). The request itself goes ahead exactly as it would have; only what is said changes.
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
        private readonly placements: RequestPlacements,
        private readonly segments: SegmentRepository,
        private readonly personas: PersonaRepository,
        private readonly jobs: PgBossJobBroker,
        // A request arriving, for subscribers registered after this module: `events`, which tells an
        // operator's own servers.
        private readonly bus: StationBus,
        private readonly logger: Logger,
    ) {}

    /**
     * Take a request. Always answers with a row, a refusal included, so whoever asked can be told why
     * in the same breath: a refusal is a `declined` row whose `reason` says it.
     */
    async submit(
        requester: Requester,
        record: { trackId: string; title: string; artist: string },
        dedication?: Dedication,
        options: { insisted?: boolean } = {},
    ): Promise<RequestRow> {
        const stationKey = this.identity.stationKey;
        const { settings, open, facts } = await this.requesterFacts(requester);
        const decision = arbitrate({ ...facts, trackAlreadyOpen: open.some(request => request.trackId === record.trackId) });

        const request: NewRequest = {
            stationKey,
            requesterKey: requester.key,
            requesterName: requester.name,
            ...(requester.actorId === undefined ? {} : { actorId: requester.actorId }),
            ...(requester.chat === undefined ? {} : { chat: requester.chat }),
            trackId: record.trackId,
            title: record.title,
            artist: record.artist,
            // An operator's own request does not wait for an operator to grant it.
            status: decision.ok ? (settings.approval === 'operator' && requester.operator !== true ? 'waiting' : 'pending') : 'declined',
            ...(decision.ok ? {} : { reason: decision.reason }),
            ...(dedication === undefined ? {} : { dedication }),
            ...(options.insisted === true ? { insisted: true as const } : {}),
            ...(requester.operator === true ? { operator: true as const } : {}),
        };
        const created = await this.write(request);
        if (created.status !== 'pending') return this.received(created);

        // Quietly: whoever asked is answered with the row this returns, so a notice as well would say
        // everything twice.
        await this.place(created, { quiet: true });
        return this.received((await this.repository.find(stationKey, created.id)) ?? created);
    }

    /** Say that a request arrived, as it now stands, and hand the row back. */
    private received(row: RequestRow): RequestRow {
        this.bus.publish('request.received', {
            id: row.id,
            trackId: row.trackId,
            title: row.title,
            artist: row.artist,
            requesterName: row.requesterName,
            via: row.chat === undefined ? 'app' : 'chat',
            status: row.status,
            ...(row.reason === undefined ? {} : { reason: row.reason }),
            ...(row.insisted === true ? { insisted: true as const } : {}),
            ...(row.dedication === undefined ? {} : { dedication: row.dedication }),
            at: Date.now(),
        });
        return row;
    }

    /**
     * The listener insisting on a record the station turned down for its own taste: a NEW request
     * for it, marked `insisted`, decided like any other and placed as overruled (see the class).
     *
     * Answers nothing for a request that is not this person's, so another listener's ids tell them
     * nothing, and `spent` for one that is not declined and overrulable any more. Somebody the
     * arbitration would refuse whatever they asked for (one already open, the cooldown, a full line)
     * is refused with a row as usual and keeps the overrule, so they can insist once that has passed.
     */
    async insist(requester: Requester, id: string): Promise<RequestRow | 'spent' | undefined> {
        const stationKey = this.identity.stationKey;
        const refused = await this.repository.find(stationKey, id);
        if (refused === undefined || refused.requesterKey !== requester.key) return undefined;
        if (refused.status !== 'declined' || refused.overrulable !== true) return 'spent';

        // Under the name they asked by the first time, whatever this caller would be called now.
        const asking: Requester = { ...requester, name: refused.requesterName };
        const record = { trackId: refused.trackId, title: refused.title, artist: refused.artist };
        if ((await this.refusal(asking)) !== undefined) return this.submit(asking, record, refused.dedication);

        // Guarded, so two taps on "play it anyway" cannot both insist.
        if ((await this.repository.spendOverrule(stationKey, id)) === undefined) return 'spent';
        return this.submit(asking, record, refused.dedication, { insisted: true });
    }

    /**
     * Why this person would be refused whatever they asked for, or nothing when they may ask. The
     * rules about the person and the line, without the one about the record, for a caller about to
     * take a record in from a provider: a refusal costs nothing, and the library is not grown for it.
     * `submit` still decides the whole thing afterwards, since the line may move in between.
     */
    async refusal(requester: Requester): Promise<string | undefined> {
        const { facts } = await this.requesterFacts(requester);
        const decision = arbitrateRequester(facts);
        return decision.ok ? undefined : decision.reason;
    }

    /** What the arbitration knows about the person asking and the line, with the open rows and the settings it came from. */
    private async requesterFacts(requester: Requester): Promise<{ settings: RequestSettings; open: RequestRow[]; facts: RequesterFacts }> {
        const stationKey = this.identity.stationKey;
        // The broadcast's own request rules where it has any: a party night's, say.
        const settings = requestSettingsFor(this.config, (await this.lineups.load())?.rules);
        const open = await this.repository.open(stationKey);
        // An operator's own requests are not in the listeners' line, so a stack of them never fills it.
        const listeners = open.filter(request => request.operator !== true);
        const mine = listeners.find(request => request.requesterKey === requester.key);
        const lastGranted = await this.repository.lastGrantedAt(stationKey, requester.key);
        const facts: RequesterFacts = {
            enabled: settings.enabled,
            onAir: this.nowPlaying.getNowPlaying().onAir,
            ...(requester.operator === true ? { operator: true } : {}),
            ...(mine === undefined ? {} : { openForRequester: `${mine.title} by ${mine.artist}` }),
            ...(lastGranted === undefined ? {} : { lastGrantedAt: lastGranted.toMillis() }),
            cooldownMs: settings.cooldownMs,
            openCount: listeners.length,
            maxOpen: settings.maxOpen,
            now: Date.now(),
        };
        return { settings, open, facts };
    }

    /**
     * Write a request, and when the database refuses it as a second open one (see the class), write
     * it as the refusal the arbitration would have given. A refusal is outside both indexes, so that
     * second write cannot be refused the same way.
     */
    private async write(request: NewRequest): Promise<RequestRow> {
        try {
            return await this.repository.create(request);
        } catch (error) {
            if (!(error instanceof OpenRequestTaken)) throw error;
            const reason =
                error.which === 'track' ? TRACK_ALREADY_OPEN : oneAtATime(await this.openTitleFor(request.stationKey, request.requesterKey));
            this.logger.info(`requests: two requests arrived together and the database kept the first (${error.which})`);
            return this.repository.create({ ...request, status: 'declined', reason });
        }
    }

    /** The open request this person won with, as the one-at-a-time refusal names it, or nothing once it has moved on. */
    private async openTitleFor(stationKey: string, requesterKey: string): Promise<string | undefined> {
        const mine = (await this.repository.open(stationKey)).find(request => request.requesterKey === requesterKey);
        return mine === undefined ? undefined : `${mine.title} by ${mine.artist}`;
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

    /**
     * Offer every pending request to the running order again, without letting any go. Answers how
     * many were placed. Run by `RequestAudioWatch` when a record's audio arrives.
     */
    async placePending(): Promise<number> {
        let placed = 0;
        for (const request of await this.repository.open(this.identity.stationKey)) {
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
     *
     * One placement of a request at a time ({@link RequestPlacements}), and only of a request that is
     * still `pending` once it has the turn: the row a caller holds may be a list read a moment ago, and
     * something else may have queued or let go of it since. Either way the answer is `waiting`, which
     * tells nobody anything.
     */
    async place(request: RequestRow, options: { quiet?: boolean } = {}): Promise<PlaceOutcome> {
        const outcome = await this.placements.exclusively(request.id, async () => {
            const current = await this.repository.find(this.identity.stationKey, request.id);
            return current?.status === 'pending' ? this.placeNow(current, options) : 'waiting';
        });
        return outcome ?? 'waiting';
    }

    private async placeNow(request: RequestRow, options: { quiet?: boolean }): Promise<PlaceOutcome> {
        const say = (row: RequestRow, text: string) => {
            if (options.quiet !== true) this.tell(row, text);
        };
        const stationKey = this.identity.stationKey;
        try {
            const lineup = await this.lineups.load();
            if (lineup === undefined) return 'waiting';

            const rules = resolveRules(lineup.mode, lineup.rules, stationRules(this.config));
            const picks = [{ title: request.title, artist: request.artist, trackId: request.trackId }];
            const options = {
                ...(lineup.era === undefined ? {} : { era: lineup.era }),
                // A never-play rule makes no exception for a listener, so a scoped one is judged
                // against the broadcast the request would join.
                broadcast: { mode: lineup.mode, ...(lineup.slotId === undefined ? {} : { slotId: lineup.slotId }) },
                keepOrder: true,
                discoveries: 1,
            };
            const overruled = () => this.resolver.resolve(picks, NO_RULES, { ...options, overrule: true });
            const [track] = request.insisted === true ? await overruled() : await this.resolver.resolve(picks, rules, options);
            if (track === undefined) {
                // Which kind of no this was, found by asking again as an overrule would (see the class).
                const overrulable = request.insisted !== true && (await overruled()).length > 0;
                await this.refuse(request, overrulable ? REFUSED_FOR_TASTE : REFUSED_OUTRIGHT, say, overrulable);
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
            if (followOnFor(lineup.rules) > 0) await this.followOnRequestShow(lineup.broadcastId, request.id);
            return 'queued';
        } catch (error) {
            // A fault here leaves the request pending for the tick to offer again, rather than
            // telling somebody no for a reason that had nothing to do with their record.
            this.logger.warn(`requests: could not place a request, and will try again (${errorText(error)})`);
            return 'waiting';
        }
    }

    /**
     * On a request show, ask for records like this request to follow it.
     *
     * A failed send is swallowed: the request is in the order and will air, which is what the
     * listener asked for. What follows it is the station's catalog, as it would have been on any
     * other show.
     */
    private async followOnRequestShow(broadcastId: string, requestId: string): Promise<void> {
        try {
            await this.jobs.send('director.follow_request', { broadcastId, requestId });
        } catch (error) {
            this.logger.warn(`requests: could not ask for records to follow a request (${errorText(error)})`);
        }
    }

    /**
     * Plan the words to go in front of a dedicated request, and answer the segment's id, or nothing
     * when there is no dedication or the station is not saying them. The listener's words ride the
     * segment's context to the writer, which is the only thing that reads them.
     *
     * Both names are screened first (see the class). The stored request keeps them as typed, since
     * the operator should see what was sent; only the segment's context carries the screened ones.
     */
    private async planDedication(request: RequestRow): Promise<string | undefined> {
        if (request.dedication === undefined || !requestSettings(this.config).dedications) return undefined;

        const reserved = await this.reservedNames();
        // Without the reserved names nothing can be judged, so nothing typed is said: the request
        // still goes ahead, with "a listener" and nobody named.
        const from = reserved === undefined ? undefined : screenName(request.requesterName, reserved);
        const to = reserved === undefined ? undefined : screenName(request.dedication.to, reserved);
        if (from === undefined || (request.dedication.to !== undefined && to === undefined)) {
            this.logger.info('requests: a name in a dedication is not one the station will say on air, so it is left out');
        }

        const context: Record<string, string> = { [DEDICATION_CONTEXT.from]: from ?? UNNAMED_REQUESTER };
        if (to !== undefined) context[DEDICATION_CONTEXT.to] = to;
        if (request.dedication.message !== undefined) context[DEDICATION_CONTEXT.message] = request.dedication.message;

        const segment = await this.segments.plan({ kind: DEDICATION_KIND, label: DEDICATION_LABEL, context });
        return segment.id;
    }

    /**
     * The names a listener may not be introduced as: the station's, its presenter's, and every
     * persona's, by on-air name and by label. Nothing when the personas could not be read.
     */
    private async reservedNames(): Promise<string[] | undefined> {
        try {
            const personas = await this.personas.list();
            return [
                this.config.get(STREAM_KEYS.title, STREAM_DEFAULTS.title),
                this.config.get(TEMPLATE_KEYS.djName, ''),
                ...personas.flatMap(persona => [persona.label, ...(persona.djName === undefined ? [] : [persona.djName])]),
            ];
        } catch (error) {
            this.logger.warn(`requests: could not read the station's own names to screen a dedication against (${errorText(error)})`);
            return undefined;
        }
    }

    private async refuse(request: RequestRow, reason: string, say: (row: RequestRow, text: string) => void, overrulable = false): Promise<void> {
        const declined = await this.repository.moveTo(this.identity.stationKey, request.id, ['pending'], 'declined', reason, { overrulable });
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
