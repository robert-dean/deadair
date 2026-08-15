import type { RundownTrack } from '#modules/playout/rundown.js';
import type { Segment } from './segment.repository.js';

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
 * label all keep working with no idea that anything changed. The only two places
 * that know what the id means are the resolver, which turns it into a URL, and
 * the director's play history, which leaves it out.
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
    };
}
