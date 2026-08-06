/**
 * The artist entity to an `ArtistEnrichment`: `facts`, `links`, and the
 * Wikidata id that lets anything downstream go further.
 *
 * `facts` is the load-bearing one, and the SDK is specific about what it wants:
 * short lines, each independently speakable. They end up in a DJ's mouth, so
 * every sentence here is built from a field MusicBrainz actually holds and is
 * skipped entirely when the field is missing. A half-known sentence ("formed in
 * in 1991") is worse than no sentence.
 */

import type { ArtistEnrichment, ExternalId, ExternalLink } from '@deadair/plugin-sdk';

import { SOURCE_MUSICBRAINZ_ARTIST, webUrl, yearOf } from './musicbrainz.mapping.js';
import type { MusicBrainzArtist, MusicBrainzRelation } from './musicbrainz.types.js';

export const SOURCE_WIKIDATA = 'wikidata';

/** MusicBrainz relation types worth a link out, and what to call each one in the UI. */
const LINKED_RELATIONS: Record<string, string> = {
    'official homepage': 'Official site',
    wikipedia: 'Wikipedia',
    wikidata: 'Wikidata',
    discogs: 'Discogs',
    'social network': 'Social',
    'youtube music': 'YouTube',
};

/** An artist that is a collective, and so was formed rather than born. */
const GROUP_TYPES = new Set(['group', 'orchestra', 'choir']);

/** `https://www.wikidata.org/wiki/Q483407` → `Q483407`. */
export function wikidataId(resource: string | undefined): string | undefined {
    const match = /\/(Q\d+)(?:[/?#]|$)/.exec(resource ?? '');
    return match?.[1];
}

/** The most specific place MusicBrainz has for this artist: where they began, else where they are. */
function origin(artist: MusicBrainzArtist): string | undefined {
    return artist['begin-area']?.name || artist.area?.name || artist.country;
}

/**
 * The one or two sentences worth saying about an artist.
 *
 * Deliberately plain. This is raw material for a DJ line, not the line itself,
 * and a fact that reads as though it already has a voice fights with whatever
 * voice the station is written in.
 */
export function artistFacts(artist: MusicBrainzArtist): string[] {
    const facts: string[] = [];
    const name = artist.name;
    if (!name) return facts;

    const isGroup = GROUP_TYPES.has((artist.type ?? '').toLowerCase());
    const where = origin(artist);
    const begin = yearOf(artist['life-span']?.begin);
    const end = yearOf(artist['life-span']?.end);

    if (where && begin !== undefined) facts.push(isGroup ? `${name} formed in ${where} in ${begin}.` : `${name} was born in ${where} in ${begin}.`);
    else if (where) facts.push(isGroup ? `${name} formed in ${where}.` : `${name} is from ${where}.`);
    else if (begin !== undefined) facts.push(isGroup ? `${name} formed in ${begin}.` : `${name} was born in ${begin}.`);

    // Only when it is over. "Active since 1991" is a claim about today that a
    // database edited last year cannot make, but a closed span is a fact.
    if (begin !== undefined && end !== undefined) facts.push(`${isGroup ? 'Active' : 'Active as a recording artist'} from ${begin} to ${end}.`);

    if (artist.disambiguation) facts.push(`${name}: ${artist.disambiguation}.`);

    return facts;
}

/** The link-out relations, in the order {@link LINKED_RELATIONS} lists them, one per type. */
function artistLinks(relations: MusicBrainzRelation[] | undefined): ExternalLink[] {
    const links: ExternalLink[] = [];

    for (const [type, label] of Object.entries(LINKED_RELATIONS)) {
        const resource = relations?.find(relation => relation.type === type)?.url?.resource;
        if (resource) links.push({ label, url: resource });
    }

    return links;
}

export function mapArtist(artist: MusicBrainzArtist | undefined): Partial<ArtistEnrichment> {
    if (!artist) return {};

    const enrichment: Partial<ArtistEnrichment> = {};

    if (artist.name) enrichment.name = artist.name;

    const facts = artistFacts(artist);
    if (facts.length > 0) enrichment.facts = facts;

    const links = artistLinks(artist.relations);
    if (artist.id) links.push({ label: 'MusicBrainz artist', url: webUrl('artist', artist.id) });
    if (links.length > 0) enrichment.links = links;

    // The MusicBrainz id first, because the host reads the first entry back as
    // the id this answer was fetched under and hands it to us again next time.
    const externalIds: ExternalId[] = [];
    if (artist.id) externalIds.push({ source: SOURCE_MUSICBRAINZ_ARTIST, id: artist.id });
    const wikidata = wikidataId(artist.relations?.find(relation => relation.type === 'wikidata')?.url?.resource);
    if (wikidata) externalIds.push({ source: SOURCE_WIKIDATA, id: wikidata });
    if (externalIds.length > 0) enrichment.externalIds = externalIds;

    return enrichment;
}
