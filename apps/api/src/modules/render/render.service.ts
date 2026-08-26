import { Injectable } from 'injectkit';
import { AuthorizationContext } from '#modules/permissions/authorization.context.js';
import { httpError } from '@maroonedsoftware/errors';
import { isPluginError } from '@deadair/plugin-sdk';
import type { SpeechPlugin } from '#modules/plugins/plugin.capabilities.js';
import { Logger } from '@maroonedsoftware/logger';
import { isMultipartFieldData, type MultipartBody, type MultipartData } from '@maroonedsoftware/multipart';
import { PgBossJobBroker } from '@maroonedsoftware/jobbroker/pgboss';
import type {
    PronunciationList,
    PronunciationQuery,
    PronunciationStateWrite,
    PronunciationWrite,
    ScriptAttempt,
    ScriptRatingInput,
    ScriptHistoryPage,
    ScriptHistoryQuery,
    ScriptHistorySummary,
    ScriptHistorySummaryQuery,
    SpeechPreviewRequest,
    ScriptPromptMessage,
    SegmentCreate,
    SegmentList,
    PadFetch,
    PadList,
    PadScanResult,
    PadSetMembership,
    PadSetWrite,
    PadState,
    SegmentScanResult,
    Segment as SegmentView,
    VoiceList,
} from './types/render.types.js';
import { DateTime } from 'luxon';
import { DEFAULT_BOARD, labelFor as padLabelFor, MAX_PAD_BYTES, padName, padNameOf, PadLibrary } from './pad.library.js';
import { PAD_SOURCES, padIsConsoleWritten, PadRepository, type Pad } from './pad.repository.js';
import { PadSetRepository } from './pad.set.repository.js';
import { PronunciationRepository } from './pronunciation.repository.js';
import { ScriptRatingsRepository } from './script.ratings.repository.js';
import { encodeScriptCursor, ScriptHistoryRepository, type HistoryTrack, type ScriptHistoryEntry } from './script.history.repository.js';
import { ratingFromColumn, ratingToColumn } from '../catalog/rating.js';
import { DEFAULT_KIND as DEFAULT_SEGMENT_KIND, labelFor, MAX_SEGMENT_BYTES, SegmentLibrary } from './segment.library.js';
import { LIBRARY_SOURCE, SegmentRepository, type Segment } from './segment.repository.js';
import {
    extensionForMime,
    isSegmentExtension,
    SEGMENT_CONTENT_TYPES,
    SEGMENT_EXTENSIONS,
    SegmentStore,
    subdirectoryIsSafe,
    type SegmentContentType,
    type SegmentExtension,
} from './segment.store.js';
import { SpeechService } from './speech.service.js';
import { SAMPLE_TEXT, VoiceSampleStore } from './voice.sample.store.js';
import { errorText } from '#modules/shared/error.text.js';

/**
 * What a segment is when nobody says.
 *
 * A talk break rather than an ident, because a caller with a script in hand is writing speech; an
 * ident is the thing that already exists as a recording in the inbox.
 */
const DEFAULT_KIND = 'talkbreak';

/** What a page of script history holds when the console does not say. A screenful and a bit. */
const DEFAULT_HISTORY_LIMIT = 50;

/**
 * How far back the roster's counts reach when nobody says.
 *
 * A day, because what the summary answers is "how is this character doing on air", and the shortest
 * honest answer to that spans a night as well as an afternoon: a station whose model declines every
 * break after midnight looks healthy on any window that stops before it.
 */
const DEFAULT_SUMMARY_HOURS = 24;

/**
 * How long a voice preview waits for the speech engine before saying the station is busy.
 *
 * The same ten seconds `ModelTalkBreakWriter` gives the model queue, and for the same reason: past
 * that, an answer saying why is worth more than a better answer nobody is still waiting for.
 */
const SAMPLE_QUEUE_MS = 10_000;

/**
 * How long a client may reuse segment audio before asking again.
 *
 * Longer than art's hour, and safely so: this URL's id maps to one row whose audio is
 * content-addressed, so the bytes behind an id change only if the segment is re-recorded. The ETag
 * is the checksum, which makes even that a headers-only revalidation the conditional-GET middleware
 * answers with a 304.
 */
const CACHE_CONTROL = 'public, max-age=86400';

/**
 * How long the station waits on an address an operator typed.
 *
 * Bounds getting the WHOLE thing rather than getting the response, unlike `host.fetch`'s own
 * deadline: a pad is a short sound with a ceiling of 25 MB, so there is no legitimate case here of a
 * body outliving the call that asked for it, and a request nobody is still watching is worse than a
 * refusal somebody can read.
 */
const FETCH_TIMEOUT_MS = 30_000;

/**
 * What the audio route hands the generated router.
 *
 * `contentType` is the answer, not decoration: the operation declares every format the store holds
 * and the router sets `ctx.type` from whichever this names. Both consumers pick their behaviour
 * from that header rather than from the bytes, so it is the difference between a wav that plays and
 * one that silently does not. See the note on `SEGMENT_CONTENT_TYPES`.
 */
/**
 * A preview's bytes, with no cache headers.
 *
 * The sample route carries an ETag because a browser will re-ask for the same URL; this one is a
 * POST whose answer nothing re-asks for, and the cache that matters is the file the key found.
 */
export interface SpeechPreviewResponse {
    contentType: (typeof SEGMENT_CONTENT_TYPES)[SegmentExtension];
    body: Buffer;
}

export interface SegmentAudioResponse {
    contentType: SegmentContentType;
    body: Buffer;
    headers: { cacheControl: string; etag: string };
}

@Injectable()
export class RenderService {
    constructor(
        private readonly segments: SegmentRepository,
        private readonly store: SegmentStore,
        private readonly library: SegmentLibrary,
        private readonly jobs: PgBossJobBroker,
        private readonly speech: SpeechService,
        private readonly samples: VoiceSampleStore,
        private readonly history: ScriptHistoryRepository,
        private readonly ratings: ScriptRatingsRepository,
        private readonly context: AuthorizationContext,
        private readonly pronunciations: PronunciationRepository,
        // The rack and the directory it fills from. Last, so every existing call site's positional
        // arguments are untouched.
        private readonly pads: PadRepository,
        private readonly padSets: PadSetRepository,
        private readonly padLibrary: PadLibrary,
        private readonly logger: Logger,
    ) {}

    /**
     * What the station has written lately, including the attempts that came to nothing.
     *
     * Read-only, and the whole of what this route does: the rows are written by the writers
     * themselves and nothing here decides anything from them. It reads one row more than it answers
     * with, which is how a full page is told from the end of the table.
     */
    async readScriptHistory(query: ScriptHistoryQuery): Promise<ScriptHistoryPage> {
        const limit = query.limit ?? DEFAULT_HISTORY_LIMIT;

        const rows = await this.history.page({
            limit,
            ...(query.before === undefined ? {} : { before: query.before }),
            ...(query.kind === undefined ? {} : { kind: query.kind }),
            ...(query.writer === undefined ? {} : { writer: query.writer }),
            ...(query.outcome === undefined ? {} : { outcome: query.outcome }),
            ...(query.personaKey === undefined ? {} : { personaKey: query.personaKey }),
            ...(query.segmentId === undefined ? {} : { segmentId: query.segmentId }),
        });

        const page = rows.slice(0, limit);
        const more = rows.length > limit;
        const last = page.at(-1);

        return {
            attempts: page.map(toAttempt),
            ...(more && last !== undefined ? { nextBefore: encodeScriptCursor(last) } : {}),
        };
    }

    /**
     * Records what the operator thought of one attempt.
     *
     * Answers the attempt as it now stands rather than an acknowledgement, mirroring the catalog's
     * rating verbs: the console redraws from the response instead of asking again for a page it
     * already holds.
     *
     * Nothing acts on this. It is read by an operator reading back what the station said, and the
     * one pass that will eventually consult it — the notebook's distil selection, which must not
     * build on a break that was thumbed down — reads it as a filter rather than as a signal to
     * train on. `docs/todo/break-ratings.md` holds the argument for why that stays true.
     */
    async rateScript(id: string, input: ScriptRatingInput): Promise<ScriptAttempt> {
        // Read off the request's own actor rather than taken as a parameter, the way every other
        // operator surface here stamps one: a caller that could pass an id could pass somebody
        // else's. A non-user actor leaves it absent, which the column allows.
        const actorId = this.context.actor.kind === 'user' ? this.context.actor.actorId : undefined;

        const rated = await this.ratings.rate(id, ratingToColumn(input.rating), actorId);
        if (!rated) throw httpError(404).withDetails({ message: `no attempt with id "${id}" has been written` });

        // Read back through the ordinary page rather than composing an answer here, so the shape the
        // console receives is the one it already knows how to draw.
        const [attempt] = (await this.history.page({ limit: 1, scriptId: id })).map(toAttempt);
        if (attempt === undefined) throw httpError(404).withDetails({ message: `no attempt with id "${id}" has been written` });

        return attempt;
    }

    /**
     * What each presenter has attempted lately, counted by outcome.
     *
     * The same rows `readScriptHistory` pages through, asked the one question a roster has: not what
     * a character said but whether what it says is reaching air. A run of declines with the floor
     * writing underneath is a sheet nothing can satisfy, and it is invisible from the character's
     * own page, where every card looks exactly as it did the day it was written.
     *
     * Echoes the window it counted, so a console labels the numbers it draws rather than assuming
     * the default it did not send.
     */
    async readScriptSummary(query: ScriptHistorySummaryQuery): Promise<ScriptHistorySummary> {
        const hours = query.hours ?? DEFAULT_SUMMARY_HOURS;

        return { hours, rows: await this.history.outcomeCountsSince(hours) };
    }

    /**
     * The station's lexicon, or one state of it.
     *
     * Every write below answers with the whole list for the reason the personas routes do: accepting
     * a proposal moves one row between two sections of the same page, and a caller handed back only
     * the row it named holds a list it has to refetch anyway.
     */
    async listPronunciations(query: PronunciationQuery): Promise<PronunciationList> {
        return { pronunciations: await this.pronunciations.list(query.state) };
    }

    /** Adds one an operator typed. Said from the next render on, since nothing caches the lexicon. */
    async createPronunciation(write: PronunciationWrite): Promise<PronunciationList> {
        if (await this.pronunciations.holds(write.written))
            throw httpError(409).withDetails({ message: `the station already has an entry for "${write.written}"` });

        await this.pronunciations.add({ ...write, state: 'active', origin: 'operator' });
        return { pronunciations: await this.pronunciations.list() };
    }

    /** Rewrites one entry's words, whoever proposed it. */
    async updatePronunciation(id: string, write: PronunciationWrite): Promise<PronunciationList> {
        if (!(await this.pronunciations.update(id, write))) throw httpError(404).withDetails({ message: `pronunciation "${id}" does not exist` });

        return { pronunciations: await this.pronunciations.list() };
    }

    /**
     * Accepts a proposal, turns one down, or takes an entry out of use.
     *
     * `rejected` rather than a deletion is the whole point of the state existing: the mining pass
     * re-reads an article whenever a plugin hands over a new copy of it, so a proposal that was
     * deleted comes back, and comes back again.
     */
    async setPronunciationState(id: string, write: PronunciationStateWrite): Promise<PronunciationList> {
        if (!(await this.pronunciations.setState(id, write.state)))
            throw httpError(404).withDetails({ message: `pronunciation "${id}" does not exist` });

        return { pronunciations: await this.pronunciations.list() };
    }

    /** Removes an entry outright, which is the operator's own to do. */
    async deletePronunciation(id: string): Promise<PronunciationList> {
        if (!(await this.pronunciations.remove(id))) throw httpError(404).withDetails({ message: `pronunciation "${id}" does not exist` });

        return { pronunciations: await this.pronunciations.list() };
    }

    /** Everything the station can play that is not a record. */
    async listSegments(): Promise<SegmentList> {
        const segments = await this.segments.list();
        return { segments: segments.map(toView) };
    }

    /**
     * Write down something for the station to say, and set it going.
     *
     * Answers as soon as the row exists rather than waiting on a synthesis, so the segment always
     * comes back `written`: this route hands over the words, and what is missing is the audio. That
     * is not an approximation of the result — it is the result. Rendering is a job precisely because
     * nobody is waiting on it, and a caller that wants to know when the audio arrived polls the
     * list.
     *
     * The send is last, and deliberately: a job that ran before the row was committed would find
     * nothing to claim. If the send fails, the row survives as a `written` segment an operator can
     * ask for again, which is a better failure than a segment that exists only in a queue.
     */
    async createSegment(create: SegmentCreate): Promise<SegmentView> {
        const segment = await this.segments.plan({
            kind: create.kind ?? DEFAULT_KIND,
            label: create.label,
            script: create.script,
            ...(create.voice === undefined ? {} : { voice: create.voice }),
        });

        await this.jobs.send('render.segment', { segmentId: segment.id });
        this.logger.info('render: planned a segment', { segment: segment.id, kind: segment.kind, voice: segment.voice });

        return toView(segment);
    }

    /**
     * The audio of one segment.
     *
     * @throws 404 for an id nobody has, for a segment with no audio yet (`planned`, `rendering` or
     * `failed`), and for one whose file has gone missing under it. All three are the same answer to
     * the caller: there is nothing to play here. The director asks the same question of the row
     * before committing anything, so a 404 on this route means a segment went missing between the
     * commit and the fetch rather than that the station tried to air a segment it never had.
     */
    async getSegmentAudio(id: string): Promise<SegmentAudioResponse> {
        const segment = await this.segments.findById(id);
        if (segment === undefined) throw httpError(404).withDetails({ message: `segment "${id}" does not exist` });
        if (segment.audioChecksum === undefined || segment.audioExt === undefined) {
            throw httpError(404).withDetails({ message: `segment "${id}" has no audio (${segment.state})` });
        }

        const bytes = await this.store.read(segment.audioChecksum, segment.audioExt);
        if (bytes === undefined) throw httpError(404).withDetails({ message: `segment "${id}" has no file` });

        return {
            contentType: SEGMENT_CONTENT_TYPES[segment.audioExt],
            body: bytes,
            headers: { cacheControl: CACHE_CONTROL, etag: `"${segment.audioChecksum}"` },
        };
    }

    /**
     * Every sound the station holds, board by board.
     *
     * Every state, so a rejected pad is visible where an operator can put it back. That is the whole
     * reason rejection is a state rather than a deletion — the library scan re-reads its directory, so
     * a deleted row would be back on the next pass and the operator's decision would not survive it.
     */
    async listPads(): Promise<PadList> {
        const [pads, sets] = await Promise.all([this.pads.list(), this.padSets.list()]);

        // Two reads rather than one per row, because the page draws every pad's memberships and the
        // alternative is an N+1 over a library an operator may have hundreds of.
        const membership = await this.padSets.setsFor(pads.map(pad => pad.id));
        const naming = new Map(await Promise.all(sets.map(async set => [set.key, await this.padSets.personasNaming(set.key)] as const)));

        return {
            pads: pads.map(pad => ({ ...toPadView(pad), sets: membership.get(pad.id) ?? [] })),
            sets: sets.map(set => ({ ...set, personas: naming.get(set.key) ?? [] })),
        };
    }

    /** Names a set, or answers the one already under that key. */
    async createPadSet(write: PadSetWrite): Promise<PadList> {
        await this.padSets.ensure({ key: write.key, label: write.label, ...(write.position === undefined ? {} : { position: write.position }) });
        return await this.listPads();
    }

    /**
     * Renames a set.
     *
     * The KEY moves with it, which is what makes this the one write here with a consequence the
     * caller has to be shown first: `personas.soundboard` holds a key and not a foreign key, so every
     * persona naming the old one silently stops finding it. `PadSet.personas` is on the wire for
     * exactly that, and the console says so before it offers the button.
     */
    async updatePadSet(id: string, write: PadSetWrite): Promise<PadList> {
        if (!(await this.padSets.update(id, { key: write.key, label: write.label, ...(write.position === undefined ? {} : { position: write.position }) }))) {
            throw httpError(404).withDetails({ message: `pad set "${id}" does not exist` });
        }

        return await this.listPads();
    }

    /** Removes a set and its memberships, and no pads. */
    async deletePadSet(id: string): Promise<PadList> {
        if (!(await this.padSets.remove(id))) throw httpError(404).withDetails({ message: `pad set "${id}" does not exist` });

        return await this.listPads();
    }

    /**
     * Puts a pad on a set or takes it off.
     *
     * A refused add answers 409 rather than silently doing nothing, because the reason is specific
     * and actionable — the set already answers to that name — and a console that showed no change
     * would leave an operator clicking the same box.
     */
    async setPadMembership(id: string, write: PadSetMembership): Promise<PadList> {
        if (!write.on) {
            await this.padSets.drop(id, write.padId);
            return await this.listPads();
        }

        const outcome = await this.padSets.add(id, write.padId);
        if (outcome === 'name-taken') {
            throw httpError(409).withDetails({ message: 'this set already has a sound under that name, and a script names a sound by name' });
        }

        return await this.listPads();
    }

    /** Takes whatever is in the pad library directory onto its board. */
    async scanPads(): Promise<PadScanResult> {
        return await this.padLibrary.scan();
    }

    /**
     * Takes a sound in from the browser.
     *
     * The second door onto `PadLibrary.ingest`, which is where every rule about what a pad IS lives —
     * including the one that matters most here: the bytes are written into the pad library on disk as
     * well as into the content store, because the store is rewritten from that directory on every
     * boot scan and an archive carries the directory. A pad that existed only in the store would be
     * absent from every export with nothing logged anywhere.
     *
     * ## What is derived and what is refused
     *
     * A name is what a SCRIPT writes, so it is the one field worth being strict about: given, it is
     * taken as the operator typed it (normalised the way a filename would be); absent, it comes off
     * the filename. Either way the FILE is named after it — see `ingest`. A name that normalises to
     * nothing is a 400 rather than a skip, because the caller here is a person watching rather than a
     * scan walking forty files.
     *
     * The extension is read from the filename and falls back to what the browser declared, since a
     * file dragged in from a download can arrive with a perfectly good mime type and a stem with no
     * dot in it. Anything the store cannot serve is a 415 naming what it can, which is the same
     * answer the scan writes to the log for the same case.
     */
    async uploadPad(multipart: MultipartBody): Promise<PadList> {
        let upload: { bytes: Buffer; filename: string; mimeType: string } | undefined;

        // Collected rather than streamed to disk, because `ingest` needs the bytes twice — once for
        // the library file and once for the content-addressed store — and this is bounded at 25 MB
        // one line down. The parser answers 413 on the ceiling itself.
        const fields = await multipart.parse(
            async (_field, stream, filename, _encoding, mimeType) => {
                const chunks: Buffer[] = [];
                for await (const chunk of stream) chunks.push(chunk as Buffer);

                upload = { bytes: Buffer.concat(chunks), filename, mimeType };
            },
            { files: 1, fileSize: MAX_PAD_BYTES, fields: 8 },
        );

        if (upload === undefined || upload.bytes.length === 0) {
            throw httpError(400).withDetails({ message: 'that upload carried no audio' });
        }

        const ext = uploadExtension(upload.filename, upload.mimeType);
        if (ext === undefined) {
            throw httpError(415).withDetails({ message: `the station serves ${SEGMENT_EXTENSIONS.join(', ')}, and that file is none of them` });
        }

        const board = (readField(fields, 'board') ?? DEFAULT_BOARD).trim();
        if (!subdirectoryIsSafe(board)) throw httpError(400).withDetails({ message: `"${board}" is not a name a board can have` });

        const asked = readField(fields, 'name');
        const name = asked === undefined ? padNameOf(upload.filename) : padName(asked);
        if (name === undefined) {
            throw httpError(400).withDetails({ message: 'that sound needs a name a script could write, and nothing was left of this one' });
        }

        const label = readField(fields, 'label')?.trim() || padLabelFor(upload.filename);

        const { pad, contested } = await this.padLibrary.ingest({
            bytes: upload.bytes,
            ext,
            board,
            name,
            label,
            source: PAD_SOURCES.upload,
        });

        // Reported rather than swallowed, on `setPadMembership`'s argument: the sound IS in the
        // library, and a console that showed no difference would leave somebody wondering why a
        // persona pointed at this board cannot reach it.
        if (contested) {
            throw httpError(409).withDetails({
                message: `"${pad.name}" is in the library, but the ${board} set already answers to that name and a script names a sound by name`,
            });
        }

        return await this.listPads();
    }

    /**
     * Goes and gets a sound from an address the operator typed.
     *
     * ## Why this is not the thing `pad-licensing.md` blocks
     *
     * That decision's Blocks line names "anything that fetches one on an operator's behalf", and its
     * own closing rule is that the line is REDISTRIBUTION rather than use. What it is about is what
     * this repository ships to everyone who installs it, where an unmet attribution obligation would
     * travel to a self-hoster who never read it. An operator pasting an address is choosing a file,
     * exactly as dropping one in the library is: nothing here inspects it, nothing records a claim
     * about its licence, and nothing about it reaches anybody else's install.
     *
     * ## No allowlist, deliberately
     *
     * `host.fetch`'s per-upstream policy exists to protect an operator from a careless PLUGIN. This
     * is the operator naming the address themselves, on a `platform.manage` route, on their own box —
     * so a list of permitted hosts would be this station deciding where its own operator may keep
     * their air horns. What is bounded instead is the shape of the answer: one request, a deadline, a
     * byte ceiling read as the body arrives rather than after it, and a format the store can serve.
     */
    async fetchPad(write: PadFetch): Promise<PadList> {
        const board = write.board.trim();
        if (!subdirectoryIsSafe(board)) throw httpError(400).withDetails({ message: `"${board}" is not a name a board can have` });

        const address = new URL(write.url);
        const response = await fetch(address, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: 'follow' }).catch(error => {
            throw httpError(502).withDetails({ message: `that address could not be reached (${errorText(error)})` });
        });

        if (!response.ok) {
            void response.body?.cancel();
            throw httpError(502).withDetails({ message: `that address answered ${response.status}` });
        }

        const ext = uploadExtension(decodePath(address.pathname), response.headers.get('content-type') ?? '');
        if (ext === undefined) {
            void response.body?.cancel();
            throw httpError(415).withDetails({ message: `the station serves ${SEGMENT_EXTENSIONS.join(', ')}, and that address is none of them` });
        }

        const bytes = await readBounded(response);
        if (bytes === undefined) throw httpError(413).withDetails({ message: `a pad may be at most ${MAX_PAD_BYTES / 1024 / 1024} MB` });
        if (bytes.length === 0) throw httpError(502).withDetails({ message: 'that address answered with no audio' });

        // DECODED first: a path is percent-encoded, so `Air%20Horn.wav` normalises to `air-20horn`
        // read raw — a token nobody would type and nothing would guess. Decoding is best-effort
        // because a malformed escape throws, and a name off the raw path beats a refused fetch.
        const path = decodePath(address.pathname);

        // The last path segment as the name, which is the same claim a filename makes one door over.
        const name = write.name === undefined ? padNameOf(path) : padName(write.name);
        if (name === undefined) {
            throw httpError(400).withDetails({ message: 'that sound needs a name a script could write, and the address gave nothing to make one from' });
        }

        const { pad, contested } = await this.padLibrary.ingest({
            bytes,
            ext,
            board,
            name,
            label: write.label?.trim() || padLabelFor(path),
            source: PAD_SOURCES.url,
        });

        if (contested) {
            throw httpError(409).withDetails({
                message: `"${pad.name}" is in the library, but the ${board} set already answers to that name and a script names a sound by name`,
            });
        }

        return await this.listPads();
    }

    /**
     * Removes a sound the console put there, and the file it wrote for it.
     *
     * ## Why this is not simply the delete `setState` argues against
     *
     * Rejecting rather than deleting is the rule on this table, and its reason is the scan: the pad
     * library on disk is re-read on every boot and on every operator's press of the button, so a
     * removed ROW comes back with the file still sitting there. That argument holds for every pad,
     * which is why the second half of this is deleting the FILE.
     *
     * What decides who may do that is `pads.source`, and it is the one thing that column decides. A
     * file the operator dropped in the library is theirs, and the console does not delete other
     * people's files — turning it down is the answer there, and it is the answer this refuses with.
     * A file the console WROTE (an upload, a fetch) it may also take away, and a mis-uploaded sound
     * that could never leave would be a one-way door.
     *
     * The bytes stay in the content store. It is content-addressed and shared with segments, so
     * removing them is a question about what else references that checksum rather than about this
     * pad, and the archive design already treats that store as the disposable half — the boot scan
     * rewrites it from the library. A file missing from disk is not an error either: the row going is
     * the point, and a pad whose file somebody already deleted by hand is exactly the case this is
     * for.
     */
    async deletePad(id: string): Promise<PadList> {
        const pad = await this.pads.findById(id);
        if (pad === undefined) throw httpError(404).withDetails({ message: `pad "${id}" does not exist` });

        if (!padIsConsoleWritten(pad.source)) {
            throw httpError(409).withDetails({
                message: `"${pad.name}" is a file in the pad library on disk, so deleting the row would only bring it back on the next scan. Turn it down instead, or remove the file`,
            });
        }

        await this.padLibrary.discard(pad);
        await this.pads.remove(id);

        return await this.listPads();
    }

    /**
     * Turns a sound down, or puts one back, and answers the whole rack.
     *
     * The whole rack rather than the row, exactly as the pronunciations routes do: one pad changing
     * state is one row moving between two sections of the same page, and a caller handed only what
     * it named is holding a list it has to refetch anyway.
     */
    async setPadState(id: string, write: PadState): Promise<PadList> {
        if (!(await this.pads.setState(id, write.state))) {
            throw httpError(404).withDetails({ message: `pad "${id}" does not exist` });
        }

        return await this.listPads();
    }

    /**
     * The sound itself, so an operator can hear what they dropped in.
     *
     * By ROW rather than by checksum, unlike {@link getStoredAudio}, and the two coexist for the
     * reason they are separate routes at all: this one is a console reading a list it is looking at,
     * where that one is a mixer resolving a part of a join. A console holding an id should not have
     * to learn a checksum to play a two-second file.
     */
    async getPadAudio(id: string): Promise<SegmentAudioResponse> {
        const pad = await this.pads.findById(id);
        if (pad === undefined) throw httpError(404).withDetails({ message: `pad "${id}" does not exist` });

        const bytes = await this.store.read(pad.audioChecksum, pad.audioExt);
        if (bytes === undefined) throw httpError(404).withDetails({ message: `pad "${id}" has no file` });

        return {
            contentType: SEGMENT_CONTENT_TYPES[pad.audioExt],
            body: bytes,
            // Revalidated rather than cached for a day, on `VoiceSampleStore`'s rule: this URL names
            // a SLOT and the file under it is replaceable, so a browser answering the next click out
            // of its own cache would play the sound an operator has just replaced.
            headers: { cacheControl: SAMPLE_CACHE_CONTROL, etag: `"${pad.audioChecksum}"` },
        };
    }

    /**
     * Audio out of the segment store, addressed by content rather than by row.
     *
     * The join's own route. A padded break is several takes with a soundboard hit between them, and
     * the mixer is handed URLs rather than bytes — so every part has to be fetchable from a sidecar
     * container. A production's beats already are, because a beat is a segment with an id; a take is
     * not a segment and never will be, and neither is a pad.
     *
     * **The extension is checked before it is used, and that is a path-safety guard rather than a
     * validation.** `checksum` and `ext` arrive from a URL, and the store composes a filename out of
     * both. The contract bounds the checksum to 64 characters and this bounds the extension to the
     * formats the store actually holds, so neither half can carry a separator or a `..` into a path
     * join. `ContentStore` guards its own paths as well; this refuses earlier, with a 404 rather than
     * a thrown path error.
     *
     * A miss is a 404 with no detail about which half missed, unlike the segment route above it. That
     * route names a row an operator is looking at; this one is addressed by a hash, and a caller
     * holding the wrong hash learns nothing useful from being told whether the file or the extension
     * was the problem.
     */
    async getStoredAudio(checksum: string, ext: string): Promise<SegmentAudioResponse> {
        const extension = ext.toLowerCase();
        if (!isSegmentExtension(extension)) throw httpError(404).withDetails({ message: 'no such audio' });

        const bytes = await this.store.read(checksum, extension);
        if (bytes === undefined) throw httpError(404).withDetails({ message: 'no such audio' });

        return {
            contentType: SEGMENT_CONTENT_TYPES[extension],
            body: bytes,
            // Content-addressed, so these bytes are these bytes forever: the strongest cache header
            // in the station, and the one place where `immutable` is a fact rather than a hope. The
            // ETag is the checksum because it already IS one.
            headers: { cacheControl: STORED_AUDIO_CACHE_CONTROL, etag: `"${checksum}"` },
        };
    }

    /**
     * The voices the station can be asked to speak in.
     *
     * Answers rather than throwing when nothing can speak, with `reason` saying which of the two
     * ways that happens it is (nothing installed, or a chosen one that is not running). A console
     * drawing an empty list wants to explain it; a 503 would leave it guessing.
     */
    async listVoices(): Promise<VoiceList> {
        const plugin = this.speech.speaker();
        if (plugin === undefined) return { voices: [], reason: this.speech.explainSpeaker() };

        const voices = await this.speech.voices(plugin);

        // Mapped rather than passed through, to leave `SpeechVoice.spec` behind. It is a cache-key
        // ingredient the host does not interpret and nobody outside this module has any use for, and
        // the `Voice` contract deliberately does not declare it — a plain assignment would compile
        // and put it on the wire anyway, since an excess property check does not reach a variable.
        return {
            voices: voices.map(voice => ({
                id: voice.id,
                label: voice.label,
                ...(voice.description === undefined ? {} : { description: voice.description }),
            })),
            pluginId: plugin.record.id,
        };
    }

    /**
     * A short line spoken in one voice, rendered on the first ask and cached after.
     *
     * The cache is the filesystem: the key is derived from the plugin, the voice, what the plugin
     * says that voice currently IS, and the fixed sample line — so a hit is the file being there
     * and a remapped voice mints a different key rather than serving the old audio back. Nothing
     * records the mapping, because the name is the mapping.
     *
     * That last part needs the plugin's own `SpeechVoice.spec`, which means asking for the voice
     * LIST before rendering one of them. It is one in-process call to a plugin that has the answer
     * in a field, and it buys the property the store's doc comment always claimed: without it the
     * key holds the station voice id, which is exactly the part that does not change when an
     * operator edits the mapping under it. A voice the plugin does not list — or lists without a
     * `spec` — keys as it did before, which is the honest answer for an engine that cannot say.
     *

     * `ext` is not part of the key, so a store that already holds this sample in one format is
     * probed for each: an operator who changes the plugin's output format gets a re-render on the
     * next click rather than a stale file under a name that no longer matches.
     *
     * @throws 503 when nothing can speak, 502 when the engine refused. Both are about the station
     * rather than about the voice asked for, which is why neither is a 404.
     */
    async getVoiceSample(voiceId: string): Promise<SegmentAudioResponse> {
        const { bytes, ext, key } = await this.renderSample(voiceId, SAMPLE_TEXT);
        return sampleResponse(bytes, key, ext);
    }

    /**
     * The same line in whichever voice the plugin falls back to.
     *
     * Its own route because the id of that voice is the empty string, which no path segment can
     * carry: what a console asking for it built was `/voices//sample`, a URL matching nothing. The
     * service has always handled the id fine — an empty one is dropped rather than passed on, so the
     * plugin is asked for its own default — and only the route could not say it.
     */
    async getDefaultVoiceSample(): Promise<SegmentAudioResponse> {
        return await this.getVoiceSample('');
    }

    /**
     * The caller's own words in one voice, so a script can be heard before anything airs it.
     *
     * The sample route above with the text parameterized, and everything that matters falls out of
     * being exactly that: the words go through the pronunciation lexicon on the way in, so a preview
     * is what the station would actually SAY rather than what was typed; the render queues behind
     * every break the station is about to air; and the audio lands in the samples store, which has no
     * segment row, so nothing here can be planted or named by a lineup.
     *
     * No cache headers, unlike the sample: a POST answer is not something a browser will hand back
     * on its own, and the cache that matters is the file the key already found.
     *
     * @throws 503 when nothing can speak or the engine is busy, 502 when it refused.
     */
    async previewSpeech(request: SpeechPreviewRequest): Promise<SpeechPreviewResponse> {
        const { bytes, ext } = await this.renderSample(request.voice ?? '', request.text);
        return { contentType: SEGMENT_CONTENT_TYPES[ext], body: bytes };
    }

    /**
     * One line spoken in one voice, from the store if it is there and from the engine if it is not.
     *
     * Shared by the two routes above rather than copied into both, because every decision in here is
     * about the station rather than about which of them asked: what to do when nothing can speak,
     * how long to wait for a busy engine, which failure is the engine's and which is the queue's.
     */
    private async renderSample(voiceId: string, text: string): Promise<{ bytes: Buffer; ext: SegmentExtension; key: string }> {
        const plugin = this.speech.speaker();
        if (plugin === undefined) throw httpError(503).withDetails({ message: this.speech.explainSpeaker() });

        const key = this.samples.keyFor(plugin.record.id, voiceId, await this.voiceSpec(plugin, voiceId), text);

        for (const ext of this.samples.extensions) {
            const cached = await this.samples.read(key, ext);
            if (cached !== undefined) return { bytes: cached, ext, key };
        }

        let ext: SegmentExtension;
        try {
            // An empty `voiceId` means the plugin's own default, which is exactly what an absent
            // `voice` means to it, so it is dropped rather than passed as an empty string.
            ext = await this.speech.speakAs(
                plugin,
                key,
                this.samples,
                {
                    text,
                    ...(voiceId.length === 0 ? {} : { voice: voiceId }),
                },
                // A preview is the one caller here with somebody waiting on it, and the only one
                // that should ever give up: a render job passes no bound, because nobody is waiting
                // and the station skips a segment that is not ready. Ten seconds is the break
                // writer's own queue bound, for the same reason it has one. `preview` puts it
                // behind every render in the queue as well, so an operator clicking through voices
                // cannot delay a break the station is about to air.
                { maxWaitMs: SAMPLE_QUEUE_MS, priority: 'preview' },
            );
        } catch (error) {
            const message = errorText(error);
            this.logger.warn('render: could not render a voice sample', { plugin: plugin.record.id, voice: voiceId, error: message });

            // The station being busy is not the engine refusing, and answering 502 for it would
            // send an operator looking at a speech plugin that is working perfectly well. 503,
            // which is also the answer for a station that cannot speak at all: both mean try again,
            // and only this one will come right on its own.
            throw httpError(isBusy(error) ? 503 : 502).withDetails({ message });
        }

        const bytes = await this.samples.read(key, ext);
        if (bytes === undefined) throw httpError(502).withDetails({ message: 'the sample was rendered and then could not be read back' });

        this.logger.info('render: rendered a voice sample', { plugin: plugin.record.id, voice: voiceId, ext });
        return { bytes, ext, key };
    }

    /**
     * What this plugin currently says a voice IS, for the sample key.
     *
     * Never throws. A plugin that cannot answer, does not implement `listVoices`, or does not know
     * this voice leaves the key as it was — so the worst case is the caching behaviour that shipped
     * before `spec` existed, and never a preview that 502s over its own cache name.
     */
    private async voiceSpec(plugin: SpeechPlugin, voiceId: string): Promise<string | undefined> {
        try {
            const voices = await this.speech.voices(plugin);
            return voices.find(voice => voice.id === voiceId)?.spec;
        } catch (error) {
            this.logger.debug('render: could not read a voice spec for the sample key', {
                plugin: plugin.record.id,
                voice: voiceId,
                error: errorText(error),
            });
            return undefined;
        }
    }

    /** Take whatever is in the inbox into the library. */
    async scanLibrary(): Promise<SegmentScanResult> {
        return await this.library.scan();
    }

    /**
     * Removes a recording the operator gave the station, and the inbox file behind it.
     *
     * ## Why this deletes where a pad is only turned down
     *
     * `PadRepository.setState` refuses to delete a file the operator dropped in, and can afford to:
     * a pad can be REJECTED, which is a decision that outlives the next scan and leaves the file
     * alone. A segment has no such state. Without this, an unwanted ident cannot be removed by any
     * route at all — while staying `ready`, and therefore staying bookable by a format-clock band
     * through `readyKinds()`. So the answer here is the other one: take the row and the file
     * together, whoever put the file there.
     *
     * ## A rendered segment is not the same object
     *
     * `source = 'render'` is the station's own speech. The running order names it, `script_history`
     * holds what was written for it, and the way to have it again is a re-render rather than a
     * re-upload — so this refuses one rather than offering a second meaning of the word. There is
     * nothing on disk to take away in that case either.
     *
     * ## No guard against the live running order, deliberately
     *
     * `DirectorService.toPlayerItems` reads segments by id and skips any it does not find, under the
     * rule its own comment states: a segment that is not `ready` is SKIPPED, never waited for. A
     * deleted one takes that path, which is the path the station already handles and the reason it
     * can hold something it has not finished making. Reaching from here into the director to ask
     * permission would invert the module order for a case that is already benign.
     */
    async deleteSegment(id: string): Promise<SegmentList> {
        const segment = await this.segments.findById(id);
        if (segment === undefined) throw httpError(404).withDetails({ message: `segment "${id}" does not exist` });

        if (segment.source !== LIBRARY_SOURCE) {
            throw httpError(409).withDetails({
                message: `"${segment.label}" is something the station wrote and spoke rather than a recording it was given, so there is nothing to take back. Re-render it instead`,
            });
        }

        await this.library.discard(segment);
        await this.segments.remove(id);

        this.logger.info('render: took a recording out of the library', { segment: id, kind: segment.kind, file: segment.sourcePath });

        return await this.listSegments();
    }

    /**
     * Takes a recording in from the browser.
     *
     * The second door onto `SegmentLibrary.ingest`, which puts the bytes in the inbox directory as
     * well as in the content store — the store is rewritten from that directory by every boot scan
     * and an archive carries the directory, so a segment that existed only in the store would be
     * absent from every export with nothing logged.
     *
     * `uploadPad`'s shape exactly, and it shares that method's two helpers rather than growing its
     * own. Two things differ, both because a segment is identified by its CHECKSUM rather than by a
     * slot. There is no name to normalise: a segment carries no token a script writes, so the
     * filename only ever becomes a LABEL and an awkward one costs nothing. And a repeat is not an
     * error — dropping the same recording in twice is one segment either way, so this answers with
     * the row that already held those bytes rather than refusing.
     *
     * The KIND is what its directory is called, so it takes the same path guard a board does. It is
     * also what `readyKinds()` offers the format clock as a bookable band, which is why the console
     * says so before an operator invents one by typing.
     */
    async uploadSegment(multipart: MultipartBody): Promise<SegmentView> {
        let upload: { bytes: Buffer; filename: string; mimeType: string } | undefined;

        const fields = await multipart.parse(
            async (_field, stream, filename, _encoding, mimeType) => {
                const chunks: Buffer[] = [];
                for await (const chunk of stream) chunks.push(chunk as Buffer);

                upload = { bytes: Buffer.concat(chunks), filename, mimeType };
            },
            { files: 1, fileSize: MAX_SEGMENT_BYTES, fields: 8 },
        );

        if (upload === undefined || upload.bytes.length === 0) {
            throw httpError(400).withDetails({ message: 'that upload carried no audio' });
        }

        const ext = uploadExtension(upload.filename, upload.mimeType);
        if (ext === undefined) {
            throw httpError(415).withDetails({ message: `the station serves ${SEGMENT_EXTENSIONS.join(', ')}, and that file is none of them` });
        }

        const kind = (readField(fields, 'kind') ?? DEFAULT_SEGMENT_KIND).trim();
        if (!subdirectoryIsSafe(kind)) throw httpError(400).withDetails({ message: `"${kind}" is not a name a kind can have` });

        const label = readField(fields, 'label')?.trim() || labelFor(upload.filename);
        if (label === '') throw httpError(400).withDetails({ message: 'that recording needs a name somebody can read' });

        const { segment, created } = await this.library.ingest({ bytes: upload.bytes, ext, kind, label });
        if (!created) {
            this.logger.info('render: an uploaded recording was one the station already held', { segment: segment.id, kind: segment.kind });
        }

        return toView(segment);
    }
}

/**
 * A cached sample, as the audio route hands it over.
 *
 * The ETag is the cache key rather than a hash of the bytes, and for once those are different
 * things: the key already identifies this voice saying this line, so a re-render of identical audio
 * is the same ETag and a remapped voice is a different one. Which is exactly what a validator should
 * mean here.
 *
 * ## Why this one revalidates and segment audio does not
 *
 * `must-revalidate` rather than the `max-age=86400` beside it, and it is the difference between the
 * two URLs rather than a difference of opinion about caching. `/segments/{id}/audio` names a row
 * whose bytes are content-addressed, so the id genuinely identifies the audio. `/voices/{id}/sample`
 * names a STATION voice, which is precisely the part that does not change when an operator remaps
 * it — so a day of `max-age` means the browser answers the next click out of its own cache and the
 * request never arrives.
 *
 * Measured rather than reasoned: with the key fixed to include what a voice currently IS, a remap
 * followed by a replay still played the old voice, and the API logged no second render because it
 * saw no second request. Making the key honest was necessary and, on its own, invisible.
 *
 * The cost is one conditional request per click, which the conditional-GET middleware answers with
 * a bodyless 304 whenever the mapping has not moved.
 */
/**
 * A year, and `immutable`, which is a claim this station can make in exactly one place.
 *
 * Everywhere else a URL names a THING whose bytes can change under it — `/voices/{id}/sample`
 * revalidates precisely because remapping a voice must not be answered out of a browser's cache.
 * Here the URL names the BYTES. There is nothing for a re-fetch to discover.
 */
const STORED_AUDIO_CACHE_CONTROL = 'public, max-age=31536000, immutable';

const SAMPLE_CACHE_CONTROL = 'private, no-cache, must-revalidate';

const sampleResponse = (body: Buffer, key: string, ext: SegmentExtension): SegmentAudioResponse => ({
    contentType: SEGMENT_CONTENT_TYPES[ext],
    body,
    headers: { cacheControl: SAMPLE_CACHE_CONTROL, etag: `"${key}"` },
});

/** Whether a failure is the station being busy rather than anything wrong with the engine. */
const isBusy = (error: unknown): boolean => isPluginError(error) && error.code === 'timeout';

/** A row as the console reads it. The checksum stays here: it is a filename, not an answer. */
const toView = (segment: Segment): SegmentView => ({
    id: segment.id,
    kind: segment.kind,
    state: segment.state,
    label: segment.label,
    source: segment.source,
    playable: segment.audioChecksum !== undefined,
    ...(segment.script === undefined ? {} : { script: segment.script }),
    ...(segment.spokenScript === undefined ? {} : { spokenScript: segment.spokenScript }),
    ...(segment.sourcePath === undefined ? {} : { sourcePath: segment.sourcePath }),
    ...(segment.durationMs === undefined ? {} : { durationMs: segment.durationMs }),
    ...(segment.error === undefined ? {} : { error: segment.error }),
    ...(segment.voice === undefined ? {} : { voice: segment.voice }),
});

/**
 * The conversation a writer sent, as far as it can be trusted to be one.
 *
 * `prompt` is jsonb written from whatever the writer handed over, so nothing about the stored shape
 * is enforced by the database and a row written by an older build is not something to read through a
 * compatibility path: an entry that is not a `{ role, content }` pair is dropped. This is a record of
 * what happened, and a malformed row is better shown short than shown wrong.
 *
 * Only ever populated while `llm.captureWrites` is on, so the ordinary answer here is `undefined`.
 */
function toPromptMessages(prompt: unknown): ScriptPromptMessage[] | undefined {
    if (!Array.isArray(prompt)) return undefined;

    const messages = prompt.flatMap(entry => {
        if (typeof entry !== 'object' || entry === null) return [];

        const { role, content } = entry as { role?: unknown; content?: unknown };
        if (typeof role !== 'string' || typeof content !== 'string') return [];

        return [{ role, content }];
    });

    return messages.length === 0 ? undefined : messages;
}

/** The three counts, when the provider reported any. A usage object with none of them is no usage. */
function toUsage(usage: Record<string, number> | undefined): ScriptAttempt['usage'] {
    if (usage === undefined) return undefined;

    const counts = {
        ...(typeof usage.inputTokens === 'number' ? { inputTokens: usage.inputTokens } : {}),
        ...(typeof usage.outputTokens === 'number' ? { outputTokens: usage.outputTokens } : {}),
        ...(typeof usage.totalTokens === 'number' ? { totalTokens: usage.totalTokens } : {}),
    };

    return Object.keys(counts).length === 0 ? undefined : counts;
}

/**
 * A neighbour as the console reads it.
 *
 * The copy of `facts` is not ceremony: the stored shape is `readonly string[]` and the generated
 * contract type is mutable, so the two do not assign without it.
 */
const toNeighbour = (track: HistoryTrack): ScriptAttempt['previous'] => ({
    title: track.title,
    artist: track.artist,
    ...(track.facts === undefined ? {} : { facts: [...track.facts] }),
});

/** One attempt as the console reads it. */
function toAttempt(entry: ScriptHistoryEntry): ScriptAttempt {
    const prompt = toPromptMessages(entry.prompt);
    const usage = toUsage(entry.usage);

    return {
        id: entry.id,
        at: entry.at,
        kind: entry.kind,
        writer: entry.writer,
        outcome: entry.outcome,
        ...(entry.personaKey === undefined ? {} : { personaKey: entry.personaKey }),
        ...(entry.label === undefined ? {} : { label: entry.label }),
        ...(entry.script === undefined ? {} : { script: entry.script }),
        ...(entry.model === undefined ? {} : { model: entry.model }),
        ...(entry.source === undefined ? {} : { source: entry.source }),
        ...(entry.reason === undefined ? {} : { reason: entry.reason }),
        ...(entry.segmentId === undefined ? {} : { segmentId: entry.segmentId }),
        ...(entry.previous === undefined ? {} : { previous: toNeighbour(entry.previous) }),
        ...(entry.next === undefined ? {} : { next: toNeighbour(entry.next) }),
        ...(entry.durationMs === undefined ? {} : { durationMs: entry.durationMs }),
        ...(usage === undefined ? {} : { usage }),
        ...(entry.raw === undefined ? {} : { raw: entry.raw }),
        ...(prompt === undefined ? {} : { prompt }),
        // Absent stays absent: nobody having said is a different answer from `neutral`, which is
        // somebody saying they have no opinion.
        ...(entry.rating === undefined ? {} : { rating: ratingFromColumn(entry.rating) }),
    };
}

/**
 * One pad as the console draws it.
 *
 * `audioChecksum` and `audioExt` are deliberately not on the wire: the console plays a pad through
 * `/pads/{id}/audio`, which is a slot, and handing it the checksum would invite it to build a
 * content-addressed URL that answers with the file that is there NOW rather than the one this row
 * names. Same reason a voice sample is keyed on what the voice currently IS.
 */
function toPadView(pad: Pad) {
    return {
        id: pad.id,
        board: pad.board,
        name: pad.name,
        label: pad.label,
        state: pad.state,
        ...(pad.durationMs === undefined ? {} : { durationMs: pad.durationMs }),
        ...(pad.loudnessLufs === undefined ? {} : { loudnessLufs: pad.loudnessLufs }),
        source: pad.source,
        ...(pad.sourcePath === undefined ? {} : { sourcePath: pad.sourcePath }),
        ...(pad.lastUsedAt === undefined ? {} : { lastUsedAt: DateTime.fromISO(pad.lastUsedAt) }),
    };
}

/**
 * One form field's value, where the caller sent one.
 *
 * A multipart field name can legitimately repeat, in which case the parser answers with an array;
 * nothing here wants a list, so the first wins. Blank is the same as absent, because an untouched
 * input in a browser form posts an empty string and "the operator left it alone" is what that means.
 */
function readField(fields: Map<string, MultipartData | MultipartData[]>, key: string): string | undefined {
    const held = fields.get(key);
    const one = Array.isArray(held) ? held[0] : held;

    if (one === undefined || !isMultipartFieldData(one)) return undefined;

    return one.value.trim() === '' ? undefined : one.value;
}

/**
 * What an upload is, as a format the store can serve.
 *
 * The filename first, because it is what the operator sees and what the scan would read. The
 * browser's declared type is the fallback rather than the authority: a file dragged out of a
 * downloads folder can arrive with a good mime type and a stem carrying no dot at all, and it can
 * equally arrive as `application/octet-stream` with a perfectly good `.wav` on the end.
 *
 * `undefined` for anything the store cannot hold, which is a 415 at the caller rather than a guess.
 */
function uploadExtension(filename: string, mimeType: string): SegmentExtension | undefined {
    const named = filename.split('.').pop()?.toLowerCase() ?? '';
    if (named !== filename.toLowerCase() && isSegmentExtension(named)) return named;

    // `extensionForMime` rather than a reverse map built here, because a second copy of that map is
    // a second thing that can fall behind the formats the store actually holds.
    return extensionForMime(mimeType);
}

/** A URL path as the characters it stands for, or as it stands where that cannot be read. */
function decodePath(pathname: string): string {
    try {
        return decodeURIComponent(pathname);
    } catch {
        return pathname;
    }
}

/**
 * A body, up to the ceiling, and `undefined` past it.
 *
 * Counted as the chunks arrive rather than checked after: `content-length` is a claim the far end
 * makes and may not make at all, so a station that trusted it would buffer a gigabyte before
 * discovering it had been lied to. The reader is cancelled the moment the total goes over, which
 * stops the transfer as well as the buffering.
 */
async function readBounded(response: Response): Promise<Buffer | undefined> {
    const body = response.body;
    if (body === null) return Buffer.alloc(0);

    const reader = body.getReader();
    const chunks: Buffer[] = [];
    let held = 0;

    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;

            held += value.byteLength;
            if (held > MAX_PAD_BYTES) {
                await reader.cancel();
                return undefined;
            }

            chunks.push(Buffer.from(value));
        }
    } finally {
        reader.releaseLock();
    }

    return Buffer.concat(chunks);
}
