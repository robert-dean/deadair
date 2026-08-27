import { Injectable } from 'injectkit';
import { httpError } from '@maroonedsoftware/errors';
import { PadSetRepository } from '#modules/render/pad.set.repository.js';
import { SpeechService } from '#modules/render/speech.service.js';
import { errorText } from '#modules/shared/error.text.js';
import { Logger } from '@maroonedsoftware/logger';
import { PersonaRepository } from './persona.repository.js';
import { PersonaStoriesRepository } from './persona.stories.repository.js';
import { detailHandle, filledFields, planImport, storyHandle, type StationSnapshot } from './persona.file.plan.js';
import { draftOf, PersonasService } from './personas.service.js';
import type { PersonaFile, PersonaFilePersona, PersonaImportPlan, PersonaImportResult } from './types/personas.types.js';

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
        // For the ANSWER alone, which is the roster in the shape the console reads and which this
        // has no business mapping a second time. Every write in this area answers the whole list,
        // because more than the named row can change; an import is the extreme case of that.
        private readonly roster: PersonasService,
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
     * Write a file into this station.
     *
     * MERGE, and the word is doing work: a character held under the same key has its SHEET rewritten
     * and its stories ADDED to, and nothing is ever deleted. A story the operator here wrote and the
     * file has never heard of stays exactly where it is, which is what makes importing somebody's
     * character safe to do on top of your own edits to it.
     *
     * ## Why this writes through the repositories rather than `PersonasService`
     *
     * `docs/todo/backup-and-restore.md` says an import writes through the SERVICES, and states the
     * two reasons: a settings write has to defer `configStore.reload()` through `AfterCommit`, and a
     * `plugin_configs` write has to reinit the plugin. **Neither has an analogue here.** A persona
     * row has no deferred side effect and nothing watches the table — the one thing that reaches the
     * running show is `setActive`, which this deliberately never calls. So the rule has nothing to
     * bite on, and going through a surface that answers the whole roster on every write would be
     * twenty-four full list reads to import twenty-four characters.
     *
     * What IS shared is the one piece of that service worth sharing: `draftOf`, which decides what a
     * blank optional field means. A second mapper would be a second opinion about whether a djName
     * somebody left empty is unset or is the empty string, and that difference has no symptom.
     *
     * ## All or nothing
     *
     * Nothing is caught. A failure part-way leaves the station exactly as it was, because the request
     * runs in one transaction — `SettingsService.write`'s posture, and right for the same reason: the
     * preview is what stands between an operator and a surprise, so a file that landed half way would
     * be the one outcome nothing had described to them.
     *
     * ## It puts nobody on air
     *
     * There is no code here that could, and none is wanted. `PUT /personas/{id}/active` is the one
     * path and it already tells the show that is running, through a `recast` posted after the commit.
     * An imported character arrives beside the others and takes over when somebody says so.
     */
    async import(file: PersonaFile): Promise<PersonaImportResult> {
        const plan = planImport(file, await this.snapshot(file));

        let created = 0;
        let updated = 0;
        let storiesWritten = 0;
        let detailsWritten = 0;

        // Read once and kept, rather than `find`ing per character: the plan already decided which
        // keys exist, and this is the map from those keys to the ids the repositories want.
        const held = new Map((await this.personas.list()).map(persona => [persona.key, persona.id]));

        for (const persona of file.personas) {
            const id = held.get(persona.key);
            const saved = id === undefined ? await this.personas.create(draftOf(persona)) : await this.personas.update(id, draftOf(persona));
            if (id === undefined) created += 1;
            else updated += 1;

            // A persona that vanished between the read above and this write is somebody deleting a
            // character mid-import. Nothing to write its stories against, and the transaction is
            // about to be rolled back anyway.
            if (saved === undefined) throw httpError(409).withDetails({ message: `"${persona.key}" was deleted while this file was being imported` });

            const written = await this.writeStories(persona);
            storiesWritten += written.stories;
            detailsWritten += written.details;
        }

        this.logger.info('personas: imported a persona file', {
            format: file.format,
            from: file.station,
            created,
            updated,
            stories: storiesWritten,
            details: detailsWritten,
        });

        return { plan, created, updated, storiesWritten, detailsWritten, personas: await this.roster.list() };
    }

    /**
     * One character's stories and details, skipping whatever this station already holds.
     *
     * Deduped by `holds` / `holdsDetail`, which are the checks the enrichment pass already uses and
     * which match the way the store's own partial unique index does. Asked rather than caught,
     * because the index does not cover `rejected` — a story turned down here and re-offered by a file
     * would otherwise be an unhandled constraint violation rather than a row that is already there.
     *
     * A `rejected` story is written and then set, because `add` takes a state and the SERVICE-shaped
     * path does not. Carrying that state is what stops the enrichment pass proposing it again on this
     * station, which is `pronunciations`' argument one table over.
     */
    private async writeStories(persona: PersonaFilePersona): Promise<{ stories: number; details: number }> {
        if (persona.stories.length === 0) return { stories: 0, details: 0 };

        // Read once for the character rather than asked per story, which is what `holds` and
        // `holdsDetail` would each cost. Those two are the definition of the match and this agrees
        // with them by using the same handles the planner keys on — see `persona.file.plan.ts`.
        const held = new Map((await this.stories.list(persona.key)).map(story => [storyHandle(story.title), story]));

        let stories = 0;
        let details = 0;

        for (const story of persona.stories) {
            let row = held.get(storyHandle(story.title));

            if (row === undefined) {
                row = await this.stories.add({
                    personaKey: persona.key,
                    title: story.title,
                    story: story.story,
                    // Whoever exported this stood behind it, so on this side it is the receiving
                    // operator's own — `PersonaStoryWrite`'s "always theirs", one install further
                    // out. See `persona.file.ts` for why `origin` does not travel.
                    origin: 'operator',
                    // Carried so the enrichment pass does not propose here what was turned down
                    // there, which is `pronunciations`' argument one table over.
                    state: story.state ?? 'active',
                });
                stories += 1;
            }

            const carried = new Set(row.details.map(detail => detailHandle(detail.detail)));
            for (const detail of story.details) {
                if (carried.has(detailHandle(detail.detail))) continue;

                await this.stories.addDetail({ storyId: row.id, detail: detail.detail, origin: 'operator', state: detail.state ?? 'active' });
                details += 1;
            }
        }

        return { stories, details };
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
        const personas = new Map(held.map(persona => [persona.key, { label: persona.label, active: persona.active, filled: filledFields(persona) }]));

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
