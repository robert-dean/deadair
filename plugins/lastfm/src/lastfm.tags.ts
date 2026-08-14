import { asList, asNumber, type LastfmMaybeList, type LastfmTag } from './lastfm.types.js';

/**
 * Turning a community folksonomy into two vocabularies the station can use.
 *
 * Last.fm's tags are the best thing this service has and the hardest to use.
 * They are the only free source of what a record actually SOUNDS like, and they
 * are also where people keep their filing system: `seen live`, `albums i own`,
 * `check out later`, `favourite songs`. A record's top tags routinely mix all
 * three kinds.
 *
 * So a tag is routed rather than accepted or rejected wholesale:
 *
 * - **Junk** — about the tagger rather than the record — is dropped. Nothing
 *   downstream can do anything with `seen live`, and it would be shown on the
 *   console beside the genres as though it were one.
 * - **Moods** go to `moods`, which nothing has ever populated. The SDK has had
 *   the field since it was written and the MusicBrainz plugin correctly declines
 *   it, because that service does not carry moods. This one does.
 * - **Everything else** goes to `genres`, which is the right default: a tag that
 *   is neither junk nor a mood is almost always a style, a scene or a period,
 *   and all three are things the station can programme against.
 *
 * The raw list is kept separately and stored under `extra`, so nothing is lost
 * to a judgement made here.
 */

/**
 * Tags that describe a feeling rather than a style.
 *
 * Hand-written and deliberately short. A long list would start swallowing genres
 * — `ambient` and `dark ambient` are styles that read as moods, `emo` is a
 * scene — and the cost of a mood landing in `genres` is nil, while a genre
 * landing in `moods` makes a mood-shaped query answer with a style.
 *
 * Matched against the whole normalized tag, never as a substring: `chill` is a
 * mood and `chillwave` is a genre.
 */
const MOODS = new Set([
    'aggressive',
    'angry',
    'atmospheric',
    'beautiful',
    'bittersweet',
    'calm',
    'catchy',
    'chill',
    'chilled',
    'dark',
    'dreamy',
    'energetic',
    'epic',
    'ethereal',
    'euphoric',
    'feel good',
    'fun',
    'gloomy',
    'happy',
    'haunting',
    'hopeful',
    'hypnotic',
    'intense',
    'melancholic',
    'melancholy',
    'mellow',
    'moody',
    'nostalgic',
    'peaceful',
    'playful',
    'relaxing',
    'romantic',
    'sad',
    'sentimental',
    'sexy',
    'smooth',
    'soothing',
    'summer',
    'uplifting',
    'upbeat',
]);

/**
 * Tags that are about somebody's own collection.
 *
 * The exact ones, plus {@link JUNK_PATTERNS} for the shapes they come in. Both
 * halves are needed: `seen live` is a fixed phrase and `albums i own in 2019` is
 * a family.
 */
const JUNK = new Set([
    'seen live',
    'favourite',
    'favourites',
    'favorite',
    'favorites',
    'favourite songs',
    'favorite songs',
    'favourite albums',
    'favorite albums',
    'love',
    'loved',
    'awesome',
    'amazing',
    'best',
    'best songs ever',
    'cool',
    'good',
    'great',
    'perfect',
    'masterpiece',
    'music',
    'songs',
    'song',
    'albums',
    'album',
    'tracks',
    'artists',
    'bands',
    'spotify',
    'youtube',
    'radio',
    'playlist',
    'mixtape',
    'shazam',
    'to check out',
    'check it out',
    'want to see live',
    'wish i saw them live',
]);

/**
 * The shapes a filing tag comes in.
 *
 * First person is the strongest signal there is that a tag is about the tagger,
 * and a bare year is the other one: `1994` is a real fact about a record and is
 * still useless as a genre, since the catalog already has the year as a number.
 */
const JUNK_PATTERNS: RegExp[] = [
    // `my favourite`, `i love this`, `stuff i like`
    /\b(?:my|i|me|mine)\b/,
    // `albums i own`, `own it`
    /\bown\b/,
    // `heard on tv`, `heard it`
    /\bheard\b/,
    // A bare year or decade — the catalog holds the year properly.
    /^(?:19|20)\d{2}s?$/,
    // `00s`, `90s` on their own.
    /^\d{2}s$/,
    // `top 100`, `top 50 of 2019`
    /^top\s?\d+/,
    // Anything that is only punctuation or digits once normalized.
    /^[\d\s]+$/,
];

/** A tag as this plugin compares it: lowercased, trimmed, whitespace collapsed. */
export function normalizeTag(name: string): string {
    return name.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Whether a tag is about the tagger rather than the record. */
export function isJunkTag(name: string): boolean {
    const tag = normalizeTag(name);
    if (tag.length === 0) return true;
    if (JUNK.has(tag)) return true;
    return JUNK_PATTERNS.some(pattern => pattern.test(tag));
}

/** Whether a tag describes a feeling rather than a style. */
export function isMoodTag(name: string): boolean {
    return MOODS.has(normalizeTag(name));
}

/** What one entity's tags become. */
export interface SplitTags {
    genres: string[];
    moods: string[];
    /**
     * Every tag that passed the weight threshold, junk included, as the service
     * spelled it.
     *
     * Kept because the routing above is a judgement and this is the evidence:
     * `extra` survives per provider, so an operator wondering why a record was
     * called `trip hop` can see what it was actually tagged with.
     */
    raw: string[];
}

/**
 * Split an entity's tags into the two vocabularies plus the record of what came in.
 *
 * `minWeight` is a share of the entity's most-applied tag rather than a vote
 * count — see `DEFAULT_MIN_TAG_WEIGHT`. A tag with no weight at all is KEPT: some
 * responses carry the list without counts, and dropping those would silently
 * make a whole endpoint contribute nothing.
 *
 * Names are returned as the service spelled them rather than normalized, because
 * these are shown to a person and eventually said out loud. Normalization is for
 * comparing.
 */
export function splitTags(tags: LastfmMaybeList<LastfmTag>, minWeight: number, limit: number): SplitTags {
    const genres: string[] = [];
    const moods: string[] = [];
    const raw: string[] = [];
    const seen = new Set<string>();

    for (const tag of asList(tags)) {
        const name = tag?.name?.trim();
        if (!name) continue;

        const weight = asNumber(tag.count);
        if (weight !== undefined && weight < minWeight) continue;

        const key = normalizeTag(name);
        if (seen.has(key)) continue;
        seen.add(key);

        raw.push(name);
        if (isJunkTag(name)) continue;

        // Genres fill up first and moods are counted separately, because a record
        // with two dozen usable tags should not spend its whole allowance on the
        // half-dozen mood words that happen to sort highest.
        if (isMoodTag(name)) {
            if (moods.length < limit) moods.push(name);
        } else if (genres.length < limit) {
            genres.push(name);
        }
    }

    return { genres, moods, raw };
}
