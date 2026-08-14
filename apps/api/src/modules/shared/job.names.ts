export type JobNames =
    | 'fake'
    | 'catalog.sync'
    | 'catalog.resolve_placeholders'
    | 'catalog.enrich'
    | 'catalog.cache_art'
    | 'catalog.analyze'
    | 'playout.cache_track'
    | 'director.extend_lineup'
    | 'director.write_break'
    | 'render.segment'
    | 'render.prune_script_history'
    | 'activity.prune_events'
    | 'scrobble.flush';
