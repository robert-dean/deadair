// How a past script is recognised as having come from one phrasing, which is the whole of the
// repetition rule and is invisible from inside the app: a station saying the same sentence every
// fourth record sounds exactly like a station that only has one.
//
// The case worth having a file for is the one that was live for as long as `wasHeard` existed. A
// phrasing beginning with a placeholder has no opening, so it fell through to being matched WHOLE —
// against a script carrying a title and a credit that differ at every break, which can essentially
// never match. It was therefore never spent, survived every round of `choose`, and stayed in the
// pool while its siblings dropped out as they were used. The audition that exposed it read four of
// six breaks off the same phrasing, twice back to back.

import { describe, expect, it } from 'vitest';

import type { TemplateInputs } from '../../../src/modules/director/break.templates.js';
import { DEFAULT_TEMPLATES, renderTemplate, usable, wasHeard } from '../../../src/modules/director/break.templates.js';
import { NEWS_TEMPLATES } from '../../../src/modules/director/news.break.writer.js';
import { WARMUP_TEMPLATES } from '../../../src/modules/director/warmup.writer.js';
import { WEATHER_TEMPLATES } from '../../../src/modules/director/weather.break.writer.js';
import { WELCOME_TEMPLATES } from '../../../src/modules/director/welcome.writer.js';
import { spoken } from '../../../src/modules/director/talk.break.writer.js';

const previous = { title: 'Domination', artist: 'Pantera' };
const next = { title: 'Hangar 18', artist: 'Megadeth' };

/** One phrasing, rendered against a break with a record either side. */
const render = (template: string, inputs: TemplateInputs = { previous, next, station: 'The Far Frequency' }) => {
    const rendered = renderTemplate(template, inputs, spoken);
    expect(rendered, `"${template}" did not render`).toBeDefined();
    return rendered!;
};

// The conspiracy host's second phrasing, word for word as `persona.defaults.ts` carried it when it
// was the one heard four times in six. The seed has since dropped the trailing word; the shape
// under test (a phrasing that opens with a placeholder) is unchanged.
const PLACEHOLDER_FIRST =
    '{{previous.artist}} there, with {{previous.title}}.[[ Next on The Far Frequency, {{next.artist}}, {{next.title}}.]] Documented.';

describe('wasHeard by a phrasing that opens with a literal', () => {
    const template = DEFAULT_TEMPLATES[0]!;

    it('recognises its own opening in a past script', () => {
        const rendered = render(template);

        expect(wasHeard(rendered, [rendered.script])).toBe(true);
    });

    it('recognises it under different records, because the opening is what repeats', () => {
        const before = render(template, { previous: { title: 'Solid Air', artist: 'John Martyn' }, next, station: 'The Far Frequency' });

        expect(wasHeard(render(template), [before.script])).toBe(true);
    });

    it('is not heard in a script from another phrasing', () => {
        expect(wasHeard(render(template), [render(DEFAULT_TEMPLATES[1]!).script])).toBe(false);
    });
});

describe('wasHeard by a phrasing that opens with a placeholder', () => {
    // The regression. Every one of these passed as `false` before there was a refrain to match on,
    // because the fallback compared whole scripts and the records had moved on.
    it('recognises itself under the very same records', () => {
        const rendered = render(PLACEHOLDER_FIRST);

        expect(wasHeard(rendered, [rendered.script])).toBe(true);
    });

    it('recognises itself under different records, which is how a break actually follows a break', () => {
        // Exactly the two consecutive scripts the audition produced: same phrasing, and every
        // placeholder in it filled from a different record.
        const first = render(PLACEHOLDER_FIRST);
        const second = render(PLACEHOLDER_FIRST, {
            previous: next,
            next: { title: "Sweet Child O' Mine", artist: "Guns N' Roses" },
            station: 'The Far Frequency',
        });

        expect(second.script).not.toBe(first.script);
        expect(wasHeard(second, [first.script])).toBe(true);
    });

    it('is recognised through its optional chunk dropping, because the refrain is never inside one', () => {
        // No `next`, so the chunk naming it goes, and with it more than half the sentence.
        const alone = render(PLACEHOLDER_FIRST, { previous, station: 'The Far Frequency' });

        expect(alone.script).not.toContain('Next on');
        expect(wasHeard(render(PLACEHOLDER_FIRST), [alone.script])).toBe(true);
    });

    it('is not heard in a script from a sibling that shares its shape', () => {
        // The 80s host's own placeholder-first phrasing. It differs from the conspiracy one by two
        // words in the middle, which is the whole of what tells them apart.
        const sibling = '{{previous.artist}} there, everybody, with {{previous.title}}.[[ Get psyched for {{next.title}}!]]';

        expect(wasHeard(render(PLACEHOLDER_FIRST), [render(sibling).script])).toBe(false);
        expect(wasHeard(render(sibling), [render(PLACEHOLDER_FIRST).script])).toBe(false);
    });

    it('is not heard in a script from a phrasing that merely says some of the same words', () => {
        expect(wasHeard(render(PLACEHOLDER_FIRST), [render(DEFAULT_TEMPLATES[1]!).script])).toBe(false);
    });
});

describe('wasHeard by a phrasing with neither an opening nor a refrain', () => {
    // The shape the whole-script fallback is actually right for: everything in it is a placeholder,
    // and the only one it has fills from a constant, so it says the same sentence every time.
    const template = '{{station.name}}.';

    it('matches whole', () => {
        const rendered = render(template);

        expect(rendered.refrain).toBeUndefined();
        expect(wasHeard(rendered, ['The Far Frequency.'])).toBe(true);
        expect(wasHeard(rendered, ['Some other station.'])).toBe(false);
    });
});

describe('the refrain itself', () => {
    it('is the longest literal the phrasing always says', () => {
        expect(render(PLACEHOLDER_FIRST).refrain?.trim()).toBe('there, with');
    });

    it('never comes from inside an optional chunk, however long that chunk is', () => {
        // The chunk carries by far the most words. Taking the refrain from it would produce one that
        // goes missing from every script written without a `next`.
        const rendered = render('{{previous.artist}} there.[[ And the long way round to saying that {{next.title}} is coming up next.]]');

        expect(rendered.refrain).toBeUndefined();
    });

    it('does not splice together the literals a dropped chunk sat between', () => {
        // `A.[[ B]] C.` must not yield the run `A. C.` — a piece the template never says, and here
        // the longest thing on the line if the chunk were simply cut out rather than marked.
        const rendered = render('{{previous.artist}} was that.[[ {{next.title}} is next.]] Stay.');

        expect(rendered.refrain?.trim()).toBe('was that.');
    });

    it('is refused when it is too short to identify anything', () => {
        // ` with ` is a word half the station's phrasings use. Matching on it would treat this
        // phrasing as spent whenever any other one had said it.
        expect(render('{{previous.artist}} with {{previous.title}}.').refrain).toBeUndefined();
    });

    it('does not begin with a period the value before it can absorb', () => {
        const template = '{{previous.title}}. Nobody wanted me to play it.';
        const question = render(template, { previous: { title: 'Where Is My Mind?', artist: 'Pixies' }, station: 'The Far Frequency' });

        expect(question.script).toBe('Where Is My Mind? Nobody wanted me to play it.');
        expect(wasHeard(render(template), [question.script])).toBe(true);
    });
});

describe('a value that already ends a sentence', () => {
    const between = (previousRecord: { title: string; artist: string }) => ({ previous: previousRecord, next, station: 'The Far Frequency' });

    it('absorbs the period after it, rather than airing two', () => {
        // Word for word from the conspiracy host's audition, which printed "from R.E.M.. Next".
        const rendered = render(
            'That was {{previous.title}}, from {{previous.artist}}.[[ Next, {{next.artist}} with {{next.title}}.]]',
            between({ title: 'Everybody Hurts', artist: 'R.E.M.' }),
        );

        expect(rendered.script).toBe('That was Everybody Hurts, from R.E.M. Next, Megadeth with Hangar 18.');
    });

    it('keeps its own question mark, rather than a period after it', () => {
        const rendered = render('Next, {{previous.title}}. Ask yourself why.', between({ title: 'Where Is My Mind?', artist: 'Pixies' }));

        expect(rendered.script).toBe('Next, Where Is My Mind? Ask yourself why.');
    });

    it('leaves the period to a value that does not end a sentence', () => {
        expect(render('From {{previous.artist}}.').script).toBe('From Pantera.');
    });

    it('leaves an ellipsis in the phrasing an ellipsis', () => {
        expect(render('{{previous.artist}}... and then silence.').script).toBe('Pantera... and then silence.');
        expect(render('{{previous.artist}}... and then silence.', between({ title: 'Everybody Hurts', artist: 'R.E.M.' })).script).toBe(
            'R.E.M... and then silence.',
        );
    });
});

// The invariant the bug broke, stated once over every pool the station ships rather than only over
// the one it was found in: it was false in three of them at the same time, and a phrasing edited
// into having no opening and no refrain is invisible from the console — it looks exactly like one
// the station simply keeps choosing.
describe('every phrasing the station ships', () => {
    // What each pool needs filled, and a second set of records for the break AFTER — which is the
    // whole difficulty, because nothing survives from one break to the next except the phrasing.
    const pools: Record<string, { templates: readonly string[]; inputs: TemplateInputs; later: TemplateInputs }> = {
        'talk breaks': {
            templates: DEFAULT_TEMPLATES,
            inputs: { previous, next, station: 'The Far Frequency', clock: 'just after nine' },
            later: { previous: next, next: previous, station: 'The Far Frequency', clock: 'nearly ten' },
        },
        welcomes: {
            templates: WELCOME_TEMPLATES,
            inputs: { next, station: 'The Far Frequency', dj: 'Sam', greeting: 'Good morning' },
            later: { next: previous, station: 'The Far Frequency', dj: 'Sam', greeting: 'Good evening' },
        },
        'warm-ups': {
            templates: WARMUP_TEMPLATES,
            inputs: { station: 'The Far Frequency', greeting: 'Good morning' },
            later: { station: 'The Far Frequency', greeting: 'Good evening' },
        },
        bulletins: {
            templates: NEWS_TEMPLATES,
            inputs: {
                next,
                station: 'The Far Frequency',
                greeting: 'Good morning',
                clock: 'just after nine',
                news: 'A bridge reopened.',
                subject: 'Technology',
            },
            later: {
                next: previous,
                station: 'The Far Frequency',
                greeting: 'Good evening',
                clock: 'nearly ten',
                news: 'The council met.',
                subject: 'Technology',
            },
        },
        'weather breaks': {
            templates: WEATHER_TEMPLATES,
            inputs: {
                next,
                station: 'The Far Frequency',
                greeting: 'Good morning',
                clock: 'just after nine',
                weather: 'Rain later.',
                weatherPlace: 'Atlanta',
            },
            later: {
                next: previous,
                station: 'The Far Frequency',
                greeting: 'Good evening',
                clock: 'nearly ten',
                weather: 'Clear tonight.',
                weatherPlace: 'Atlanta',
            },
        },
    };

    for (const [pool, { templates, inputs, later }] of Object.entries(pools)) {
        describe(pool, () => {
            it('recognises each phrasing as spent when the break before it used the same one', () => {
                for (const template of usable(templates, inputs, spoken)) {
                    const before = render(template.template, later);

                    expect(wasHeard(template, [before.script]), `"${template.template}" was not recognised`).toBe(true);
                }
            });

            it('hears none of the refrains in a script from one of the others', () => {
                // Refrains only, and the exemption is the older half of the rule rather than a gap:
                // an opening is matched as a PREFIX precisely so that two phrasings differing only
                // in their middle count as the same one, and the news pool has a live pair that does
                // — "Now the news." and "Now the {{news.topic}} news." share "Now the". That is
                // over-exclusion, which `choose`'s second round absorbs. A refrain is matched
                // ANYWHERE in the line, which is the looser test, so it is the one worth holding to
                // finding only its own.
                const rendered = usable(templates, inputs, spoken);

                for (const one of rendered.filter(each => each.refrain !== undefined)) {
                    const others = rendered.filter(other => other.template !== one.template).map(other => render(other.template, later).script);

                    expect(wasHeard(one, others), `"${one.template}" was heard in a sibling's script`).toBe(false);
                }
            });
        });
    }
});
