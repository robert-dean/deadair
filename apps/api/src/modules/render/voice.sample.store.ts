import { createHash } from 'node:crypto';
import { ContentStore } from '#modules/shared/content.store.js';
import { SEGMENT_CONTENT_TYPES, type SegmentExtension } from './segment.store.js';

/**
 * The line every voice says when it is being previewed.
 *
 * One fixed sentence, so two voices are compared on the same words rather than on whichever script
 * happened to be to hand. Something a station actually says, because a voice that sounds right
 * reading a pangram and wrong reading a back-announce is the wrong voice.
 *
 * Part of the cache key: changing it invalidates every stored sample by construction, which is why
 * this can be edited freely without anything having to be swept.
 */
export const SAMPLE_TEXT = "You're listening to Deadair. Here's another one.";

/**
 * Rendered voice previews, so an operator can hear a voice before choosing it.
 *
 * ## Emphatically not segments
 *
 * A sample is never airable. It has no row in `deadair.segments`, so it cannot be planted by the
 * break planner, cannot be named by a lineup, and cannot reach a running order — which is the whole
 * reason it lives in its own store rather than as a `kind: 'voice-sample'` segment. The alternative
 * would have put previews in the library the console lists and the planner chooses from, one typo
 * away from the station airing a demo of its own voice.
 *
 * ## Keyed rather than content-addressed, and therefore tableless
 *
 * Every other {@link ContentStore} in the station names bytes after themselves. This one names them
 * after the QUESTION they answer — this plugin, this voice, this line — because that is knowable
 * before the audio exists. So a cache hit is the file being there, a miss is it not, and nothing has
 * to remember a mapping: no table, no repository, no rows to garbage-collect.
 *
 * It also makes staleness impossible rather than merely unlikely. An operator who remaps `host` from
 * one engine voice to another mints a different key, so the next preview renders instead of playing
 * the old voice back. The file under the old key is inert rather than wrong, and costs a few
 * kilobytes until somebody empties the directory.
 */
export class VoiceSampleStore extends ContentStore<SegmentExtension> {
    constructor(root: string) {
        super(root, SEGMENT_CONTENT_TYPES);
    }

    /**
     * The cache name for one voice on one plugin.
     *
     * sha256 because {@link ContentStore} requires it: every path guard in that class is written
     * against a checksum, and deriving one rather than inventing a naming scheme means a plugin id
     * with a slash in it can never become a directory traversal.
     *
     * The plugin id is in the key because two engines saying `host` are two different voices, and
     * the text is in it so this file's own {@link SAMPLE_TEXT} can be changed without leaving
     * every station holding samples of a line it no longer uses.
     */
    keyFor(pluginId: string, voiceId: string): string {
        return createHash('sha256').update(`${pluginId}\n${voiceId}\n${SAMPLE_TEXT}`).digest('hex');
    }
}
