import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import { ActivityRecorder } from '#modules/activity/activity.recorder.js';
import { LlmService } from '#modules/llm/llm.service.js';
import { errorText } from '#modules/shared/error.text.js';
import { settingIsOn } from '#modules/shared/setting.flags.js';
import { MODEL_PRIORITY, MODEL_WAIT_MS } from './persona.distil.service.js';
import { PersonaRepository } from './persona.repository.js';
import { PersonaStoriesRepository } from './persona.stories.repository.js';
import { readProposals, storyPrompt, type ExistingStory } from './persona.story.model.js';

/**
 * The story pass's settings, keyed like every other model-driven feature.
 *
 * Off by default, for `PERSONA_NOTES_KEYS`' reason and one of its own: this is the only pass on the
 * station that writes something the operator MUST look at before it can ever be used, so turning it
 * on is accepting a queue rather than accepting some background generations.
 */
export const PERSONA_STORIES_KEYS = {
    enabled: 'llm.personaStories',
    model: 'llm.personaStoriesModel',
} as const;

/** OFF. A shelf an operator fills in by hand works perfectly well; this only adds to it. */
export const PERSONA_STORIES_DEFAULT = false;

/** How long one character's pass may take once it has the model slot. */
export const MODEL_BUDGET_MS = 120_000;

/**
 * How many stories a character may accumulate before the pass stops proposing new ones.
 *
 * Twelve, and the number is doing something specific: at most ONE story reaches any break, so a
 * shelf of thirty is twenty-eight anecdotes a listener will never hear and an operator has to read
 * anyway. Past this the pass may still propose DETAILS, which is the half that makes a character's
 * past deepen rather than simply lengthen — and which is what the prompt already prefers.
 */
export const MAX_STORIES_PER_CHARACTER = 12;

/** One pass, for the job's log line and the activity row. */
export interface StoryPassSummary {
    /** Characters looked at. */
    considered: number;
    /** Characters the model actually answered for. */
    read: number;
    /** New stories proposed. */
    stories: number;
    /** Details proposed on stories that already existed. */
    details: number;
    failed: number;
}

const empty = (): StoryPassSummary => ({ considered: 0, read: 0, stories: 0, details: 0, failed: 0 });

/**
 * The station remembering things on its characters' behalf.
 *
 * ## Everything it writes is a PROPOSAL, and that is the whole safety property
 *
 * `PersonaDistilService` next door can put a `said` note straight into use because the note quotes a
 * line the station actually broadcast, and a quote that does not exist in the corpus is thrown away.
 * There is no equivalent check here and there cannot be one: a story is fiction about a character,
 * so nothing entails it and a verifier has no question to answer. What replaces the check is the
 * operator, and it is why nothing this writes can reach a listener until somebody has read it.
 *
 * ## It uses the station's tools, which is what "grounded" means here
 *
 * The conversation runs with tools ON, unlike every break writer, so a model can go and look at what
 * this station actually plays before deciding what its presenter remembers. That is the difference
 * between a character who has a past and one who has a past about records nobody here owns.
 *
 * **The seam a web search would drop into is `ToolRegistry`, not this file.** A `search` capability
 * becomes one more source there and this pass gets it with no change; see
 * `docs/todo/tool-plugins.md`. What would need re-reading on that day is the fence in
 * `persona.story.model.ts`, because a pass that can look things up can also state them.
 *
 * ## Everything about it declines quietly
 *
 * The setting is off, there is no model plugin, the slot is busy with a break, the answer came back
 * unparseable, the character's shelf is full: all of them leave the shelf exactly as it was, and
 * none costs the station anything on air.
 */
@Injectable()
export class PersonaStoryPassService {
    constructor(
        private readonly personas: PersonaRepository,
        private readonly stories: PersonaStoriesRepository,
        private readonly llm: LlmService,
        private readonly activity: ActivityRecorder,
        private readonly config: AppConfig,
        private readonly logger: Logger,
    ) {}

    /**
     * One pass over every character this station has.
     *
     * Every character rather than only the one on air, for the distil pass's reason: a persona that
     * presents Tuesday mornings has as much of a past as the default one and would otherwise never
     * accumulate any of it.
     */
    async run(stop?: AbortSignal): Promise<StoryPassSummary> {
        const summary = empty();

        // Read per pass rather than held, so an operator turning it on gets it on the next run.
        if (!settingIsOn(this.config, PERSONA_STORIES_KEYS.enabled, PERSONA_STORIES_DEFAULT)) return summary;
        if (!this.llm.canGenerate()) {
            this.logger.debug(`personas: no model to remember with (${this.llm.explainGenerator()})`);
            return summary;
        }

        for (const persona of await this.personas.list()) {
            if (stop?.aborted) break;
            summary.considered++;

            try {
                const read = await this.remember(persona.key, persona);
                if (read === undefined) continue;

                summary.read++;
                summary.stories += read.stories;
                summary.details += read.details;
            } catch (error) {
                // Includes the gate's own timeout, which is the station using its model for something
                // that matters more rather than a failure of this pass. Nothing is written either
                // way and the character comes round again tomorrow.
                summary.failed++;
                this.logger.warn(`personas: could not write anything down for "${persona.key}" (${errorText(error)})`);
            }
        }

        // One row carrying a count rather than one per proposal, on `StationLineup.markAiring`'s rule
        // — and only when something is actually WAITING, because the feed is where an operator learns
        // there is a queue and a pass that proposed nothing is not news.
        const proposed = summary.stories + summary.details;
        if (proposed > 0) {
            void this.activity.record({
                // `director`, like the notebook pass beside it: who the station is presenting as is a
                // programming fact, and the feed's modules are about where an operator would look.
                module: 'director',
                kind: 'persona.storiesProposed',
                detail:
                    proposed === 1
                        ? 'The station thought of something one of its characters might have lived through, and is waiting to be told whether to keep it.'
                        : `The station thought of ${proposed} things its characters might have lived through, and is waiting to be told whether to keep them.`,
                data: { stories: summary.stories, details: summary.details, characters: summary.read },
            });
        }

        return summary;
    }

    /**
     * One character, asked for and written down. `undefined` when the model answered with nothing.
     *
     * There is no watermark here, which is where this parts company with the distil pass: that one
     * walks a stream of scripts and must not read the same window twice, and this one has no corpus
     * to get through. What stops it proposing the same story every night is the store — the partial
     * unique index over the handle, and the `rejected` state that outlives the pass — plus the
     * existing shelf being in the prompt.
     */
    private async remember(
        personaKey: string,
        persona: { label: string; style: string; diction?: readonly string[]; quirks?: readonly string[]; avoid?: readonly string[] },
    ): Promise<{ stories: number; details: number } | undefined> {
        const held = await this.stories.list(personaKey);
        // Turned-down proposals are shown as well as live ones, and deliberately: the unique index
        // would refuse a duplicate handle anyway, so leaving them out would spend a generation
        // rediscovering something somebody has already said no to.
        const existing: ExistingStory[] = held
            .filter(story => story.state !== 'rejected')
            .map(story => ({
                title: story.title,
                story: story.story,
                details: story.details.filter(detail => detail.state === 'active').map(detail => detail.detail),
            }));

        const model = this.config.get(PERSONA_STORIES_KEYS.model, '').trim();
        const started = Date.now();

        const answer = await this.llm.converse(
            {
                messages: storyPrompt(
                    {
                        label: persona.label,
                        style: persona.style,
                        ...(persona.diction === undefined ? {} : { diction: persona.diction }),
                        ...(persona.quirks === undefined ? {} : { quirks: persona.quirks }),
                        ...(persona.avoid === undefined ? {} : { avoid: persona.avoid }),
                    },
                    existing,
                ),
                ...(model.length === 0 ? {} : { model }),
                reasoningEffort: 'low',
            },
            // Tools ON, which is the one place this differs from every other pass on the station.
            // See the class note: a character's past is worth having only where it is about records
            // this station actually holds, and that is a question the model has to go and ask.
            { budgetMs: MODEL_BUDGET_MS, maxWaitMs: MODEL_WAIT_MS, priority: MODEL_PRIORITY },
        );

        const proposals = readProposals(answer.text, existing);
        if (proposals.length === 0) {
            this.logger.debug('personas: a model had nothing to remember for this character', { persona: personaKey });
            return undefined;
        }

        const full = existing.length >= MAX_STORIES_PER_CHARACTER;
        const stories = full ? [] : proposals.filter(proposal => proposal.kind === 'story');
        const details = proposals.filter(proposal => proposal.kind === 'detail');

        // `suggested`, all of it, and that is the whole safety property of this pass. See the class
        // note for why there is nothing here to verify instead.
        const wroteStories = await this.stories.addAll(
            stories.map(proposal => ({
                personaKey,
                title: proposal.title,
                story: proposal.kind === 'story' ? proposal.story : '',
                state: 'suggested' as const,
                origin: 'model' as const,
                ...(proposal.source === undefined ? {} : { source: proposal.source }),
            })),
        );

        const byTitle = new Map(held.map(story => [story.title.trim().toLowerCase(), story.id]));
        const wroteDetails = await this.stories.addDetails(
            details.flatMap(proposal => {
                const storyId = byTitle.get(proposal.title.trim().toLowerCase());
                if (storyId === undefined || proposal.kind !== 'detail') return [];

                return [
                    {
                        storyId,
                        detail: proposal.detail,
                        state: 'suggested' as const,
                        origin: 'model' as const,
                        ...(proposal.source === undefined ? {} : { source: proposal.source }),
                    },
                ];
            }),
        );

        // The numbers rather than a verdict, for the distil pass's reason: "the model stopped
        // thinking of anything" and "everything it thought of was one this character already had"
        // are two different questions and neither can be asked of figures nobody gathered. A count
        // below what was proposed is the unique index catching a duplicate, which is the ordinary
        // case on a settled character rather than a fault.
        this.logger.info('personas: a model wrote something down for a character', {
            persona: personaKey,
            existing: existing.length,
            proposed: proposals.length,
            stories: wroteStories,
            details: wroteDetails,
            ...(full ? { shelfFull: true } : {}),
            durationMs: Date.now() - started,
            finish: answer.finishReason,
            ...(answer.usage === undefined ? {} : { tokens: answer.usage.totalTokens ?? answer.usage.outputTokens }),
        });

        return { stories: wroteStories, details: wroteDetails };
    }
}
