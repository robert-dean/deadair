import { Injectable } from 'injectkit';
import { PadSetRepository } from '#modules/render/pad.set.repository.js';
import { SpeechService } from '#modules/render/speech.service.js';
import { errorText } from '#modules/shared/error.text.js';
import { Logger } from '@maroonedsoftware/logger';
import { PersonaRepository } from './persona.repository.js';
import { PersonaStoriesRepository } from './persona.stories.repository.js';
import { detailHandle, planImport, storyHandle, type StationSnapshot } from './persona.file.plan.js';
import type { PersonaFile, PersonaImportPlan } from './types/personas.types.js';

/**
 * Taking a character IN: what a file would do here, and — once the import half lands — doing it.
 *
 * ## Why this reaches into the render module
 *
 * Two of the four things a preview reports are questions only that module can answer: which station
 * voices the installed engine actually maps, and which soundboards this library holds. `PersonasModule`
 * is registered BEFORE `RenderModule` in `modules.ts`, which is fine and precedented — that list is a
 * lifecycle order rather than a resolution one, and `PersonaRehearsalService` already resolves the
 * director's writer registry from further up the same list. What would not be fine is reaching for
 * either at boot, and nothing here runs outside a request.
 *
 * ## Neither of those questions may cost a preview
 *
 * Both go through {@link vocabulary}, which swallows. Asking the speech engine means invoking a
 * plugin, which can be slow, refuse, or be pointed at a server that is not running — and a preview
 * that failed because a TTS server was down would be a page an operator cannot get past, over a
 * notice that is advisory in the first place. What is lost when either fails is one KIND of notice,
 * which is exactly the state a station with no speech plugin is in permanently.
 */
@Injectable()
export class PersonaImportService {
    constructor(
        private readonly personas: PersonaRepository,
        private readonly stories: PersonaStoriesRepository,
        private readonly speech: SpeechService,
        private readonly padSets: PadSetRepository,
        private readonly logger: Logger,
    ) {}

    /**
     * What this file would do here. Writes nothing.
     *
     * The same {@link planImport} the import itself runs, so this is the decision rather than a
     * forecast of it — the property `docs/todo/backup-and-restore.md` asks for in as many words.
     */
    async preview(file: PersonaFile): Promise<PersonaImportPlan> {
        const plan = planImport(file, await this.snapshot(file));

        this.logger.info('personas: previewed a persona file', {
            format: file.format,
            from: file.station,
            characters: plan.personas.length,
            creates: plan.personas.filter(entry => entry.outcome === 'create').length,
            notices: plan.notices.length + plan.personas.reduce((total, entry) => total + entry.notices.length, 0),
        });

        return plan;
    }

    /**
     * What this station holds, read once for the whole file.
     *
     * The stories are read only for keys this station actually has, because a character it does not
     * hold has none by definition — which on a file of twenty-four characters against a fresh
     * install is zero queries rather than twenty-four.
     */
    private async snapshot(file: PersonaFile): Promise<StationSnapshot> {
        const held = await this.personas.list();
        const personas = new Map(held.map(persona => [persona.key, { label: persona.label, active: persona.active }]));

        const wanted = file.personas.map(persona => persona.key).filter(key => personas.has(key));
        const stories = new Map(await Promise.all(wanted.map(async key => [key, await this.storiesFor(key)] as const)));

        const { voices, soundboards } = await this.vocabulary();

        return {
            personas,
            stories,
            ...(voices === undefined ? {} : { voices }),
            ...(soundboards === undefined ? {} : { soundboards }),
        };
    }

    /** One persona's handles, keyed the way the store's own partial unique index matches them. */
    private async storiesFor(key: string): Promise<ReadonlyMap<string, ReadonlySet<string>>> {
        const held = await this.stories.list(key);

        return new Map(held.map(story => [storyHandle(story.title), new Set(story.details.map(detail => detailHandle(detail.detail)))]));
    }

    /**
     * The two vocabularies a sheet can point at, each one best-effort.
     *
     * `voices` stays `undefined` for a station where nothing can speak — which is an ordinary state,
     * and where a notice per character would be a page of complaints about a decision nobody has
     * made. It is also `undefined` when the engine could not be asked, which is deliberately the same
     * answer: in both cases this station has said nothing about which voices exist, so a file's claim
     * cannot be contradicted.
     *
     * `soundboards` differs, and the difference is the whole reason both are optional rather than
     * defaulted to empty. An empty set there is a real answer — a station with no racks — and worth
     * a notice. `undefined` is only ever a read that failed, which must not be reported as though the
     * table had answered and been empty.
     */
    private async vocabulary(): Promise<{ voices?: ReadonlySet<string>; soundboards?: ReadonlySet<string> }> {
        let voices: ReadonlySet<string> | undefined;
        try {
            const speaker = this.speech.speaker();
            if (speaker !== undefined) voices = new Set((await this.speech.voices(speaker)).map(voice => voice.id));
        } catch (error) {
            this.logger.info(
                `personas: could not ask the speech engine which voices it maps, so a preview will not mention them (${errorText(error)})`,
            );
        }

        let soundboards: ReadonlySet<string> | undefined;
        try {
            soundboards = new Set((await this.padSets.list()).map(set => set.key));
        } catch (error) {
            this.logger.info(`personas: could not read the soundboards, so a preview will not mention them (${errorText(error)})`);
        }

        return { ...(voices === undefined ? {} : { voices }), ...(soundboards === undefined ? {} : { soundboards }) };
    }
}
