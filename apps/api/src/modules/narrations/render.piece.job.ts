import { Container, Injectable } from 'injectkit';
import { JobContext } from '@maroonedsoftware/jobbroker';
import { Logger } from '@maroonedsoftware/logger';
import { PgBossJobBroker } from '@maroonedsoftware/jobbroker/pgboss';
import type { NarrationText } from '@deadair/plugin-sdk';
import { PlainJob } from '#modules/jobs/plain.job.js';
import { asNarrationPlugin } from '#modules/plugins/plugin.capabilities.js';
import { byPluginId, pluginsWith } from '#modules/plugins/plugin.selection.js';
import { PluginInvoker } from '#modules/plugins/plugin.invoker.js';
import { PluginRegistry } from '#modules/plugins/plugin.registry.js';
import { PersonaRepository } from '#modules/personas/persona.repository.js';
import { ProductionRepository } from '#modules/productions/production.repository.js';
import { packParts } from '#modules/render/pack.parts.js';
import { SegmentRepository } from '#modules/render/segment.repository.js';
import { SpeechService } from '#modules/render/speech.service.js';
import { errorText } from '#modules/shared/error.text.js';
import { NARRATION_KIND } from './narration.kind.js';
import { NarrationPieceRepository } from './narration.piece.repository.js';
import { WORDS_PER_MINUTE } from './narration.source.js';
import { splitSeriesId } from './series.ids.js';

/** Which piece to speak: the station's own id for it, `narration_pieces.id`. */
export interface RenderPiecePayload {
    pieceId?: string;
}

/**
 * How long a plugin is given to produce one piece's words.
 *
 * Far longer than a listing gets, because the work is different in kind: this is where a plugin
 * fetches and parses whatever the piece actually lives in. The SDK tells plugin authors to expect it.
 */
export const GET_TEXT_TIMEOUT_MS = 60_000;

/** The shortest a production may claim to be. `productions.target_ms` has a `> 0` check to satisfy. */
export const MIN_TARGET_MS = 30_000;

/**
 * Turn one piece of somebody else's writing into a production the station has already written.
 *
 * ## What this does that no other job does
 *
 * Every other production is WRITTEN: `ProduceProductionJob` runs its passes, a model decides the
 * words, and the beats are planned as it goes. Here the words exist already, because an author wrote
 * them, so this opens the production directly at `rendering` and plants every beat `written`, which
 * `SegmentRepository.plan` does for anything handed a script. No model is called at any point.
 *
 * From there nothing is new. `RenderSegmentJob` speaks each beat with the lexicon, the cue strip and
 * the persona's voice; the director notices when they are all `ready` and asks the mixer to join
 * them; `NarrationScheduler` attaches the joined audio to this piece.
 *
 * ## Three things that look like details and are not
 *
 * **It opens with `ProductionRepository.open` rather than `ProductionsService.request`.** That one
 * sends `director.produce`, whose first pass would claim the row `planned → drafting` and write model
 * beats over these. The service is the door for a production somebody wants WRITTEN; this is not one.
 *
 * **The narrator is the station's DEFAULT host, not whoever is presenting.** This runs hours ahead of
 * the slot, on whatever broadcast happens to be on at the time, so reading the presenter off the
 * current show would give chapter three one voice and chapter four another. A series has one reader.
 *
 * **Every failure is written on the piece and nothing is thrown**, which is why the job has no retry:
 * the row says what went wrong, and whatever asks next is the retry. A production that was opened and
 * then lost the race for the row is cancelled rather than left to be made and never used.
 */
@Injectable()
export class RenderPieceJob extends PlainJob<RenderPiecePayload> {
    constructor(
        private readonly pieces: NarrationPieceRepository,
        private readonly productions: ProductionRepository,
        private readonly segments: SegmentRepository,
        private readonly personas: PersonaRepository,
        private readonly speech: SpeechService,
        private readonly pluginRegistry: PluginRegistry,
        private readonly pluginInvoker: PluginInvoker,
        private readonly jobs: PgBossJobBroker,
        context: JobContext,
        container: Container,
        logger: Logger,
    ) {
        super(context, container, logger);
    }

    protected async execute(payload?: RenderPiecePayload, signal?: AbortSignal): Promise<void> {
        if (!payload?.pieceId) {
            this.logger.warn('narrations: a render was sent with no piece to speak', { job: this.context.id });
            return;
        }

        const piece = await this.pieces.get(payload.pieceId);
        if (piece === undefined) {
            this.logger.info('narrations: the piece a render was for is gone', { job: this.context.id, piece: payload.pieceId });
            return;
        }
        // Already spoken, or already being spoken by somebody else's production. Either way this send
        // is a duplicate, which is free by design.
        if (piece.segmentId !== undefined || piece.productionId !== undefined) return;

        const words = await this.wordsFor(piece.id, piece.seriesId, piece.pieceId);
        if (words === undefined) return;

        if (signal?.aborted) {
            await this.pieces.markRenderFailed(piece.id, 'the render was abandoned before it started');
            return;
        }

        // Who reads it, and in what voice. Both halves are needed: a beat with no voice would be
        // spoken by whatever the engine defaults to, which is not a decision anybody made.
        const narrator = await this.personas.presenting(undefined);
        if (narrator?.voice === undefined) {
            await this.pieces.markRenderFailed(piece.id, 'the station has nobody to read it: its host has no voice');
            return;
        }

        const parts = packParts(words.parts, await this.speech.maxCharacters(), piece.language);
        if (parts.length === 0) {
            await this.pieces.markRenderFailed(piece.id, 'there were no words in it');
            return;
        }

        const production = await this.productions.open({
            kind: NARRATION_KIND,
            title: piece.title,
            targetMs: targetFor(piece.wordCount),
            // Nothing is written, so the mode only has to be one the row's check accepts. `quick` is
            // the one that means the fewest passes, which is the truest of the three here.
            writingMode: 'quick',
            personaId: narrator.id,
            ...(piece.scheduledFor === undefined ? {} : { scheduledFor: piece.scheduledFor }),
        });

        // Straight past every writing pass: the author did that. `planned → rendering` is a transition
        // nothing else makes, and it is the whole difference between this and a production the station
        // writes for itself.
        if (!(await this.productions.moveTo(production.id, 'rendering', 'planned'))) {
            await this.pieces.markRenderFailed(piece.id, 'the production could not be started');
            return;
        }

        // The row is claimed before any beat is planted, so two renders that both got this far end
        // with one production making audio and the other cancelled, rather than two speaking the same
        // chapter into two piles of segments.
        if (!(await this.pieces.markProduction(piece.id, production.id))) {
            await this.productions.cancel(production.id);
            this.logger.info('narrations: another render got there first, so this one was dropped', { job: this.context.id, piece: piece.id });
            return;
        }

        const context = contextFor(piece);
        for (const [ordinal, script] of parts.entries()) {
            const planned = await this.segments.plan({
                kind: NARRATION_KIND,
                label: labelFor(piece.title, ordinal, parts.length),
                script,
                voice: narrator.voice,
                personaId: narrator.id,
                writer: 'narration',
                productionId: production.id,
                productionOrdinal: ordinal,
                context,
                reason: 'a piece of writing the station is reading out',
            });

            // `background`, because this is hours from its slot and the engine is the same one every
            // break needs. The gate orders by rank and does not preempt, so a break planted while this
            // is being spoken waits for one part rather than the whole chapter.
            await this.jobs.send('render.segment', { segmentId: planned.id, priority: 'background' });
        }

        this.logger.info('narrations: a piece is being read out', {
            job: this.context.id,
            piece: piece.id,
            production: production.id,
            parts: parts.length,
            voice: narrator.voice,
        });
    }

    /**
     * The words of one piece, from the plugin that offered it.
     *
     * Every way this fails is written on the piece and answered as `undefined`, because each is a
     * reason an operator should be able to read off the row rather than out of a log.
     */
    private async wordsFor(id: string, qualifiedSeriesId: string, pieceId: string): Promise<NarrationText | undefined> {
        const address = splitSeriesId(qualifiedSeriesId);
        if (address === undefined) {
            await this.pieces.markRenderFailed(id, 'the series id does not name a plugin');
            return undefined;
        }

        const plugin = pluginsWith(this.pluginRegistry.list(), asNarrationPlugin)
            .sort(byPluginId)
            .find(candidate => candidate.record.id === address.pluginId);
        if (plugin === undefined) {
            await this.pieces.markRenderFailed(id, `the plugin that offered this is not installed or not running (${address.pluginId})`);
            return undefined;
        }

        try {
            const words = await this.pluginInvoker.invoke(
                plugin.record.id,
                'narration.getText',
                async () => plugin.instance.getText({ seriesId: address.seriesId, pieceId }),
                { timeoutMs: GET_TEXT_TIMEOUT_MS },
            );

            // `undefined` is the plugin saying it cannot produce the text, which the SDK keeps
            // deliberately distinct from an empty piece: one is a source that failed and the other is
            // a chapter of blank pages, and an operator reading the row should be told which.
            if (words === undefined) {
                await this.pieces.markRenderFailed(id, 'the plugin could not produce the words for it');
                return undefined;
            }

            return words;
        } catch (error) {
            await this.pieces.markRenderFailed(id, `the words could not be read (${errorText(error)})`);
            return undefined;
        }
    }
}

/**
 * How long the production claims it will be.
 *
 * `productions.target_ms` has a `> 0` check and feeds `priorityForSlot`; nothing plans the running
 * order against it, which is `narration_pieces.word_count` through `NarrationSource`. So this only
 * has to be honest and positive.
 */
function targetFor(wordCount: number | undefined): number {
    if (wordCount === undefined || wordCount <= 0) return MIN_TARGET_MS;
    return Math.max(MIN_TARGET_MS, Math.round((wordCount / WORDS_PER_MINUTE) * 60_000));
}

/** What the console calls one part of a reading: the piece, and which part of it this is. */
function labelFor(title: string, ordinal: number, total: number): string {
    const label = `${title} (${ordinal + 1}/${total})`;
    return label.length <= 400 ? label : `${label.slice(0, 399)}…`;
}

/**
 * Which piece a segment is, flat, as `segments.context` holds it.
 *
 * The same keys a fetched podcast episode writes, because the same two readers use them: the mount
 * names it through `programmeRundownTrack` and a presenter introduces it through
 * `WriteBreakJob.programmeTrack`. `programme: true` is what tells both that this is a programme
 * rather than the station talking, without either of them learning what a narration is.
 */
function contextFor(piece: { id: string; seriesId: string; pieceId: string; seriesTitle: string; title: string; summary?: string; artworkUrl?: string; author?: string }) {
    return {
        programme: true,
        narrationPieceId: piece.id,
        seriesId: piece.seriesId,
        pieceId: piece.pieceId,
        showTitle: piece.seriesTitle,
        episodeTitle: piece.title,
        ...(piece.summary === undefined ? {} : { summary: piece.summary }),
        ...(piece.artworkUrl === undefined ? {} : { artworkUrl: piece.artworkUrl }),
        ...(piece.author === undefined ? {} : { author: piece.author }),
    };
}
