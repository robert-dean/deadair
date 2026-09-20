import type { AlmanacEntry } from '@deadair/plugin-sdk';

/**
 * Which of a day's entries a MUSIC station should reach for first.
 *
 * Pure and table-tested, for `news.classify.ts`'s reason and with the same
 * standing: this is a decision about words, it runs on the floor as well as
 * under the model, so it may not fetch, may not fail and may not need a model.
 *
 * ## Why the host decides this and the plugin cannot
 *
 * `capabilities/almanac.ts` refuses to take "the musicians" as a query. What a
 * station leans toward is a fact about the station, settled beside its voice and
 * its phrasings, and a plugin that filtered would make this station's character
 * depend on which plugin an operator installed.
 *
 * ## An ORDER rather than a cut, by default
 *
 * The 20th of September has thirty-odd musicians in it and the 3rd of January
 * has four. A filter would make the station say nothing at all on the thin days,
 * which is the worst version of a feature whose whole job is to have something
 * to say — so `music` puts the musicians first and keeps the rest behind them,
 * and only `musicOnly` throws the rest away. That is the same shape as the
 * bulletin's `spread`: the operator decides the order, and what is left still
 * gets a turn.
 *
 * ## The words are roles, not genres
 *
 * `guitarist` is never anything but music. `rock`, `record`, `single`, `chart`
 * and `concert` all are: a rock formation, a world record, a single mother, a
 * chart of the sea, the Concert of Europe. The list below is therefore made of
 * what somebody DOES and of nouns that only music has, and it is matched as
 * whole words against the entry's own sentence and the one-line descriptions of
 * whatever it is about — which is exactly the field
 * {@link AlmanacSubject.description} exists to carry.
 *
 * `opera` was on the list and is not, measured against the real feed rather than
 * reasoned about: on the 20th of September it claimed L. Ron Hubbard announcing
 * the story of Xenu, whose article Wikipedia describes as a space opera. A soap
 * opera would have done the same. Nothing is lost — an opera singer's entry says
 * `singer`, `soprano` or `composer` — and what was gained was a station reading
 * out Scientology as a music anniversary.
 *
 * Missing a musician is a cheap mistake here and claiming a general entry is a
 * dear one: the first costs an ordering, and the second is a station announcing
 * a battle as though it were a birthday.
 */

/** How this station leans when it reads the day out. */
export type AlmanacLean = 'music' | 'musicOnly' | 'any';

/**
 * Words that mean music wherever they appear, normalized and matched whole.
 *
 * Roles first, because a description is usually one ("Portuguese guitarist"),
 * then the nouns only music uses. Plurals are spelled out rather than stemmed:
 * a stemmer would be a second thing to be wrong, and this list changes about
 * once a year.
 */
export const MUSIC_WORDS: readonly string[] = [
    'musician',
    'musicians',
    'singer',
    'singers',
    'songwriter',
    'songwriters',
    'vocalist',
    'vocalists',
    'guitarist',
    'guitarists',
    'bassist',
    'bass player',
    'drummer',
    'drummers',
    'pianist',
    'keyboardist',
    'organist',
    'saxophonist',
    'trumpeter',
    'trombonist',
    'violinist',
    'cellist',
    'flautist',
    'flutist',
    'percussionist',
    'harpist',
    'accordionist',
    'rapper',
    'rappers',
    'composer',
    'composers',
    'conductor',
    'lyricist',
    'bandleader',
    'band',
    'bands',
    'girl group',
    'boy band',
    'album',
    'albums',
    'discography',
    'orchestra',
    'choir',
    'symphony',
    'jazz',
    'blues',
    'reggae',
    'hip hop',
    'motown',
    'music',
    'musical',
    'record label',
    'record producer',
    'recording artist',
    'soundtrack',
    'grammy',
    'grammys',
    'eurovision',
];

/** Whether an entry is about music, by its own sentence and by what it is about. */
export function isMusical(entry: AlmanacEntry): boolean {
    const said = normalize([entry.text, ...(entry.subjects ?? []).map(subject => subject.description ?? '')].join(' '));
    return MUSIC_WORDS.some(word => saysWord(said, word));
}

/**
 * The day's entries in the order this station should read them.
 *
 * Stable within each half: the source's own order is by year, and reordering
 * inside the musicians would be this file inventing an editorial judgement it
 * has no basis for. `any` is the source's order untouched.
 */
export function leaned(entries: readonly AlmanacEntry[], lean: AlmanacLean): AlmanacEntry[] {
    if (lean === 'any') return [...entries];

    const musical = entries.filter(isMusical);
    if (lean === 'musicOnly') return musical;

    return [...musical, ...entries.filter(entry => !isMusical(entry))];
}

/**
 * Lowercase, unaccented, punctuation to spaces.
 *
 * `news.classify.ts`'s own normalizer, restated rather than shared: that one is
 * private to the classifier and is about matching an operator's typed label
 * against a publisher's tag, where this is about matching a fixed list against
 * somebody else's prose. Exporting one for both would tie two vocabularies
 * together that have no reason to move at the same time.
 */
const normalize = (value: string): string =>
    value
        .toLowerCase()
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .replace(/[.'’]/gu, '')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();

/**
 * Whether a normalized text says a normalized word, as a WHOLE word.
 *
 * A substring test would match `band` inside `abandoned` and `opera` inside
 * `operation`, which between them are most of a day's history. The phrase case
 * (`bass player`) is why this is a spaces-padded `includes` rather than a
 * regular expression.
 */
const saysWord = (said: string, word: string): boolean => ` ${said} `.includes(` ${word} `);
