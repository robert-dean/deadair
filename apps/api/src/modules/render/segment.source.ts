import type { RundownTrack } from '#modules/playout/rundown.js';
import { SYNDICATED_SOURCE, type Segment } from './segment.repository.js';

/**
 * Who the running order says a segment's audio comes from.
 *
 * A rundown item's identity is `pluginId` + `externalId`, and every item that has
 * ever gone on air came from a music provider. A segment does not, so it borrows
 * the shape rather than the mechanism: this is the station itself, named in the
 * same reverse-DNS space so it can never collide with a real plugin id, and
 * `externalId` is the segment's own id.
 *
 * **The rundown deliberately learns nothing from this.** It is a plain item, so
 * `annotate.ts`, the aired notify, `PlayoutStatus`, now-playing and the mount
 * label all keep working with no idea that anything changed. The only three places
 * that know what the id means are the resolver, which turns it into a URL, the
 * director's play history, which leaves it out, and `/nowplaying`, which tells a
 * listener the station is talking rather than naming an empty artist.
 */
export const RENDER_PLUGIN_ID = 'deadair.render';

/** Whether a running-order item is something the station said rather than a record it played. */
export const isRenderItem = (item: { pluginId: string }): boolean => item.pluginId === RENDER_PLUGIN_ID;

/**
 * A ready segment as a line of the running order.
 *
 * `artists` is empty rather than the station's name, and that is a decision about
 * what a listener sees: `itemAnnotations` leaves an empty value out entirely, so
 * the mount is labelled "Station ident" rather than "Station ident - Deadair",
 * which reads as a band nobody has heard of.
 *
 * `durationMs` is carried when the row has one and left out when it does not.
 * Nothing schedules against it — the player measures the audio itself — so an
 * absent duration costs a console a countdown and nothing else.
 */
export function segmentRundownTrack(segment: Segment): RundownTrack {
    // Two ways to be a programme, and this asks the ROW rather than a kind on purpose. An episode is
    // one by where its audio came from; a reading the station spoke itself is an ordinary `render`
    // row, and what marks it is the context its beats carried. Reading a module's predicate here
    // would point `render` at a module registered after it.
    if (segment.source === SYNDICATED_SOURCE || segment.context?.programme === true) return programmeRundownTrack(segment);

    return {
        pluginId: RENDER_PLUGIN_ID,
        externalId: segment.id,
        title: segment.label,
        artists: [],
        // A segment is the station talking, so it has no artist to be identified by. The empty
        // key it produces matches no history row, which is what keeps a break out of the repeat
        // window rather than needing a rule of its own.
        artist: '',
        ...(segment.durationMs === undefined ? {} : { durationMs: segment.durationMs }),
        // Carried rather than derived, and only when the writer offered one: `segments.label` is the
        // producer's name for this break and is what `title` above holds, while this is the same
        // break said in a register a stream can carry. Nothing here decides which is which — the
        // writer did, when it wrote the words. See `listenerLine` in `playout/annotate.ts`.
        ...(segment.listenerLabel === undefined ? {} : { listenerLabel: segment.listenerLabel }),
        // The one measurement a segment carries, and it rides the item for the same reason a
        // record's does: `annotate.ts` decides the gain per hand-over, against a target that is a
        // live setting, so what travels is what was MEASURED rather than what was computed from it.
        // Absent until something measures it, which `speechGainFor` treats as an assumed level
        // rather than as no opinion — a break with no gain at all is ten decibels under the music.
        ...(segment.loudnessLufs === undefined ? {} : { loudnessLufs: segment.loudnessLufs }),
    };
}

/**
 * An episode of somebody else's programme as a line of the running order.
 *
 * The one segment that DOES have somebody to be identified by, and the one place the label is not
 * what a listener should see: `The Long Wave: Episode 12` is the console's name for the row, while a
 * player's one line of text wants the episode as the title and the show as the artist, which Icecast
 * renders as `The Long Wave - Episode 12` exactly as it renders a record. Both come off the row's own
 * context, written when the episode was fetched, and the label is the fallback for a row whose
 * context something has mangled.
 *
 * `artist` stays EMPTY even so. It is what identity is taken from (`RundownItem.artist`), and an
 * empty key is what keeps a segment out of the repeat window and the artist cooldown; a show's name
 * there would put a programme into the song key space. Play history leaves every segment out anyway,
 * so this is belt and braces rather than the mechanism.
 */
function programmeRundownTrack(segment: Segment): RundownTrack {
    const context = segment.context ?? {};
    const episode = typeof context.episodeTitle === 'string' && context.episodeTitle.length > 0 ? context.episodeTitle : segment.label;
    const show = typeof context.showTitle === 'string' && context.showTitle.length > 0 ? context.showTitle : undefined;
    const artworkUrl = typeof context.artworkUrl === 'string' && /^https?:\/\//.test(context.artworkUrl) ? context.artworkUrl : undefined;

    return {
        pluginId: RENDER_PLUGIN_ID,
        externalId: segment.id,
        title: episode,
        artists: show === undefined ? [] : [show],
        artist: '',
        programme: true,
        ...(segment.durationMs === undefined ? {} : { durationMs: segment.durationMs }),
        ...(artworkUrl === undefined ? {} : { artworkUrl }),
        ...(segment.loudnessLufs === undefined ? {} : { loudnessLufs: segment.loudnessLufs }),
    };
}
