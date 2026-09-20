/**
 * The station settings this module reads.
 *
 * Declared in `settings.registry.ts` and read here, which is the split every
 * module keeps: the registry owns the form and the defaults, and the typed
 * resolver lives beside the code that acts on it.
 */
export const ENRICHMENT_KEYS = {
    /**
     * Which source wins when two of them describe one record differently.
     *
     * The one provider order that overrides something rather than replacing an
     * accident of spelling. Enrichment already had a precedence: every plugin
     * declares a `priority`, and the merge takes the first non-empty answer
     * field by field, so the lowest number wins a conflicting release year.
     *
     * That number is the plugin AUTHOR's opinion of their own source in the
     * abstract — canonical, supplementary, a guess — and it is a good default
     * precisely because it is not about this station. What it cannot know is
     * that on THIS library one source is consistently right about the year and
     * another consistently wrong, which the operator can see and previously had
     * no way to say short of disabling a source they otherwise wanted.
     *
     * So: anything listed here is asked before anything not, in the order
     * given, and the unlisted keep their declared priority order among
     * themselves. Empty means the declared order exactly, which is what every
     * station did before this existed.
     *
     * It changes what is WRITTEN next, not what is already written. A record
     * enriched yesterday keeps the fields it was promoted with until something
     * enriches it again; the live read side re-merges and changes at once.
     */
    providerOrder: 'enrichment.providerOrder',
} as const;
