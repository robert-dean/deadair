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
 * It also makes staleness impossible rather than merely unlikely — but only because of the `spec`
 * argument below, and this comment claimed it for a long time while the key could not deliver it.
 * The station voice id is exactly the part that does NOT change when an operator edits the mapping
 * under it, so `host = af_heart` becoming `host = bm_george` kept the same key and played the old
 * voice back forever. It went unnoticed only because no station had a mapping to edit.
 *
 * The file under a superseded key is inert rather than wrong, and costs a few kilobytes until
 * somebody empties the directory.
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
     * Four things are in it, and each one is a way the answer can legitimately change:
     *
     * - the PLUGIN, because two engines saying `host` are two different voices;
     * - the station VOICE ID, which is what was asked for;
     * - the plugin's own `SpeechVoice.spec`, which is what the id currently MEANS. Opaque here on
     *   purpose — the host does not know what an engine voice or a speed or a reference clip is, and
     *   does not need to in order to notice that the string changed;
     * - the {@link SAMPLE_TEXT}, so that line can be edited without leaving every station holding
     *   samples of words it no longer uses.
     *
     * A plugin that publishes no `spec` keys exactly as this did before it existed, which is right
     * for an engine whose voices cannot be reconfigured.
     */
    keyFor(pluginId: string, voiceId: string, spec?: string): string {
        return createHash('sha256')
            .update(`${pluginId}\n${voiceId}\n${spec ?? ''}\n${SAMPLE_TEXT}`)
            .digest('hex');
    }
}
