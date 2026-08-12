import { Logger } from '@maroonedsoftware/logger';
import { songKey } from './rotation.keys.js';
import { SetGenerator, type SetInputs, type TrackPick } from './set.generator.js';

/**
 * Which generators are asked for a set, in the order they are asked.
 *
 * An explicit list handed in at registration, following {@link BreakWriterRegistry}: what the
 * station chooses with is one readable line in `director.module.ts` rather than the sum of whatever
 * registered itself, and **registration order IS preference order** — a model binding goes at the
 * front and the deterministic draw stays at the back, so ranking them is one line of a module.
 *
 * ## It TOPS UP rather than falling through
 *
 * This is the one place it differs from the writer registry, and the difference is not a
 * preference. A break is one sentence: a writer either has it or it does not, so the registry takes
 * the first answer and stops. A set is `count` picks, and {@link SetGenerator.generate} already
 * documents returning fewer as an ordinary outcome rather than a failure — a small library under a
 * wide repeat window genuinely has less to offer.
 *
 * So a generator that named six of fifteen has not failed, it has done most of the job, and
 * discarding those six to fall through to the next one would throw away the good half of the
 * answer. Each generator is asked for what is still MISSING, and the last one — which cannot fail —
 * finishes whatever is left.
 *
 * ## Nothing here throws
 *
 * A generator that threw, one that answered with nothing, and one that answered with junk are the
 * same outcome: log it and ask the next. Only a chain whose every entry came up empty answers
 * short, and that is still not an exception — the caller appends what it got and the station asks
 * again when the lineup next runs low. Turning any of it into a throw would put the running order
 * at the mercy of the least reliable generator installed.
 *
 * The floor's own contract is what makes this safe: `CatalogSetGenerator` makes no network call,
 * needs no model, and cannot fail in a way that takes the station off air. **Keep it last.**
 */
export class SetGeneratorChain extends SetGenerator {
    readonly name = 'chain';

    constructor(
        private readonly generators: readonly SetGenerator[],
        private readonly logger: Logger,
    ) {
        super();
    }

    /** Which bindings will be asked, in order. For the log and for a console. */
    bindings(): string[] {
        return this.generators.map(generator => generator.name);
    }

    async generate(inputs: SetInputs): Promise<TrackPick[]> {
        if (inputs.count <= 0) return [];

        const chosen: TrackPick[] = [];
        // Seeded from what the caller already wants avoided, then grown as each generator answers,
        // so a generator further down the chain cannot re-name what one above it already chose.
        // Passing them down rather than de-duplicating afterwards is what lets the floor spend its
        // draw on tracks that will actually be kept.
        //
        // SONGS only, and the asymmetry is the caller's rather than this class's: `ExtendLineupJob`
        // avoids the songs a lineup already holds and deliberately not the artists, because
        // excluding every artist already queued would starve a long rotation of its own library. An
        // artist is spaced within a batch and cooled down once they actually air, which are the two
        // places it can be judged against something real. Growing an artist set here would undo
        // that one generator at a time.
        const avoidSongKeys = new Set(inputs.avoidSongKeys ?? []);

        for (const generator of this.generators) {
            const missing = inputs.count - chosen.length;
            if (missing <= 0) break;

            const picks = await this.ask(generator, { ...inputs, count: missing, avoidSongKeys });

            let repeated = 0;
            for (const pick of picks) {
                if (chosen.length >= inputs.count) break;

                const song = songKey(pick.title, [pick.artist]);
                // Belt as well as braces. The avoid sets above are advice a generator is trusted to
                // honour, and a duplicate reaching the running order is a record airing twice in an
                // hour — cheap enough to make impossible here rather than to trust.
                if (avoidSongKeys.has(song)) {
                    repeated += 1;
                    continue;
                }

                avoidSongKeys.add(song);
                chosen.push(pick);
            }

            if (picks.length > 0) {
                // `repeated` is the number worth having and it is not a curiosity. A generator that
                // names records already in the running order is failing in a way NOTHING else can
                // see: the count comes back right, the floor quietly covers the shortfall, and the
                // station sounds fine. On a model binding it is the specific failure
                // `set.prompt.ts` calls "the seed is not a pick" — the avoid list shown as context
                // being read as a menu — and without this line the only symptom is the floor doing
                // more work than expected.
                this.logger.debug('director: a generator named part of the set', {
                    generator: generator.name,
                    asked: missing,
                    named: picks.length,
                    ...(repeated === 0 ? {} : { alreadyQueued: repeated }),
                });
                if (repeated > 0 && repeated >= picks.length / 2) {
                    this.logger.warn(
                        `director: the ${generator.name} generator named ${repeated} of ${picks.length} records the running order already holds`,
                    );
                }
            }
        }

        if (chosen.length < inputs.count) {
            // Not a warning. A station whose library is smaller than its appetite lives here
            // permanently, and the caller already treats a short answer as ordinary.
            this.logger.debug('director: the chain came up short', { asked: inputs.count, named: chosen.length });
        }
        return chosen;
    }

    /** One generator's turn, with every way of failing flattened to "it named nothing". */
    private async ask(generator: SetGenerator, inputs: SetInputs): Promise<TrackPick[]> {
        let picks: TrackPick[];
        try {
            picks = await generator.generate(inputs);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            // Warned rather than noted quietly, because a generator THROWING is a bug in that
            // generator even though the chain absorbs it. One declining is not.
            this.logger.warn(`director: a set generator failed (${generator.name}: ${message})`);
            return [];
        }

        const usable = picks.filter(pick => pick.title.trim().length > 0 && pick.artist.trim().length > 0);
        if (usable.length < picks.length) {
            this.logger.warn(`director: the ${generator.name} generator named a track with no title or no artist; dropping it`);
        }

        // "A generator may return fewer; it must not return more." Enforced rather than trusted,
        // because the caller sized its oversample against this number.
        return usable.slice(0, inputs.count);
    }
}
