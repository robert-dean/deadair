import { Logger } from '@maroonedsoftware/logger';
import { ActivityRecorder } from '#modules/activity/activity.recorder.js';
import { songKey } from './rotation.keys.js';
import { SetGenerator, type SetInputs, type TrackPick } from './set.generator.js';
import { errorText } from '#modules/shared/error.text.js';

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
        // The activity feed, recorded from HERE rather than from `ExtendLineupJob` where the other
        // refill logging lives, because this is the only place the attribution exists: `generate`
        // answers with picks and a `TrackPick` does not carry the generator that named it, so the
        // job can see how many records arrived and never which binding found them. Carrying it up
        // would mean widening the `SetGenerator` return type for one reader.
        private readonly activity: ActivityRecorder,
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
        /** Who named how many, in the order they were asked. The feed's half of the answer. */
        const named: { generator: string; kept: number }[] = [];

        for (const generator of this.generators) {
            const missing = inputs.count - chosen.length;
            if (missing <= 0) break;

            const before = chosen.length;
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

            // KEPT rather than named: a generator that answered with fifteen records the order
            // already holds contributed nothing, and the feed should say so rather than crediting it
            // with fifteen. `repeated` above is why the two numbers differ.
            named.push({ generator: generator.name, kept: chosen.length - before });

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

        this.announce(inputs.count, chosen.length, named);
        return chosen;
    }

    /**
     * Tell the feed who chose this batch.
     *
     * Only where more than one generator was asked, or where the whole chain came up short. A
     * station with one generator installed produces the same line every refill, which is the
     * fastest way to make a feed unreadable, and the interesting fact is precisely the one a single
     * binding cannot produce: that something was asked, contributed part of the batch or none of
     * it, and the floor finished the rest.
     *
     * A short chain IS worth saying even from one generator, because a station quietly running
     * fifteen-minute hours is a library that has run dry rather than a station programming itself.
     */
    private announce(asked: number, chosen: number, named: readonly { generator: string; kept: number }[]): void {
        const short = chosen < asked;
        if (named.length < 2 && !short) return;

        const words = named.map(entry => `${entry.generator} named ${entry.kept}`).join(', ');
        void this.activity.record({
            module: 'director',
            kind: 'set.generated',
            // Not a fault: the chain topping up is the design working, and a library smaller than
            // the station's appetite is an ordinary state rather than something to go and fix.
            detail: short
                ? `The station asked for ${asked} records and found ${chosen}: ${words}.`
                : `The station chose ${chosen} records: ${words}.`,
            data: { asked, chosen, named: [...named] },
        });
    }

    /** One generator's turn, with every way of failing flattened to "it named nothing". */
    private async ask(generator: SetGenerator, inputs: SetInputs): Promise<TrackPick[]> {
        let picks: TrackPick[];
        try {
            picks = await generator.generate(inputs);
        } catch (error) {
            const message = errorText(error);
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
