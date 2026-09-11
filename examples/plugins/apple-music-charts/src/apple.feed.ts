import { z } from 'zod';

/**
 * Apple's feed, and the one thing about it that is easy to get wrong.
 *
 * `artistName` is a CREDIT LINE, not an artist: `HUGEL, Imael Angel & Ultra Naté` is one field. The
 * station matches a chart entry on its lead artist alone, so handing it that string names a record
 * correctly and finds nothing, and the record is dropped as not in the catalogue.
 *
 * Splitting on punctuation is the obvious fix and the wrong one. `, ` destroys `Tyler, The Creator`,
 * and ` & ` destroys `Simon & Garfunkel`. What the feed does give, beside the credit, is `artistUrl`,
 * which is the LEAD artist's page and ends in a slug of their name
 * (`https://music.apple.com/gb/artist/hugel/978839124`). So the lead is the shortest run of names at
 * the start of the credit whose slug is that one, and everybody after it is featured. Where there is
 * no such run (no URL, a name Apple slugs in a way this does not reproduce), the whole credit is kept
 * as the artist: a record the station fails to find is a better outcome than one it finds under the
 * wrong artist.
 */

const entrySchema = z.object({
    id: z.string().optional(),
    name: z.string().min(1),
    artistName: z.string().min(1),
    artistUrl: z.string().optional(),
    url: z.string().optional(),
});

const feedSchema = z.object({
    feed: z.object({
        results: z.array(entrySchema),
    }),
});

export type AppleFeedEntry = z.infer<typeof entrySchema>;

/** The entries of one feed document, in chart order. Throws a `ZodError` on anything else. */
export function parseFeed(json: unknown): AppleFeedEntry[] {
    return feedSchema.parse(json).feed.results;
}

/** The ways a credit line joins two names, longest first so ` featuring ` is not read as ` feat`. */
const JOINERS = /(\s+featuring\s+|\s+feat\.\s+|\s+ft\.\s+|\s+&\s+|,\s+|\s+x\s+)/i;

/**
 * A name as Apple writes it into a URL: accents dropped, lower case, every run of anything else a
 * single hyphen. Measured against the feed rather than documented anywhere, so it is a guess that
 * fails safe: a slug this gets wrong means the credit is kept whole.
 */
export function slugOf(name: string): string {
    return name
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

/** The slug at the end of an artist URL, or `undefined` for anything that is not one. */
export function artistSlugOf(url: string | undefined): string | undefined {
    if (url === undefined) return undefined;
    const match = /\/artist\/([^/]+)\/\d+\/?$/.exec(url);
    return match?.[1] === undefined ? undefined : decodeURIComponent(match[1]).toLowerCase();
}

export interface Credit {
    /** The lead artist, which is all the station matches on. */
    artist: string;
    /** Everybody else on the credit, in the feed's own order. Shown, never matched. */
    featuring: string[];
}

/** Splits a credit line into its lead artist and the rest. See the note at the top of this file. */
export function splitCredit(artistName: string, artistUrl: string | undefined): Credit {
    const whole: Credit = { artist: artistName.trim(), featuring: [] };
    const lead = artistSlugOf(artistUrl);
    if (lead === undefined) return whole;

    // Alternating [name, joiner, name, joiner, name]: a capturing split keeps the joiners, so a run of
    // names is put back exactly as the feed wrote it.
    const pieces = artistName.split(JOINERS);
    for (let end = 1; end <= pieces.length; end += 2) {
        const candidate = pieces.slice(0, end).join('').trim();
        if (slugOf(candidate) !== lead) continue;

        const featuring = pieces
            .slice(end + 1)
            .filter((_piece, index) => index % 2 === 0)
            .map(name => name.trim())
            .filter(name => name.length > 0);
        return { artist: candidate, featuring };
    }

    return whole;
}
