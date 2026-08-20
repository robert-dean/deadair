import { Injectable } from 'injectkit';
import { httpError } from '@maroonedsoftware/errors';
import { isPluginError } from '@deadair/plugin-sdk';
import { Logger } from '@maroonedsoftware/logger';
import { PgBossJobBroker } from '@maroonedsoftware/jobbroker/pgboss';
import type {
    ScriptAttempt,
    ScriptHistoryPage,
    ScriptHistoryQuery,
    ScriptPromptMessage,
    SegmentCreate,
    SegmentList,
    SegmentScanResult,
    Segment as SegmentView,
    VoiceList,
} from './types/render.types.js';
import { encodeScriptCursor, ScriptHistoryRepository, type HistoryTrack, type ScriptHistoryEntry } from './script.history.repository.js';
import { SegmentLibrary } from './segment.library.js';
import { SegmentRepository, type Segment } from './segment.repository.js';
import { SEGMENT_CONTENT_TYPES, SegmentStore, type SegmentContentType, type SegmentExtension } from './segment.store.js';
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
 * What the audio route hands the generated router.
 *
 * `contentType` is the answer, not decoration: the operation declares every format the store holds
 * and the router sets `ctx.type` from whichever this names. Both consumers pick their behaviour
 * from that header rather than from the bytes, so it is the difference between a wav that plays and
 * one that silently does not. See the note on `SEGMENT_CONTENT_TYPES`.
 */
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
     * The voices the station can be asked to speak in.
     *
     * Answers rather than throwing when nothing can speak, with `reason` saying which of the three
     * ways that happens it is (nothing installed, several installed and none chosen, or a chosen one
     * that is not running). A console drawing an empty list wants to explain it; a 503 would leave
     * it guessing.
     */
    async listVoices(): Promise<VoiceList> {
        const plugin = this.speech.speaker();
        if (plugin === undefined) return { voices: [], reason: this.speech.explainSpeaker() };

        const voices = await this.speech.voices(plugin);
        return { voices, pluginId: plugin.record.id };
    }

    /**
     * A short line spoken in one voice, rendered on the first ask and cached after.
     *
     * The cache is the filesystem: the key is derived from the plugin, the voice and the fixed
     * sample line, so a hit is the file being there and a remapped voice mints a different key
     * rather than serving the old audio back. Nothing records the mapping, because the name is the
     * mapping.
     *
     * `ext` is not part of the key, so a store that already holds this sample in one format is
     * probed for each: an operator who changes the plugin's output format gets a re-render on the
     * next click rather than a stale file under a name that no longer matches.
     *
     * @throws 503 when nothing can speak, 502 when the engine refused. Both are about the station
     * rather than about the voice asked for, which is why neither is a 404.
     */
    async getVoiceSample(voiceId: string): Promise<SegmentAudioResponse> {
        const plugin = this.speech.speaker();
        if (plugin === undefined) throw httpError(503).withDetails({ message: this.speech.explainSpeaker() });

        const key = this.samples.keyFor(plugin.record.id, voiceId);

        for (const ext of this.samples.extensions) {
            const cached = await this.samples.read(key, ext);
            if (cached !== undefined) return sampleResponse(cached, key, ext);
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
                    text: SAMPLE_TEXT,
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
        return sampleResponse(bytes, key, ext);
    }

    /** Take whatever is in the inbox into the library. */
    async scanLibrary(): Promise<SegmentScanResult> {
        return await this.library.scan();
    }
}

/**
 * A cached sample, as the audio route hands it over.
 *
 * The ETag is the cache key rather than a hash of the bytes, and for once those are different
 * things: the key already identifies this voice saying this line, so a re-render of identical audio
 * is the same ETag and a remapped voice is a different one. Which is exactly what a validator should
 * mean here.
 */
const sampleResponse = (body: Buffer, key: string, ext: SegmentExtension): SegmentAudioResponse => ({
    contentType: SEGMENT_CONTENT_TYPES[ext],
    body,
    headers: { cacheControl: CACHE_CONTROL, etag: `"${key}"` },
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
    };
}
