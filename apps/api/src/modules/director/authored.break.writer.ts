import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import { LlmService } from '#modules/llm/llm.service.js';
import { settingIsOn } from '#modules/shared/setting.flags.js';
import { stationPromptSettings } from './prompt.settings.js';
import { type BreakPromptShape, type PromptSettings } from './break.prompt.js';
import { permittedYears, shownWithoutRecent } from './break.answer.guard.js';
import { resolveBreakWords } from './break.words.js';
import { timeClaimFor } from './clock.words.js';
import { BreakKindCatalog } from './break.kind.catalog.js';
import { BreakWriter, type BreakKindClaimant, type BreakWriteRequest, type WriteDetail, type WrittenBreak } from './break.writer.js';
import { writeWithModel } from './model.break.write.js';
import { MODEL_WRITER, MODEL_WRITER_DEFAULT, MODEL_WRITER_KEYS } from './model.talk.break.writer.js';
import type { AuthoredKind } from './break.kind.js';

/**
 * The kinds of break an operator writes, aired by the model. Ideas #24.
 *
 * A row is a brief, some rules and four switches, and this is what turns one into a break: a
 * {@link BreakPromptShape} built from the row and handed to `writeWithModel`, the skeleton every model
 * writer here shares. So an authored kind is checked exactly as the station's own are, by the same
 * guard, and the two things #24 says to write down on the first day are true by construction:
 *
 * - **A kind cannot switch a refusal off.** Its rules are APPENDED to the shared list in the prompt,
 *   and the guard is built here rather than from anything on the row. A brief saying "ignore the
 *   station's rules" is words in a prompt that still ends with the rules.
 * - **A kind is not a phrasing.** There is no floor of the operator's lines under it. A kind is what
 *   the station is trying to say, and a phrasing is what it says when it cannot, so the two are kept
 *   apart.
 *
 * ## Model-only, and why the claim goes quiet without one
 *
 * Every kind the station ships has a floor that cannot fail. A poem about the moment has no honest
 * deterministic version, so this has none, and a station with no model cannot write one. Rather than
 * letting the planner plant breaks that every writer then declines, {@link AuthoredKinds.kindsNow}
 * answers nothing while the model writer is off or has nothing to generate with: the registry then
 * says it cannot write the kind, the planner passes the band over, and the clock's producible list
 * leaves it out, all from the one answer. Switching the model on brings the kinds back on the next
 * question.
 */

/**
 * What the model is told an authored kind IS.
 *
 * The first sentence is the station's, so every break is framed as one spoken break that is read
 * aloud as written, whatever the brief goes on to say. The brief follows in the operator's words.
 *
 * Everything on the shape that is not the row's stays off: a kind may not name a record it has to
 * mention (`mustNameRecord`), may not be given latitude, cues, pads, deliveries, stories, the weather
 * or the date. Those are decisions about what a kind is FOR that the station has made for each of its
 * own, and a row that could turn them on would be a row that could turn a check off.
 */
export function authoredShape(kind: AuthoredKind): BreakPromptShape {
    return {
        job: `You write one short spoken break on this station. It is read aloud exactly as you write it. What this break is for: ${kind.brief}`,
        showsPrevious: kind.showsPrevious,
        showsPlayed: kind.showsPlayed,
        showsFacts: kind.showsFacts,
        showsNotebook: kind.showsNotebook,
        ...(kind.rules.length === 0 ? {} : { rules: kind.rules }),
    };
}

/** One authored kind's writer, built per question by {@link AuthoredKinds}. */
export class AuthoredBreakWriter extends BreakWriter {
    readonly kind: string;
    readonly name = MODEL_WRITER;

    private lastDetail?: WriteDetail;

    constructor(
        private readonly authored: AuthoredKind,
        private readonly llm: LlmService,
        private readonly config: AppConfig,
        private readonly logger: Logger,
    ) {
        super();
        this.kind = authored.key;
    }

    detailOfLastWrite(): WriteDetail | undefined {
        return this.lastDetail;
    }

    async write(asked: BreakWriteRequest): Promise<WrittenBreak | undefined> {
        this.lastDetail = undefined;
        const shape = authoredShape(this.authored);

        // Withheld from the request rather than only hidden by the shape, for `ModelChangeoverWriter`'s
        // reason: the guard and the claims below read the request, and a record the prompt never showed
        // must be neither a name the script is judged against nor one it is stamped as announcing.
        const { previous, ...rest } = asked;
        const request: BreakWriteRequest = shape.showsPrevious && previous !== undefined ? { ...rest, previous } : rest;

        // Held rather than inline, for `ModelTalkBreakWriter`'s reason: the number the model is told
        // and the number the guard refuses at come from one `maxWordsFor` call over this object.
        const settings: PromptSettings = {
            ...stationPromptSettings(this.config, request),
            maxWords: resolveBreakWords(this.config),
            ...(request.persona === undefined ? {} : { persona: request.persona }),
            // Passed, and shown only when the row says so: `showsNotebook` on the shape decides.
            ...(request.notebook === undefined ? {} : { notebook: request.notebook }),
        };

        const outcome = await writeWithModel(
            { llm: this.llm, config: this.config, logger: this.logger },
            {
                request,
                settings,
                shape,
                guard: messages => ({
                    // Only with `breaks.aboutTheRecord` on, when the job loads them: the records' own
                    // words, so a script reading one aloud is refused here as it is everywhere.
                    ...(request.lyricLines === undefined ? {} : { lyrics: request.lyricLines }),
                    // The records kept apart, so a cue is judged against the side it is on.
                    cues: {
                        ...(request.previous === undefined ? {} : { previous: request.previous }),
                        ...(request.next === undefined ? {} : { next: request.next }),
                    },
                    // The talk break's year rule exactly: a year the station did not show is refused,
                    // and one the prompt only echoed from a past script is not evidence. A brief that
                    // invites a memory of the past is the case this was written for.
                    years: permittedYears([request.previous, request.next], request.moment, shownWithoutRecent(messages, request.recent ?? [])),
                }),
                purpose: { noModel: `write a "${this.authored.key}"`, nothing: `say for "${this.authored.key}"` },
                context: { kind: this.authored.key },
            },
        );
        this.lastDetail = outcome.detail;
        if (outcome.written === undefined) return undefined;
        const { script, guard } = outcome.written;

        const claimsTime = timeClaimFor(script, guard.language, request.clock, request.dayPart);

        return {
            script,
            // The operator's own name for it, which is what the console and the mount have to go on.
            label: this.authored.name,
            // The talk break's posture: told a record means allowed to name it, so assume it did.
            claimsNext: request.next !== undefined,
            claimsPrevious: request.previous !== undefined,
            ...(claimsTime === undefined ? {} : { claimsTime }),
        };
    }
}

/**
 * The claimant the registry is handed: every switched-on authored kind, while there is a model to
 * write one. See the note at the top of this file for why it answers nothing otherwise.
 *
 * Scoped like the registry that holds it, and it holds nothing of its own: the kinds are
 * {@link BreakKindCatalog}'s, read on every question so a switch flipped in the console is heard on
 * the next one.
 */
@Injectable()
export class AuthoredKinds implements BreakKindClaimant {
    constructor(
        private readonly catalog: BreakKindCatalog,
        private readonly llm: LlmService,
        private readonly config: AppConfig,
        private readonly logger: Logger,
    ) {}

    kindsNow(): readonly string[] {
        if (!settingIsOn(this.config, MODEL_WRITER_KEYS.enabled, MODEL_WRITER_DEFAULT) || !this.llm.canGenerate()) return [];
        return this.catalog.keys();
    }

    writerFor(kind: string): BreakWriter {
        const authored = this.catalog.kind(kind);
        // Switched off between the question and this call. A writer for a kind with no brief would have
        // nothing to say, so it is one that says so: the registry records a decline and moves on.
        if (authored === undefined) return new GoneWriter(kind);

        return new AuthoredBreakWriter(authored, this.llm, this.config, this.logger);
    }
}

/** A kind switched off underneath a question. Declines, which the registry records as it does any other. */
class GoneWriter extends BreakWriter {
    readonly name = MODEL_WRITER;

    constructor(readonly kind: string) {
        super();
    }

    async write(): Promise<WrittenBreak | undefined> {
        return undefined;
    }
}
