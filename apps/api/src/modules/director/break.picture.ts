import type { ArtAsset } from '#modules/art/art.repository.js';
import { artPath } from '#modules/art/art.path.js';
import { breakArtKey } from '#modules/art/break.art.js';
import { personaArtKey, personaIdIsSafe } from '#modules/art/persona.art.js';
import type { Segment } from '#modules/render/segment.repository.js';

/**
 * The pictures a set of breaks can wear: each KIND's own picture, and the portrait of each persona
 * who SPEAKS one of them. Both keyed the way the art table files them, so one read answers both.
 */
export interface BreakPictures {
    kinds: ReadonlyMap<string, string>;
    speakers: ReadonlyMap<string, string>;
}

/**
 * The art keys one read needs to picture these breaks.
 *
 * The speaker's portrait is asked for rather than the broadcast host's because on a co-hosted show
 * they are different people: a talk break goes to whichever co-host was heard least recently, and
 * pictured with the lead's portrait it showed one face over the other's voice.
 */
export function breakPictureKeys(segments: Iterable<Segment>): string[] {
    const keys = new Set<string>();
    for (const segment of segments) {
        keys.add(breakArtKey(segment.kind));
        if (segment.personaId !== undefined && personaIdIsSafe(segment.personaId)) keys.add(personaArtKey(segment.personaId));
    }
    return [...keys];
}

/** What the art table held for {@link breakPictureKeys}, sorted into the two kinds of picture. */
export function breakPicturesFrom(segments: Iterable<Segment>, held: ReadonlyMap<string, ArtAsset>): BreakPictures {
    const kinds = new Map<string, string>();
    const speakers = new Map<string, string>();
    for (const segment of segments) {
        // A row with no checksum is one the sweeper has not filled, which neither kind of picture
        // ever is, since both are written with their bytes. The narrowing is the repository's
        // contract and taking it costs nothing.
        const kind = held.get(breakArtKey(segment.kind));
        if (kind?.checksum !== undefined) kinds.set(segment.kind, artPath(kind));
        if (segment.personaId === undefined) continue;
        const portrait = held.get(personaArtKey(segment.personaId));
        if (portrait?.checksum !== undefined) speakers.set(segment.personaId, artPath(portrait));
    }
    return { kinds, speakers };
}

/**
 * The picture one break wears, where it has no cover of its own.
 *
 * The kind's picture first, since an operator who gave the forecast one chose it for that. Then the
 * face of whoever SPEAKS it. A speaker with no portrait wears nothing, which is the station's logo,
 * rather than the host's face: a newsreader's bulletin is not the host talking, and nor is a
 * co-host's break. The broadcast host's portrait is the answer only where the row names nobody (a
 * library recording, or a speaker since deleted) or the pictures could not be read at all, which is
 * what every break wore before the speaker was asked about.
 */
export function breakPicture(segment: Segment, pictures: BreakPictures | undefined, hostArtwork: string | undefined): string | undefined {
    if (pictures === undefined) return hostArtwork;
    const kind = pictures.kinds.get(segment.kind);
    if (kind !== undefined) return kind;
    return segment.personaId === undefined ? hostArtwork : pictures.speakers.get(segment.personaId);
}
