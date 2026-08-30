import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { SimilarityService } from '#modules/similarity/similarity.service.js';
import type { StationTool, ToolSource } from './llm.tools.js';

/**
 * "Who else sounds like this?", as something a model can ask.
 *
 * ## What it is for, which is not what it looks like
 *
 * It looks like a way to find more records, and it is — but the more valuable use
 * is the other direction. A DJ introducing a record has to say something true
 * about it, and "if you like this you will like that" is a claim a model
 * otherwise has to invent. This makes it checkable: a name that came back from
 * here is somebody a real service says resembles the artist, rather than a
 * plausible-sounding act the model associated on the spot.
 *
 * ## It suggests and never schedules
 *
 * A name from here is a name. Choosing it puts it through `PickResolver` like any
 * other pick, where the dislike veto and the rotation rules run — so the worst a
 * wrong suggestion can do is waste a slot, never air something the operator
 * forbade.
 *
 * ## Why the tracks ride along
 *
 * Answering with artists alone would leave the model to guess a title by an act
 * it may know nothing about, which is exactly the invention this is meant to
 * replace. So when a plugin can name records, a few come back per artist, and the
 * model can copy a real title rather than produce one that sounds right.
 */

/** How many artists come back, whatever was asked for. */
const MAX_ARTISTS = 12;

/**
 * Records offered per artist when the source can name them.
 *
 * Small. A dozen artists at ten tracks each is a hundred and twenty rows of
 * context for a question that was about ARTISTS, and the model can search for
 * more by anyone it settles on.
 */
const TRACKS_PER_ARTIST = 3;

/** Artists for which records are fetched at all, so one call cannot become a dozen upstream ones. */
const ARTISTS_WITH_TRACKS = 5;

@Injectable()
export class SimilarArtistsTool implements ToolSource {
    constructor(
        private readonly similarity: SimilarityService,
        private readonly logger: Logger,
    ) {}

    async tools(): Promise<StationTool[]> {
        // Nothing to offer with no plugin installed, the same rule the other sources follow: a
        // declaration whose every call answers "there are none" is context spent on a dead end.
        if (!this.similarity.hasSimilarity()) return [];

        return [
            {
                // Who sounds like whom. As slow-moving as the catalog it is about.
                freshness: 'timeless',
                declaration: {
                    name: 'similar_artists',
                    // Written for the model, and it says what the answer is FOR: both programming
                    // and saying something true on air, because a model told only the first uses it
                    // only for the first.
                    description:
                        'Find artists that genuinely resemble a given artist, according to listening data rather than guesswork. Use it to widen a set beyond the same few acts, and to say something true on air about who a record will appeal to. Records named here still have to be chosen like any other.',
                    parameters: {
                        type: 'object',
                        properties: {
                            artist: { type: 'string', description: 'The artist to find neighbours for.' },
                            limit: { type: 'number', description: `How many artists, at most ${MAX_ARTISTS}.` },
                        },
                        required: ['artist'],
                        additionalProperties: false,
                    },
                },
                run: async args => await this.find(args),
            },
        ];
    }

    /**
     * One lookup.
     *
     * An artist nothing recognises comes back as an empty list rather than an error: it is a true
     * answer to the question, and a model handed an exception loses the whole generation over a
     * name it can simply stop pursuing.
     */
    private async find(args: Record<string, unknown>): Promise<{ artist: string; similar: SimilarArtistRow[] }> {
        const artist = readText(args.artist);
        if (artist === undefined) throw new Error('similar_artists needs an "artist" to look up');

        const found = await this.similarity.similarTo({ name: artist }, clampLimit(args.limit));

        const similar: SimilarArtistRow[] = [];
        for (const [index, neighbour] of found.entries()) {
            // Records for the first few only. Every one is an upstream call, and the tail of a
            // similarity list is where a model is least likely to settle.
            const tracks =
                index < ARTISTS_WITH_TRACKS && this.similarity.canNameTracks()
                    ? await this.similarity.topTracks(
                          { name: neighbour.name, ...(neighbour.mbid === undefined ? {} : { mbid: neighbour.mbid }) },
                          TRACKS_PER_ARTIST,
                      )
                    : [];

            similar.push({
                artist: neighbour.name,
                ...(tracks.length === 0 ? {} : { tracks: tracks.map(track => track.title) }),
            });
        }

        this.logger.debug('llm: looked up similar artists', { artist, found: similar.length });
        return { artist, similar };
    }
}

/**
 * One neighbour as the model reads it.
 *
 * No `match` and no ids. A score the model cannot compare across sources is a number it will
 * nonetheless reason about, and an id is nothing it can act on — the list is already in the order
 * the sources put it in, which is the whole of what the score would have told it.
 */
interface SimilarArtistRow {
    artist: string;
    /** A few real titles, so the model copies one rather than inventing a plausible name. */
    tracks?: string[];
}

/** An argument the model actually set. */
const readText = (value: unknown): string | undefined => (typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined);

/** Whatever the model asked for, held between one and {@link MAX_ARTISTS}. */
function clampLimit(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) return MAX_ARTISTS;
    return Math.min(MAX_ARTISTS, Math.floor(value));
}
