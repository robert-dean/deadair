import { ContentStore } from '#modules/shared/content.store.js';

/**
 * The formats a cached record is kept in, and what each is served as.
 *
 * Deliberately the same five the segment store holds, and for the same reason: the consumer is the
 * same Liquidsoap, which sends a HEAD before the GET, names the temp file it downloads to after the
 * content type and picks its decoder from that name. Serving a flac as `audio/mpeg` therefore fails
 * as silence rather than as an error anyone sees.
 *
 * This list is what `playout.ck` declares on the audio operation, and the two have to agree: the
 * service answers with the mime and the router sets `ctx.type` from it, so a format here the
 * contract does not declare will not type-check.
 */
export const TRACK_CONTENT_TYPES = {
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    flac: 'audio/flac',
    m4a: 'audio/mp4',
} as const satisfies Record<string, string>;

export type TrackExtension = keyof typeof TRACK_CONTENT_TYPES;

export type TrackContentType = (typeof TRACK_CONTENT_TYPES)[TrackExtension];

export const TRACK_EXTENSIONS = Object.keys(TRACK_CONTENT_TYPES) as readonly TrackExtension[];

export function isTrackExtension(value: string | undefined): value is TrackExtension {
    return value !== undefined && Object.hasOwn(TRACK_CONTENT_TYPES, value);
}

/**
 * What a provider may CALL the audio on the way in, mapped to the extension the file gets on disk.
 *
 * Separate from {@link TRACK_CONTENT_TYPES} and generous on purpose, the way `ART_CONTENT_TYPES` is:
 * `audio/mp3` and `audio/x-flac` are not registered types but plenty of servers send them, and a
 * Subsonic-shaped stream endpoint answers with whatever the file on the other end happens to be. A
 * response whose type is not in here is not audio this store can hold, which is a recorded failure
 * rather than a file named after a guess.
 *
 * `audio/mpeg` covers mp3 and nothing else here, which is the one place this is stricter than it
 * looks: an mp2 or an AAC-in-ADTS stream announced as `audio/mpeg` lands under `.mp3`. Liquidsoap's
 * ffmpeg decoder does not care, and the alternative is sniffing bytes to name a file.
 */
export const TRACK_SOURCE_TYPES: Record<string, TrackExtension> = {
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/wave': 'wav',
    'audio/ogg': 'ogg',
    'application/ogg': 'ogg',
    'audio/vorbis': 'ogg',
    'audio/flac': 'flac',
    'audio/x-flac': 'flac',
    'audio/mp4': 'm4a',
    'audio/m4a': 'm4a',
    'audio/x-m4a': 'm4a',
};

/**
 * A record's audio on disk: the station's own copy of something a provider served.
 *
 * Everything about how bytes are laid out, and every guard against a path that is not what it
 * claims, is {@link ContentStore}'s; this is which formats and a name injectkit can register
 * against. Content-addressed like the other two stores, so two bindings that resolve to identical
 * audio are one file, and a re-fetch of the same record is the same name written again.
 */
export class TrackStore extends ContentStore<TrackExtension> {
    constructor(root: string) {
        super(root, TRACK_CONTENT_TYPES);
    }
}
