/**
 * The station settings a show's mix flow reads. Declared in `settings.registry.ts`, read beside the code
 * that acts on them.
 */
export const MIX_FLOW_KEYS = {
    /**
     * Whether the station has a model name a main genre for a band its enrichment gives none, so a mix
     * flow can split and count its records by genre. OFF, on the rule every model walk here follows: it
     * walks a share of the library through the model in the background.
     */
    artistGenres: 'mixFlow.artistGenres',
    /** Which models name them, `provider:model`, in order. Empty for the plugin's default. */
    genreModel: 'llm.genreModel',
} as const;

/** OFF. See {@link MIX_FLOW_KEYS.artistGenres}. */
export const ARTIST_GENRES_DEFAULT = false;
