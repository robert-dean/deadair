/**
 * Every query key in the app, in one place, so an invalidation and the query it means to invalidate
 * cannot drift apart. Keys are `as const` tuples: TanStack matches them structurally, and the
 * literal types let a typo fail the build rather than silently miss.
 */
export const queryKeys = {
    session: {
        /** The verdict on the refresh cookie. Deliberately not keyed on the session epoch; see `session.bootstrap`. */
        restore: () => ['session', 'restore'] as const,
    },
    onboarding: {
        requirements: () => ['onboarding', 'requirements'] as const,
    },
    plugins: {
        /** The catalogue. Unfiltered: the API narrows nothing, and the console groups by capability itself. */
        list: () => ['plugins', 'list'] as const,
        detail: (id: string) => ['plugins', 'detail', id] as const,
        /**
         * A tail of a plugin's buffered log. Keyed on the query too: a level or limit change is a
         * different page, not a stale one. Called with no `query` at all, this is deliberately a
         * strict prefix of every filtered form below it, so `invalidateQueries` with the id-only key
         * matches the unfiltered tail and every filtered one alike.
         */
        logs: (id: string, query?: { limit?: number; level?: string }) =>
            query === undefined ? (['plugins', 'logs', id] as const) : (['plugins', 'logs', id, query.limit ?? 'all', query.level ?? 'all'] as const),
        /**
         * What the plugin currently offers for its own config fields.
         *
         * Separate from `detail` even though the settings form uses both, because they go stale for
         * different reasons: the detail changes when the operator saves, and this changes when the
         * plugin's own upstream does. Folding it into the detail would mean every save re-probed a
         * model server, and every refresh refetched the manifest.
         */
        configSuggestions: (id: string) => ['plugins', 'config-suggestions', id] as const,
    },
    /**
     * The station's own settings. One key, and no per-group or per-key form: the API answers with
     * all of them at once and a write answers with all of them again, so there is never a slice of
     * this to invalidate on its own.
     */
    settings: {
        all: () => ['settings', 'all'] as const,
    },
    /**
     * The voices the station can speak in. One key: it is the current speech plugin's answer, and
     * there is only ever one of those.
     */
    voices: {
        list: () => ['voices', 'list'] as const,
    },
    playlists: {
        list: () => ['playlists', 'list'] as const,
        tracks: (pluginId: string, playlistId: string) => ['playlists', 'tracks', pluginId, playlistId] as const,
    },
    playout: {
        /** The transport. One key: there is only ever one station, and it is polled rather than paged. */
        status: () => ['playout', 'status'] as const,
    },
    /**
     * The station's programming, as opposed to `playout`, which is what the player was actually
     * handed. There is one running order and the director owns it; the transport is what has become
     * of the head of it.
     */
    director: {
        /** What is on air. One key, for the reason `playout.status` is one key, and polled for the same reason. */
        air: () => ['director', 'air'] as const,
        /** The live running order, item by item. One key, because there is one of them per station. */
        order: () => ['director', 'order'] as const,
    },
    /**
     * The station's own catalog, as opposed to `playlists`, which is whatever the enabled plugins
     * can offer right now.
     *
     * Every list key carries its page and search term. They are a different query rather than a
     * stale one: page 2 is not page 1 refetched, and a search that reused the unfiltered key would
     * overwrite the full list in the cache with a filtered slice of it.
     */
    catalog: {
        artists: (page: number, search?: string) => ['catalog', 'artists', page, search ?? ''] as const,
        artist: (id: string) => ['catalog', 'artist', id] as const,
        artistAlbums: (id: string, page: number, search?: string) => ['catalog', 'artist', id, 'albums', page, search ?? ''] as const,
        /** What every enrichment provider stored about one row. Read only; the walk is the writer. */
        artistEnrichment: (id: string) => ['catalog', 'artist', id, 'enrichment'] as const,
        albums: (page: number, search?: string) => ['catalog', 'albums', page, search ?? ''] as const,
        album: (id: string) => ['catalog', 'album', id] as const,
        albumTracks: (id: string, page: number, search?: string) => ['catalog', 'album', id, 'tracks', page, search ?? ''] as const,
        albumEnrichment: (id: string) => ['catalog', 'album', id, 'enrichment'] as const,
        tracks: (page: number, search?: string) => ['catalog', 'tracks', page, search ?? ''] as const,
        trackEnrichment: (id: string) => ['catalog', 'track', id, 'enrichment'] as const,
    },
} as const;
