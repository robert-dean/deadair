/**
 * The code the Jellyfin and Emby plugins share, which is nearly all of it.
 *
 * Bundled INTO each plugin's `dist` rather than installed beside it: the plugins list this package as
 * a dev dependency, which tsup inlines, so an installed plugin still carries no runtime dependency of
 * its own and `plugin:prove` reads it the way it reads every other bundled plugin.
 */
export * from './mediabrowser.client.js';
export * from './mediabrowser.config.js';
export * from './mediabrowser.dialect.js';
export * from './mediabrowser.enrichment.js';
export * from './mediabrowser.mapping.js';
export * from './mediabrowser.match.js';
export * from './mediabrowser.plugin.js';
export * from './mediabrowser.search.js';
export * from './mediabrowser.types.js';
