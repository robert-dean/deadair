import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import { stationPromptSettings } from './prompt.settings.js';
import { languageName } from '#modules/shared/language.name.js';
import { LlmService } from '#modules/llm/llm.service.js';
import { type BreakPromptShape, type PromptSettings } from './break.prompt.js';
import { permittedYears, shownWithoutRecent } from './break.answer.guard.js';
import { timeClaimFor } from './clock.words.js';
import { BreakWriter, type BreakWriteRequest, type WriteDetail, type WrittenBreak } from './break.writer.js';
import { CHANGEOVER_KIND, spokenNames, thankedAt } from './changeover.writer.js';
import { writeWithModel } from './model.break.write.js';
import { MODEL_WRITER } from './model.talk.break.writer.js';

/**
 * A model marking a change of programme, with the station's own words underneath it.
 *
 * Registered ahead of `ChangeoverWriter` rather than instead of it, for the reason every model binding
 * here is: no plugin, a plugin that is down or a model that rambles all fall through the registry to a
 * correct sentence. Its bounds are `ModelTalkBreakWriter`'s, imported so the two cannot drift, and it
 * shares `llm.breakWriter` with every other kind for `ModelWelcomeWriter`'s reason.
 *
 * What is its own is {@link CHANGEOVER_SHAPE}, and the records it is NOT given. The request is handed
 * over with no `previous` and no `next`, which is the floor's withholding done the same way: the record
 * behind belonged to the other show, and one ahead would be a promise on a piece about the shows.
 */

/**
 * What the model is told a changeover IS.
 *
 * No latitude. A change of programme is the one break where the listener wants the facts, which show
 * and who, and a presenter taking the whole of their room to get there is the previous show running on.
 */
export const CHANGEOVER_SHAPE: BreakPromptShape = {
    job: 'You mark the moment one show on this station ends and the next begins. It is read aloud exactly as you write it.',
    showsPrevious: false,
    rules: [
        'Say which show is starting and that you are presenting it. When somebody else presented the show before, thank everybody you ' +
            'were told presented it, once and together, by the names you were given and no other. Leave none of them out. When it was ' +
            'only you, do not thank anybody: you are carrying on.',
        'This is about the shows, not the records. Do not say what the last show played or what is coming up next.',
    ],
    opening: (request, settings) => {
        const change = request.changeover;
        const lead = change?.outgoing?.djName?.trim();
        const thanked = thankedAt(change);
        // English whatever the station speaks: this is the prompt, and the model writes the words.
        const names = spokenNames(thanked);

        return [
            change?.outgoingShow === undefined ? 'A programme on this station has just ended.' : `The show "${change.outgoingShow}" has just ended.`,
            thanked.length === 0
                ? 'You presented it yourself, or nobody named presented it, so there is nobody to thank.'
                : lead === undefined || lead.length === 0
                  ? // The lead carries on and a co-host does not: thank the one leaving, not yourself.
                    `You presented it with ${names}, who ${thanked.length === 1 ? 'is' : 'are'} not on the show starting now. Thank ${thanked.length === 1 ? 'them' : 'each of them'}.`
                  : thanked.length === 1
                    ? `It was presented by ${names}.`
                    : `It was presented by ${names}, together. Thank all ${thanked.length} of them.`,
            change?.incomingShow === undefined
                ? 'Nothing is scheduled now, so the station carries on with its own music. Do not name a show starting.'
                : `The show starting now is "${change.incomingShow}", and you are presenting it.`,
            // The greeting words verbatim, for `WELCOME_SHAPE`'s reason: an invented phrasing has no
            // expiry the station can check, and this one is stamped as a claim and checked at hand-over.
            request.greeting === undefined
                ? undefined
                : settings.language === undefined
                  ? `You may open with "${request.greeting.words}", in those words and no other way of saying it.`
                  : `You may open with the ${languageName(settings.language)} for "${request.greeting.words}".`,
        ]
            .filter(Boolean)
            .join(' ');
    },
};

@Injectable()
export class ModelChangeoverWriter extends BreakWriter {
    readonly kind = CHANGEOVER_KIND;
    readonly name = MODEL_WRITER;

    private lastDetail?: WriteDetail;

    constructor(
        private readonly llm: LlmService,
        private readonly config: AppConfig,
        private readonly logger: Logger,
    ) {
        super();
    }

    detailOfLastWrite(): WriteDetail | undefined {
        return this.lastDetail;
    }

    async write(asked: BreakWriteRequest): Promise<WrittenBreak | undefined> {
        this.lastDetail = undefined;

        // Withheld here rather than trusted to the shape: `showsPrevious: false` hides the record
        // behind, and nothing in a shape can hide the one ahead. See the note on the class.
        const { previous: _previous, next: _next, ...request } = asked;

        // Held rather than passed inline, for `ModelTalkBreakWriter`'s reason: the number the model is
        // told has to be the number the guard refuses at.
        const settings: PromptSettings = {
            ...stationPromptSettings(this.config, request),
            ...(request.persona === undefined ? {} : { persona: request.persona }),
            ...(request.notebook === undefined ? {} : { notebook: request.notebook }),
            // Passed and declined by the shape, which sets no `allowsCues`, for `ModelWelcomeWriter`'s
            // reason: what a kind permits belongs on the shape, in one place.
            ...(request.reactions === undefined ? {} : { reactions: request.reactions }),
        };

        const outcome = await writeWithModel(
            { llm: this.llm, config: this.config, logger: this.logger },
            {
                request,
                settings,
                shape: CHANGEOVER_SHAPE,
                // No record was shown, so no cue to judge and no year belongs in the answer but one the
                // prompt itself carried.
                guard: messages => ({ years: permittedYears([], request.moment, shownWithoutRecent(messages, request.recent)) }),
                purpose: { noModel: 'mark the change of programme with', nothing: 'mark the change of programme with' },
            },
        );
        this.lastDetail = outcome.detail;
        if (outcome.written === undefined) return undefined;
        const { script, guard } = outcome.written;
        const claimsTime = timeClaimFor(script, guard.language, request.greeting, request.dayPart);

        return {
            script,
            label: 'Changeover',
            // The floor's label, so a player shows the same thing whichever writer won.
            listenerLabel: request.changeover?.incomingShow ?? request.station ?? 'Changeover',
            // Stamped only when the answer really carries a time of day, as the welcome's is.
            ...(claimsTime === undefined ? {} : { claimsTime }),
        };
    }
}
