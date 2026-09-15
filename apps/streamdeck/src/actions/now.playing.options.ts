/** The Now Playing action's id, as the manifest names it. */
export const NOW_PLAYING = 'radio.deadair.streamdeck.now-playing';

/**
 * One Now Playing key's own settings: what it draws over the cover.
 *
 * Action settings rather than global ones, because two keys can want different things (a large
 * cover-only key, a small one with the title) and nothing here is a secret: Elgato exports an
 * action's settings with a profile, which is right for a display choice. Absent means shown, so a
 * key placed before these existed, or never configured, draws everything.
 *
 * Booleans, because these are Stream Deck settings and not the station's: `AppConfig`'s rule that a
 * setting is a string belongs to the API.
 */
export type NowPlayingSettings = {
    showProgress?: boolean;
    showTitle?: boolean;
};

export interface NowPlayingOptions {
    /** The bar along the top. */
    progress: boolean;
    /** The record's title and who it is by. Never the station's own words for why it is quiet, or a failure's. */
    title: boolean;
}

export const SHOW_EVERYTHING: NowPlayingOptions = { progress: true, title: true };

/** What a key's settings ask it to draw. Anything but an explicit `false` is shown. */
export function optionsFrom(settings: unknown): NowPlayingOptions {
    const given = (typeof settings === 'object' && settings !== null ? settings : {}) as NowPlayingSettings;
    return { progress: given.showProgress !== false, title: given.showTitle !== false };
}

/** The settings a pair of choices is saved as. */
export function settingsFor(options: NowPlayingOptions): NowPlayingSettings {
    return { showProgress: options.progress, showTitle: options.title };
}
