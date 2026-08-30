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
        /**
         * What every installed plugin is asking the operator for, and the answer so far.
         *
         * One key rather than one per plugin, because the API answers with the whole list and a
         * decision answers with the whole list again: there is never a slice of this to invalidate
         * on its own. Read by the settings page, which is nowhere near the plugin pages above.
         */
        grants: () => ['plugins', 'grants'] as const,
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
     * What the station is using the disk for. One key: the API answers with every store at once,
     * and there is no slice of it worth invalidating on its own.
     */
    storage: {
        all: () => ['storage', 'all'] as const,
    },
    /**
     * The voices the station can speak in. One key: it is the current speech plugin's answer, and
     * there is only ever one of those.
     */
    voices: {
        list: () => ['voices', 'list'] as const,
    },
    /**
     * What the station's track fetcher holds by way of a Spotify login. One key: it is one reading
     * of one process, and both writes answer in terms of it.
     */
    stream: {
        authorization: () => ['stream', 'authorization'] as const,
    },
    /**
     * How the station says a word. One key, like the voices above: every write answers with the
     * whole lexicon, since accepting a proposal moves one row between two sections of one page.
     */
    pronunciations: {
        list: () => ['pronunciations', 'list'] as const,
    },
    /**
     * The soundboard. One key and no per-board slice: a board is a column of the same list rather
     * than a page of its own, and every write answers with the whole rack.
     */
    pads: {
        list: () => ['pads', 'list'] as const,
    },
    /**
     * Who the station can be. One key, and no per-persona form: every write answers with the whole
     * list, because putting one on air takes another off, so there is never a slice of this worth
     * invalidating on its own. Same shape as `settings` above and for the same reason.
     */
    personas: {
        list: () => ['personas', 'list'] as const,
        /** One character's notebook. Keyed per persona, since a panel only ever draws the one it is open under. */
        notes: (id: string) => ['personas', 'notes', id] as const,
        stories: (id: string) => ['personas', 'stories', id] as const,
    },
    schedule: {
        /** The station's day. One key: every write answers with the whole grid, since a slot's span is its neighbour's start. */
        list: () => ['schedule', 'list'] as const,
        /** Which slot is in force and which one is airing. Its own key because it moves with the clock rather than with the grid. */
        current: () => ['schedule', 'current'] as const,
        /** The day drawn as blocks. Keyed on the window, since a different range is a different page rather than a stale one. */
        timetable: (from: string | undefined, days: number) => ['schedule', 'timetable', from ?? 'today', days] as const,
    },
    productions: {
        list: () => ['productions', 'list'] as const,
    },
    /**
     * What the station's breaks can be about: news categories today, weather locations next. One
     * key for the rows, because every write answers with the whole list — and a separate one for the
     * KINDS, which say what the station can have subjects for at all and change with a deploy rather
     * than with an edit.
     */
    topics: {
        list: () => ['topics', 'list'] as const,
        kinds: () => ['topics', 'kinds'] as const,
    },
    station: {
        /** What needs somebody. One key: it is a reading of the whole station, and there is only one. */
        attention: () => ['station', 'attention'] as const,
        /** The machinery underneath it. One reading, for the same reason. */
        checkup: () => ['station', 'checkup'] as const,
        /**
         * What the station did, decision by decision. Keyed on the filter like the activity feed
         * and for the same reason: a filtered list is a different list rather than a stale one.
         */
        traces: (filter: { kind?: string; failedOnly?: boolean }) =>
            ['station', 'traces', filter.kind ?? 'all', filter.failedOnly === true ? 'failed' : 'all'] as const,
        /** One decision, by the id or prefix that was asked for. */
        trace: (id: string) => ['station', 'trace', id] as const,
        /** Which logs this install has. One key: it is a reading of the box, and there is only one. */
        logSources: () => ['station', 'log-sources'] as const,
        /**
         * A tail of one log. Keyed on the level too, on the same rule the plugin log tail follows:
         * a filtered tail is a different page rather than a stale one.
         */
        log: (id: string, level: string | undefined) => ['station', 'log', id, level ?? 'all'] as const,
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
     * What the station has been doing. Keyed on the filter, not on the page: the pages of one
     * filtered feed live inside a single infinite query, and a filter change is a different feed
     * rather than a stale one. `'all'` stands in for an absent filter so the key stays a tuple of
     * literals.
     */
    activity: {
        feed: (filter: { module?: string; minSeverity?: string }) =>
            ['activity', 'feed', filter.module ?? 'all', filter.minSeverity ?? 'all'] as const,
    },
    /**
     * Everything the station has written, one row per ATTEMPT. Keyed on the filters for the reason
     * the activity feed is: a filtered history is not a stale unfiltered one, and sharing the key
     * would leave a half-filtered list on screen while the new first page loaded.
     */
    /**
     * A chart is a published document that changes at most daily, so the key carries which chart and
     * which edition and nothing else. There is one list and one page per chart, and neither is a
     * filtered view of the other.
     */
    charts: {
        list: () => ['charts', 'list'] as const,
        page: (id: string, date?: string) => ['charts', 'page', id, date ?? ''] as const,
    },

    /**
     * The feed list is one question; the stories are another, narrowed by which feed.
     *
     * The category filter is deliberately NOT in the key: it is applied client-side by joining
     * stories to the feeds that carry a category, so narrowing by one asks the API nothing.
     */
    news: {
        feeds: () => ['news', 'feeds'] as const,
        stories: (feedId?: string) => ['news', 'stories', feedId ?? ''] as const,
    },

    /** One list, because the API answers with the whole library and every write answers with it again. */
    segments: {
        list: () => ['segments', 'list'] as const,
    },

    scripts: {
        // Every filter is part of the key, including the two that arrive from a link: a key missing
        // one is two different questions sharing one answer, and what that looks like is one
        // character's breaks drawn under another character's heading.
        history: (filter: { kind?: string; writer?: string; outcome?: string; segmentId?: string; personaKey?: string }) =>
            [
                'scripts',
                'history',
                filter.kind ?? 'all',
                filter.writer ?? 'all',
                filter.outcome ?? 'all',
                filter.segmentId ?? 'all',
                filter.personaKey ?? 'all',
            ] as const,
        summary: (hours: number) => ['scripts', 'summary', hours] as const,
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
        /** The format clock. One key: order is preference, so every write answers with the whole of it. */
        clock: () => ['director', 'clock'] as const,
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
        artists: (page: number, search?: string, order?: string) => ['catalog', 'artists', page, search ?? '', order ?? ''] as const,
        artist: (id: string) => ['catalog', 'artist', id] as const,
        artistAlbums: (id: string, page: number, search?: string, order?: string) =>
            ['catalog', 'artist', id, 'albums', page, search ?? '', order ?? ''] as const,
        /** What every enrichment provider stored about one row. Read only; the walk is the writer. */
        artistEnrichment: (id: string) => ['catalog', 'artist', id, 'enrichment'] as const,
        albums: (page: number, search?: string, order?: string) => ['catalog', 'albums', page, search ?? '', order ?? ''] as const,
        album: (id: string) => ['catalog', 'album', id] as const,
        albumTracks: (id: string, page: number, search?: string, order?: string) =>
            ['catalog', 'album', id, 'tracks', page, search ?? '', order ?? ''] as const,
        albumEnrichment: (id: string) => ['catalog', 'album', id, 'enrichment'] as const,
        /** Keyed on the state filter too: a filtered list is a different request, not a stale one. */
        tracks: (page: number, search?: string, state?: string, order?: string) =>
            ['catalog', 'tracks', page, search ?? '', state ?? '', order ?? ''] as const,
        /**
         * One record and everything it has accumulated. Separate from `trackEnrichment` because they
         * go stale for different reasons: this moves when the station plays, fetches or measures the
         * record, and that moves when the enrichment walk reaches it.
         */
        track: (id: string) => ['catalog', 'track', id] as const,
        trackEnrichment: (id: string) => ['catalog', 'track', id, 'enrichment'] as const,
    },
} as const;
