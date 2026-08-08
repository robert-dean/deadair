import { Injectable } from 'injectkit';
import { httpError } from '@maroonedsoftware/errors';
import { Logger } from '@maroonedsoftware/logger';
import { PgBossJobBroker } from '@maroonedsoftware/jobbroker/pgboss';
import { SettingsRepository } from '#modules/settings/settings.repository.js';
import type { SegmentCreate, SegmentList, SegmentScanResult, Segment as SegmentView, VoiceList } from './types/render.types.js';
import { SegmentLibrary } from './segment.library.js';
import { SegmentRepository, type Segment } from './segment.repository.js';
import { SEGMENT_CONTENT_TYPES, SegmentStore, type SegmentContentType, type SegmentExtension } from './segment.store.js';
import { SpeechService } from './speech.service.js';
import { explainNoSpeaker, SPEECH_PLUGIN_KEY } from './speech.settings.js';
import { SAMPLE_TEXT, VoiceSampleStore } from './voice.sample.store.js';

/**
 * What a segment is when nobody says.
 *
 * A talk break rather than an ident, because a caller with a script in hand is writing speech; an
 * ident is the thing that already exists as a recording in the inbox.
 */
const DEFAULT_KIND = 'talkbreak';

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
        private readonly settings: SettingsRepository,
        private readonly logger: Logger,
    ) {}

    /** Everything the station can play that is not a record. */
    async listSegments(): Promise<SegmentList> {
        const segments = await this.segments.list();
        return { segments: segments.map(toView) };
    }

    /**
     * Write down something for the station to say, and set it going.
     *
     * Answers as soon as the row exists rather than waiting on a synthesis, so the segment always
     * comes back `planned`. That is not an approximation of the result — it is the result. Rendering
     * is a job precisely because nobody is waiting on it, and a caller that wants to know when the
     * audio arrived polls the list.
     *
     * The send is last, and deliberately: a job that ran before the row was committed would find
     * nothing to claim. If the send fails, the row survives as a `planned` segment an operator can
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
        const plugin = await this.speech.speaker();
        if (plugin === undefined) {
            const candidates = this.speech.speakers();
            return { voices: [], reason: explainNoSpeaker(candidates, await this.settings.get(SPEECH_PLUGIN_KEY)) };
        }

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
        const plugin = await this.speech.speaker();
        if (plugin === undefined) {
            const candidates = this.speech.speakers();
            throw httpError(503).withDetails({ message: explainNoSpeaker(candidates, await this.settings.get(SPEECH_PLUGIN_KEY)) });
        }

        const key = this.samples.keyFor(plugin.record.id, voiceId);

        for (const ext of this.samples.extensions) {
            const cached = await this.samples.read(key, ext);
            if (cached !== undefined) return sampleResponse(cached, key, ext);
        }

        let ext: SegmentExtension;
        try {
            // An empty `voiceId` means the plugin's own default, which is exactly what an absent
            // `voice` means to it, so it is dropped rather than passed as an empty string.
            ext = await this.speech.speakAs(plugin, key, this.samples, {
                text: SAMPLE_TEXT,
                ...(voiceId.length === 0 ? {} : { voice: voiceId }),
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.warn('render: could not render a voice sample', { plugin: plugin.record.id, voice: voiceId, error: message });
            throw httpError(502).withDetails({ message });
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

/** A row as the console reads it. The checksum stays here: it is a filename, not an answer. */
const toView = (segment: Segment): SegmentView => ({
    id: segment.id,
    kind: segment.kind,
    state: segment.state,
    label: segment.label,
    source: segment.source,
    playable: segment.audioChecksum !== undefined,
    ...(segment.script === undefined ? {} : { script: segment.script }),
    ...(segment.sourcePath === undefined ? {} : { sourcePath: segment.sourcePath }),
    ...(segment.durationMs === undefined ? {} : { durationMs: segment.durationMs }),
    ...(segment.error === undefined ? {} : { error: segment.error }),
    ...(segment.voice === undefined ? {} : { voice: segment.voice }),
});
