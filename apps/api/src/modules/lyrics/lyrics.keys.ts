/**
 * The station settings this module reads.
 *
 * Declared in `settings.registry.ts` and read here, the split every module keeps: the registry owns
 * the form and the defaults, and the typed read lives beside the code that acts on it.
 */
export const LYRICS_KEYS = {
    /**
     * Whether the walk asks the lyrics plugins anything at all.
     *
     * OFF by default, on the rule every switch in this feature follows: installing a lyrics plugin
     * must not change what the station does until somebody decides it should. A lyric is
     * copyrighted text the station holds and never says, and an operator should choose to hold it.
     */
    fetch: 'lyrics.fetch',
    /**
     * Which lyrics source is asked first. Empty means each plugin's declared priority, which is the
     * `enrichment.providerOrder` rule; it orders and never gates.
     */
    providerOrder: 'lyrics.providerOrder',
} as const;

/** OFF. See {@link LYRICS_KEYS.fetch}. */
export const LYRICS_FETCH_DEFAULT = false;
